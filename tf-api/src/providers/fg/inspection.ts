import { ProviderError } from "@/errors/app-error.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import type { InspectionRequest, InspectionResult } from "@/contracts/inspection.ts";
import type { PolicyLifecycleStatus } from "@/contracts/enums.ts";
import { FG_SLUG } from "./config.ts";
import type { FgConfig } from "./config.ts";
import { todayIst } from "./mapper.ts";

/**
 * LiveChek break-in / pre-inspection (third-party REST, static `App-key` header).
 * Create a request, then poll status; issuance proceeds only when the inspection
 * is recommended/approved. Spec: Inspection Service/API_Doc_UAT_FG.pdf.
 */

/** Adds `days` to an ISO YYYY-MM-DD date, returning ISO YYYY-MM-DD (UTC-safe). */
function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/** Maps a LiveChek status string to the canonical lifecycle status. */
export function mapLivechekStatus(raw: string | undefined): PolicyLifecycleStatus {
  const s = (raw ?? "").toLowerCase();
  // Check rejection first: "not-recommended" also contains "recommend".
  if (s.includes("reject") || s.includes("not-recommend") || s.includes("decline")) {
    return "INSPECTION_REJECTED";
  }
  if (s.includes("approve") || s.includes("recommend") || s.includes("complete")) {
    return "INSPECTION_APPROVED";
  }
  if (s.includes("close")) return "INSPECTION_CLOSED";
  return "INSPECTION_PENDING";
}

/**
 * Detects whether FG requires a pre-inspection for this journey: break-in
 * (expired previous policy), TP→Comprehensive upgrade, or a rollover missing the
 * previous-policy reference (PYP skipped). New vehicles never need it.
 *
 * Break-in is DERIVED from the dates, not just the client-sent flag: FG decides
 * break-in from PreviousPolExpDt vs the new policy start, so an expired — or
 * unreadable/missing — previous expiry must trigger the inspection path even
 * when the caller left isPreviousPolicyExpired false (live-observed 2026-07-14:
 * FG rejected exactly such a proposal as "break-in Scenario").
 */
export function inspectionRequired(req: MotorQuoteRequest): boolean {
  if (req.businessType === "new" || req.vehicleType === "newVehicle" || req.vehicleType === "newCommercial") {
    return false;
  }
  // Third-party has an inspection WAIVER (no own-damage exposure) — FG applies
  // the T+2 risk-start rule instead (certification SC_09 "Break In - Third
  // Party Policy: Inspection wavier for Third Party Policy").
  if (req.selectedPolicy === "thirdParty") return false;
  if (req.isPreviousPolicyExpired) return true; // break-in (explicit)
  if (req.previousPolicyType === "thirdParty" && req.selectedPolicy === "comprehensive") return true;
  const isRollover = req.businessType === "rollover" || req.businessType === "renewal";
  if (!isRollover) return false;
  if (!req.previousPolicyNumber) return true; // PYP skipped
  // Derived break-in: previous policy expiry unknown, or a real GAP before the
  // new policy starts. A seamless renewal (new start = expiry + 1 day) is NOT a
  // break-in, so compare against expiry+1, not expiry — otherwise the standard
  // rollover (start = prevExpiry+1) self-flags as break-in. ISO YYYY-MM-DD
  // strings compare lexicographically.
  const expiry = req.previousPolicyExpiryDate;
  if (!expiry) return true;
  const start = req.policyStartDate ?? todayIst();
  const seamlessStart = addDaysIso(expiry, 1);
  return start > seamlessStart;
}

async function livechek(
  config: FgConfig,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<unknown> {
  if (!config.inspection.appKey) {
    throw new ProviderError(FG_SLUG, 500, "LiveChek App-key is not configured", undefined, "INSPECTION_CONFIG");
  }
  const headers: Record<string, string> = {
    "app-key": config.inspection.appKey,
    "Content-Type": "application/json",
  };
  const res = await fetch(`${config.inspection.baseUrl}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new ProviderError(FG_SLUG, res.status, `LiveChek request failed [${res.status}]`, text.slice(0, 500));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(FG_SLUG, 502, "LiveChek returned non-JSON", text.slice(0, 500));
  }
}

interface LivechekCreateResponse {
  status?: { code?: number; message?: string };
  data?: { _id?: string; status?: string } & Record<string, unknown>;
}
interface LivechekStatusResponse {
  status?: { code?: number; message?: string };
  data?: { status?: string; refId?: string } & Record<string, unknown>;
}

/** Creates a break-in inspection request. */
export async function createInspection(
  config: FgConfig,
  req: InspectionRequest,
): Promise<InspectionResult> {
  const body = {
    appId: config.inspection.appId,
    companyId: config.inspection.companyId,
    refId: req.refId,
    name: req.name,
    email: req.email,
    mobileNumber: req.mobileNumber,
    address: req.address,
    regNumber: req.regNumber,
    vehicleCategory: req.vehicleCategory,
    vehicleSubCategory: req.vehicleSubCategory,
    make: req.make,
    brand: req.brand,
    modelYear: req.modelYear,
    fuelType: req.fuelType,
    city: req.city,
    odometer: req.odometer,
    regType: req.regType,
    ...(req.appUserId ? { appUserId: req.appUserId } : {}),
  };
  const json = (await livechek(config, "/reports/", "POST", body)) as LivechekCreateResponse;
  const raw = json.data?.status;
  return {
    refId: req.refId,
    inspectionId: json.data?._id,
    status: mapLivechekStatus(raw),
    rawStatus: raw,
    message: json.status?.message,
    _rawResponse: json,
  };
}

/** Polls the status of a previously created inspection request. */
export async function getInspectionStatus(config: FgConfig, refId: string): Promise<InspectionResult> {
  const json = (await livechek(config, `/reports/${encodeURIComponent(refId)}/status`, "GET")) as LivechekStatusResponse;
  const raw = json.data?.status;
  return {
    refId,
    status: mapLivechekStatus(raw),
    rawStatus: raw,
    message: json.status?.message,
    _rawResponse: json,
  };
}

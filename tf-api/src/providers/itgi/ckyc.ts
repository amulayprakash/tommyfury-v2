import type { ItgiConfig } from "./config.ts";
import { ITGI_ENDPOINTS } from "./config.ts";
import type { ItgiTransport } from "./http.ts";

/**
 * ITGI's CKYC is REST/JSON and — per the vendor kit — carries NO auth header;
 * access is presumed to be IP-whitelisted. That assumption is an open
 * confirmation with ITGI (docs/itgi-integration-notes.md §8).
 *
 * Flow: fetch → (validate-OTP → re-fetch when OTPPending) → create when no
 * record exists. The output is the IURN, which every proposal must carry.
 */

export interface ItgiKycFetchRequest {
  clientType: "IND" | "LE";
  firstName: string;
  middleName?: string;
  lastName?: string;
  /** DD-MM-YYYY (note: not the ISO order we use internally). */
  dateofBirth: string;
  gender?: "M" | "F" | "T";
  idType: string;
  idNumber: string;
  /** Mandatory for IND; must match the mobile held on the CKYC record. */
  mobileNumber?: string;
}

export interface ItgiKycResult {
  status: string;
  iurn?: string;
  requiresOtp: boolean;
  success: boolean;
  message?: string;
}

type VendorEnvelope = { status?: number; result?: Record<string, unknown>; errors?: unknown[] };

function readResult(raw: unknown): Record<string, unknown> {
  const env = (raw ?? {}) as VendorEnvelope;
  return env.result ?? {};
}

/** ISO `YYYY-MM-DD` → the CKYC API's `DD-MM-YYYY`. */
export function toCkycDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

export function mapKycStatus(status: string): "verified" | "pending" | "failed" {
  const s = status.trim().toUpperCase();
  if (s === "SUCCESS" || s === "EXISTING RECORD") return "verified";
  if (s.startsWith("OTP")) return s.includes("SUCCESS") ? "verified" : "pending";
  return "failed";
}

function toResult(result: Record<string, unknown>): ItgiKycResult {
  const status = String(result.status ?? "").trim();
  const iurn = String(result.itgiUniqueReferenceId ?? "").trim() || undefined;
  const mapped = mapKycStatus(status);
  return {
    status,
    iurn,
    requiresOtp: status === "OTPPending",
    success: mapped === "verified" && Boolean(iurn),
    message: (result.ckycRemarks as string | undefined) ?? (mapped === "failed" ? status : undefined),
  };
}

/** Step 1 — search ITGI / CERSAI for an existing KYC record. */
export async function itgiKycFetch(
  cfg: ItgiConfig,
  req: ItgiKycFetchRequest,
  transport: ItgiTransport,
  requestId: string,
): Promise<ItgiKycResult> {
  const raw = await transport.json(ITGI_ENDPOINTS.kycFetch(cfg), req, { requestId });
  return toResult(readResult(raw));
}

export interface ItgiKycOtpRequest {
  itgiUniqueReferenceId: string;
  otp?: string;
  resend?: boolean;
}

export interface ItgiKycOtpResult extends ItgiKycResult {
  validated: boolean;
  resent: boolean;
}

/** Step 2 — validate (or resend) the CERSAI download OTP. Exactly one action. */
export async function itgiKycValidateOtp(
  cfg: ItgiConfig,
  req: ItgiKycOtpRequest,
  transport: ItgiTransport,
  requestId: string,
): Promise<ItgiKycOtpResult> {
  const resend = Boolean(req.resend);
  const body = {
    itgiUniqueReferenceId: req.itgiUniqueReferenceId,
    // The vendor rejects both flags being Y (or both N) in a single call.
    validateOTPFlag: resend ? "N" : "Y",
    cersaiDownloadOTP: resend ? "" : (req.otp ?? ""),
    resendOTPFlag: resend ? "Y" : "N",
  };
  const raw = await transport.json(ITGI_ENDPOINTS.kycValidateOtp(cfg), body, { requestId });
  const result = readResult(raw);
  const status = String(result.status ?? "").trim();
  return {
    ...toResult(result),
    validated: status === "OTPValidation-Success",
    resent: status === "OTPReTriggered-Success",
  };
}

export interface ItgiKycDocument {
  idType: "IDENTITY_PROOF" | "ADDRESS_PROOF" | "OTHERS";
  idName: string;
  idNumber: string;
  fileName: string;
  fileExtension: "pdf" | "jpg" | "jpeg" | "tif" | "tiff";
  fileBase64: string;
}

export interface ItgiKycCreateRequest {
  clientType: "IND" | "LE";
  prefix?: string;
  firstName: string;
  middleName?: string;
  lastName?: string;
  gender?: "M" | "F" | "T";
  dateofBirth: string;
  relationshipType?: "Father" | "Spouse" | "Mother";
  relatedPersonPrefix?: string;
  relatedPersonFirstName?: string;
  relatedPersonMiddleName?: string;
  relatedPersonLastName?: string;
  mobileNumber: string;
  emailAddress: string;
  addressLine1: string;
  city: string;
  district: string;
  state: string;
  country: string;
  pinCode: string;
  correspondenceAddressLine1: string;
  correspondenceCity: string;
  correspondenceDistrict: string;
  correspondenceState: string;
  correspondenceCountry: string;
  correspondencePinCode: string;
  /** PAN or FORM60 required; ≥1 ADDRESS_PROOF; PHOTOGRAPH mandatory for IND. */
  kycDocuments: ItgiKycDocument[];
}

/** Step 3 — create the KYC record when no existing one was found. */
export async function itgiKycCreate(
  cfg: ItgiConfig,
  req: ItgiKycCreateRequest,
  transport: ItgiTransport,
  requestId: string,
): Promise<ItgiKycResult> {
  const raw = await transport.json(ITGI_ENDPOINTS.kycCreate(cfg), req, { requestId });
  return toResult(readResult(raw));
}

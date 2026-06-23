import { ProviderError } from "@/errors/app-error.ts";
import type { CkycRequest, KycResult } from "@/contracts/kyc.ts";
import { FG_SLUG } from "./config.ts";
import type { FgConfig } from "./config.ts";

/**
 * FG CKYC (GCKYC/3.0.0) — JSON, on its own WSO2 product (separate client
 * subscription + static `Token` header). Flow: POST /Web/VerifyCKYC; on a hit
 * the proposal carries the CKYC number, on a miss FG returns a redirect `url`
 * for manual document upload. Spec: GC_CKYCAPI_WebaggDocumentation-UAT.pdf.
 */

interface VerifyCkycResponse {
  uid?: string;
  apiStatus?: string; // "Success" | "Failed"
  kycStatus?: number; // 0 = OTP/no-record path, 1 = existing case
  response?: {
    req_id?: string;
    proposal_id?: string;
    proposalId?: string;
    ckyc_remarks?: string;
    ckyc_request_id?: string | null;
    idNum?: string;
    url?: string;
    finalStatus?: string;
    success?: boolean;
    message?: string;
    uploadedDocuments?: { full_name?: string } & Record<string, unknown>;
  } | null;
  errorMessage?: string | null;
}

/** Maps the canonical CkycRequest to FG's VerifyCKYC body. */
function toVerifyBody(req: CkycRequest, systemName: string): Record<string, unknown> {
  const idType = req.panNumber ? "PAN" : req.aadhaarNumber ? "AADHAAR" : "CKYC";
  const idNum = req.panNumber ?? req.aadhaarNumber ?? req.ckycNumber ?? "";
  return {
    id_type: idType,
    id_num: idNum,
    dob: req.dob, // YYYY-MM-DD (v3 format)
    mobile: req.mobile ?? "",
    full_name: req.fullName ?? req.nameAsPerAadhaar ?? "",
    gender: req.gender ?? "",
    url_type: "",
    customer_type: "I",
    ...(req.redirectUrl ? { redirect_url: req.redirectUrl } : {}),
    system_name: systemName,
  };
}

async function postJson(url: string, token: string, subscriptionToken: string | undefined, body: unknown) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "*/*",
    Authorization: `Bearer ${token}`,
  };
  if (subscriptionToken) headers.Token = subscriptionToken;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new ProviderError(FG_SLUG, res.status, `FG CKYC request failed [${res.status}]`, text.slice(0, 500));
  }
  try {
    return JSON.parse(text) as VerifyCkycResponse;
  } catch {
    throw new ProviderError(FG_SLUG, 502, "FG CKYC returned non-JSON", text.slice(0, 500));
  }
}

/** Runs VerifyCKYC and maps the outcome to the canonical KycResult. */
export async function fgVerifyCkyc(
  config: FgConfig,
  req: CkycRequest,
  token: string,
): Promise<KycResult> {
  if (!req.mobile || !req.fullName) {
    throw new ProviderError(
      FG_SLUG,
      422,
      "FG CKYC requires the customer mobile and full name",
      undefined,
      "CKYC_INPUT_REQUIRED",
    );
  }
  const json = await postJson(
    `${config.ckyc.baseUrl}/Web/VerifyCKYC`,
    token,
    config.ckyc.subscriptionToken,
    toVerifyBody(req, config.vendorCode),
  );

  const ok = (json.apiStatus ?? "").toLowerCase() === "success";
  const r = json.response ?? {};
  const proposalId = r.proposal_id ?? r.proposalId;
  const redirectUrl = r.url;

  if (!ok) {
    return {
      isKycSuccess: false,
      proposalId,
      displayMessage: json.errorMessage ?? r.message ?? "CKYC verification failed",
      _rawResponse: json,
    };
  }

  // A redirect URL means no auto-match — the customer must complete manual KYC.
  if (redirectUrl) {
    return {
      isKycSuccess: false,
      requiresRedirect: true,
      redirectUrl,
      proposalId,
      kycId: proposalId,
      displayMessage: r.ckyc_remarks ?? "Complete KYC verification to continue",
      _rawResponse: json,
    };
  }

  // Auto-matched: proposalId carries the CKYC; the number is confirmed via status.
  return {
    isKycSuccess: true,
    proposalId,
    kycId: proposalId,
    ckycRefId: proposalId,
    name: r.uploadedDocuments?.full_name ?? req.fullName,
    _rawResponse: json,
  };
}

interface CkycStatusResponse {
  apiStatus?: string;
  response?: { ckyc_no?: string; ckycNumber?: string; finalStatus?: string; status?: string } | null;
  errorMessage?: string | null;
}

/**
 * Polls CKYC status by proposalId to retrieve the final CKYC number (fed into
 * CreateProposal). The v3 status path is best-effort; confirm with FG.
 */
export async function fgGetCkycStatus(
  config: FgConfig,
  proposalId: string,
  token: string,
): Promise<{ ckycNumber?: string; status?: string; raw: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "*/*",
    Authorization: `Bearer ${token}`,
  };
  if (config.ckyc.subscriptionToken) headers.Token = config.ckyc.subscriptionToken;
  const res = await fetch(`${config.ckyc.baseUrl}/Web/GetCKYCStatus`, {
    method: "POST",
    headers,
    body: JSON.stringify({ proposal_id: proposalId, proposalId }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new ProviderError(FG_SLUG, res.status, `FG CKYC status failed [${res.status}]`, text.slice(0, 500));
  }
  let json: CkycStatusResponse = {};
  try {
    json = JSON.parse(text) as CkycStatusResponse;
  } catch {
    throw new ProviderError(FG_SLUG, 502, "FG CKYC status returned non-JSON", text.slice(0, 500));
  }
  const r = json.response ?? {};
  return { ckycNumber: r.ckyc_no ?? r.ckycNumber, status: r.finalStatus ?? r.status, raw: json };
}

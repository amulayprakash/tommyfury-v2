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
    /** Registry auto-match delivers the CKYC number right here (remarks "OK"). */
    ckyc_number?: string | null;
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

async function postJson<T = VerifyCkycResponse>(
  url: string,
  token: string,
  subscriptionToken: string | undefined,
  body: unknown,
): Promise<T> {
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
    return JSON.parse(text) as T;
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

  // Auto-matched. A registry hit (ckyc_remarks "OK") carries the CKYC number
  // directly in this response; older/manual cases deliver it via GetKycStatus.
  const ckycNumber = r.ckyc_number ?? undefined;
  return {
    isKycSuccess: true,
    ckycNumber,
    proposalId,
    kycId: ckycNumber ?? proposalId,
    ckycRefId: proposalId,
    name: r.uploadedDocuments?.full_name ?? req.fullName,
    _rawResponse: json,
  };
}

interface CkycStatusResponse {
  apiStatus?: string;
  kycStatus?: number;
  response?: {
    finalStatus?: string;
    status?: string;
    success?: boolean;
    message?: string;
    ckyc_no?: string;
    ckycNumber?: string;
    uploadedDocuments?: ({ ckycNumber?: string | null } & Record<string, unknown>) | null;
  } | null;
  errorMessage?: string | null;
}

export interface FgCkycStatus {
  ckycNumber?: string;
  status?: string;
  success?: boolean;
  message?: string;
  raw: unknown;
}

/**
 * Fetches the KYC state for a VerifyCKYC proposalId. v3 endpoint (per FG's
 * GC-CKYCAPI v3 Postman collection, live-verified): POST /Verify/GetKycStatus
 * with {proposal_id, system_name}. Once KYC completes, the CKYC number (fed
 * into CreateProposal) arrives nested in response.uploadedDocuments.ckycNumber;
 * response.success / finalStatus report whether it is actually complete.
 */
export async function fgGetCkycStatus(
  config: FgConfig,
  proposalId: string,
  token: string,
): Promise<FgCkycStatus> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "*/*",
    Authorization: `Bearer ${token}`,
  };
  if (config.ckyc.subscriptionToken) headers.Token = config.ckyc.subscriptionToken;
  const res = await fetch(`${config.ckyc.baseUrl}/Verify/GetKycStatus`, {
    method: "POST",
    headers,
    body: JSON.stringify({ proposal_id: proposalId, system_name: config.vendorCode }),
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
  return {
    ckycNumber: r.uploadedDocuments?.ckycNumber ?? r.ckyc_no ?? r.ckycNumber,
    status: r.finalStatus ?? r.status,
    success: r.success,
    message: r.message,
    raw: json,
  };
}

// ─── UploadDocBytes (GCKYC/3.0.0 /Verify/UploadDocBytes) ──────────────────────
// Manual document-upload path for the CKYC-miss case where the redirect URL is
// unusable: POST a base64 document; Arya OCR extracts + verifies it. The CKYC
// number is NOT returned here — poll GetKycStatus (finalStatus 1 or 3) after a
// verified upload. Spec: FGI-CKYC-API-DOC.docx §4 UploadDocBytes.

export interface FgUploadDocRequest {
  /** Unique request id for this upload (we pass the provider requestId). */
  reqId: string;
  /** VerifyCKYC proposal_id (`PR_xxx`) the document is attached to. */
  proposalId: string;
  /** Document kind hint — "pdf" (file is a PDF) or an ID type like "aadhar". */
  docType: string;
  /** Base64 of the document bytes (no data: prefix). */
  docBase64: string;
}

interface UploadDocResponse {
  extracted_data?:
    | ({
        name?: string | null;
        dob?: string | null;
        aadhar_id?: string | null;
        gender?: string | null;
        address?: string | null;
        aadhar_masked_no?: string | null;
        father_spouse_name?: string | null;
      } & Record<string, unknown>)
    | null;
  doc_type?: string;
  image_quality?: string | null;
  req_id?: string;
  success?: boolean;
  error_message?: string | null;
  verify_data?: { status?: boolean; code?: number; message?: string | null } | null;
  proposal_id?: string;
}

export interface FgUploadDocResult {
  /** True only when recognition AND verification both passed. */
  isVerified: boolean;
  extractedName?: string;
  imageQuality?: string;
  proposalId?: string;
  message?: string;
  raw: unknown;
}

/** Chooses FG's `doc_type` from the uploaded file's mime + declared ID type. */
export function fgCkycDocType(mimeType: string, idType: string): string {
  if (mimeType === "application/pdf") return "pdf";
  return idType === "AADHAAR" ? "aadhar" : idType.toLowerCase();
}

/** Uploads one document to FG's CKYC OCR/verify endpoint and maps the outcome. */
export async function fgUploadDocBytes(
  config: FgConfig,
  req: FgUploadDocRequest,
  token: string,
): Promise<FgUploadDocResult> {
  const json = await postJson<UploadDocResponse>(
    `${config.ckyc.baseUrl}/Verify/UploadDocBytes`,
    token,
    config.ckyc.subscriptionToken,
    {
      req_id: req.reqId,
      proposal_id: req.proposalId,
      doc_type: req.docType,
      doc_base64: req.docBase64,
    },
  );

  const isVerified = json.success === true && json.verify_data?.status === true;
  return {
    isVerified,
    extractedName: json.extracted_data?.name ?? undefined,
    imageQuality: json.image_quality ?? undefined,
    proposalId: json.proposal_id ?? req.proposalId,
    message: json.error_message || json.verify_data?.message || undefined,
    raw: json,
  };
}

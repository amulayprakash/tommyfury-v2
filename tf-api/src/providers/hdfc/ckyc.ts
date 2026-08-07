import { ProviderError } from "@/errors/app-error.ts";
import { tokenManager, expiryWithThreshold } from "@/providers/token-manager.ts";
import type { CkycRequest, KycResult } from "@/contracts/kyc.ts";
import { toHdfcDate } from "./format.ts";
import { HDFC_SLUG, type HdfcConfig } from "./config.ts";

/**
 * Pehchaan e-KYC. A separate service from the HEI motor API: different host,
 * different auth (api_key → ~10-minute JWT), different vocabulary.
 *
 *   #0    GET /tgt/generate-token            (header api_key)  → { token, expiry }
 *   #1.2  GET /primary/kyc-verified          (header token)    → verified | redirect
 *   #1.3  GET /primary/kyc-status/:kycId
 *
 * Status polling needs no extra route: /primary/kyc-verified accepts kyc_id and
 * txn_id as lookup keys, so after the hosted journey returns with ?kycId=… the
 * client simply calls completeCkyc again with that id in `ckycNumber`.
 */

const KYC_TOKEN_CACHE_KEY = `${HDFC_SLUG}:kyc`;

const ENDPOINTS = {
  generateToken: "/tgt/generate-token",
  fetchKyc: "/primary/kyc-verified",
} as const;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Mints (or reuses) the Pehchaan JWT. */
async function getKycToken(config: HdfcConfig): Promise<string> {
  if (!config.kyc.apiKey) {
    throw new ProviderError(
      HDFC_SLUG,
      500,
      "HDFC Pehchaan api_key is not configured (set HDFC_KYC_API_KEY)",
    );
  }
  return tokenManager.getToken(KYC_TOKEN_CACHE_KEY, async () => {
    const res = await fetch(config.kyc.baseUrl + ENDPOINTS.generateToken, {
      headers: { api_key: config.kyc.apiKey },
    });
    const body = obj(await readJson(res));
    const data = obj(body.data);
    const token = str(data.token) ?? str(body.token);
    if (!token) {
      throw new ProviderError(HDFC_SLUG, res.status, "HDFC Pehchaan token generation failed", body);
    }
    // `expiry` is an epoch in seconds when present; otherwise fall back to config.
    const expirySec = Number(data.expiry ?? body.expiry ?? 0);
    const expiresAt =
      expirySec > 0
        ? expiryWithThreshold(expirySec * 1000)
        : Date.now() + config.kyc.tokenTtlSeconds * 1000 * 0.8;
    return { accessToken: token, expiresAt };
  });
}

/** Only the parameters Pehchaan recognises, all lower-snake, blanks omitted. */
export function toPehchaanParams(req: CkycRequest, config: HdfcConfig): Record<string, string> {
  const candidates: Record<string, string | undefined> = {
    // ckycNumber doubles as Pehchaan's kyc_id — that is how the post-redirect
    // status poll re-enters this same call.
    kyc_id: req.ckycNumber,
    pan: req.panNumber,
    dob: toHdfcDate(req.dob) ?? undefined,
    mobile: req.mobile,
    name: req.fullName,
    aadhaar_uid: req.aadhaarNumber,
    txn_id: req.transactionId,
    redirect_url: req.redirectUrl ?? config.kyc.returnUrl,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(candidates)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Maps Pehchaan's two response shapes onto the canonical KycResult. The
 * not-found shape deliberately mirrors FG's manual-KYC fallback
 * ({requiresRedirect, redirectUrl}) so the frontend's existing redirect handling
 * applies unchanged.
 */
export function normalizePehchaan(body: unknown): KycResult {
  const b = obj(body);
  const d = obj(b.data ?? b);

  const redirectUrl =
    str(d.redirection_link) ?? str(d.redirectionLink) ?? str(d.link) ?? str(b.redirection_link);
  if (redirectUrl) {
    return {
      isKycSuccess: false,
      requiresRedirect: true,
      redirectUrl,
      ckycRefId: str(d.txn_id) ?? str(b.txn_id),
      displayMessage: "Complete KYC on the HDFC Pehchaan portal to continue",
      _rawResponse: body,
    };
  }

  const verified = Number(d.iskycVerified) === 1 || d.status === "approved";
  return {
    isKycSuccess: verified,
    kycId: str(d.kyc_id),
    ckycNumber: str(d.kyc_id),
    name: str(d.name),
    dob: str(d.dob),
    email: str(d.email),
    phone: str(d.mobile),
    permanentAddress: str(d.permanentAddress),
    correspondenceAddress: str(d.correspondenceAddress) ?? str(d.permanentAddress),
    displayMessage: str(d.status),
    _rawResponse: body,
  };
}

/** Looks up an existing verified KYC, or returns the hosted-journey redirect. */
export async function hdfcCompleteCkyc(config: HdfcConfig, req: CkycRequest): Promise<KycResult> {
  const params = new URLSearchParams(toPehchaanParams(req, config));
  const url = `${config.kyc.baseUrl}${ENDPOINTS.fetchKyc}?${params.toString()}`;

  let token = await getKycToken(config);
  let res = await fetch(url, { headers: { token } });

  if (res.status === 401) {
    // The JWT died mid-flight — drop it so the next caller mints fresh, and retry once.
    tokenManager.invalidate(KYC_TOKEN_CACHE_KEY);
    token = await getKycToken(config);
    res = await fetch(url, { headers: { token } });
  }

  return normalizePehchaan(await readJson(res));
}

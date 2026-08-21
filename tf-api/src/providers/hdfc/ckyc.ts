import { ProviderError } from "@/errors/app-error.ts";
import { tokenManager, expiryWithThreshold } from "@/providers/token-manager.ts";
import type { CkycRequest, KycResult } from "@/contracts/kyc.ts";
import { toHdfcDate } from "./format.ts";
import { HDFC_SLUG, type HdfcConfig } from "./config.ts";

/**
 * Pehchaan e-KYC. A separate service from the HEI motor API: different host,
 * different auth (api_key → ~10-minute JWT), different vocabulary.
 *
 *   #0      GET /tgt/generate-token                        (header api_key) → { token, expiry }
 *   #1.2    GET /primary/kyc-verified                      (header token)   → verified | redirect
 *   #1.2.1  GET /partner/corporate/kyc                     (header token)   → verified | redirect
 *   #1.3    GET /primary/kyc-status/:kycId                 (header token)   → { iskycVerified, status }
 *   #1.4    GET /primary/kyc-status/transaction-id/:txnId  (header token)   → { iskycVerified, status }
 *
 * /primary/kyc-verified accepts kyc_id and txn_id as lookup keys, so *fetching a
 * verified identity* after the hosted journey returns needs no extra route. The
 * two status routes are a different job: they poll a verification still in
 * progress, and they are the documented way to learn one was REJECTED —
 * something /primary/kyc-verified never reports.
 */

const KYC_TOKEN_CACHE_KEY = `${HDFC_SLUG}:kyc`;

const ENDPOINTS = {
  generateToken: "/tgt/generate-token",
  fetchKyc: "/primary/kyc-verified",
  fetchCorporateKyc: "/partner/corporate/kyc",
  kycStatus: "/primary/kyc-status",
  kycStatusByTxn: "/primary/kyc-status/transaction-id",
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
 * Corporate Pehchaan parameters (kit doc 1.2.1, /partner/corporate/kyc).
 *
 * The kit lists three accepted key pairs — PAN+DOI (preferred), CIN+DOI and
 * CKYC+DOI — and mandates ent_type, redirect_url and txn_id on top of whichever
 * pair is used. All parameter names are lowercase.
 *
 * Deliberately does NOT read req.dob: a corporate entity has no date of birth,
 * and callers duplicate dateOfIncorporation into that mandatory field. See the
 * note on `dob` in src/contracts/kyc.ts.
 */
export function toCorporatePehchaanParams(
  req: CkycRequest,
  config: HdfcConfig,
): Record<string, string> {
  const candidates: Record<string, string | undefined> = {
    ent_pan: req.entityPan,
    ent_cin: req.entityCin,
    ent_ckycnum: req.entityCkycNumber,
    doi: toHdfcDate(req.dateOfIncorporation) ?? undefined,
    ent_type: req.entityType,
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

  // `redirect_link` is the key Pehchaan actually emits. Counted across both kit
  // documents, `redirection_link`/`redirectionLink` occur ZERO times, while
  // `redirect_link` carries the hosted-journey URL in all nine negative samples
  // (six in doc 1.2, three in doc 1.2.1) — and a live corporate negative case on
  // 2026-08-21 returned it. The `redirection_link` spellings below are kept only
  // as tolerant fallbacks; reading them alone left this branch dead against the
  // real service, silently discarding the link and reporting a bare failure.
  //
  // Do NOT add `redirect_url` to this chain. It is the REQUEST parameter we send
  // (where Pehchaan returns the user to), not a response field; the `redirectUrl=`
  // inside the returned link is our own value echoed back as a query param of
  // that URL string, not a JSON key.
  const redirectUrl =
    str(d.redirect_link) ??
    str(d.redirection_link) ??
    str(d.redirectionLink) ??
    str(d.link) ??
    str(b.redirect_link) ??
    str(b.redirection_link);
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
    // Individual responses carry `name` and `dob`. Corporate ones carry `doi`
    // rather than `dob` — but they carry `name`, NOT the `fullName` that kit doc
    // 1.2.1 documents: both live corporate responses on 2026-08-21 came back with
    // `name` (`scripts/_hdfc-corporate-kyc-probe-*.json`). `fullName` stays in the
    // fallback chain because the kit spells it that way and both shapes land in
    // the same canonical slots — but the kit's spelling is NOT what was observed,
    // which is this file's lesson of the week (see `redirect_link` above).
    name: str(d.name) ?? str(d.fullName),
    dob: str(d.dob) ?? str(d.doi),
    email: str(d.email),
    phone: str(d.mobile),
    permanentAddress: str(d.permanentAddress),
    correspondenceAddress: str(d.correspondenceAddress) ?? str(d.permanentAddress),
    displayMessage: str(d.status),
    _rawResponse: body,
  };
}

/**
 * The status endpoints (kit docs 1.3, 1.4) return only { iskycVerified, status }
 * — no identity. They exist to poll a verification still in progress, and they
 * are the documented way to learn one was REJECTED, which /primary/kyc-verified
 * does not tell you.
 */
export function normalizeKycStatus(body: unknown, kycId: string | undefined): KycResult {
  const d = obj(obj(body).data ?? body);
  return {
    isKycSuccess: Number(d.iskycVerified) === 1,
    kycId,
    ckycNumber: kycId,
    ckycRefId: str(d.txn_id),
    displayMessage: str(d.status),
    _rawResponse: body,
  };
}

/** Shared transport for every Pehchaan GET: token, request, retry once on 401. */
async function getWithToken(config: HdfcConfig, url: string): Promise<unknown> {
  let token = await getKycToken(config);
  let res = await fetch(url, { headers: { token } });
  if (res.status === 401) {
    // The JWT died mid-flight — drop it so the next caller mints fresh, and retry once.
    tokenManager.invalidate(KYC_TOKEN_CACHE_KEY);
    token = await getKycToken(config);
    res = await fetch(url, { headers: { token } });
  }
  return readJson(res);
}

/** Polls a Pehchaan KYC by its own id (kit doc 1.3). */
export async function hdfcKycStatusByKycId(config: HdfcConfig, kycId: string): Promise<KycResult> {
  const url = `${config.kyc.baseUrl}${ENDPOINTS.kycStatus}/${encodeURIComponent(kycId)}`;
  return normalizeKycStatus(await getWithToken(config, url), kycId);
}

/** Polls a Pehchaan KYC by the transaction id we sent (kit doc 1.4). */
export async function hdfcKycStatusByTxnId(config: HdfcConfig, txnId: string): Promise<KycResult> {
  const url = `${config.kyc.baseUrl}${ENDPOINTS.kycStatusByTxn}/${encodeURIComponent(txnId)}`;
  return normalizeKycStatus(await getWithToken(config, url), undefined);
}

/** Looks up an existing verified KYC, or returns the hosted-journey redirect. */
export async function hdfcCompleteCkyc(config: HdfcConfig, req: CkycRequest): Promise<KycResult> {
  // A corporate proposer goes through Pehchaan's separate corporate kit, which
  // takes entity-shaped parameters (kit doc 1.2.1). Everything downstream —
  // token, retry-once-on-401, normalization — is identical.
  const isCorporate = req.customerType === "corporate";
  const endpoint = isCorporate ? ENDPOINTS.fetchCorporateKyc : ENDPOINTS.fetchKyc;
  const params = new URLSearchParams(
    isCorporate ? toCorporatePehchaanParams(req, config) : toPehchaanParams(req, config),
  );
  const url = `${config.kyc.baseUrl}${endpoint}?${params.toString()}`;

  return normalizePehchaan(await getWithToken(config, url));
}

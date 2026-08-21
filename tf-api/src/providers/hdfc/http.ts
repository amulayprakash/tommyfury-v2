import { ProviderError } from "@/errors/app-error.ts";
import { HDFC_SLUG } from "./config.ts";

/** Injectable so fixture-driven tests never touch the network. */
export interface HdfcTransport {
  request(args: {
    method: "GET" | "POST";
    url: string;
    headers: Record<string, string>;
    jsonBody?: unknown;
    /**
     * Safe to retry on 5xx / network failure. Only the read-only steps
     * (authenticate, IDV, premium) opt in — a retried createProposal or
     * submitPaymentDetails could bind a duplicate policy.
     */
    idempotent?: boolean;
  }): Promise<unknown>;
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Default transport. Note it does NOT throw on a non-2xx status alone: HDFC UAT
 * returns diagnostic bodies with 4xx/5xx codes, and discarding them would leave
 * us with no way to explain a failure.
 */
export class FetchTransport implements HdfcTransport {
  async request(args: {
    method: "GET" | "POST";
    url: string;
    headers: Record<string, string>;
    jsonBody?: unknown;
    idempotent?: boolean;
  }): Promise<unknown> {
    const headers = { ...args.headers };
    let body: string | undefined;
    if (args.jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(args.jsonBody);
    }

    const maxAttempts = args.idempotent ? MAX_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(args.url, { method: args.method, headers, body });
      } catch (err) {
        if (attempt < maxAttempts) {
          await sleep(RETRY_BASE_MS * attempt);
          continue;
        }
        throw new ProviderError(HDFC_SLUG, 0, `HDFC request failed: ${(err as Error).message}`);
      }

      const text = await response.text().catch(() => "");
      const parsed = text ? safeJson(text) : undefined;

      if (!response.ok) {
        if (response.status >= 500 && attempt < maxAttempts) {
          await sleep(RETRY_BASE_MS * attempt);
          continue;
        }
        // HDFC returns diagnostic bodies WITH 4xx/5xx codes, so hand those to
        // assertHdfcSuccess to surface verbatim rather than flattening them.
        // But only when the body actually looks like an HDFC envelope:
        // assertHdfcSuccess deliberately passes a body carrying neither a status
        // nor an error (bare 200 document payloads do that), so returning an
        // unrecognised non-2xx body — a gateway fault like
        // {"fault":{"message":"Invalid credentials"}} — would be read as SUCCESS
        // and normalize to a zero premium. Fail closed instead.
        if (carriesHdfcEnvelope(parsed)) return parsed;
        throw new ProviderError(
          HDFC_SLUG,
          response.status,
          `HDFC request failed [${response.status}]`,
          parsed ?? text,
        );
      }
      return parsed;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * True when a body carries a field assertHdfcSuccess can actually judge. Arrays
 * are excluded despite being typeof "object" — they can hold no status key, so
 * treating one as an envelope would silently pass.
 */
export function carriesHdfcEnvelope(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  return (
    b.StatusCode !== undefined ||
    b.statusCode !== undefined ||
    b.Status !== undefined ||
    b.status !== undefined ||
    b.Error !== undefined ||
    b.error !== undefined ||
    // Message is judgeable too, now that assertHdfcSuccess reads it. Without
    // this the two disagree: a non-2xx body carrying only a Message would be
    // rejected here as unjudgeable, losing the one line explaining why.
    b.Message !== undefined ||
    b.message !== undefined
  );
}

export interface NormalizedHdfcResponse {
  statusCode: string | number | null;
  error: string | null;
  /**
   * HDFC's other diagnostic channel. UNDOCUMENTED — the data dictionary's
   * response sheets list only StatusCode / Error / Warning — but it is what the
   * wire actually carries, on success ("Premium Calculated", "Proposal
   * Generated") and on failure alike. Ignoring it is why a live CreateProposal
   * refusal once reported itself as the useless "status 0".
   */
  message: string | null;
  warning: string | null;
  data: unknown;
}

/** HDFC is inconsistent about casing; collapse it into one shape. */
export function normalizeHdfcResponse(raw: unknown): NormalizedHdfcResponse {
  if (raw == null || typeof raw !== "object") {
    return { statusCode: null, error: null, message: null, warning: null, data: raw };
  }
  const r = raw as Record<string, unknown>;
  return {
    statusCode: (r.StatusCode ?? r.statusCode ?? r.Status ?? r.status ?? null) as string | number | null,
    error: (r.Error ?? r.error ?? null) as string | null,
    message: (r.Message ?? r.message ?? r.Msg ?? r.msg ?? null) as string | null,
    warning: (r.Warning ?? r.warning ?? null) as string | null,
    data: raw,
  };
}

/**
 * HDFC uses "1" / 200 / "200" / "SUCCESS" across endpoints — the code differs by
 * endpoint, so this is a set rather than one value. It is NOT exhaustive: a
 * successful CreateProposal answers 0. See `completedWrite` for why that is
 * judged on evidence instead of by widening this set.
 */
export function isHdfcSuccess(statusCode: unknown): boolean {
  if (statusCode == null) return false;
  const s = String(statusCode).trim().toUpperCase();
  return s === "1" || s === "200" || s === "TRUE" || s === "SUCCESS";
}

/**
 * Raises when HDFC reports a business failure. HDFC's `Error` text (typically
 * "BUSINESS EXCEPTION: …") is the ONLY diagnostic it provides, so it is carried
 * verbatim into the message rather than being replaced with a generic string.
 *
 * A body with neither a status code nor an error is accepted: some document
 * endpoints return a bare payload.
 */
export function assertHdfcSuccess(body: unknown, step: string): void {
  const norm = normalizeHdfcResponse(body);
  if (isHdfcSuccess(norm.statusCode)) return;
  if (completedWrite(body)) return;
  if (norm.statusCode == null && !norm.error && !norm.message) return;
  const reason = norm.error ?? norm.message ?? `status ${String(norm.statusCode)}`;
  throw new ProviderError(HDFC_SLUG, 502, `HDFC ${step} failed: ${reason}`, body);
}

/**
 * True when the body proves the write HDFC was asked to perform actually landed.
 *
 * Live on 21/08/2026 a SUCCESSFUL CreateProposal answered `StatusCode: 0` with
 * `Message: "Proposal Generated"` and a real proposal number. `isHdfcSuccess`
 * does not recognise 0, so the call was reported as failed — a false negative on
 * a WRITE. HDFC had already created the proposal; each retry created another,
 * and the numbers were thrown away with the exception.
 *
 * The narrow fix is to trust the artifact rather than the status code. HDFC does
 * not mint a proposal or policy number for a request it rejected, so either one
 * is positive proof of success no matter what the envelope says. Widening
 * `isHdfcSuccess` to accept 0 was the alternative and is worse: 0 would then read
 * as success on every endpoint, including ones where it genuinely means failure.
 */
function completedWrite(body: unknown): boolean {
  if (body == null || typeof body !== "object") return false;
  const pd = (body as Record<string, unknown>).Policy_Details;
  const details = pd && typeof pd === "object" ? (pd as Record<string, unknown>) : {};
  const artifact = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";
  return (
    artifact(details.ProposalNumber) ||
    artifact(details.PolicyNumber) ||
    artifact((body as Record<string, unknown>).ProposalNumber) ||
    artifact((body as Record<string, unknown>).PolicyNumber)
  );
}

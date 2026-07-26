import { ProviderError } from "@/errors/app-error.ts";
import { ITGI_SLUG } from "./config.ts";

/** Vendor sentinels meaning "accepted by the ITGI core (P400)". */
const SUCCESS_MESSAGES = new Set([
  "SUCCESSFULLY_SUBMITTED_IN_P400",
  "SUCCESSFULLY_UPDATED_IN_P400",
  "PAYMENT_ACCEPTED_BREAK_IN",
]);

export function isItgiSuccessMessage(message: string | undefined): boolean {
  return Boolean(message && SUCCESS_MESSAGES.has(message.trim().toUpperCase()));
}

/**
 * A canonical id has no ITGI counterpart in the Provider*Code tables. Treated as
 * "no quote" rather than a hard error so one unmapped vehicle/RTO never breaks
 * the whole comparison page.
 *
 * This is load-bearing for RTO: the vendor kit ships no RTO master, so the
 * resolver fails closed here rather than guessing a token.
 */
export class ItgiUnmappedCodeError extends Error {
  readonly code = "UNMAPPED_CODE";
  constructor(kind: string, value: string) {
    super(`ITGI has no ${kind} mapping for "${value}"`);
    this.name = "ItgiUnmappedCodeError";
  }
}

export function classifyItgiError(message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("unavailable") ||
    m.includes("connection")
  )
    return "UPSTREAM_UNAVAILABLE";
  if (m.includes("inspection") || m.includes("break-in") || m.includes("breakin"))
    return "INSPECTION_REQUIRED";
  if (m.includes("kyc") || m.includes("iurn")) return "KYC_INCOMPLETE";
  if (m.includes("declined") || m.includes("not allowed") || m.includes("referral"))
    return "REFERRAL_DECLINED";
  if (m.includes("master") || m.includes("invalid") || m.includes("mandatory"))
    return "VALIDATION_FAILED";
  return "PROVIDER_ERROR";
}

function firstErrorText(root: Record<string, unknown>): string {
  // `erorMessage` is the vendor's own misspelling (IDV response) — keep it.
  for (const key of ["erorMessage", "errorMessage", "error", "Error"] as const) {
    const v = root[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * ITGI signals failure via `error` / `errorMessage` / `erorMessage` (sic). A nil
 * or empty value means success. Throws a ProviderError with a canonical code.
 */
export function assertItgiSuccess(root: Record<string, unknown>, context: string): void {
  const message = firstErrorText(root);
  if (!message) return;

  const code = classifyItgiError(message);
  // Transient upstream faults are not user-actionable — surface the friendly,
  // retryable wording and keep the raw detail for logs.
  const userMessage =
    code === "UPSTREAM_UNAVAILABLE"
      ? "IFFCO-Tokio's service is temporarily unavailable. Please try again in a moment."
      : `ITGI ${context} failed: ${message}`;
  throw new ProviderError(ITGI_SLUG, 200, userMessage, root, code);
}

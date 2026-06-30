import { ProviderError } from "@/errors/app-error.ts";
import { ICICI_SLUG } from "./config.ts";

/**
 * Injectable transport so tests can supply a fake ICICI backend driven by the
 * recorded PDF fixtures without touching the network.
 */
export interface IciciTransport {
  request(args: {
    method: "GET" | "POST";
    url: string;
    token: string;
    jsonBody?: unknown;
    formData?: FormData;
    /**
     * Safe to retry on a 5xx / network failure. ICICI's UAT gateway throws
     * intermittent 502/504, so quote/premium READS (which only ever create a
     * throwaway quote) opt in. State-changing calls (proposal, ckyc, ovd) MUST
     * leave this false so a transient error can't bind a duplicate policy.
     */
    idempotent?: boolean;
  }): Promise<unknown>;
}

/** Max attempts for an idempotent request (1 try + 2 retries). */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Default transport backed by global fetch. */
export class FetchTransport implements IciciTransport {
  async request(args: {
    method: "GET" | "POST";
    url: string;
    token: string;
    jsonBody?: unknown;
    formData?: FormData;
    idempotent?: boolean;
  }): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${args.token}` };
    let body: string | FormData | undefined;

    if (args.formData) {
      body = args.formData; // browser/undici sets multipart boundary
    } else if (args.jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(args.jsonBody);
    }

    const maxAttempts = args.idempotent ? MAX_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(args.url, { method: args.method, headers, body });
      } catch (err) {
        // Network/transport failure — retry idempotent reads, else surface.
        if (attempt < maxAttempts) {
          await sleep(RETRY_BASE_MS * attempt);
          continue;
        }
        throw new ProviderError(ICICI_SLUG, 0, `ICICI request failed: ${(err as Error).message}`);
      }
      const text = await response.text().catch(() => "");
      const parsed = text ? safeJson(text) : undefined;

      if (!response.ok) {
        // 5xx are transient gateway errors (502/504) — retry idempotent reads.
        if (response.status >= 500 && attempt < maxAttempts) {
          await sleep(RETRY_BASE_MS * attempt);
          continue;
        }
        throw new ProviderError(
          ICICI_SLUG,
          response.status,
          `ICICI request failed [${response.status}]`,
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

/** Classifies an ICICI failure message into a canonical, frontend-friendly code. */
export function classifyIciciError(message: string): string {
  const m = message.toLowerCase();
  // PAN/CKYC lookup found no record — ICICI asks to fall back to an alternate
  // KYC method (Aadhaar CKYC or OVD document upload).
  if (m.includes("alternate kyc") || m.includes("ckyc") || m.includes("kyc"))
    return "KYC_INCOMPLETE";
  return "PROVIDER_ERROR";
}

/** ICICI returns Success:false (HTTP 200) for business failures — surface those. */
export function assertIciciSuccess(body: unknown, context: string): void {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.Success === false) {
      const message = String(b.ErrorMessage ?? b.DisplayMessage ?? "unknown");
      throw new ProviderError(
        ICICI_SLUG,
        200,
        `ICICI ${context} failed: ${message}`,
        body,
        context === "ckyc" || context === "ovd" ? classifyIciciError(message) : "PROVIDER_ERROR",
      );
    }
  }
}

import { randomUUID } from "node:crypto";
import { ProviderError } from "@/errors/app-error.ts";
import type { TokenFetcher } from "@/providers/token-manager.ts";
import { HDFC_SLUG, hdfcEndpointUrl, type HdfcConfig } from "./config.ts";
import { FetchTransport, normalizeHdfcResponse, type HdfcTransport } from "./http.ts";

/** Matches the TokenManager's own staleness threshold. */
const REFRESH_THRESHOLD = 0.8;

/**
 * HDFC requires a unique, non-empty TRANSACTIONID on the Authenticate header.
 * Omitting it makes authentication fail outright — a recurring integration
 * pitfall recorded during the original UAT work.
 */
export function hdfcTransactionId(prefix = "TF"): string {
  return `${prefix}${Date.now()}${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** Per-product token scope, mirroring FG's per-subscription token keying. */
export function hdfcTokenCacheKey(config: HdfcConfig): string {
  return `${HDFC_SLUG}:${config.productCode}`;
}

/**
 * HDFC's authenticate response carries NO expiry, so the lifetime comes from
 * config (HDFC_TOKEN_TTL) — see open confirmation #3 in the integration notes.
 */
export function hdfcTokenFetcher(
  config: HdfcConfig,
  transport: HdfcTransport = new FetchTransport(),
): TokenFetcher {
  return async () => {
    const body = await transport.request({
      method: "GET",
      url: hdfcEndpointUrl(config, "authenticate"),
      headers: {
        SOURCE: config.source,
        CHANNEL_ID: config.channelId,
        PRODUCT_CODE: config.productCode,
        CREDENTIAL: config.credential,
        TRANSACTIONID: hdfcTransactionId("AUTH"),
      },
      idempotent: true,
    });

    const b = (body ?? {}) as Record<string, unknown>;
    const token =
      (b.Authentication as Record<string, unknown> | undefined)?.Token ??
      (b.authentication as Record<string, unknown> | undefined)?.token ??
      b.Token ??
      null;

    if (typeof token !== "string" || !token) {
      const reason = normalizeHdfcResponse(body).error ?? "no token returned";
      throw new ProviderError(HDFC_SLUG, 502, `HDFC authenticate failed: ${reason}`, body);
    }

    return {
      accessToken: token,
      expiresAt: Date.now() + config.tokenTtlSeconds * 1000 * REFRESH_THRESHOLD,
    };
  };
}

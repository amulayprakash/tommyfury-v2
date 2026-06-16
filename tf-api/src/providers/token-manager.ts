import { logger } from "@/lib/logger.ts";

export interface CachedToken {
  accessToken: string;
  /** Epoch millis at which this token should be considered stale and refetched. */
  expiresAt: number;
}

/**
 * A provider supplies its own token acquisition. The TokenManager owns the
 * cross-cutting concerns (caching, single-flight, refresh); the actual HTTP
 * call lives with the provider because vendors disagree on the grant
 * (Zuno: OAuth2 client-credentials; ICICI: Login/Password(AES) → JWT).
 */
export type TokenFetcher = () => Promise<CachedToken>;

// Pluggable store interface — swap for Redis in production
export interface TokenStore {
  get(key: string): CachedToken | undefined;
  set(key: string, token: CachedToken): void;
}

class InMemoryTokenStore implements TokenStore {
  private readonly cache = new Map<string, CachedToken>();

  get(key: string): CachedToken | undefined {
    return this.cache.get(key);
  }

  set(key: string, token: CachedToken): void {
    this.cache.set(key, token);
  }
}

// Per-key in-flight promise to prevent thundering herd on expiry
const inFlight = new Map<string, Promise<string>>();

export class TokenManager {
  private readonly store: TokenStore;

  constructor(store: TokenStore = new InMemoryTokenStore()) {
    this.store = store;
  }

  /**
   * Returns a valid access token for `cacheKey`, fetching via `fetcher` only
   * when the cache is empty or stale. Concurrent callers share one fetch.
   */
  async getToken(cacheKey: string, fetcher: TokenFetcher): Promise<string> {
    const cached = this.store.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.accessToken;
    }

    // Single-flight: reuse in-flight request for the same key
    const existing = inFlight.get(cacheKey);
    if (existing !== undefined) {
      return existing;
    }

    const fetchPromise = this.runFetch(cacheKey, fetcher).finally(() => {
      inFlight.delete(cacheKey);
    });

    inFlight.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  private async runFetch(cacheKey: string, fetcher: TokenFetcher): Promise<string> {
    logger.debug({ cacheKey }, "Fetching provider token");
    const token = await fetcher();
    this.store.set(cacheKey, token);
    logger.debug({ cacheKey, expiresAt: token.expiresAt }, "Token cached");
    return token.accessToken;
  }
}

// ─── OAuth2 client-credentials fetcher (Zuno-style) ───────────────────────────

export interface OAuth2Credentials {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope?: string;
}

interface OAuth2TokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

const REFRESH_THRESHOLD = 0.8; // treat token as stale at 80% of its TTL

/** Builds a {@link TokenFetcher} for the standard OAuth2 client-credentials grant. */
export function oauth2ClientCredentialsFetcher(creds: OAuth2Credentials): TokenFetcher {
  return async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      ...(creds.scope ? { scope: creds.scope } : {}),
    });

    const response = await fetch(creds.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Token fetch failed [${response.status}]: ${text}`);
    }

    const json = (await response.json()) as OAuth2TokenResponse;
    const expiresIn = json.expires_in ?? 3600;
    return {
      accessToken: json.access_token,
      expiresAt: Date.now() + expiresIn * 1000 * REFRESH_THRESHOLD,
    };
  };
}

/** Helper for fetchers that receive an absolute expiry timestamp (e.g. ICICI). */
export function expiryWithThreshold(expiresAtMs: number, now = Date.now()): number {
  const ttl = expiresAtMs - now;
  if (ttl <= 0) return now;
  return now + ttl * REFRESH_THRESHOLD;
}

// Singleton — shared across all providers
export const tokenManager = new TokenManager();

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TokenManager,
  oauth2ClientCredentialsFetcher,
  expiryWithThreshold,
} from "@/providers/token-manager.ts";
import type { TokenStore, CachedToken } from "@/providers/token-manager.ts";

// In-memory store for tests
class TestStore implements TokenStore {
  private cache = new Map<string, CachedToken>();
  get(key: string) {
    return this.cache.get(key);
  }
  set(key: string, token: CachedToken) {
    this.cache.set(key, token);
  }
}

describe("TokenManager", () => {
  let manager: TokenManager;
  let store: TestStore;

  beforeEach(() => {
    store = new TestStore();
    manager = new TokenManager(store);
    vi.restoreAllMocks();
  });

  it("fetches and caches a token on first call", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ accessToken: "tok_abc", expiresAt: Date.now() + 60_000 });

    const token = await manager.getToken("test-key", fetcher);
    expect(token).toBe("tok_abc");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns cached token without fetching again", async () => {
    store.set("cached-key", { accessToken: "tok_cached", expiresAt: Date.now() + 60_000 });
    const fetcher = vi.fn();

    const token = await manager.getToken("cached-key", fetcher);
    expect(token).toBe("tok_cached");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("re-fetches when cached token is expired", async () => {
    store.set("expired-key", { accessToken: "tok_old", expiresAt: Date.now() - 1000 });
    const fetcher = vi
      .fn()
      .mockResolvedValue({ accessToken: "tok_new", expiresAt: Date.now() + 60_000 });

    const token = await manager.getToken("expired-key", fetcher);
    expect(token).toBe("tok_new");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shares a single in-flight fetch across concurrent callers", async () => {
    let resolveFetch!: (t: CachedToken) => void;
    const fetcher = vi.fn().mockReturnValue(
      new Promise<CachedToken>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const p1 = manager.getToken("race-key", fetcher);
    const p2 = manager.getToken("race-key", fetcher);
    resolveFetch({ accessToken: "tok_shared", expiresAt: Date.now() + 60_000 });

    expect(await p1).toBe("tok_shared");
    expect(await p2).toBe("tok_shared");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("propagates fetcher errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Token fetch failed [401]"));
    await expect(manager.getToken("fail-key", fetcher)).rejects.toThrow("Token fetch failed [401]");
  });
});

describe("oauth2ClientCredentialsFetcher", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts the client-credentials grant and parses the token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok_oauth", expires_in: 3600 }),
    } as Response);

    const fetcher = oauth2ClientCredentialsFetcher({
      clientId: "id",
      clientSecret: "secret",
      tokenUrl: "https://example.com/token",
    });
    const token = await fetcher();

    expect(token.accessToken).toBe("tok_oauth");
    expect(token.expiresAt).toBeGreaterThan(Date.now());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when the token endpoint returns an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as Response);

    const fetcher = oauth2ClientCredentialsFetcher({
      clientId: "bad",
      clientSecret: "bad",
      tokenUrl: "https://example.com/token",
    });
    await expect(fetcher()).rejects.toThrow("Token fetch failed [401]");
  });
});

describe("expiryWithThreshold", () => {
  it("returns 80% of the remaining TTL", () => {
    const now = 1_000_000;
    expect(expiryWithThreshold(now + 1000, now)).toBe(now + 800);
  });

  it("returns now for an already-expired timestamp", () => {
    const now = 1_000_000;
    expect(expiryWithThreshold(now - 5000, now)).toBe(now);
  });
});

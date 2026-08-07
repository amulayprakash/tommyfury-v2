import { describe, it, expect, vi } from "vitest";
import { hdfcTokenFetcher, hdfcTokenCacheKey } from "../auth.ts";
import type { HdfcConfig } from "../config.ts";
import type { HdfcTransport } from "../http.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "NOVACRED",
  channelId: "NOVA0001",
  credential: "s3cret",
  productCode: "2311",
  tokenTtlSeconds: 1000,
  kyc: { baseUrl: "https://kyc.example", apiKey: "k", tokenTtlSeconds: 480, returnUrl: "" },
};

function transportReturning(body: unknown, capture?: (args: never) => void): HdfcTransport {
  return {
    request: vi.fn(async (args) => {
      capture?.(args as never);
      return body;
    }),
  };
}

describe("hdfcTokenFetcher", () => {
  it("returns the token from HDFC's Authentication block", async () => {
    const transport = transportReturning({ Authentication: { Token: "tok-123" } });
    const token = await hdfcTokenFetcher(config, transport)();
    expect(token.accessToken).toBe("tok-123");
  });

  it("computes expiry from the configured TTL with the 80% staleness threshold", async () => {
    const transport = transportReturning({ Authentication: { Token: "tok-123" } });
    const before = Date.now();
    const token = await hdfcTokenFetcher(config, transport)();
    // 1000s TTL * 0.8 = 800s
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 800_000 - 50);
    expect(token.expiresAt).toBeLessThanOrEqual(Date.now() + 800_000);
  });

  it("always sends a non-empty unique TRANSACTIONID — auth fails without it", async () => {
    const seen: Record<string, string>[] = [];
    const transport = transportReturning({ Authentication: { Token: "t" } }, (args) => {
      seen.push((args as { headers: Record<string, string> }).headers);
    });
    const fetcher = hdfcTokenFetcher(config, transport);
    await fetcher();
    await fetcher();
    expect(seen[0]!.TRANSACTIONID).toBeTruthy();
    expect(seen[1]!.TRANSACTIONID).toBeTruthy();
    expect(seen[0]!.TRANSACTIONID).not.toBe(seen[1]!.TRANSACTIONID);
  });

  it("sends the channel headers and the credential", async () => {
    const seen: Record<string, string>[] = [];
    const transport = transportReturning({ Authentication: { Token: "t" } }, (args) => {
      seen.push((args as { headers: Record<string, string> }).headers);
    });
    await hdfcTokenFetcher(config, transport)();
    expect(seen[0]).toMatchObject({
      SOURCE: "NOVACRED",
      CHANNEL_ID: "NOVA0001",
      PRODUCT_CODE: "2311",
      CREDENTIAL: "s3cret",
    });
  });

  it("accepts the lowercase and bare token spellings", async () => {
    expect(
      (await hdfcTokenFetcher(config, transportReturning({ authentication: { token: "a" } }))())
        .accessToken,
    ).toBe("a");
    expect(
      (await hdfcTokenFetcher(config, transportReturning({ Token: "b" }))()).accessToken,
    ).toBe("b");
  });

  it("throws a ProviderError when no token comes back", async () => {
    const transport = transportReturning({ StatusCode: "0", Error: "bad credential" });
    await expect(hdfcTokenFetcher(config, transport)()).rejects.toThrow(/bad credential/);
  });
});

describe("hdfcTokenCacheKey", () => {
  it("scopes the cache by product code so a future TW/CV product cannot collide", () => {
    expect(hdfcTokenCacheKey(config)).toBe("hdfc:2311");
  });
});

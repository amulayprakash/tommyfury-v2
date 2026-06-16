import { describe, it, expect, vi, beforeEach } from "vitest";
import { iciciTokenFetcher } from "../auth.ts";
import type { IciciConfig } from "../config.ts";

const config: IciciConfig = {
  baseUrl: "https://uat.example.com",
  login: "user",
  password: "pass",
  aesKey: Buffer.alloc(32, 1).toString("base64"),
  aesMode: "aes-256-ecb",
  credentialSetId: "default",
};

describe("iciciTokenFetcher", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts the login body and returns token + 80%-of-remaining expiry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: "jwt-token",
        expiry: new Date(Date.now() + 20 * 60_000).toISOString(),
        success: true,
      }),
    } as Response);

    const token = await iciciTokenFetcher(config)();
    expect(token.accessToken).toBe("jwt-token");
    expect(token.expiresAt).toBeGreaterThan(Date.now());
    expect(token.expiresAt).toBeLessThan(Date.now() + 20 * 60_000);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://uat.example.com/auth-api/access/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when success is false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, errorMessage: "bad creds" }),
    } as Response);
    await expect(iciciTokenFetcher(config)()).rejects.toThrow("ICICI auth rejected: bad creds");
  });

  it("throws on a non-OK HTTP status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    } as Response);
    await expect(iciciTokenFetcher(config)()).rejects.toThrow("ICICI auth failed [401]");
  });
});

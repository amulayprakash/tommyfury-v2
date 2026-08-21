import { describe, it, expect } from "vitest";

import { resolveAppUrls, API_BASE_URL, WEB_BASE_URL } from "@/config/app-urls.ts";
import { createApp } from "@/app.ts";

describe("resolveAppUrls", () => {
  it("uses the Shree public origin in production", () => {
    expect(resolveAppUrls("production")).toEqual({
      api: "http://103.127.167.212",
      web: "http://103.127.167.212",
    });
  });

  it("never returns a localhost origin in production", () => {
    // This is the regression that matters: a localhost origin in production
    // means FG posts payment results into the void and HDFC's Pehchaan journey
    // returns the customer to a dead page.
    const { api, web } = resolveAppUrls("production");
    expect(api).not.toContain("localhost");
    expect(web).not.toContain("localhost");
  });

  it("uses the local dev servers in development", () => {
    expect(resolveAppUrls("development")).toEqual({
      api: "http://localhost:4000",
      web: "http://localhost:8080",
    });
  });

  it("treats test like development, so the suite never depends on a deployment", () => {
    expect(resolveAppUrls("test")).toEqual(resolveAppUrls("development"));
  });

  it("exports constants already resolved for the running NODE_ENV", () => {
    // vitest.config.ts pins NODE_ENV=test.
    expect(API_BASE_URL).toBe("http://localhost:4000");
    expect(WEB_BASE_URL).toBe("http://localhost:8080");
  });
});

describe("createApp proxy trust", () => {
  it("trusts exactly one reverse-proxy hop", () => {
    // Apache terminates the client connection and proxies /api/v1 to
    // 127.0.0.1:4000. Without this setting express-rate-limit buckets every
    // user in the world under 127.0.0.1, and pino-http logs the proxy as the
    // client on every request. `1` rather than `true` means a client-supplied
    // X-Forwarded-For cannot spoof an IP past that single trusted hop.
    expect(createApp().get("trust proxy")).toBe(1);
  });
});

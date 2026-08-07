import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProviderError } from "@/errors/app-error.ts";
import {
  isHdfcSuccess,
  normalizeHdfcResponse,
  assertHdfcSuccess,
  carriesHdfcEnvelope,
  FetchTransport,
} from "../http.ts";

describe("isHdfcSuccess", () => {
  it("accepts every success spelling HDFC uses", () => {
    expect(isHdfcSuccess("1")).toBe(true);
    expect(isHdfcSuccess(200)).toBe(true);
    expect(isHdfcSuccess("200")).toBe(true);
    expect(isHdfcSuccess("SUCCESS")).toBe(true);
  });

  it("rejects anything else, including a missing code", () => {
    expect(isHdfcSuccess("0")).toBe(false);
    expect(isHdfcSuccess(null)).toBe(false);
    expect(isHdfcSuccess(undefined)).toBe(false);
  });
});

describe("normalizeHdfcResponse", () => {
  it("reads HDFC's inconsistent casing into one shape", () => {
    expect(normalizeHdfcResponse({ StatusCode: "1", Error: null })).toEqual({
      statusCode: "1",
      error: null,
      warning: null,
      data: { StatusCode: "1", Error: null },
    });
    expect(normalizeHdfcResponse({ statusCode: 200, error: "boom" }).error).toBe("boom");
  });

  it("tolerates a non-object body", () => {
    expect(normalizeHdfcResponse("plain text").statusCode).toBeNull();
  });
});

describe("assertHdfcSuccess", () => {
  it("passes a successful body through", () => {
    expect(() => assertHdfcSuccess({ StatusCode: "1" }, "calculatePremium")).not.toThrow();
  });

  it("raises a ProviderError carrying HDFC's verbatim message", () => {
    let caught: unknown;
    try {
      assertHdfcSuccess(
        { StatusCode: "0", Error: "BUSINESS EXCEPTION: IDV Deviation not allowed" },
        "calculatePremium",
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    const e = caught as ProviderError;
    expect(e.providerSlug).toBe("hdfc");
    // The vendor message is the only diagnostic HDFC gives — it must survive.
    expect(e.message).toContain("IDV Deviation not allowed");
    expect(e.message).toContain("calculatePremium");
  });

  it("does not throw when the status is absent but no error is reported", () => {
    // Some HDFC document endpoints return a bare payload with no StatusCode.
    expect(() => assertHdfcSuccess({ Req_Policy_Document: {} }, "getPolicyDocument")).not.toThrow();
  });
});

describe("carriesHdfcEnvelope", () => {
  it("recognises every status/error spelling HDFC uses", () => {
    expect(carriesHdfcEnvelope({ StatusCode: "1" })).toBe(true);
    expect(carriesHdfcEnvelope({ statusCode: 200 })).toBe(true);
    expect(carriesHdfcEnvelope({ Status: "SUCCESS" })).toBe(true);
    expect(carriesHdfcEnvelope({ Error: "boom" })).toBe(true);
  });

  it("rejects a body with no judgeable field", () => {
    // A gateway fault is an object, but assertHdfcSuccess cannot judge it.
    expect(carriesHdfcEnvelope({ fault: { message: "Invalid credentials" } })).toBe(false);
    expect(carriesHdfcEnvelope({})).toBe(false);
  });

  it("rejects arrays, strings and nullish bodies", () => {
    // typeof [] === "object", so arrays need an explicit guard.
    expect(carriesHdfcEnvelope(["some", "error"])).toBe(false);
    expect(carriesHdfcEnvelope("<html>502 Bad Gateway</html>")).toBe(false);
    expect(carriesHdfcEnvelope(null)).toBe(false);
    expect(carriesHdfcEnvelope(undefined)).toBe(false);
  });
});

describe("FetchTransport non-2xx handling", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const res = (status: number, body: unknown) =>
    ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as Response;

  const call = () =>
    new FetchTransport().request({ method: "POST", url: "https://uat/x", headers: {} });

  it("passes a non-2xx HDFC envelope through so its message survives verbatim", async () => {
    const body = { StatusCode: "0", Error: "BUSINESS EXCEPTION: RTO not serviceable" };
    fetchMock.mockResolvedValue(res(400, body));
    await expect(call()).resolves.toEqual(body);
  });

  it("throws on a non-2xx body it cannot judge, rather than passing it off as success", async () => {
    // Regression guard: returning this would make assertHdfcSuccess's lenient
    // "no status, no error" branch treat a gateway fault as a successful quote,
    // which then normalizes to a zero premium.
    fetchMock.mockResolvedValue(res(500, { fault: { message: "Invalid credentials" } }));
    await expect(call()).rejects.toBeInstanceOf(ProviderError);
  });

  it("keeps the unjudgeable body as error details for diagnosis", async () => {
    fetchMock.mockResolvedValue(res(500, { fault: { message: "Invalid credentials" } }));
    const err = await call().catch((e: unknown) => e);
    expect((err as ProviderError).details).toEqual({ fault: { message: "Invalid credentials" } });
    expect((err as ProviderError).upstreamStatus).toBe(500);
  });

  it("does not retry a non-idempotent call, so a payment cannot bind twice", async () => {
    fetchMock.mockResolvedValue(res(500, { fault: {} }));
    await call().catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

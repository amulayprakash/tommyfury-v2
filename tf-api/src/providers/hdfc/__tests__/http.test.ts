import { describe, it, expect } from "vitest";
import { ProviderError } from "@/errors/app-error.ts";
import { isHdfcSuccess, normalizeHdfcResponse, assertHdfcSuccess } from "../http.ts";

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

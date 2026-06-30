import { describe, it, expect } from "vitest";
import { assertIciciSuccess, classifyIciciError } from "../http.ts";
import { ProviderError } from "@/errors/app-error.ts";

describe("classifyIciciError", () => {
  it("flags the 'alternate KYC options' failure as KYC_INCOMPLETE", () => {
    expect(
      classifyIciciError("Failed: - Request failed, please retry with alternate KYC options."),
    ).toBe("KYC_INCOMPLETE");
  });

  it("leaves unrelated failures as PROVIDER_ERROR", () => {
    expect(classifyIciciError("Premium calculation failed")).toBe("PROVIDER_ERROR");
  });
});

describe("assertIciciSuccess", () => {
  it("throws a KYC_INCOMPLETE ProviderError on a CKYC business failure", () => {
    const body = {
      Success: false,
      ErrorMessage: "Failed: - Request failed, please retry with alternate KYC options.",
    };
    try {
      assertIciciSuccess(body, "ckyc");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe("KYC_INCOMPLETE");
      expect((err as Error).message).toContain("alternate KYC options");
    }
  });

  it("keeps non-KYC contexts as PROVIDER_ERROR", () => {
    try {
      assertIciciSuccess({ Success: false, ErrorMessage: "bad request" }, "proposal");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ProviderError).code).toBe("PROVIDER_ERROR");
    }
  });

  it("passes through a successful body", () => {
    expect(() => assertIciciSuccess({ Success: true }, "ckyc")).not.toThrow();
  });
});

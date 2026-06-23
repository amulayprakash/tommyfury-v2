import { describe, it, expect } from "vitest";
import { inspectionRequired, mapLivechekStatus } from "../inspection.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";

const base = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  isPreviousPolicyExpired: false,
  previousPolicyNumber: "P123",
} as unknown as MotorQuoteRequest;

describe("inspectionRequired (break-in rules)", () => {
  it("requires inspection for an expired previous policy (break-in)", () => {
    expect(inspectionRequired({ ...base, isPreviousPolicyExpired: true })).toBe(true);
  });

  it("requires inspection on a TP→Comprehensive upgrade", () => {
    expect(
      inspectionRequired({ ...base, previousPolicyType: "thirdParty", selectedPolicy: "comprehensive" }),
    ).toBe(true);
  });

  it("requires inspection when a rollover has no previous policy number (PYP skipped)", () => {
    expect(inspectionRequired({ ...base, previousPolicyNumber: undefined })).toBe(true);
  });

  it("does not require inspection for a clean rollover", () => {
    expect(inspectionRequired(base)).toBe(false);
  });

  it("never requires inspection for new business", () => {
    expect(inspectionRequired({ ...base, businessType: "new", isPreviousPolicyExpired: true })).toBe(false);
  });
});

describe("mapLivechekStatus", () => {
  it("maps vendor statuses to the canonical lifecycle", () => {
    expect(mapLivechekStatus("company-approved")).toBe("INSPECTION_APPROVED");
    expect(mapLivechekStatus("not-recommended")).toBe("INSPECTION_REJECTED");
    expect(mapLivechekStatus("closed")).toBe("INSPECTION_CLOSED");
    expect(mapLivechekStatus("initial")).toBe("INSPECTION_PENDING");
    expect(mapLivechekStatus(undefined)).toBe("INSPECTION_PENDING");
  });
});

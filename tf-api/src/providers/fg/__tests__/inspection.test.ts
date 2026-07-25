import { describe, it, expect } from "vitest";
import { inspectionRequired, mapLivechekStatus } from "../inspection.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";

const base = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  isPreviousPolicyExpired: false,
  previousPolicyNumber: "P123",
  previousPolicyExpiryDate: "2099-01-01",
} as unknown as MotorQuoteRequest;

describe("inspectionRequired (break-in rules)", () => {
  it("requires inspection for an expired previous policy (break-in)", () => {
    expect(inspectionRequired({ ...base, isPreviousPolicyExpired: true })).toBe(true);
  });

  it("derives break-in from a past expiry date even when the flag says not expired", () => {
    expect(
      inspectionRequired({ ...base, previousPolicyExpiryDate: "2023-08-10" }),
    ).toBe(true);
  });

  it("derives break-in when the previous expiry is unknown (unreadable RC)", () => {
    expect(inspectionRequired({ ...base, previousPolicyExpiryDate: undefined })).toBe(true);
  });

  it("uses the new policy start date for the derived comparison", () => {
    expect(
      inspectionRequired({
        ...base,
        previousPolicyExpiryDate: "2026-08-01",
        policyStartDate: "2026-09-01",
      }),
    ).toBe(true);
    expect(
      inspectionRequired({
        ...base,
        previousPolicyExpiryDate: "2026-08-01",
        policyStartDate: "2026-08-01",
      }),
    ).toBe(false);
  });

  it("does NOT flag a seamless renewal (new start = prev expiry + 1 day) as break-in", () => {
    // The standard rollover starts the day the previous policy ends — zero gap.
    // This must NOT self-flag as a break-in.
    expect(
      inspectionRequired({
        ...base,
        previousPolicyExpiryDate: "2026-08-01",
        policyStartDate: "2026-08-02",
      }),
    ).toBe(false);
    // A genuine gap (start beyond expiry + 1 day) is still a break-in.
    expect(
      inspectionRequired({
        ...base,
        previousPolicyExpiryDate: "2026-08-01",
        policyStartDate: "2026-08-03",
      }),
    ).toBe(true);
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

  it("waives inspection for third-party break-ins (FG SC_09 TP waiver)", () => {
    expect(
      inspectionRequired({ ...base, selectedPolicy: "thirdParty", isPreviousPolicyExpired: true }),
    ).toBe(false);
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

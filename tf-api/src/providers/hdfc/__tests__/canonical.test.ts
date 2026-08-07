import { describe, it, expect } from "vitest";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import { toHdfcRequest, resolveBusinessType, applyRolloverDateSanity } from "../mapper/canonical.ts";
import type { HdfcResolvedCodes } from "../types.ts";

const codes: HdfcResolvedCodes = {
  modelCode: "38908",
  rtoCode: "10406",
  previousInsurerCode: "ICICILOMBARD",
};

function baseRequest(overrides: Partial<MotorQuoteRequest> = {}): MotorQuoteRequest {
  return {
    vehicleType: "fourWheeler",
    selectedPolicy: "comprehensive",
    businessType: "rollover",
    makeId: "MAR",
    makeName: "MARUTI",
    modelId: "SWIFT",
    modelName: "SWIFT",
    fuelType: "petrol",
    rtoCode: "MH01",
    registrationDate: "2019-06-15",
    registrationNumber: "MH01QQ7878",
    isPreviousPolicyExpired: false,
    claimInPreviousPolicy: false,
    ncbPercent: 20,
    zeroDep: true,
    engineProtect: false,
    rsa: false,
    tyreProtect: false,
    rimProtect: false,
    rti: false,
    consumables: false,
    paOwner: true,
    paUnnamedPassenger: false,
    legalLiabilityPaidDriver: false,
    keyProtect: false,
    garageCash: false,
    lossOfBelongings: false,
    batteryProtect: false,
    drivingAccessories: false,
    ncbProtection: false,
    ...overrides,
  } as MotorQuoteRequest;
}

describe("resolveBusinessType", () => {
  it("returns New Vehicle for a new-business journey", () => {
    expect(resolveBusinessType(baseRequest({ businessType: "new" }))).toBe("New Vehicle");
  });

  it("returns New Vehicle for the newVehicle category regardless of businessType", () => {
    expect(resolveBusinessType(baseRequest({ vehicleType: "newVehicle" }))).toBe("New Vehicle");
  });

  it("returns New Vehicle when there is no registration number", () => {
    expect(resolveBusinessType(baseRequest({ registrationNumber: undefined }))).toBe("New Vehicle");
  });

  it("returns Roll Over for a registered vehicle changing insurer", () => {
    expect(resolveBusinessType(baseRequest())).toBe("Roll Over");
  });

  it("returns Roll Over for a renewal", () => {
    expect(resolveBusinessType(baseRequest({ businessType: "renewal" }))).toBe("Roll Over");
  });
});

describe("applyRolloverDateSanity", () => {
  // HDFC requires the previous policy to expire strictly before the new start.
  it("moves the start date to the day after the previous expiry when they overlap", () => {
    expect(applyRolloverDateSanity("2026-08-01", "2026-08-10")).toBe("2026-08-11");
  });

  it("moves the start date when they are equal", () => {
    expect(applyRolloverDateSanity("2026-08-10", "2026-08-10")).toBe("2026-08-11");
  });

  it("leaves a start date that is already after the expiry alone", () => {
    expect(applyRolloverDateSanity("2026-08-11", "2026-08-10")).toBe("2026-08-11");
  });

  it("leaves the start date alone when there is no previous expiry", () => {
    expect(applyRolloverDateSanity("2026-08-01", undefined)).toBe("2026-08-01");
  });
});

describe("toHdfcRequest", () => {
  it("uses the resolved vendor codes, never the canonical ids", () => {
    const out = toHdfcRequest(baseRequest(), codes, "TXN1");
    expect(out.vehicle.modelCode).toBe("38908");
    expect(out.vehicle.rtoCode).toBe("10406");
  });

  it("maps canonical plan types onto HDFC POLICY_TYPE", () => {
    expect(toHdfcRequest(baseRequest(), codes, "T").policy.policyType).toBe("OD Plus TP");
    expect(
      toHdfcRequest(baseRequest({ selectedPolicy: "thirdParty" }), codes, "T").policy.policyType,
    ).toBe("TP Only");
    expect(
      toHdfcRequest(baseRequest({ selectedPolicy: "standAloneOD" }), codes, "T").policy.policyType,
    ).toBe("OD Only");
  });

  it("maps canonical add-on booleans onto the HDFC cover flags", () => {
    const out = toHdfcRequest(
      baseRequest({ zeroDep: true, tyreProtect: true, rti: true, consumables: true }),
      codes,
      "T",
    );
    expect(out.addons.zeroDep).toBe(true);
    expect(out.addons.tyreSecure).toBe(true);
    expect(out.addons.rti).toBe(true);
    expect(out.addons.consumables).toBe(true);
    expect(out.addons.engineProtect).toBe(false);
  });

  it("defaults RTIPlanType to A only when RTI is selected", () => {
    expect(toHdfcRequest(baseRequest({ rti: true }), codes, "T").addons.rtiPlanType).toBe("A");
    expect(toHdfcRequest(baseRequest({ rti: false }), codes, "T").addons.rtiPlanType).toBeUndefined();
  });

  it("carries the resolved previous-insurer code, never a hard-coded default", () => {
    const out = toHdfcRequest(
      baseRequest({ previousInsurerId: "ICICI", previousPolicyNumber: "P123" }),
      codes,
      "T",
    );
    expect(out.previousPolicy.insurerCode).toBe("ICICILOMBARD");
    expect(out.previousPolicy.policyNo).toBe("P123");
  });

  it("leaves the previous-insurer code undefined when the resolver found none", () => {
    const out = toHdfcRequest(baseRequest(), { modelCode: "1", rtoCode: "2" }, "T");
    expect(out.previousPolicy.insurerCode).toBeUndefined();
  });

  it("flags electric vehicles from the canonical fuel type", () => {
    expect(toHdfcRequest(baseRequest({ fuelType: "electric" }), codes, "T").isElectric).toBe(true);
    expect(toHdfcRequest(baseRequest(), codes, "T").isElectric).toBe(false);
  });

  it("turns on the EV covers for an electric vehicle", () => {
    const out = toHdfcRequest(baseRequest({ fuelType: "electric", zeroDep: true }), codes, "T");
    expect(out.ev.motorCover).toBe(1);
    expect(out.ev.zeroDepBattery).toBe(1);
  });

  it("applies rollover date sanity to the policy start date", () => {
    const out = toHdfcRequest(
      baseRequest({ policyStartDate: "2026-08-01", previousPolicyExpiryDate: "2026-08-10" }),
      codes,
      "T",
    );
    expect(out.policy.startDate).toBe("2026-08-11");
  });

  it("carries the transaction id through", () => {
    expect(toHdfcRequest(baseRequest(), codes, "TXN-42").transactionId).toBe("TXN-42");
  });
});

import { describe, it, expect } from "vitest";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import { toHdfcRequest, resolveBusinessType, applyRolloverDateSanity } from "../mapper/canonical.ts";
import { reqPvtCarFor } from "../mapper/req-pvtcar.ts";
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

describe("policy tenure (canonical tenureYears → POLICY_TENURE)", () => {
  // Evidence for this mapping: PrivateCarDataDictionary.xlsx, sheet
  // "03 CalculatePremium Request" row 40 — "POLICY_TENURE … Policy Tenure(1,2,3).
  // Product Code 2311 (Comprehensive) New Policy - 1OD–3TP, 2OD-3TP, 3OD-3TP;
  // Rollover - 1OD–1TP, 3OD. Product Code 2319 (TP Only Product) New Policy - 3TP;
  // Rollover - 1TP, 2TP, 3TP." One int, carrying the OD leg on the package /
  // SA-OD product and the TP leg on the liability product. There is no second
  // tenure field, so the "+3" of a 1+3 is implied by BusinessType, not sent.
  it("defaults to 1 when the caller supplies no tenure", () => {
    expect(toHdfcRequest(baseRequest(), codes, "T").policy.tenure).toBe(1);
  });

  it("carries a long-term tenure through to the HDFC shape", () => {
    for (const years of [1, 2, 3]) {
      expect(toHdfcRequest(baseRequest({ tenureYears: years }), codes, "T").policy.tenure).toBe(
        years,
      );
    }
  });

  it("reaches POLICY_TENURE on every business type's Req_PvtCar template", () => {
    // New Business (1+3 / 2+3 / 3+3), Roll Over (1+1 / 3+0) and Used Car all
    // read the same policy.tenure — the long-term cases in HDFC's own
    // PVTcarTestScenarios.xls "Long Team" sheet are unreachable otherwise.
    const newBiz = toHdfcRequest(
      baseRequest({ businessType: "new", registrationNumber: undefined, tenureYears: 3 }),
      codes,
      "T",
    );
    expect(reqPvtCarFor(newBiz).POLICY_TENURE).toBe(3);

    const rollover = toHdfcRequest(baseRequest({ tenureYears: 2 }), codes, "T");
    expect(rollover.businessType).toBe("Roll Over");
    expect(reqPvtCarFor(rollover).POLICY_TENURE).toBe(2);

    // Used Car is not reachable from a canonical request (BusinessTypeSchema has
    // no "used" member and resolveBusinessType never returns it), so its template
    // is checked by re-labelling an otherwise identical shape.
    const used = toHdfcRequest(baseRequest({ tenureYears: 3 }), codes, "T");
    expect(reqPvtCarFor({ ...used, businessType: "Used Car" }).POLICY_TENURE).toBe(3);
  });

  it("does not disturb any other mapped field", () => {
    const one = toHdfcRequest(baseRequest({ tenureYears: 1 }), codes, "T");
    const three = toHdfcRequest(baseRequest({ tenureYears: 3 }), codes, "T");
    expect({ ...three, policy: { ...three.policy, tenure: 1 } }).toEqual(one);
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

  it("turns on the electric motor cover for an electric vehicle", () => {
    const out = toHdfcRequest(baseRequest({ fuelType: "electric", zeroDep: true }), codes, "T");
    expect(out.ev.motorCover).toBe(1);
    // zeroDepBattery deliberately stays off here: HDFC refuses it unless the
    // battery/charger cover is also selected. See the EV cover-rules block below.
    expect(out.ev.zeroDepBattery).toBe(0);
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

describe("previous third-party policy", () => {
  it("carries all three previous-TP fields, not just the dates", () => {
    // The TP policy number was originally dropped while its sibling dates were
    // wired, leaving HDFC unable to identify the policy it must validate.
    const out = toHdfcRequest(
      baseRequest({
        selectedPolicy: "standAloneOD",
        previousTpPolicyNumber: "TP-8891",
        previousTpStartDate: "2025-09-01",
        previousTpExpiryDate: "2028-08-31",
      }),
      codes,
      "T",
    );
    expect(out.previousPolicy.tpPolicyNo).toBe("TP-8891");
    expect(out.previousPolicy.tpStartDate).toBe("2025-09-01");
    expect(out.previousPolicy.tpEndDate).toBe("2028-08-31");
  });
});

describe("applyRolloverDateSanity is calendar-safe", () => {
  it("advances across a month boundary", () => {
    expect(applyRolloverDateSanity("2026-08-01", "2026-08-31")).toBe("2026-09-01");
  });

  it("advances across a year boundary", () => {
    expect(applyRolloverDateSanity("2026-12-01", "2026-12-31")).toBe("2027-01-01");
  });

  it("advances across a leap day", () => {
    expect(applyRolloverDateSanity("2028-02-01", "2028-02-28")).toBe("2028-02-29");
    expect(applyRolloverDateSanity("2028-02-01", "2028-02-29")).toBe("2028-03-01");
  });

  it("always yields a start strictly after the previous expiry", () => {
    // The single property HDFC actually enforces. Checked across a DST
    // transition window, where local-time date arithmetic would slip a day.
    for (const expiry of ["2026-03-07", "2026-03-08", "2026-03-09", "2026-11-01", "2026-11-02"]) {
      const shifted = applyRolloverDateSanity("2020-01-01", expiry);
      expect(new Date(shifted).getTime()).toBeGreaterThan(new Date(expiry).getTime());
    }
  });
});

describe("electric-vehicle cover rules (learned from HDFC UAT)", () => {
  it("drops engine-gearbox cover for an EV", () => {
    // "EGP Add on cover not applicable for electric vehicles" — a live rejection.
    const ev = toHdfcRequest(baseRequest({ fuelType: "electric", engineProtect: true }), codes, "T");
    expect(ev.addons.engineProtect).toBe(false);
  });

  it("keeps engine-gearbox cover for a petrol vehicle", () => {
    const petrol = toHdfcRequest(baseRequest({ engineProtect: true }), codes, "T");
    expect(petrol.addons.engineProtect).toBe(true);
  });

  it("only claims battery zero-dep when the battery cover is also taken", () => {
    // "This cover cannot be opted unless addon 'Battery, Charger & Accessories
    // Cover' is selected." Without this the quote is rejected outright.
    const withoutBattery = toHdfcRequest(
      baseRequest({ fuelType: "electric", zeroDep: true, batteryProtect: false }),
      codes,
      "T",
    );
    expect(withoutBattery.ev.zeroDepBattery).toBe(0);
    expect(withoutBattery.ev.batteryChargerCover).toBe(0);
  });

  it("claims battery zero-dep when both are taken", () => {
    const withBattery = toHdfcRequest(
      baseRequest({ fuelType: "electric", zeroDep: true, batteryProtect: true }),
      codes,
      "T",
    );
    expect(withBattery.ev.zeroDepBattery).toBe(1);
    expect(withBattery.ev.batteryChargerCover).toBe(1);
  });
});

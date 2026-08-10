import { describe, it, expect } from "vitest";
import newPremium from "../fixtures/collection/new-premium.json" with { type: "json" };
import rolloverPremium from "../fixtures/collection/rollover-premium.json" with { type: "json" };
import usedPremium from "../fixtures/collection/used-premium.json" with { type: "json" };
import { reqPvtCarNew, reqPvtCarRollover, reqPvtCarUsed, reqPvtCarFor } from "../mapper/req-pvtcar.ts";
import type { HdfcRequestShape } from "../types.ts";

function shape(overrides: Partial<HdfcRequestShape> = {}): HdfcRequestShape {
  return {
    transactionId: "T",
    businessType: "New Vehicle",
    isElectric: false,
    vehicle: { modelCode: "38908", rtoCode: "10406", idv: 949411 },
    policy: { tenure: 1, policyType: "OD Plus TP" },
    previousPolicy: { ncbPercentage: 0, claim: false },
    addons: {
      zeroDep: false,
      tyreSecure: false,
      ncbProtection: false,
      rti: false,
      consumables: false,
      engineProtect: false,
      roadsideAssistance: false,
      roadsideAssistanceWorldwide: false,
      roadsideAssistanceAdvance: false,
      lossOfUse: false,
      emiProtector: false,
      emiAmount: 0,
      highProtection: false,
      lossOfPersonalBelongings: false,
      lossOfPersonalBelongingsSI: 0,
      llPaidDriver: 0,
      paPaidDriverSI: 0,
      noOfPaPaidDriver: 0,
      unnamedPersons: 0,
      unnamedPersonSI: 0,
      cpaTenure: 0,
      electricalAccessoryIdv: 0,
      nonElectricalAccessoryIdv: 0,
      antiTheftDisc: false,
      voluntaryExcess: 0,
      biFuelType: "",
      biFuelKitValue: 0,
      effectiveDrivingLicense: true,
    },
    ev: {},
    ...overrides,
  };
}

describe("Req_PvtCar field parity with the Postman collection", () => {
  it("New Business emits exactly the collection's keys, in order", () => {
    expect(Object.keys(reqPvtCarNew(shape()))).toEqual(Object.keys(newPremium.Req_PvtCar));
  });

  it("Roll Over emits exactly the collection's keys, in order", () => {
    const out = reqPvtCarRollover(shape({ businessType: "Roll Over" }));
    expect(Object.keys(out)).toEqual(Object.keys(rolloverPremium.Req_PvtCar));
  });

  it("Used Car emits exactly the collection's keys, in order", () => {
    const out = reqPvtCarUsed(shape({ businessType: "Used Car" }));
    expect(Object.keys(out)).toEqual(Object.keys(usedPremium.Req_PvtCar));
  });

  it("Roll Over carries PlanType and EMIPlanType, which New Business does not", () => {
    const rollover = Object.keys(reqPvtCarRollover(shape({ businessType: "Roll Over" })));
    const fresh = Object.keys(reqPvtCarNew(shape()));
    expect(rollover).toContain("PlanType");
    expect(rollover).toContain("EMIPlanType");
    expect(fresh).not.toContain("PlanType");
    expect(fresh).not.toContain("EMIPlanType");
  });

  it("Used Car carries IsFibertank and NumberOfDrivers", () => {
    const used = Object.keys(reqPvtCarUsed(shape({ businessType: "Used Car" })));
    expect(used).toContain("IsFibertank");
    expect(used).toContain("NumberOfDrivers");
  });
});

describe("cover flags", () => {
  it("emits numeric 0/1 for cover flags, not booleans", () => {
    const out = reqPvtCarNew(shape({ addons: { ...shape().addons, zeroDep: true } }));
    expect(out.IsZeroDept_Cover).toBe(1);
    expect(out.IsTyreSecure_Cover).toBe(0);
  });

  it("emits real booleans for the fields HDFC types as boolean", () => {
    const out = reqPvtCarNew(shape());
    expect(out.BreakinWaiver).toBe(false);
    expect(out.Effectivedrivinglicense).toBe(true);
    expect(out.AntiTheftDiscFlag).toBe(false);
  });

  it("sets RTIPlanType only when RTI is on", () => {
    const on = reqPvtCarNew(shape({ addons: { ...shape().addons, rti: true, rtiPlanType: "A" } }));
    expect(on.IsRTI_Cover).toBe(1);
    expect(on.RTIPlanType).toBe("A");
    expect(reqPvtCarNew(shape()).RTIPlanType).toBeNull();
  });

  it("zeroes every EV flag for a non-electric vehicle", () => {
    const out = reqPvtCarNew(shape());
    expect(out.isElectricMotorCover).toBe(0);
    expect(out.isZeroDepClaimforBattery).toBe(0);
    expect(out.isBatteryChargerAccessoryCover).toBe(0);
  });

  it("sets the EV flags for an electric vehicle", () => {
    const out = reqPvtCarNew(
      shape({ isElectric: true, ev: { motorCover: 1, zeroDepBattery: 1, batteryChargerCover: 1 } }),
    );
    expect(out.isElectricMotorCover).toBe(1);
    expect(out.isZeroDepClaimforBattery).toBe(1);
    expect(out.isBatteryChargerAccessoryCover).toBe(1);
  });

  it("carries POLICY_TYPE through from the canonical plan type", () => {
    expect(reqPvtCarNew(shape()).POLICY_TYPE).toBe("OD Plus TP");
    expect(
      reqPvtCarNew(shape({ policy: { tenure: 1, policyType: "TP Only" } })).POLICY_TYPE,
    ).toBe("TP Only");
  });
});

describe("reqPvtCarFor", () => {
  it("dispatches on the business type", () => {
    expect(Object.keys(reqPvtCarFor(shape({ businessType: "Roll Over" })))).toContain("PlanType");
    expect(Object.keys(reqPvtCarFor(shape({ businessType: "Used Car" })))).toContain("IsFibertank");
    expect(Object.keys(reqPvtCarFor(shape()))).not.toContain("PlanType");
  });
});

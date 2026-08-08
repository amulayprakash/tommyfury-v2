import { describe, it, expect } from "vitest";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import {
  toHdfcRequest,
  resolveBusinessType,
  applyRolloverDateSanity,
  exceedsVehicleAge,
  HDFC_DEFAULT_LOSS_OF_BELONGINGS_SI,
} from "../mapper/canonical.ts";
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
    // vehicleAge is pinned inside the RTI ceiling: baseRequest's 2019
    // registration is past it, and this case is about the mapping, not the age.
    const out = toHdfcRequest(
      baseRequest({ vehicleAge: 1, zeroDep: true, tyreProtect: true, rti: true, consumables: true }),
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
    expect(toHdfcRequest(baseRequest({ vehicleAge: 1, rti: true }), codes, "T").addons.rtiPlanType)
      .toBe("A");
    expect(toHdfcRequest(baseRequest({ vehicleAge: 1, rti: false }), codes, "T").addons.rtiPlanType)
      .toBeUndefined();
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

describe("own-damage add-ons on a liability-only policy", () => {
  // PVTcarTestScenarios.xls "New and Rollover" rows 5 and 15 ask for "all cover"
  // on a TP-only policy. HDFC answers Basic_OD_Premium 0 — no own-damage section
  // — and then bills the own-damage add-ons anyway: live on UAT, Zero Dep ₹2,855,
  // Tyre Secure ₹1,328, NCB Protect ₹730, RTI ₹1,328, Consumables ₹664,
  // Engine-Gearbox ₹930, Emergency Assistance ₹50. HDFC polices none of it, so
  // the customer pays for cover the policy cannot carry unless we stop asking.
  const everyCover = {
    zeroDep: true, tyreProtect: true, ncbProtection: true, rti: true, consumables: true,
    engineProtect: true, rsa: true, lossOfBelongings: true, batteryProtect: true,
    electricalAccessoriesSI: 20_000, nonElectricalAccessoriesSI: 10_000,
    voluntaryDeductible: 2_500, hasAntiTheftDevice: true,
    // Inside the RTI age ceiling, so RTI is dropped by the policy type alone.
    vehicleAge: 1,
  } as const;

  it("drops every own-damage cover when the policy is TP Only", () => {
    const a = toHdfcRequest(
      baseRequest({ selectedPolicy: "thirdParty", ...everyCover }),
      codes,
      "T",
    ).addons;
    expect(a.zeroDep).toBe(false);
    expect(a.tyreSecure).toBe(false);
    expect(a.ncbProtection).toBe(false);
    expect(a.rti).toBe(false);
    expect(a.rtiPlanType).toBeUndefined();
    expect(a.consumables).toBe(false);
    expect(a.engineProtect).toBe(false);
    expect(a.roadsideAssistance).toBe(false);
    expect(a.lossOfPersonalBelongings).toBe(false);
    expect(a.lossOfPersonalBelongingsSI).toBe(0);
    expect(a.electricalAccessoryIdv).toBe(0);
    expect(a.nonElectricalAccessoryIdv).toBe(0);
    expect(a.voluntaryExcess).toBe(0);
  });

  it("keeps the liability-section covers, which HDFC does price on TP Only", () => {
    // Evidence that these belong on a liability policy is HDFC's own rating of
    // rows 5 and 15: UnnamedPerson_premium ₹300/₹100 and PaidDriver_Premium
    // ₹150/₹50 came back on the same TP-only quotes that wrongly carried Zero
    // Dep. Compulsory PA survives too — HDFC's liability sample
    // (fixtures/collection/liability-premium.json) sends CPA_Tenure: 1.
    const a = toHdfcRequest(
      baseRequest({
        selectedPolicy: "thirdParty",
        ...everyCover,
        paOwner: true,
        paUnnamedPassenger: true,
        unnamedPaSumInsured: 200_000,
        legalLiabilityPaidDriver: true,
        bifuelKitType: "CNG",
        bifuelKitSI: 60_000,
      }),
      codes,
      "T",
    ).addons;
    expect(a.cpaTenure).toBe(1);
    expect(a.effectiveDrivingLicense).toBe(false);
    expect(a.unnamedPersons).toBe(1);
    expect(a.unnamedPersonSI).toBe(200_000);
    expect(a.llPaidDriver).toBe(1);
    expect(a.noOfPaPaidDriver).toBe(1);
    // The bi-fuel kit rates its own BiFuel_Kit_TP_Premium, so it is not OD-only.
    expect(a.biFuelType).toBe("CNG");
    expect(a.biFuelKitValue).toBe(60_000);
  });

  it("drops the EV own-damage riders on a liability-only policy", () => {
    // Motor cover, battery/charger cover and battery zero-dep all indemnify the
    // vehicle itself. The explicit 0 on motorCover matters: the Req_PvtCar
    // templates read `ev.motorCover ?? 1`, so leaving it unset would send 1.
    const ev = toHdfcRequest(
      baseRequest({ selectedPolicy: "thirdParty", fuelType: "electric", ...everyCover }),
      codes,
      "T",
    );
    expect(ev.ev.motorCover).toBe(0);
    expect(ev.ev.zeroDepBattery).toBe(0);
    expect(ev.ev.batteryChargerCover).toBe(0);
    expect(reqPvtCarFor(ev).isElectricMotorCover).toBe(0);
  });

  it("leaves a comprehensive policy's own-damage covers alone", () => {
    const a = toHdfcRequest(baseRequest(everyCover), codes, "T").addons;
    expect(a.zeroDep).toBe(true);
    expect(a.tyreSecure).toBe(true);
    expect(a.rti).toBe(true);
    expect(a.roadsideAssistance).toBe(true);
    expect(a.electricalAccessoryIdv).toBe(20_000);
    expect(a.voluntaryExcess).toBe(2_500);
  });

  it("leaves a standalone-OD policy's own-damage covers alone", () => {
    // "OD Only" is all own-damage, so nothing here is out of place. (HDFC does
    // enforce the mirror rule itself — it charges no CPA on a SA-OD policy.)
    const a = toHdfcRequest(
      baseRequest({ selectedPolicy: "standAloneOD", ...everyCover }),
      codes,
      "T",
    ).addons;
    expect(a.zeroDep).toBe(true);
    expect(a.rti).toBe(true);
    expect(a.roadsideAssistance).toBe(true);
  });

  it("stops the OD cover FLAGS reaching Req_PvtCar, without changing its key set", () => {
    // The templates are held to golden-fixture key parity, so this rule may only
    // change values. Both halves are asserted here.
    const comprehensive = reqPvtCarFor(toHdfcRequest(baseRequest(everyCover), codes, "T"));
    const liability = reqPvtCarFor(
      toHdfcRequest(baseRequest({ selectedPolicy: "thirdParty", ...everyCover }), codes, "T"),
    );
    expect(Object.keys(liability)).toEqual(Object.keys(comprehensive));
    expect(liability.IsZeroDept_Cover).toBe(0);
    expect(liability.IsTyreSecure_Cover).toBe(0);
    expect(liability.IsNCBProtection_Cover).toBe(0);
    expect(liability.IsRTI_Cover).toBe(0);
    expect(liability.IsCOC_Cover).toBe(0);
    expect(liability.IsEngGearBox_Cover).toBe(0);
    expect(liability.IsEA_Cover).toBe(0);
    expect(liability.IsLossOfPersonalBelongings_Cover).toBe(0);
    expect(liability.LossOfPersonalBelonging_SI).toBe(0);
    expect(liability.ElecticalAccessoryIDV).toBe(0);
    expect(liability.NonElecticalAccessoryIDV).toBe(0);
    expect(liability.Voluntary_Excess_Discount).toBe(0);
    // …and the liability-section keys still carry their values.
    expect(liability.CPA_Tenure).toBe(1);
  });

  it("matches HDFC's own liability sample cover-flag block", () => {
    // fixtures/collection/liability-premium.json is HDFC's Req_PvtCar for the
    // Liability product: every Is*_Cover flag 0, both accessory IDVs 0,
    // AntiTheftDiscFlag false, Voluntary_Excess_Discount 0, CPA_Tenure 1.
    const liability = reqPvtCarFor(
      toHdfcRequest(baseRequest({ selectedPolicy: "thirdParty", ...everyCover }), codes, "T"),
    );
    for (const key of Object.keys(liability).filter((k) => /^Is[A-Z].*_Cover$/.test(k))) {
      expect({ key, value: liability[key] }).toEqual({ key, value: 0 });
    }
  });
});

describe("Return to Invoice vehicle-age ceiling", () => {
  // "RTI cover is valid up to 3 year's for all product." — PVTcarTestScenarios.xls
  // "New and Rollover" row 23. HDFC's UAT rules engine does not enforce its own
  // rule at three years: on a four-year-old Swift it priced RTI at ₹1,049 (gross
  // ₹6,792) and only declines from five ("<> Upto 3 years = decline Cover not
  // eligible for selected vehicle age").
  it("drops RTI on a vehicle past the three-year ceiling", () => {
    expect(
      toHdfcRequest(baseRequest({ vehicleAge: 4, rti: true }), codes, "T").addons.rti,
    ).toBe(false);
  });

  it("keeps RTI at exactly three years", () => {
    expect(
      toHdfcRequest(baseRequest({ vehicleAge: 3, rti: true }), codes, "T").addons.rti,
    ).toBe(true);
  });

  it("drops RTIPlanType with the cover, so no orphan plan code is sent", () => {
    const out = toHdfcRequest(baseRequest({ vehicleAge: 4, rti: true }), codes, "T");
    expect(out.addons.rtiPlanType).toBeUndefined();
    expect(reqPvtCarFor(out).IsRTI_Cover).toBe(0);
    expect(reqPvtCarFor(out).RTIPlanType).toBe("");
  });

  it("leaves every other add-on untouched when RTI is dropped", () => {
    const a = toHdfcRequest(
      baseRequest({ vehicleAge: 9, rti: true, zeroDep: true, consumables: true }),
      codes,
      "T",
    ).addons;
    expect(a.rti).toBe(false);
    expect(a.zeroDep).toBe(true);
    expect(a.consumables).toBe(true);
  });
});

describe("exceedsVehicleAge", () => {
  const req = (o: Partial<MotorQuoteRequest>) => baseRequest(o);

  it("prefers an explicitly supplied vehicleAge", () => {
    // registrationDate says brand new, vehicleAge says nine years old: the
    // caller's own number wins, so a journey that carries only the age still
    // gets the rule applied.
    expect(exceedsVehicleAge(req({ registrationDate: "2026-01-01", vehicleAge: 9 }), 3, "2026-08-08"))
      .toBe(true);
    expect(exceedsVehicleAge(req({ registrationDate: "2010-01-01", vehicleAge: 1 }), 3, "2026-08-08"))
      .toBe(false);
  });

  it("measures real calendar years, not 365-day blocks", () => {
    // The trap this exists for: 1,460 days (4 × 365) before 2026-08-08 is
    // 2022-08-09, which whole-year subtraction floors to 3 — yet the vehicle is
    // three years and 364 days old and an "up to 3 years" rule must decline it.
    expect(exceedsVehicleAge(req({ registrationDate: "2022-08-09" }), 3, "2026-08-08")).toBe(true);
  });

  it("is inclusive of the anniversary itself", () => {
    expect(exceedsVehicleAge(req({ registrationDate: "2023-08-08" }), 3, "2026-08-08")).toBe(false);
    expect(exceedsVehicleAge(req({ registrationDate: "2023-08-07" }), 3, "2026-08-08")).toBe(true);
  });

  it("judges the age at cover start, not at the moment of quoting", () => {
    // A rollover whose start was pushed past the previous policy's expiry can
    // cross an anniversary between quote and inception.
    expect(exceedsVehicleAge(req({ registrationDate: "2023-08-08" }), 3, "2026-08-07")).toBe(false);
    expect(exceedsVehicleAge(req({ registrationDate: "2023-08-08" }), 3, "2026-08-09")).toBe(true);
  });

  it("survives a leap-day registration", () => {
    // 29 Feb 2024 has no anniversary in 2027, so it rolls to 1 March — the
    // generous reading, which keeps the cover for one more day rather than
    // stripping it a day early on a date the customer never chose.
    expect(exceedsVehicleAge(req({ registrationDate: "2024-02-29" }), 3, "2027-02-27")).toBe(false);
    expect(exceedsVehicleAge(req({ registrationDate: "2024-02-29" }), 3, "2027-03-01")).toBe(false);
    expect(exceedsVehicleAge(req({ registrationDate: "2024-02-29" }), 3, "2027-03-02")).toBe(true);
  });

  it("does not gate on an unparseable date", () => {
    // Better to send the cover and let HDFC judge than to silently strip it
    // because a caller sent a malformed date.
    expect(exceedsVehicleAge(req({ registrationDate: "not-a-date" }), 3, "2026-08-08")).toBe(false);
  });
});

describe("anti-theft discount", () => {
  // "Anti Theft Discount not applicable for all motor product." —
  // PVTcarTestScenarios.xls "New and Rollover" row 27. HDFC grants it anyway:
  // sending AntiTheftDiscFlag=true returned AntiTheftDisc_Premium=37, a discount
  // off the filed rate that HDFC does not actually offer.
  it("never claims the discount, whatever the customer declared", () => {
    expect(toHdfcRequest(baseRequest({ hasAntiTheftDevice: true }), codes, "T").addons.antiTheftDisc)
      .toBe(false);
    expect(toHdfcRequest(baseRequest({ hasAntiTheftDevice: false }), codes, "T").addons.antiTheftDisc)
      .toBe(false);
  });

  it("still emits AntiTheftDiscFlag, so the Req_PvtCar key set is unchanged", () => {
    const out = reqPvtCarFor(toHdfcRequest(baseRequest({ hasAntiTheftDevice: true }), codes, "T"));
    expect(out).toHaveProperty("AntiTheftDiscFlag");
    expect(out.AntiTheftDiscFlag).toBe(false);
  });

  it("leaves the canonical flag itself alone for the providers that honour it", () => {
    // The suppression is HDFC-local on purpose: hasAntiTheftDevice is a real
    // customer fact and ICICI Lombard prices a genuine discount from it.
    const req = baseRequest({ hasAntiTheftDevice: true });
    toHdfcRequest(req, codes, "T");
    expect(req.hasAntiTheftDevice).toBe(true);
  });
});

describe("loss of personal belongings sum insured", () => {
  // HDFC rates this cover ON LossOfPersonalBelonging_SI. Hardcoded to 0, the
  // cover flag went out but LossOfPersonalBelongings_Premium came back 0 —
  // PVTcarTestScenarios.xls "Long Team" row 32. ₹50,000 is HDFC's own figure:
  // the only request in its Postman collection that turns the cover on
  // (Comprehensive / New Business / OD Plus TP / 3 OD + 3 TP / 04 CreateProposal)
  // sends LossOfPersonalBelonging_SI: 50000.
  it("substitutes HDFC's own sample sum insured when the caller names none", () => {
    const a = toHdfcRequest(baseRequest({ lossOfBelongings: true }), codes, "T").addons;
    expect(a.lossOfPersonalBelongings).toBe(true);
    expect(a.lossOfPersonalBelongingsSI).toBe(HDFC_DEFAULT_LOSS_OF_BELONGINGS_SI);
    expect(HDFC_DEFAULT_LOSS_OF_BELONGINGS_SI).toBe(50_000);
  });

  it("honours a caller-supplied sum insured", () => {
    expect(
      toHdfcRequest(baseRequest({ lossOfBelongings: true, lossOfBelongingsSI: 15_000 }), codes, "T")
        .addons.lossOfPersonalBelongingsSI,
    ).toBe(15_000);
  });

  it("sends no sum insured when the cover was not taken", () => {
    const a = toHdfcRequest(
      baseRequest({ lossOfBelongings: false, lossOfBelongingsSI: 15_000 }),
      codes,
      "T",
    ).addons;
    expect(a.lossOfPersonalBelongings).toBe(false);
    expect(a.lossOfPersonalBelongingsSI).toBe(0);
  });

  it("reaches LossOfPersonalBelonging_SI on the Req_PvtCar template", () => {
    const out = reqPvtCarFor(toHdfcRequest(baseRequest({ lossOfBelongings: true }), codes, "T"));
    expect(out.IsLossOfPersonalBelongings_Cover).toBe(1);
    expect(out.LossOfPersonalBelonging_SI).toBe(50_000);
  });
});

describe("compulsory personal accident (CPA) cover", () => {
  // Effectivedrivinglicense is HDFC's CPA EXEMPTION flag, not a licence
  // statement — their warning reads "Owner has no valid driving license or
  // Having CPA in another policy". Hardcoding it true suppressed CPA on every
  // quote: verified live, CPA ₹0 with true vs ₹325 with false.
  it("does not claim the exemption when the customer wants owner-driver PA", () => {
    expect(toHdfcRequest(baseRequest({ paOwner: true }), codes, "T").addons.effectiveDrivingLicense)
      .toBe(false);
  });

  it("claims the exemption only when the customer declines owner-driver PA", () => {
    expect(toHdfcRequest(baseRequest({ paOwner: false }), codes, "T").addons.effectiveDrivingLicense)
      .toBe(true);
  });

  it("still sets CPA_Tenure from paOwner, so the two stay consistent", () => {
    const on = toHdfcRequest(baseRequest({ paOwner: true }), codes, "T");
    expect(on.addons.cpaTenure).toBe(1);
    expect(on.addons.effectiveDrivingLicense).toBe(false);
  });
});

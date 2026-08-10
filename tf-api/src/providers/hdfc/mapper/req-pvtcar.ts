import { bool01, boolTF, num } from "../format.ts";
import { HDFC_BUSINESS_TYPE } from "../config.ts";
import type { HdfcRequestShape } from "../types.ts";

/**
 * The Req_PvtCar blocks, ported verbatim from the UAT-verified standalone
 * module. Each business type has a DIFFERENT field set in HDFC's Postman
 * collection, and HDFC's Blaze rules engine rejects payloads carrying fields the
 * sample for that business type does not send — so these stay as three separate
 * templates rather than one merged shape with conditionals.
 *
 * KEY ORDER IS PART OF THE CONTRACT. The tests assert Object.keys() equality
 * against fixtures extracted from the collection.
 *
 * Where the standalone module read an addon the canonical request has no source
 * for (a.pospCode, a.towing, a.namedPersons, a.payAsYouDrive, ...) the literal
 * that expression evaluated to is inlined — the key still ships, with the same
 * value the original sent, because dropping it would change the field set.
 * `toHdfcDate` is deliberately not imported: every date-valued key in these
 * three templates (BreakinInspectionDate, initialOdometerReadingDate) has no
 * canonical source and resolves to null.
 */

export type ReqPvtCar = Record<string, unknown>;

/** New Business — order per Comprehensive/New Business/03 CalculatePremium. */
export function reqPvtCarNew(req: HdfcRequestShape): ReqPvtCar {
  const a = req.addons;
  const ev = req.ev;
  return {
    POSP_CODE: null,
    POLICY_TYPE: req.policy.policyType,
    POLICY_TENURE: num(req.policy.tenure, 1),
    ExtensionCountryCode: 0.0,
    ExtensionCountryName: null,
    BreakIN_ID: null,
    BreakInStatus: null,
    BreakInInspectionFlag: null,
    BreakinWaiver: false,
    BreakinInspectionDate: null,
    Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
    NumberOfEmployees: 0,
    NoOfWorkmen: 0,
    NoOfCleanerConductorCoolies: 0,
    BiFuelType: a.biFuelType ?? "",
    BiFuel_Kit_Value: num(a.biFuelKitValue),
    LLPaiddriver: num(a.llPaidDriver),
    PAPaiddriverSI: num(a.paPaidDriverSI),
    Owner_Driver_Nominee_Name: a.nomineeName ?? null,
    Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
    Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
    Owner_Driver_Appointee_Name: null,
    Owner_Driver_Appointee_Relationship: null,
    IsZeroDept_Cover: bool01(a.zeroDep),
    IsTyreSecure_Cover: bool01(a.tyreSecure),
    ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
    NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
    OtherLoadDiscRate: 0.0,
    AntiTheftDiscFlag: boolTF(a.antiTheftDisc),
    HandicapDiscFlag: false,
    IsNCBProtection_Cover: bool01(a.ncbProtection),
    IsRTI_Cover: bool01(a.rti),
    RTIPlanType: a.rti ? (a.rtiPlanType ?? "A") : null,
    IsCOC_Cover: bool01(a.consumables),
    IsEngGearBox_Cover: bool01(a.engineProtect),
    IsLossofUseDownTimeProt_Cover: bool01(a.lossOfUse),
    IsEA_Cover: bool01(a.roadsideAssistance),
    IsEAW_Cover: bool01(a.roadsideAssistanceWorldwide),
    IsEAAdvance_Cover: bool01(a.roadsideAssistanceAdvance),
    IsTowing_Cover: 0,
    Towing_Limit: null,
    IsEMIProtector_Cover: bool01(a.emiProtector),
    NoOfEmi: a.noOfEmi ?? null,
    EMIAmount: num(a.emiAmount),
    /**
     * KEY-SET EXCEPTION, and the only one in this template.
     *
     * HDFC's New Business sample does not send `EMIPlanType`, so it is not part
     * of the proven key set and is NOT emitted on any payload that leaves the
     * EMI cover off — every request the certification pack has ever passed with
     * keeps exactly its old shape.
     *
     * It is emitted when the cover IS on because without it the cover cannot be
     * bought at all. Proven live on UAT, New Business, model 12798 / RTO 10406:
     * `IsEMIProtector_Cover: 1` with `NoOfEmi: 3` and `EMIAmount: 15000` is
     * refused with "EMI Protector Plus - Add on system rate is not available";
     * the byte-identical payload with `EMIPlanType: "A"` added prices. So the
     * key genuinely belongs on an EMI-Protector payload — HDFC's sample simply
     * never buys the cover. Same conditional-key discipline as
     * `Policy_Details.PolicyEndDate` for the multi-year standalone OD.
     *
     * Position mirrors the Roll Over template, which carries the key
     * unconditionally: immediately after EMIAmount.
     */
    ...(a.emiProtector ? { EMIPlanType: a.emiPlanType ?? null } : {}),
    NoofUnnamedPerson: num(a.unnamedPersons),
    UnnamedPersonSI: num(a.unnamedPersonSI),
    Voluntary_Excess_Discount: num(a.voluntaryExcess),
    IsLimitedtoOwnPremises: 0,
    TPPDLimit: 0.0,
    NoofnamedPerson: 0,
    namedPersonSI: 0,
    NamedPersons: null,
    AutoMobile_Assoication_No: a.automobileAssociationNo ?? null,
    fuel_type: null,
    CPA_Tenure: num(a.cpaTenure),
    payAsYouDrive: null,
    initialOdometerReading: null,
    initialOdometerReadingDate: null,
    kmsYouExpectToDrive: 0,
    IsHighProtection_Cover: bool01(a.highProtection),
    HigherTowingLimit: a.higherTowingLimit ?? null,
    IsLossOfPersonalBelongings_Cover: bool01(a.lossOfPersonalBelongings),
    LossOfPersonalBelonging_SI: num(a.lossOfPersonalBelongingsSI),
    isCoPassengerOptedForLOPB: 0,
    isElectricMotorCover: req.isElectric ? bool01(ev.motorCover ?? 1) : 0,
    isZeroDepClaimforBattery: req.isElectric ? bool01(ev.zeroDepBattery ?? a.zeroDep) : 0,
    isBatteryChargerAccessoryCover: req.isElectric ? bool01(ev.batteryChargerCover) : 0,
    NoOfPAPaidDriver: num(a.noOfPaPaidDriver),
  };
}

/**
 * Roll Over — same as New Business plus PlanType (first) and EMIPlanType (after
 * EMIAmount), and CPA_Tenure defaults to 1 rather than 0. RTIPlanType falls back
 * to "" here, not null, which is what the Roll Over sample sends.
 *
 * DIVERGENCE FROM THE STANDALONE MODULE: reqPvtCar_Rollover in payloadBuilder.js
 * omits `kmsYouExpectToDrive`, which its own New Business template sends and
 * which HDFC's Roll Over CalculatePremium sample DOES carry (between
 * initialOdometerReadingDate and IsHighProtection_Cover). That is a dropped
 * field in the JS, not an intentional per-business-type difference, so the key
 * is restored here to match the collection.
 */
export function reqPvtCarRollover(req: HdfcRequestShape): ReqPvtCar {
  const a = req.addons;
  const ev = req.ev;
  return {
    /**
     * HDFC's merchandising label for the cover bundle. Inert as a rating input —
     * live on UAT every value including an invented one returned an identical
     * gross premium — but it is HDFC's own field and this template has always
     * carried the key, so the plan the customer actually chose is now named on
     * the payload instead of a flat null. What the plan COSTS is carried by the
     * Is*_Cover flags the plan expanded to. See HDFC_PLANS.
     */
    PlanType: a.planType ?? null,
    POSP_CODE: null,
    POLICY_TYPE: req.policy.policyType,
    POLICY_TENURE: num(req.policy.tenure, 1),
    ExtensionCountryCode: 0.0,
    ExtensionCountryName: null,
    BreakIN_ID: null,
    BreakInStatus: null,
    BreakInInspectionFlag: null,
    BreakinWaiver: false,
    BreakinInspectionDate: null,
    Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
    NumberOfEmployees: 0,
    NoOfWorkmen: 0,
    NoOfCleanerConductorCoolies: 0,
    BiFuelType: a.biFuelType ?? "",
    BiFuel_Kit_Value: num(a.biFuelKitValue),
    LLPaiddriver: num(a.llPaidDriver),
    PAPaiddriverSI: num(a.paPaidDriverSI),
    Owner_Driver_Nominee_Name: a.nomineeName ?? null,
    Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
    Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
    Owner_Driver_Appointee_Name: null,
    Owner_Driver_Appointee_Relationship: null,
    IsZeroDept_Cover: bool01(a.zeroDep),
    IsTyreSecure_Cover: bool01(a.tyreSecure),
    ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
    NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
    OtherLoadDiscRate: 0.0,
    AntiTheftDiscFlag: boolTF(a.antiTheftDisc),
    HandicapDiscFlag: false,
    IsNCBProtection_Cover: bool01(a.ncbProtection),
    IsRTI_Cover: bool01(a.rti),
    RTIPlanType: a.rti ? (a.rtiPlanType ?? "A") : "",
    IsCOC_Cover: bool01(a.consumables),
    IsEngGearBox_Cover: bool01(a.engineProtect),
    IsLossofUseDownTimeProt_Cover: bool01(a.lossOfUse),
    IsEA_Cover: bool01(a.roadsideAssistance),
    IsEAW_Cover: bool01(a.roadsideAssistanceWorldwide),
    IsEAAdvance_Cover: bool01(a.roadsideAssistanceAdvance),
    IsTowing_Cover: 0,
    Towing_Limit: null,
    IsEMIProtector_Cover: bool01(a.emiProtector),
    NoOfEmi: a.noOfEmi ?? null,
    EMIAmount: num(a.emiAmount),
    EMIPlanType: a.emiPlanType ?? null,
    NoofUnnamedPerson: num(a.unnamedPersons),
    UnnamedPersonSI: num(a.unnamedPersonSI),
    Voluntary_Excess_Discount: num(a.voluntaryExcess),
    IsLimitedtoOwnPremises: 0,
    TPPDLimit: 0.0,
    NoofnamedPerson: 0,
    namedPersonSI: 0,
    NamedPersons: null,
    AutoMobile_Assoication_No: a.automobileAssociationNo ?? null,
    fuel_type: null,
    CPA_Tenure: a.cpaTenure != null ? num(a.cpaTenure) : 1,
    payAsYouDrive: null,
    initialOdometerReading: null,
    initialOdometerReadingDate: null,
    kmsYouExpectToDrive: 0,
    IsHighProtection_Cover: bool01(a.highProtection),
    HigherTowingLimit: a.higherTowingLimit ?? null,
    IsLossOfPersonalBelongings_Cover: bool01(a.lossOfPersonalBelongings),
    LossOfPersonalBelonging_SI: num(a.lossOfPersonalBelongingsSI),
    isCoPassengerOptedForLOPB: 0,
    isElectricMotorCover: req.isElectric ? bool01(ev.motorCover ?? 1) : 0,
    isZeroDepClaimforBattery: req.isElectric ? bool01(ev.zeroDepBattery ?? a.zeroDep) : 0,
    isBatteryChargerAccessoryCover: req.isElectric ? bool01(ev.batteryChargerCover) : 0,
    NoOfPAPaidDriver: num(a.noOfPaPaidDriver),
  };
}

/**
 * Used Car — a DISTINCT order (the Towing block moves up above the accessory
 * IDVs, the whole Is*_Cover block moves below the odometer fields, IsFibertank
 * and NumberOfDrivers appear, and PayAsYouDrive/InitialOdometerReading*
 * are capitalised differently). It also sends NO PlanType, EMI*, RTIPlanType,
 * kmsYouExpectToDrive, isCoPassengerOptedForLOPB, EV or NoOfPAPaidDriver keys,
 * and no NoOfCleanerConductorCoolies — NoOfWorkmen moves down next to
 * NumberOfDrivers. Ported from payloadBuilder.js reqPvtCar_Used verbatim.
 */
export function reqPvtCarUsed(req: HdfcRequestShape): ReqPvtCar {
  const a = req.addons;
  return {
    POSP_CODE: null,
    POLICY_TYPE: req.policy.policyType,
    POLICY_TENURE: num(req.policy.tenure, 1),
    ExtensionCountryCode: 0,
    ExtensionCountryName: null,
    BreakIN_ID: null,
    BreakInStatus: null,
    BreakInInspectionFlag: null,
    BreakinWaiver: false,
    BreakinInspectionDate: null,
    Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
    NumberOfEmployees: 0,
    BiFuelType: a.biFuelType ?? null,
    BiFuel_Kit_Value: num(a.biFuelKitValue),
    LLPaiddriver: num(a.llPaidDriver),
    PAPaiddriverSI: num(a.paPaidDriverSI),
    Owner_Driver_Nominee_Name: a.nomineeName ?? null,
    Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
    Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
    Owner_Driver_Appointee_Name: null,
    Owner_Driver_Appointee_Relationship: null,
    Towing_Limit: null,
    IsTowing_Cover: 0,
    IsEAAdvance_Cover: bool01(a.roadsideAssistanceAdvance),
    ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
    NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
    OtherLoadDiscRate: 0,
    AntiTheftDiscFlag: boolTF(a.antiTheftDisc),
    HandicapDiscFlag: false,
    NoofUnnamedPerson: num(a.unnamedPersons),
    UnnamedPersonSI: num(a.unnamedPersonSI),
    Voluntary_Excess_Discount: num(a.voluntaryExcess),
    IsLimitedtoOwnPremises: 0,
    TPPDLimit: 0,
    NoofnamedPerson: 0,
    namedPersonSI: 0,
    NamedPersons: null,
    AutoMobile_Assoication_No: a.automobileAssociationNo ?? null,
    fuel_type: null,
    CPA_Tenure: a.cpaTenure != null ? num(a.cpaTenure) : 1,
    PayAsYouDrive: null,
    InitialOdometerReading: null,
    InitialOdometerReadingDate: null,
    IsZeroDept_Cover: bool01(a.zeroDep),
    IsTyreSecure_Cover: bool01(a.tyreSecure),
    IsNCBProtection_Cover: bool01(a.ncbProtection),
    IsRTI_Cover: bool01(a.rti),
    IsCOC_Cover: bool01(a.consumables),
    IsEngGearBox_Cover: bool01(a.engineProtect),
    IsLossofUseDownTimeProt_Cover: bool01(a.lossOfUse),
    IsEA_Cover: bool01(a.roadsideAssistance),
    IsEAW_Cover: bool01(a.roadsideAssistanceWorldwide),
    IsFibertank: bool01(a.fibertank),
    NoOfWorkmen: 0,
    NumberOfDrivers: num(a.numberOfDrivers),
    IsHighProtection_Cover: bool01(a.highProtection),
    // The Used Car sample sends 0 here, not null, and carries no EMI keys at
    // all — so EMI Protector is simply not offered on a used-car policy.
    HigherTowingLimit: a.higherTowingLimit ?? 0,
    IsLossOfPersonalBelongings_Cover: bool01(a.lossOfPersonalBelongings),
    LossOfPersonalBelonging_SI: num(a.lossOfPersonalBelongingsSI),
  };
}

export function reqPvtCarFor(req: HdfcRequestShape): ReqPvtCar {
  if (req.businessType === HDFC_BUSINESS_TYPE.rollover) return reqPvtCarRollover(req);
  if (req.businessType === HDFC_BUSINESS_TYPE.used) return reqPvtCarUsed(req);
  return reqPvtCarNew(req);
}

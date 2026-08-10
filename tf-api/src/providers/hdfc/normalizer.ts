import type { VehicleCategory } from "@/contracts/enums.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { CertificateResult } from "@/contracts/policy.ts";
import { HDFC_SLUG, HDFC_DISPLAY_NAME, HDFC_POLICY_TYPE } from "./config.ts";
import type { HdfcCustomer } from "./types.ts";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
/** A zero cover premium means "not selected" — omit it rather than reporting 0. */
const opt = (v: unknown): number | undefined => num(v) || undefined;

export interface HdfcIdvBand {
  recommended: number | null;
  min: number | null;
  max: number | null;
}

/** Step 02 response. The data dictionary puts these under CalculatedIDV. */
export function normalizeIdv(body: unknown): HdfcIdvBand {
  const b = obj(body);
  const idv = obj(b.CalculatedIDV ?? b.IDV_DETAILS ?? b);
  return {
    recommended: (idv.IDV_AMOUNT as number) ?? (idv.RecommendedIDV as number) ?? null,
    min: (idv.MIN_IDV_AMOUNT as number) ?? (idv.MinIDV as number) ?? null,
    max: (idv.MAX_IDV_AMOUNT as number) ?? (idv.MaxIDV as number) ?? null,
  };
}

/**
 * HDFC rejects any IDV that deviates from its own recommendation with
 * "IDV Deviation not allowed", so the recommendation always wins. A caller
 * value is used only when HDFC offered no recommendation AND the value sits
 * inside the permitted band.
 */
export function selectIdvForPremium(band: HdfcIdvBand, callerIdv: number): number | null {
  if (band.recommended) return band.recommended;
  if (!callerIdv) return null;
  if (band.min && callerIdv < band.min) return null;
  if (band.max && callerIdv > band.max) return null;
  return callerIdv;
}

/**
 * The expiring-policy snapshot returned by `getpolicydataforrenewal`. Renewal is
 * keyed by policy number alone, so this response is the ONLY source for the IDV,
 * cover, vehicle codes and customer that the later renewal steps need.
 *
 * Field names follow the kit's data dictionary sheet "03 RenewalExtract", whose
 * response lives under `Resp_RE` (+ a `Customer_Details` block). The
 * `Policy_Details.Vehicle_IDV` / bare-root fallbacks are what the UAT-exercised
 * standalone module read, kept so either observed shape works.
 */
export interface HdfcRenewalSnapshot {
  idv: number;
  /** HDFC vocabulary ("OD Plus TP" / "OD Only" / "TP Only"). */
  policyType: string;
  tenure: number;
  registrationNo?: string;
  modelCode?: string;
  rtoCode?: string;
  registrationDate?: string;
  policyStartDate?: string;
  previousPolicyType?: string;
  previousPolicyEndDate?: string;
  previousPolicyTpStartDate?: string;
  previousPolicyTpEndDate?: string;
  customer: HdfcCustomer;
}

/** Renewal step 02 response → the snapshot the remaining renewal steps build on. */
export function normalizeRenewalExtract(body: unknown): HdfcRenewalSnapshot {
  const b = obj(body);
  const re = obj(b.Resp_RE);
  const pd = obj(b.Policy_Details);
  const c = obj(b.Customer_Details);

  return {
    idv: num(re.IDV ?? pd.Vehicle_IDV ?? b.Vehicle_IDV),
    // A renewal defaults to the package cover, never to OD-only: guessing
    // "OD Only" for a comprehensive policy would silently drop TP cover.
    policyType: str(re.Policy_Type) ?? HDFC_POLICY_TYPE.comprehensive,
    tenure: num(re.Policy_Term) || 1,
    registrationNo: str(re.Registration_No),
    modelCode: str(re.VehicleModelCode),
    rtoCode: str(re.RTOLocationCode),
    registrationDate: str(re.DateofDeliveryOrRegistration),
    policyStartDate: str(re.Policy_Effective_From_Date),
    previousPolicyType: str(re.PreviousPolicy_PolicyType),
    previousPolicyEndDate: str(re.PreviousPolicy_PolicyEndDate),
    previousPolicyTpStartDate: str(re.PreviousPolicy_TPStartDate),
    previousPolicyTpEndDate: str(re.PreviousPolicy_TPEndDate),
    customer: {
      firstName: str(c.Customer_FirstName),
      middleName: str(c.Customer_MiddleName),
      lastName: str(c.Customer_LastName),
      dob: str(c.CustomerDOB),
      email: str(c.CustomerEmail),
      mobile: str(c.CustomerMobile),
      panNo: str(c.Customer_PANNum),
      salutation: str(c.Customer_Salutation),
      gender: str(c.CustomerGender),
      permAddress1: str(c.PermanentAddress1),
      permAddress2: str(c.PermanentAddress2),
      permCityDistrict: str(c.PermanentCityDistrict),
      permState: str(c.PermanentState),
      permPinCode: str(c.PermanentPinCode),
      pehchaanId: str(c.Customer_PehchaanID),
    },
  };
}

/** HDFC's POLICY_TYPE vocabulary → the canonical policy type. */
export function canonicalPolicyType(hdfcPolicyType: string): string {
  const hit = Object.entries(HDFC_POLICY_TYPE).find(([, v]) => v === hdfcPolicyType);
  return hit ? hit[0] : "comprehensive";
}

export interface HdfcQuoteCtx {
  requestId: string;
  quoteNo: string;
  policyType: string;
  vehicleCategory: VehicleCategory;
}

/** Step 03 response → canonical quote. All amounts are whole rupees. */
export function normalizeQuote(body: unknown, ctx: HdfcQuoteCtx): CanonicalQuoteResult {
  const b = obj(body);
  const r = obj(b.Resp_PvtCar ?? b.Resp_Motor);

  // Field names below are taken from a REAL HDFC UAT CalculatePremium response
  // (captured 2026-08-07, 108 keys in Resp_PvtCar), not from the data dictionary.
  // Several differ from the obvious guess — the cover premiums are prefixed
  // `Vehicle_Base_`, own-damage and third-party are `Basic_*` rather than
  // `Total_*`, and `EA_premium` has a lowercase p. The older spellings are kept
  // as fallbacks in case another product spells them the documented way.
  const addonPremiums = {
    zeroDep: opt(r.Vehicle_Base_ZD_Premium ?? r.ZeroDept_Premium),
    tyreProtect: opt(r.Vehicle_Base_TySec_Premium ?? r.TyreSecure_Premium),
    ncbProtection: opt(r.Vehicle_Base_NCB_Premium ?? r.NCBProtection_Premium),
    rti: opt(r.Vehicle_Base_RTI_Premium ?? r.RTI_Premium),
    consumables: opt(r.Vehicle_Base_COC_Premium ?? r.COC_Premium),
    // `Vehicle_Base_ENG_Premium` is what the wire actually carries (live UAT:
    // 783 on a 1-year Swift). The `_EGP_` spelling this used to read was a guess
    // and matched nothing, so the engine-gearbox premium never reached the
    // compare card even when the customer had bought and been charged for it.
    engineProtect: opt(
      r.Vehicle_Base_ENG_Premium ?? r.Vehicle_Base_EGP_Premium ?? r.EngGearBox_Premium,
    ),
    rsa: opt(r.EA_premium ?? r.EA_Premium),
    // Lowercase p, like EA_premium — HDFC spells this pair differently from
    // every other premium field in Resp_PvtCar.
    rsaWorldwide: opt(r.EAW_premium ?? r.EAW_Premium),
    // "Loss of Use / Down Time Protection" is HDFC's name for Garage Cash.
    garageCash: opt(r.Loss_of_Use_Premium),
    emiProtect: opt(r.EMI_PROTECTOR_PREMIUM),
    lossOfBelongings: opt(r.LossOfPersonalBelongings_Premium),
    paOwner: opt(r.CPA_Premium),
    paUnnamedPassenger: opt(r.UnnamedPerson_Premium),
    legalLiabilityPaidDriver: opt(r.LLPaiddriver_Premium),
    // EVs price three separate battery/motor covers; the canonical contract has
    // one batteryProtect slot, so report their sum rather than dropping two.
    batteryProtect:
      opt(
        num(r.ElectricMotorCover_Premium) +
          num(r.ZeroDepClaimForBattery_Premium) +
          num(r.BatteryChargerAccessory_Premium),
      ) ?? opt(r.ElectricMotor_Premium),
  };

  const discounts = {
    ncbPercent: opt(r.Current_NCB_Per ?? r.NCB_Percentage),
    ncbAmount: opt(r.NCBBonusDisc_Premium ?? r.NCB_Discount),
    antiTheft: opt(r.AntiTheft_Discount),
    voluntaryDeductible: opt(r.Voluntary_Excess_Discount),
    ownDamageDiscount: opt(r.Other_Discount),
  };

  /**
   * Break-in: the cover lapsed before this policy starts, so HDFC will not put
   * it on risk until the vehicle has been inspected. Without this the customer
   * saw a broken-in HDFC quote on the compare card indistinguishable from a
   * clean one, and only discovered the inspection after choosing it.
   *
   * Both field names come from a real UAT CalculatePremium response, and the
   * signal is `BreakIN_Premium`, NOT `BreakInLoadingPercent`. HDFC returns the
   * loading PERCENTAGE on a liability break-in as well — live, a TP-only policy
   * whose cover lapsed 120 days earlier comes back with
   * `BreakInLoadingPercent: 15` and `BreakIN_Premium: 0` — while its own pack
   * says that case needs no inspection ("Verify if Break-in in laibility
   * product" → "Inspection not required"). The percentage is the rate that
   * WOULD apply; the premium is what HDFC actually charged, and it is charged
   * only where a break-in genuinely bites. Live values behind that reading:
   *
   *   lapsed  1 day  (< 24 h)   0% / ₹0      — no loading
   *   lapsed  3 days             15% / ₹220
   *   lapsed 60 days             15% / ₹220
   *   lapsed 120 days            15% / ₹1,000
   *   lapsed 120 days, TP only   15% / ₹0     — no inspection
   *   never insured, 100-day-old new vehicle  0% / ₹0 — no lapse to break in from
   *
   * KNOWN GAP: HDFC's "Break In" sheet says a lapse under 24 hours is also sent
   * for inspection, and that case carries no loading — CalculatePremium exposes
   * nothing that separates it from a clean quote, so it is not flagged here.
   */
  const isInspectionRequired = num(r.BreakIN_Premium) > 0;

  const totalAddonPremium = Object.values(addonPremiums).reduce<number>((s, v) => s + (v ?? 0), 0);
  const totalDiscount =
    num(r.NCBBonusDisc_Premium ?? r.NCB_Discount) +
    num(r.AntiTheft_Discount) +
    num(r.Voluntary_Excess_Discount) +
    num(r.Other_Discount);
  const netPremium = num(r.Net_Premium);
  const serviceTaxAmount = num(r.Service_Tax);
  const grossPremium = num(r.Total_Premium);

  return {
    quoteNo: ctx.quoteNo,
    transactionId: ctx.quoteNo,
    requestId: ctx.requestId,
    providerSlug: HDFC_SLUG,
    insurerName: HDFC_DISPLAY_NAME,
    policyType: ctx.policyType,
    vehicleCategory: ctx.vehicleCategory,
    idvValue: num(r.IDV ?? r.Vehicle_IDV),
    minIdv: opt(r.MinimumIDV),
    maxIdv: opt(r.MaximumIDV),
    isInspectionRequired,
    basicOdPremium: num(r.Basic_OD_Premium ?? r.Total_OD_Premium ?? r.OD_Premium),
    thirdPartyPremium: num(r.Basic_TP_Premium ?? r.Total_TP_Premium ?? r.TP_Premium),
    addonPremiums,
    discounts,
    totalAddonPremium,
    totalDiscount,
    netPremium,
    serviceTaxPercent: netPremium > 0 ? Math.round((serviceTaxAmount / netPremium) * 100) : 18,
    serviceTaxAmount,
    grossPremium,
    _rawResponse: body,
  };
}

export interface HdfcProposalResult {
  proposalNumber?: string;
}

/** Step 04 response. */
export function normalizeProposal(body: unknown): HdfcProposalResult {
  const b = obj(body);
  const pd = obj(b.Policy_Details);
  return { proposalNumber: str(pd.ProposalNumber) ?? str(b.ProposalNumber) };
}

export interface HdfcPaymentResult {
  policyNumber?: string;
}

/** Step 06 response. HDFC spells it PolicyNumber (no underscore) here. */
export function normalizePayment(body: unknown): HdfcPaymentResult {
  const b = obj(body);
  const pd = obj(b.Policy_Details);
  return {
    policyNumber:
      str(pd.PolicyNumber) ?? str(pd.Policy_Number) ?? str(b.PolicyNumber) ?? str(b.Policy_Number),
  };
}

/**
 * Step 07 response → certificate. Extends the shared `CertificateResult`
 * contract (`coiBase64`, `status`, `_rawResponse`) with HDFC's own policy
 * number, which getpolicydocument echoes back but which the shared contract
 * doesn't carry (see normalizer.test.ts contract cross-check note below).
 */
export interface HdfcCertificateResult extends CertificateResult {
  policyNumber?: string;
}

export function normalizeCertificate(body: unknown): HdfcCertificateResult {
  const b = obj(body);
  const doc = obj(b.Req_Policy_Document ?? b.Policy_Document);
  return {
    policyNumber: str(doc.Policy_Number) ?? str(doc.PolicyNumber),
    coiBase64: str(doc.Document) ?? str(doc.PolicyDocument) ?? "",
    _rawResponse: body,
  };
}

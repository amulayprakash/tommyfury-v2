import { boolTF, normalizeClaim, num, toHdfcDate, yearOnly } from "../format.ts";
import { HDFC_BUSINESS_TYPE } from "../config.ts";
import type { HdfcRequestShape } from "../types.ts";

/**
 * The Policy_Details blocks, ported from the UAT-verified standalone module.
 * As with Req_PvtCar, each business type has a DIFFERENT field set in HDFC's
 * Postman collection and the Blaze rules engine rejects payloads carrying fields
 * the sample for that business type does not send — so these stay as three
 * separate templates rather than one shape with conditionals.
 *
 * KEY ORDER IS PART OF THE CONTRACT. The tests assert Object.keys() equality
 * against fixtures extracted from the collection (12 / 29 / 22 keys).
 */

export type PolicyDetails = Record<string, unknown>;

export interface PolicyDetailsOptions {
  /**
   * CreateProposal needs the previous policy's identity (insurer + policy number)
   * so HDFC can validate claim status. CalculatePremium must NOT send them: a
   * previous-insurer code at premium time fails with "No Data found for given
   * previous insured code".
   */
  forProposal?: boolean;
}

/**
 * HDFC always needs a DateofDeliveryOrRegistration. Fall back through explicit
 * delivery date → registration date → mid-year of the manufacture year → policy
 * start → today. Never returns empty.
 */
function deliveryOrRegDate(req: HdfcRequestShape): string | null {
  const v = req.vehicle;
  if (v.deliveryOrRegistrationDate) return toHdfcDate(v.deliveryOrRegistrationDate);
  if (v.registrationDate) return toHdfcDate(v.registrationDate);
  if (v.manufactureYear) {
    const m = String(v.manufactureYear).match(/(19|20)\d{2}/);
    if (m) return toHdfcDate(`${m[0]}-06-15`);
  }
  if (req.policy.startDate) return toHdfcDate(req.policy.startDate);
  return toHdfcDate(new Date());
}

/**
 * Parses a date-only value to a Date at LOCAL midnight. `new Date("2024-04-25")`
 * is UTC midnight, which reads back through toHdfcDate's local getters as the
 * 24th on any host behind UTC. The Roll Over block below *derives* dates by
 * subtracting days, and HDFC rejects a rollover unless the previous policy
 * expires strictly before the new start — a one-day slip is a vendor rejection,
 * not a cosmetic bug.
 */
function toLocalDate(input?: string | null): Date | null {
  if (!input) return null;
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Day arithmetic on calendar components, so a DST boundary cannot shift the date. */
function minusDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days);
}

/**
 * HDFC's Blaze schema needs a valid, non-empty previous policy type: an empty
 * value breaks it with "prevPolicyStartDate expected prevPolicyType", and the
 * frontend's all-caps "COMPREHENSIVE" is not a value it recognises.
 *
 * Every recognised input therefore normalises to "Comprehensive Package",
 * including TP Only. That looks wrong but is deliberate: HDFC's OTHEUW_VALIDATION
 * (line 13110) raises a claim-validation error on some TP Only / previous-type
 * combinations, and "Comprehensive Package" is the combination proven to pass on
 * UAT for every Roll Over. Anything unrecognised is passed through untouched.
 */
function normalizePrevType(type?: string | null): string | null {
  const s = String(type ?? "")
    .trim()
    .toLowerCase();
  if (!s || s.includes("comprehensive")) return "Comprehensive Package";
  if (s.includes("liability") || s.includes("tp")) return "Comprehensive Package";
  return type ?? null;
}

/** New Business — order per Comprehensive/New Business/03 CalculatePremium. */
export function policyDetailsNew(req: HdfcRequestShape): PolicyDetails {
  const v = req.vehicle;
  return {
    PolicyStartDate: toHdfcDate(req.policy.startDate),
    ProposalDate: toHdfcDate(req.policy.proposalDate),
    BusinessType_Mandatary: HDFC_BUSINESS_TYPE.new,
    VehicleModelCode: String(v.modelCode),
    DateofDeliveryOrRegistration: deliveryOrRegDate(req),
    DateofFirstRegistration: v.firstRegistrationDate ? toHdfcDate(v.firstRegistrationDate) : null,
    YearOfManufacture: yearOnly(v.manufactureYear, req.policy.startDate),
    // The collection uses null here; a real plate would make HDFC's schema
    // demand registrationNumberSection* fields. CreateProposal overwrites it.
    Registration_No: null,
    EngineNumber: v.engineNumber?.trim() ?? null,
    ChassisNumber: v.chassisNumber?.trim() ?? null,
    RTOLocationCode: String(v.rtoCode),
    Vehicle_IDV: num(v.idv),
  };
}

/**
 * Roll Over — adds the financier block, the full previous-policy block and the
 * PreviousPolicy_Is*_Cover trailer. Ported from payloadBuilder.js
 * policyDetails_Rollover, with two deliberate corrections:
 *
 *   - the previous insurer and policy number fall back to null, NOT to a
 *     hard-coded 'ICICILOMBARD' / 'NA' (see below);
 *   - the transliterated comments are restated in English.
 *
 * The financier fields are always null today: the canonical request carries the
 * financier's NAME while HDFC wants its numeric FinancierCode. The original sent
 * null here too — see HdfcFinancier in types.ts.
 */
export function policyDetailsRollover(
  req: HdfcRequestShape,
  opts: PolicyDetailsOptions = {},
): PolicyDetails {
  const v = req.vehicle;
  const p = req.policy;
  const pp = req.previousPolicy;
  const fin = req.financier;
  const forProposal = opts.forProposal === true;

  // Only CreateProposal may carry the previous policy's identity, because HDFC
  // needs it to validate the declared claim status. CalculatePremium must send
  // null: HDFC's own premium sample does, and any code here — even "OTHERS" —
  // fails with "No Data found for given previous insured code".
  //
  // DIVERGENCE FROM THE STANDALONE MODULE: it fell back to the literals
  // 'ICICILOMBARD' and 'NA' when nothing was resolved, so every rollover
  // proposal it ever sent declared ICICI Lombard as the previous insurer. The
  // real code now comes from ProviderInsurerCode(hdfc) via the code resolver;
  // when it resolves to nothing we send null rather than assert something false.
  const prevInsurer = forProposal ? (pp.insurerCode ?? null) : null;
  const prevPolicyNo = forProposal ? (pp.policyNo ?? null) : null;

  const prevType = forProposal ? normalizePrevType(pp.type) : (pp.type ?? null);

  // HDFC requires the previous policy to have expired before the new one starts,
  // so a proposal with no supplied end date defaults to the day before inception.
  const startDate = (p.startDate ? toLocalDate(p.startDate) : null) ?? new Date();
  const prevEnd = pp.endDate ? toLocalDate(pp.endDate) : forProposal ? minusDays(startDate, 1) : null;

  // HDFC underwriting also wants the previous TP policy's dates (with the claim)
  // for a Roll Over. When the caller supplies none, a proposal defaults the TP
  // policy to the same expiry as the OD policy, running one year back — which is
  // exactly what the collection's Roll Over proposal sample sends.
  const tpEnd = pp.tpEndDate ? toLocalDate(pp.tpEndDate) : forProposal ? prevEnd : null;
  const tpStart = pp.tpStartDate
    ? toLocalDate(pp.tpStartDate)
    : forProposal && tpEnd
      ? minusDays(tpEnd, 365)
      : null;
  const tpInsurer = forProposal ? (pp.tpInsurer ?? prevInsurer) : (pp.tpInsurer ?? null);
  const tpPolicyNo = forProposal ? (pp.tpPolicyNo ?? prevPolicyNo) : (pp.tpPolicyNo ?? null);

  return {
    PolicyStartDate: toHdfcDate(p.startDate),
    ProposalDate: toHdfcDate(p.proposalDate),
    AgreementType: fin?.agreementType ?? null,
    FinancierCode: fin?.financierCode ?? null,
    BranchName: fin?.branchName ?? null,
    PreviousPolicy_CorporateCustomerId_Mandatary: prevInsurer,
    PreviousPolicy_NCBPercentage: num(pp.ncbPercentage),
    PreviousPolicy_PolicyEndDate: toHdfcDate(prevEnd),
    PreviousPolicy_PolicyStartDate: toHdfcDate(pp.startDate),
    PreviousPolicy_PolicyNo: prevPolicyNo,
    PreviousPolicy_PolicyClaim: normalizeClaim(pp.claim),
    PreviousPolicy_PreviousPolicyType: prevType,
    PreviousPolicyBusinessType: null,
    PreviousPolicy_TPENDDATE: toHdfcDate(tpEnd),
    PreviousPolicy_TPSTARTDATE: toHdfcDate(tpStart),
    PreviousPolicy_TPINSURER: tpInsurer,
    PreviousPolicy_TPPOLICYNO: tpPolicyNo,
    BusinessType_Mandatary: HDFC_BUSINESS_TYPE.rollover,
    VehicleModelCode: String(v.modelCode),
    DateofDeliveryOrRegistration: deliveryOrRegDate(req),
    DateofFirstRegistration: v.firstRegistrationDate ? toHdfcDate(v.firstRegistrationDate) : null,
    YearOfManufacture: yearOnly(v.manufactureYear, p.startDate),
    // As for New Business: the collection's premium sample sends null and
    // CreateProposal overwrites it with the dashed plate.
    Registration_No: null,
    EngineNumber: v.engineNumber?.trim() ?? null,
    ChassisNumber: v.chassisNumber?.trim() ?? null,
    RTOLocationCode: String(v.rtoCode),
    Vehicle_IDV: num(v.idv),
    PreviousPolicy_IsZeroDept_Cover: boolTF(pp.hadZeroDep),
    PreviousPolicy_IsRTI_Cover: boolTF(pp.hadRti),
  };
}

/**
 * Used Car — a distinct, shorter block: no ProposalDate, no financier block, an
 * explicitly-null previous-policy header (HDFC's sample nulls every previous
 * field for a used vehicle) and a PolicyEndDate/EndorsementEffectiveDate/
 * SumInsured/Premium trailer no other business type sends. Ported from
 * payloadBuilder.js policyDetails_Used.
 */
export function policyDetailsUsed(req: HdfcRequestShape): PolicyDetails {
  const v = req.vehicle;
  return {
    PolicyStartDate: toHdfcDate(req.policy.startDate),
    PreviousPolicy_PolicyStartDate: null,
    PreviousPolicy_PolicyNo: null,
    PreviousPolicy_PreviousPolicyType: null,
    PreviousPolicy_TPENDDATE: null,
    PreviousPolicy_TPSTARTDATE: null,
    PreviousPolicy_TPINSURER: null,
    PreviousPolicy_TPPOLICYNO: null,
    BusinessType_Mandatary: HDFC_BUSINESS_TYPE.used,
    VehicleModelCode: String(v.modelCode),
    DateofDeliveryOrRegistration: deliveryOrRegDate(req),
    DateofFirstRegistration: toHdfcDate(v.firstRegistrationDate),
    YearOfManufacture: yearOnly(v.manufactureYear, req.policy.startDate),
    // NOTE: HDFC's Used Car samples — premium AND proposal — both send a dashed
    // plate here ("MH-43-BY-2760") with no registrationNumberSection* fields, so
    // the standalone module's comment claiming "collection uses null in premium"
    // is wrong for this business type. Its null is kept because that is the value
    // proven on UAT, and CreateProposal overwrites it with the real plate anyway.
    Registration_No: null,
    EngineNumber: v.engineNumber?.trim() ?? null,
    ChassisNumber: v.chassisNumber?.trim() ?? null,
    RTOLocationCode: String(v.rtoCode),
    Vehicle_IDV: num(v.idv),
    PolicyEndDate: null,
    EndorsementEffectiveDate: null,
    SumInsured: 0,
    Premium: 0,
  };
}

export function policyDetailsFor(
  req: HdfcRequestShape,
  opts: PolicyDetailsOptions = {},
): PolicyDetails {
  if (req.businessType === HDFC_BUSINESS_TYPE.rollover) return policyDetailsRollover(req, opts);
  if (req.businessType === HDFC_BUSINESS_TYPE.used) return policyDetailsUsed(req);
  return policyDetailsNew(req);
}

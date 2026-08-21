import { boolTF, formatRegWithDashes, normalizeClaim, num, toHdfcDate, yearOnly } from "../format.ts";
import { HDFC_BUSINESS_TYPE, HDFC_POLICY_TYPE } from "../config.ts";
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
 * Registration_No for CalculatePremium.
 *
 * This USED to be null on every business type, because sending a real plate at
 * premium time once made HDFC's schema demand the registrationNumberSection*
 * fields. That is no longer true, and as of 17/08/2026 UAT rejects the null
 * outright with "Vehicle Registration number is mandatory".
 *
 * Proven on live UAT by varying this field alone and holding everything else
 * constant: null fails, the dashed plate prices, and the literal "New" prices —
 * to the rupee, the same premium as the plate (IDV 12,44,800 / gross ₹15,977 on
 * the probe vehicle). So the field is validated but not rated, and a vehicle
 * with no plate yet can safely say "New", which is what HDFC's own IDV sample
 * sends and what CreateProposal already falls back to.
 */
function premiumRegistrationNo(req: HdfcRequestShape): string {
  return formatRegWithDashes(req.vehicle.registrationNo) ?? "New";
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
 * The end date of a multi-year STANDALONE OD policy, or null when the key must
 * not be emitted at all.
 *
 * VENDOR BEHAVIOUR — on the standalone-OD product HDFC takes the OD term from
 * Policy_Details.PolicyEndDate and IGNORES Req_PvtCar.POLICY_TENURE. Every
 * SA_OD sample in the kit's newer collection (Private Car_New.postman_collection,
 * fixtures saod-*.json) sends POLICY_TENURE: 1 and varies only PolicyEndDate:
 *
 *   New Business / SA_OD / 3 years           03/07/2025 → 01/07/2028
 *   Roll Over / SA_OD / Short Term(<1 year)  19/06/2025 → 18/09/2025
 *   Roll Over / SA_OD / 1 year               19/06/2025 → 18/06/2026
 *   Roll Over / SA_OD / Long Term(>1 & <3)   13/08/2025 → 18/08/2027
 *
 * Confirmed live on UAT before this rule existed: an "OD Only" quote priced
 * IDENTICALLY at tenure 1, 2 and 3 (New Business gross ₹9,775; Roll Over
 * ₹1,300) with IdvYear2 and IdvYear3 both 0 — POLICY_TENURE alone buys nothing.
 *
 * WHY IT IS CONDITIONAL, AND ON WHAT.
 * The key is emitted only for POLICY_TYPE "OD Only" with a tenure of 2 or more.
 * It is deliberately NOT emitted for a 1-year OD, nor for any OD-Plus-TP or
 * TP-Only policy, because Policy_Details key sets are asserted field-for-field
 * against the older collection's premium samples (see policy-details.test.ts)
 * and neither of those samples carries a PolicyEndDate. HDFC's Blaze engine
 * rejects payloads carrying keys the sample for that business type does not
 * send, so the 1-year path — the one every passing row in the certification
 * pack goes down — keeps its proven key set untouched.
 *
 * The newer collection does send PolicyEndDate on a 1-year Roll Over too
 * (saod-rollover-control-premium.json), so the key is evidently tolerated there
 * as well; that is not a reason to start sending it on a path that already
 * works, and it is recorded here only so a later reader knows the option exists.
 *
 * The date itself is start + N years − 1 day, the market's standard inclusive
 * term and exactly what two of the three dated Roll Over samples show
 * (19/06/2025 → 18/06/2026 for a year, 19/06/2025 → 18/09/2025 for a quarter).
 *
 * WHAT HDFC WILL ACTUALLY WRITE. Sweeping the end date a day at a time from +6
 * months to +3 years on UAT (2026-08-10) found exactly one multi-year band:
 *
 *   ≤   365 days   priced as a one-year OD, no IDV ladder
 *   366–730 days   refused, "Policy Tenure is not Correct for Short-Term"
 *   731–1095 days  priced multi-year, IdvYear1 + IdvYear2 populated
 *   ≥  1096 days   refused, "Invalid Short Term Policy period"
 *
 * So a 3-year term (1094–1095 days by the formula above) lands inside the band
 * and prices — which is also where HDFC's own "SA_OD / 3 years" sample lands,
 * 1094 days out; it stops two days short of the third anniversary precisely
 * because 1096 is refused. A 2-year term (729–730 days) falls in the hole
 * beneath the band and HDFC refuses it. That refusal is left to stand: sending
 * 731 days instead would buy a pass by quoting a term the customer did not ask
 * for, on a product HDFC prices identically across the whole band.
 */
function multiYearOdEndDate(req: HdfcRequestShape): string | null {
  if (req.policy.policyType !== HDFC_POLICY_TYPE.standAloneOD) return null;
  const years = num(req.policy.tenure, 1);
  if (!Number.isInteger(years) || years < 2) return null;
  const start = toLocalDate(req.policy.startDate);
  if (!start) return null;
  const end = new Date(start.getFullYear() + years, start.getMonth(), start.getDate());
  return toHdfcDate(minusDays(end, 1));
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
  const odEndDate = multiYearOdEndDate(req);
  return {
    PolicyStartDate: toHdfcDate(req.policy.startDate),
    // Multi-year standalone OD only — see multiYearOdEndDate. The position is
    // HDFC's: its SA_OD samples put PolicyEndDate immediately after
    // PolicyStartDate, ahead of ProposalDate.
    ...(odEndDate ? { PolicyEndDate: odEndDate } : {}),
    ProposalDate: toHdfcDate(req.policy.proposalDate),
    BusinessType_Mandatary: HDFC_BUSINESS_TYPE.new,
    VehicleModelCode: String(v.modelCode),
    DateofDeliveryOrRegistration: deliveryOrRegDate(req),
    DateofFirstRegistration: v.firstRegistrationDate ? toHdfcDate(v.firstRegistrationDate) : null,
    YearOfManufacture: yearOnly(v.manufactureYear, req.policy.startDate),
    // See premiumRegistrationNo — a new vehicle has no plate yet, so this is
    // "New". CreateProposal overwrites it with the real one.
    Registration_No: premiumRegistrationNo(req),
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

  const odEndDate = multiYearOdEndDate(req);

  return {
    PolicyStartDate: toHdfcDate(p.startDate),
    // Multi-year standalone OD only — see multiYearOdEndDate. Same position as
    // in HDFC's Roll Over / SA_OD samples: straight after PolicyStartDate.
    ...(odEndDate ? { PolicyEndDate: odEndDate } : {}),
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
    // See premiumRegistrationNo — a rollover always has a plate.
    Registration_No: premiumRegistrationNo(req),
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
    // HDFC's Used Car samples — premium AND proposal — both send a dashed plate
    // here ("MH-43-BY-2760"), which is what premiumRegistrationNo now produces.
    // The old null contradicted HDFC's own sample and UAT no longer accepts it.
    Registration_No: premiumRegistrationNo(req),
    EngineNumber: v.engineNumber?.trim() ?? null,
    ChassisNumber: v.chassisNumber?.trim() ?? null,
    RTOLocationCode: String(v.rtoCode),
    Vehicle_IDV: num(v.idv),
    // The Used Car template already carries this key — HDFC's own used sample
    // sends it null — so a multi-year standalone OD only fills it in; the key
    // set is unchanged either way. See multiYearOdEndDate.
    PolicyEndDate: multiYearOdEndDate(req),
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

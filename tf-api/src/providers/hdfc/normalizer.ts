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

  const addonPremiums = {
    zeroDep: opt(r.ZeroDept_Premium),
    tyreProtect: opt(r.TyreSecure_Premium),
    ncbProtection: opt(r.NCBProtection_Premium),
    rti: opt(r.RTI_Premium),
    consumables: opt(r.COC_Premium),
    engineProtect: opt(r.EngGearBox_Premium),
    rsa: opt(r.EA_Premium),
    lossOfBelongings: opt(r.LossOfPersonalBelongings_Premium),
    paOwner: opt(r.CPA_Premium),
    paUnnamedPassenger: opt(r.UnnamedPerson_Premium),
    legalLiabilityPaidDriver: opt(r.LLPaiddriver_Premium),
    batteryProtect: opt(r.ElectricMotor_Premium),
  };

  const discounts = {
    ncbPercent: opt(r.NCB_Percentage),
    ncbAmount: opt(r.NCB_Discount),
    antiTheft: opt(r.AntiTheft_Discount),
    voluntaryDeductible: opt(r.Voluntary_Excess_Discount),
  };

  const totalAddonPremium = Object.values(addonPremiums).reduce<number>((s, v) => s + (v ?? 0), 0);
  const totalDiscount = num(r.NCB_Discount) + num(r.AntiTheft_Discount) + num(r.Voluntary_Excess_Discount);
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
    basicOdPremium: num(r.Total_OD_Premium ?? r.OD_Premium),
    thirdPartyPremium: num(r.Total_TP_Premium ?? r.TP_Premium),
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

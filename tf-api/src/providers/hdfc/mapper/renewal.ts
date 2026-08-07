import { num } from "../format.ts";
import { buildCustomerDetails } from "./customer.ts";
import type { HdfcCustomer } from "../types.ts";

/**
 * The Renewal payload templates, ported verbatim from the standalone module and
 * held to the three fixtures extracted from HDFC's own Postman collection
 * (fixtures/collection/renewal-*.json).
 *
 * Renewal is keyed by an existing POLICY NUMBER rather than by full vehicle
 * details: every call carries a `Req_Renewal` block and HDFC re-derives the risk
 * from the expiring policy. That is why `Req_PvtCar` here is a SHORTER field set
 * than the New Business / Roll Over templates in req-pvtcar.ts — it sends 60
 * keys and omits PlanType, RTIPlanType, EMIPlanType, NoOfWorkmen,
 * NoOfCleanerConductorCoolies, kmsYouExpectToDrive, the EV covers and
 * NoOfPAPaidDriver. Verified against renewal-premium.json: 60 keys, same order.
 *
 * KEY ORDER IS PART OF THE CONTRACT — the tests assert Object.keys() equality.
 *
 * ⚠ ADD-ON LIMITATION. The standalone builder read ~40 add-on flags off a
 * `req.addons` bag. `HdfcRenewalInput` has no equivalent, and the canonical
 * `RenewalProposalRequest` carries only `addonCodes` — FG *combo* codes
 * (e.g. "STZDP") for which HDFC publishes no cross-walk. So, exactly as
 * req-pvtcar.ts does for its unsourced addons, the literal each expression
 * evaluated to on an empty bag is inlined: every cover ships as 0/null/false,
 * which is byte-for-byte what HDFC's own renewal sample sends. The consequence
 * is real and deliberate: an HDFC renewal currently re-rates with NO optional
 * covers selected. Restoring the expiring policy's covers needs the extract's
 * `Resp_RE.Is*_Cover` flags to be threaded through, which is a separate change.
 */

export interface HdfcRenewalInput {
  transactionId: string;
  previousPolicyNo: string;
  registrationNo?: string;
  idv: number;
  policyType: string;
  tenure: number;
  customer?: HdfcCustomer;
}

/** Renewal step 02 — getpolicydataforrenewal. */
export function buildRenewalExtract(
  transactionId: string,
  policyNo: string,
): Record<string, unknown> {
  return { TransactionID: transactionId, Req_Renewal: { Policy_No: policyNo } };
}

/**
 * Renewal step 03 — GetCalculateIDV, fed from the step-02 snapshot rather than
 * from a canonical request (a renewal caller supplies only a policy number).
 * Same field set and order as the New/Roll Over IDV call, including the literal
 * `Registration_No: "New"` — HDFC's Renewal/03 sample sends "New" too, and a
 * real plate makes its schema demand the registrationNumberSection* fields.
 */
export function buildRenewalGetCalculateIDV(
  transactionId: string,
  snap: {
    modelCode?: string;
    rtoCode?: string;
    registrationDate?: string;
    policyStartDate?: string;
    previousPolicyType?: string;
    previousPolicyEndDate?: string;
    previousPolicyTpEndDate?: string;
    previousPolicyTpStartDate?: string;
  },
): Record<string, unknown> {
  return {
    TransactionID: transactionId,
    IDV_DETAILS: {
      ModelCode: snap.modelCode ?? "",
      RTOCode: snap.rtoCode ?? "",
      Vehicle_Registration_Date: snap.registrationDate ?? null,
      Registration_No: "New",
      Policy_Start_Date: snap.policyStartDate ?? null,
      PreviousPolicy_PreviousPolicyType: snap.previousPolicyType ?? "COMPREHENSIVE",
      PreviousPolicy_EndDate: snap.previousPolicyEndDate ?? null,
      PreviousPolicy_TPENDDATE: snap.previousPolicyTpEndDate ?? null,
      PreviousPolicy_TPSTARTDATE: snap.previousPolicyTpStartDate ?? null,
    },
  };
}

/** The Renewal Req_PvtCar block. See the add-on limitation note above. */
function renewalReqPvtCar(input: HdfcRenewalInput): Record<string, unknown> {
  return {
    POSP_CODE: null,
    POLICY_TYPE: input.policyType,
    POLICY_TENURE: num(input.tenure, 1),
    ExtensionCountryCode: 0.0,
    ExtensionCountryName: null,
    BreakIN_ID: null,
    BreakInStatus: null,
    BreakInInspectionFlag: null,
    BreakinWaiver: false,
    BreakinInspectionDate: null,
    Effectivedrivinglicense: false,
    NumberOfEmployees: 0,
    BiFuelType: null,
    BiFuel_Kit_Value: 0,
    LLPaiddriver: 0,
    PAPaiddriverSI: 0,
    Owner_Driver_Nominee_Name: null,
    Owner_Driver_Nominee_Age: 0,
    Owner_Driver_Nominee_Relationship: null,
    Owner_Driver_Appointee_Name: null,
    Owner_Driver_Appointee_Relationship: null,
    IsZeroDept_Cover: 0,
    IsTyreSecure_Cover: 0,
    ElecticalAccessoryIDV: 0,
    NonElecticalAccessoryIDV: 0,
    OtherLoadDiscRate: 0.0,
    AntiTheftDiscFlag: false,
    HandicapDiscFlag: false,
    IsNCBProtection_Cover: 0,
    IsRTI_Cover: 0,
    IsCOC_Cover: 0,
    IsEngGearBox_Cover: 0,
    IsLossofUseDownTimeProt_Cover: 0,
    IsEA_Cover: 0,
    IsEAW_Cover: 0,
    IsEAAdvance_Cover: 0,
    IsTowing_Cover: 0,
    Towing_Limit: null,
    IsEMIProtector_Cover: 0,
    NoOfEmi: null,
    EMIAmount: 0,
    NoofUnnamedPerson: 0,
    UnnamedPersonSI: 0,
    Voluntary_Excess_Discount: 0,
    IsLimitedtoOwnPremises: 0,
    TPPDLimit: 0.0,
    NoofnamedPerson: 0,
    namedPersonSI: 0,
    NamedPersons: null,
    AutoMobile_Assoication_No: "",
    fuel_type: null,
    CPA_Tenure: 1,
    payAsYouDrive: null,
    initialOdometerReading: null,
    initialOdometerReadingDate: null,
    IsHighProtection_Cover: 0,
    HigherTowingLimit: 0,
    IsLossOfPersonalBelongings_Cover: 0,
    LossOfPersonalBelonging_SI: 0,
    isCoPassengerOptedForLOPB: 0,
  };
}

/**
 * Renewal step 04 — CalculatePremium against the extracted policy.
 *
 * `Vehicle_Regn_No` is sent RAW, not through formatRegWithDashes: the dash form
 * is a CreateProposal-only requirement (see format.ts) and HDFC's own renewal
 * samples send "" here.
 */
export function buildRenewalCalculatePremium(input: HdfcRenewalInput): Record<string, unknown> {
  return {
    TransactionID: input.transactionId,
    Policy_Details: { Vehicle_IDV: num(input.idv) },
    Req_Renewal: {
      Policy_No: input.previousPolicyNo,
      Vehicle_Regn_No: input.registrationNo ?? "",
    },
    Req_PvtCar: renewalReqPvtCar(input),
  };
}

/**
 * Renewal step 05 — CreateProposal against the extracted policy: the premium
 * body plus Customer_Details, which here carries the trailing null
 * `BusinessType_Mandatary` (as the Used Car proposal does).
 */
export function buildRenewalCreateProposal(input: HdfcRenewalInput): Record<string, unknown> {
  return {
    TransactionID: input.transactionId,
    Policy_Details: { Vehicle_IDV: num(input.idv) },
    Req_Renewal: {
      Policy_No: input.previousPolicyNo,
      Vehicle_Regn_No: input.registrationNo ?? "",
    },
    Customer_Details: buildCustomerDetails(input.customer ?? {}, { trailingBusinessType: true }),
    Req_PvtCar: renewalReqPvtCar(input),
  };
}

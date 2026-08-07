import { formatRegWithDashes, toHdfcDate } from "../format.ts";
import { HDFC_BUSINESS_TYPE } from "../config.ts";
import type { HdfcRequestShape } from "../types.ts";
import { reqPvtCarFor } from "./req-pvtcar.ts";
import { policyDetailsFor } from "./policy-details.ts";
import { buildCustomerDetails } from "./customer.ts";

export { toHdfcRequest, resolveBusinessType, applyRolloverDateSanity } from "./canonical.ts";

/**
 * Step 02 — GetCalculateIDV.
 *
 * Registration_No is ALWAYS "New" and there are no registrationNumberSection*
 * fields: IDV is derived from model + RTO + dates, and sending a real plate
 * makes HDFC's schema demand the section fields. Both the New-Business and
 * Roll-Over samples in the collection do this.
 */
export function buildGetCalculateIDV(req: HdfcRequestShape): Record<string, unknown> {
  const v = req.vehicle;
  const pp = req.previousPolicy;
  return {
    TransactionID: req.transactionId,
    IDV_DETAILS: {
      ModelCode: String(v.modelCode),
      RTOCode: String(v.rtoCode),
      Vehicle_Registration_Date: toHdfcDate(v.registrationDate) ?? toHdfcDate(req.policy.startDate),
      Registration_No: "New",
      Policy_Start_Date: toHdfcDate(req.policy.startDate),
      PreviousPolicy_PreviousPolicyType: pp.type ?? "COMPREHENSIVE",
      PreviousPolicy_EndDate: toHdfcDate(pp.endDate),
      PreviousPolicy_TPENDDATE: toHdfcDate(pp.tpEndDate),
      PreviousPolicy_TPSTARTDATE: toHdfcDate(pp.tpStartDate),
    },
  };
}

/** Step 03 — CalculatePremium. */
export function buildCalculatePremium(req: HdfcRequestShape): Record<string, unknown> {
  return {
    TransactionID: req.transactionId,
    Policy_Details: policyDetailsFor(req),
    Req_PvtCar: reqPvtCarFor(req),
  };
}

/**
 * Step 04 — CreateProposal. This is where the REAL registration number goes, in
 * dash format ("MH-01-QQ-7878") and still with no section fields.
 */
export function buildCreateProposal(req: HdfcRequestShape): Record<string, unknown> {
  const isUsed = req.businessType === HDFC_BUSINESS_TYPE.used;
  const policyDetails = policyDetailsFor(req, { forProposal: true });
  policyDetails.Registration_No = formatRegWithDashes(req.vehicle.registrationNo) ?? "New";
  if (req.businessType === HDFC_BUSINESS_TYPE.new) {
    // The New-Business proposal sample uses "" rather than null here.
    policyDetails.DateofFirstRegistration = req.vehicle.firstRegistrationDate
      ? toHdfcDate(req.vehicle.firstRegistrationDate)
      : "";
  }
  return {
    TransactionID: req.transactionId,
    Customer_Details: buildCustomerDetails(req.customer ?? {}, { trailingBusinessType: isUsed }),
    Policy_Details: policyDetails,
    Req_PvtCar: reqPvtCarFor(req),
  };
}

/** Step 05 — GetProposalDocument. */
export function buildGetProposalDocument(req: HdfcRequestShape): Record<string, unknown> {
  return {
    TransactionID: req.transactionId,
    Req_Policy_Document: { Proposal_Number: req.proposalNumber },
  };
}

/** Step 06 — SubmitPaymentDetails. Records money already collected elsewhere. */
export function buildSubmitPaymentDetails(req: HdfcRequestShape): Record<string, unknown> {
  const pay = req.payment ?? { amount: 0 };
  return {
    TransactionID: req.transactionId,
    Proposal_no: req.proposalNumber,
    Cis_Flag: "Y",
    Payment_Details: {
      GC_PaymentID: "",
      BANK_NAME: pay.bankName ?? "BIZDIRECT",
      BANK_BRANCH_NAME: pay.bankBranchName ?? "Andheri",
      PAYMENT_MODE_CD: pay.paymentModeCode ?? "EP",
      PAYER_TYPE: pay.payerType ?? "CUSTOMER",
      PAYMENT_AMOUNT: String(pay.amount),
      INSTRUMENT_NUMBER: pay.instrumentNumber ?? req.transactionId,
      PAYMENT_DATE: toHdfcDate(pay.paymentDate ?? new Date()),
    },
  };
}

/** Step 07 — GetPolicyDocument. */
export function buildGetPolicyDocument(req: HdfcRequestShape): Record<string, unknown> {
  return {
    TransactionID: req.transactionId,
    Req_Policy_Document: { Policy_Number: req.policyNumber },
  };
}

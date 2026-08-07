import { z } from "zod";
import { PaymentReceiptSchema } from "./policy.ts";

// ─── Motor Renewal ────────────────────────────────────────────────────────────
// Three-op flow keyed off an existing policy:
//   renewalQuote(policyNo)              → expiring-policy snapshot + premium
//   renewalProposal(echo + modify Δ)    → bound (re-rated) premium
//   renewalCreatePolicy(receipt)        → new policyNumber
//
// Steps 2 and 3 originally encoded FG's contract exactly (productCode,
// clientCode, agentCode, branch, coverCode, IMT endorsements). HDFC's renewal
// needs almost none of those — only Policy_No, Vehicle_Regn_No, Vehicle_IDV and
// the cover block — so vendor-specific fields are optional here and each
// provider asserts its own via requireFields (src/lib/require-fields.ts).
//
// FG linkage through-line: ProposalNo == "00" + previous policy number.

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Step 1 — ModifyRenewalQuote. `vendorCode` is supplied by provider config. */
export const RenewalQuoteRequestSchema = z.object({
  /** The customer's existing GC/FG policy number. */
  policyNo: z.string().min(1),
  /** Existing policy expiry (ISO); converted to FG DD/MM/YYYY. Optional. */
  expiryDate: IsoDate.optional(),
  registrationNo: z.string().optional(),
});
export type RenewalQuoteRequest = z.infer<typeof RenewalQuoteRequestSchema>;

/** Step 2 — ModifyRenewalProposal: echo the quote snapshot + a constrained
 *  modification delta. IDV/SI values are whole rupees (INR ints). */
export const RenewalProposalRequestSchema = z.object({
  // Echoed from the quote snapshot (OldPolicyDetails / PolicyHolderDeatils):
  /** FG product code. Optional at the contract level; FG asserts it via requireFields. */
  productCode: z.string().min(1).optional(),
  previousPolicyNo: z.string().min(1),
  /** == "00" + previous policy no (OldPolicyDetails.ProposalNo). */
  proposalNo: z.string().min(1),
  /**
   * PolicyHolderDeatils.ClientID → PolicyDetails.ClientCode. Optional at the
   * contract level; FG asserts it via requireFields.
   */
  clientCode: z.string().min(1).optional(),
  /** New-term policy start / end (ISO); converted to FG DD/MM/YYYY. */
  startDate: IsoDate,
  expiryDate: IsoDate,
  /** Inline CKYC when the policyholder's CKYC is unverified. */
  ckycNo: z.string().optional(),
  ckycRefNo: z.string().optional(),
  // Modification delta (ModifyDetails):
  /** FG agent code. Optional at the contract level; FG asserts it via requireFields. */
  agentCode: z.string().min(1).optional(),
  /** FG branch. Optional at the contract level; FG asserts it via requireFields. */
  branch: z.string().min(1).optional(),
  /** FG cover code. Optional at the contract level; FG asserts it via requireFields. */
  coverCode: z.enum(["CO", "OD", "LO"]).optional(),
  /** Insured Declared Value in whole rupees. */
  vehicleIdv: z.number().int().nonnegative(),
  /**
   * Discount %, negative as returned by the quote (echo as-is). The quote
   * surfaces this as a number in `contractDetails.discountPercentage`, so callers
   * thread it straight through.
   */
  discountPercentage: z.number(),
  /** Add-on combo cover codes (e.g. "STZDP"). */
  addonCodes: z.array(z.string().min(1)).default([]),
  /** CNG/LPG kit sum insured in whole rupees. */
  idvOfCngOrLpg: z.number().int().nonnegative().optional(),
  electricalAccessoriesValues: z.string().optional(),
  nonElectricalAccessoriesValues: z.string().optional(),
  imt10: z.string().optional(),
  imt15: z.string().optional(),
  imt16: z.string().optional(),
  imt20: z.string().optional(),
  imt23: z.string().optional(),
  imt28: z.string().optional(),
  imt29: z.string().optional(),
  // Break-in linkage (only when the quote flagged a break-in):
  inspectionNo: z.string().optional(),
  inspectionDate: IsoDate.optional(),
  /** Vendor correlation id (HDFC threads one TransactionID across all steps). */
  transactionId: z.string().optional(),
  /** Vehicle registration number (HDFC Req_Renewal.Vehicle_Regn_No). */
  registrationNo: z.string().optional(),
});
export type RenewalProposalRequest = z.infer<typeof RenewalProposalRequestSchema>;

/** Step 3 — ModifyRenewalPolicyIssuance. `vendorCode` is supplied by config. */
export const RenewalCreatePolicyRequestSchema = z.object({
  policyNo: z.string().min(1),
  /**
   * ClientID returned by the proposal (or quote snapshot). Optional at the
   * contract level; FG asserts it via requireFields.
   */
  clientId: z.string().min(1).optional(),
  /** == "00" + previous policy no (HDFC sends its own Proposal_Number here). */
  proposalNo: z.string().min(1),
  /** FG agent code. Optional at the contract level; FG asserts it via requireFields. */
  agentCode: z.string().min(1).optional(),
  /** FG branch code. Optional at the contract level; FG asserts it via requireFields. */
  branchCode: z.string().min(1).optional(),
  registrationNo: z.string().optional(),
  /** Vendor correlation id (HDFC threads one TransactionID across all steps). */
  transactionId: z.string().optional(),
  receipt: PaymentReceiptSchema,
});
export type RenewalCreatePolicyRequest = z.infer<typeof RenewalCreatePolicyRequestSchema>;

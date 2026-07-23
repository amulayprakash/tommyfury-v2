import { z } from "zod";
import { PaymentReceiptSchema } from "./policy.ts";

// ─── FG Motor Renewal (Renewal/1.0.0/RenewalModify) ───────────────────────────
// Full-JSON 3-op flow keyed off an existing GC/FG policy:
//   ModifyRenewalQuote(policyNo)            → expiring-policy snapshot + premium
//   ModifyRenewalProposal(echo + modify Δ)  → bound (re-rated) premium
//   ModifyRenewalPolicyIssuance(receipt)    → new policyNumber
// Linkage through-line: ProposalNo == "00" + previous policy number (no fresh id).

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
  productCode: z.string().min(1),
  previousPolicyNo: z.string().min(1),
  /** == "00" + previous policy no (OldPolicyDetails.ProposalNo). */
  proposalNo: z.string().min(1),
  /** PolicyHolderDeatils.ClientID → PolicyDetails.ClientCode. */
  clientCode: z.string().min(1),
  /** New-term policy start / end (ISO); converted to FG DD/MM/YYYY. */
  startDate: IsoDate,
  expiryDate: IsoDate,
  /** Inline CKYC when the policyholder's CKYC is unverified. */
  ckycNo: z.string().optional(),
  ckycRefNo: z.string().optional(),
  // Modification delta (ModifyDetails):
  agentCode: z.string().min(1),
  branch: z.string().min(1),
  coverCode: z.enum(["CO", "OD", "LO"]),
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
});
export type RenewalProposalRequest = z.infer<typeof RenewalProposalRequestSchema>;

/** Step 3 — ModifyRenewalPolicyIssuance. `vendorCode` is supplied by config. */
export const RenewalCreatePolicyRequestSchema = z.object({
  policyNo: z.string().min(1),
  /** ClientID returned by the proposal (or quote snapshot). */
  clientId: z.string().min(1),
  /** == "00" + previous policy no. */
  proposalNo: z.string().min(1),
  agentCode: z.string().min(1),
  branchCode: z.string().min(1),
  registrationNo: z.string().optional(),
  receipt: PaymentReceiptSchema,
});
export type RenewalCreatePolicyRequest = z.infer<typeof RenewalCreatePolicyRequestSchema>;

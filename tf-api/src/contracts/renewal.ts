import { z } from "zod";
import { PaymentReceiptSchema } from "./policy.ts";

// ─── FG Motor Renewal (motorRenewal/1.0.0) ────────────────────────────────────
// A distinct JSON flow keyed off an existing FG policy: GetQuote(PolicyNo) →
// CreatePolicy(QuotationNo + Receipt). Not the SOAP new-business path.

export const RenewalQuoteRequestSchema = z.object({
  /** The customer's existing Future Generali policy number. */
  policyNo: z.string().min(1),
  /** Existing policy expiry (ISO); converted to FG DD/MM/YYYY. Optional. */
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  registrationNo: z.string().optional(),
});

export type RenewalQuoteRequest = z.infer<typeof RenewalQuoteRequestSchema>;

export const RenewalCreatePolicyRequestSchema = z.object({
  policyNo: z.string().min(1),
  /** QuotationNo returned by the renewal GetQuote. */
  quoteNo: z.string().min(1),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  registrationNo: z.string().optional(),
  ckycNo: z.string().optional(),
  ckycRefNo: z.string().optional(),
  receipt: PaymentReceiptSchema,
});

export type RenewalCreatePolicyRequest = z.infer<typeof RenewalCreatePolicyRequestSchema>;

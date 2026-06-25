import { z } from "zod";
import { HealthProductSchema, HealthLineSchema } from "./health-enums.ts";

// ─── Per-member premium breakdown ─────────────────────────────────────────────

export const HealthMemberPremiumSchema = z.object({
  memberId: z.number().int().positive(),
  name: z.string().optional(),
  relation: z.string().optional(),
  age: z.number().int().nonnegative().optional(),
  sumInsured: z.number().nonnegative().optional(),
  coverType: z.string().optional(),
  basePremium: z.number().nonnegative().optional(),
  loadingAmount: z.number().nonnegative().optional(),
  loadingPercent: z.number().nonnegative().optional(),
  perPersonPremium: z.number().nonnegative().optional(),
});
export type HealthMemberPremium = z.infer<typeof HealthMemberPremiumSchema>;

// ─── Canonical health quote result ────────────────────────────────────────────

export const HealthQuoteResultSchema = z.object({
  // Identity
  quoteNo: z.string(),
  /** Vendor transaction id that keys downstream calls. */
  transactionId: z.string().optional(),
  requestId: z.string(),
  providerSlug: z.string(),
  insurerId: z.string().optional(),
  insurerName: z.string().optional(),
  insurerLogoUrl: z.string().optional(),

  // Plan
  product: HealthProductSchema,
  line: HealthLineSchema,
  sumInsured: z.number().nonnegative(),
  policyTermYears: z.number().int().positive(),
  policyStartDate: z.string().optional(),
  policyEndDate: z.string().optional(),

  // Members
  members: z.array(HealthMemberPremiumSchema),

  // Premium breakdown
  basePremium: z.number().min(0),
  totalDiscount: z.number().min(0),
  totalLoading: z.number().min(0),
  netPremium: z.number().min(0),
  serviceTaxPercent: z.number().min(0).default(18),
  serviceTaxAmount: z.number().min(0),
  grossPremium: z.number().min(0),

  // Contract metadata (populated by proposal / issuance)
  policyNumber: z.string().optional(),
  clientId: z.string().optional(),
  applicationNo: z.string().optional(),
  receiptNo: z.string().optional(),
  paymentUrl: z.string().optional(),
  contractDetails: z.record(z.string(), z.unknown()).optional(),

  // Raw provider response stored for audit (never exposed to client in prod)
  _rawResponse: z.unknown().optional(),
});
export type HealthQuoteResult = z.infer<typeof HealthQuoteResultSchema>;

import { z } from "zod";
import { PaymentReceiptSchema } from "../policy.ts";
import { HealthFullQuoteRequestSchema } from "./health-quote-request.ts";

// ─── Health policy issuance (post-payment) ────────────────────────────────────
// Unlike motor (which binds issuance to a prior QuotationNo), FG health issuance is
// a full CreatePolicy(METHOD=CRT): it re-submits the entire proposal payload
// (Client + members) together with the payment Receipt and returns the PolicyNo.
// Reuses the canonical PolicyIssuanceResult (see contracts/policy.ts) for the result.
export const HealthIssuanceRequestSchema = HealthFullQuoteRequestSchema.extend({
  /** ClientId from the proposal (carried through for our audit; FG re-creates it). */
  clientId: z.string().optional(),
  receipt: PaymentReceiptSchema,
});
export type HealthIssuanceRequest = z.infer<typeof HealthIssuanceRequestSchema>;

import { z } from "zod";
import { PolicyLifecycleStatusSchema, VehicleCategorySchema, PolicyTypeSchema } from "./enums.ts";

// ─── Policy status ────────────────────────────────────────────────────────────

export const PolicyStatusRequestSchema = z.object({
  transactionId: z.string().min(1),
});

export type PolicyStatusRequest = z.infer<typeof PolicyStatusRequestSchema>;

export const PolicyStatusResultSchema = z.object({
  policyReferenceId: z.string().optional(),
  policyNumber: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: PolicyLifecycleStatusSchema,
  inspectionId: z.string().optional(),
  isKycSuccess: z.boolean().optional(),
  paymentLink: z.string().optional(),
  message: z.string().optional(),
  _rawResponse: z.unknown().optional(),
});

export type PolicyStatusResult = z.infer<typeof PolicyStatusResultSchema>;

// ─── Certificate of Insurance (COI) ───────────────────────────────────────────

export const CertificateResultSchema = z.object({
  /** Base64-encoded PDF bytes. */
  coiBase64: z.string(),
  status: z.string().optional(),
  _rawResponse: z.unknown().optional(),
});

export type CertificateResult = z.infer<typeof CertificateResultSchema>;

// ─── Policy issuance (post-payment) ───────────────────────────────────────────
// FG PolicyIssuance_Vendors: references a prior proposal by ClientID +
// strPolicyQuoteNumber, carries the payment receipt, and returns the real PolicyNo.

/** Payment-receipt block fed into issuance (sourced from the PG callback). */
export const PaymentReceiptSchema = z.object({
  uniqueTranKey: z.string().min(1),
  /** PG transaction timestamp, passed through verbatim (e.g. "27/05/2025 16:26:00"). */
  transactionDate: z.string().min(1),
  receiptType: z.string().default("IVR"),
  amount: z.coerce.number().positive(),
  tranRefNo: z.string().min(1),
  tranRefNoDate: z.string().min(1),
  /** Payment-gateway type, e.g. "PAYU". */
  pgType: z.string().default("PAYU"),
  tcsAmount: z.string().optional(),
  checkType: z.string().optional(),
  bsbCode: z.string().optional(),
});

export type PaymentReceipt = z.infer<typeof PaymentReceiptSchema>;

export const PolicyIssuanceRequestSchema = z.object({
  /** FG QuotationNo from CreateProposal → strPolicyQuoteNumber. */
  quoteNo: z.string().min(1),
  /** FG ClientId returned by GetQuote/CreateProposal → PolicyHeader.ClientID. */
  clientId: z.string().min(1),
  vehicleCategory: VehicleCategorySchema,
  policyType: PolicyTypeSchema.optional(),
  /** Policy dates (ISO); converted to FG DD/MM/YYYY in the mapper. */
  policyStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  policyEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  receipt: PaymentReceiptSchema,
});

export type PolicyIssuanceRequest = z.infer<typeof PolicyIssuanceRequestSchema>;

export const PolicyIssuanceResultSchema = z.object({
  providerSlug: z.string(),
  insurerName: z.string().optional(),
  status: PolicyLifecycleStatusSchema,
  /** The real, bound policy number from FG. */
  policyNumber: z.string().optional(),
  applicationNo: z.string().optional(),
  receiptNo: z.string().optional(),
  clientId: z.string().optional(),
  quoteNo: z.string().optional(),
  message: z.string().optional(),
  _rawResponse: z.unknown().optional(),
});

export type PolicyIssuanceResult = z.infer<typeof PolicyIssuanceResultSchema>;

// ─── Payment initiation (build the checksum-signed gateway form) ──────────────

export const PaymentInitiateRequestSchema = z.object({
  /** FG QuotationNo (used as TransactionID + ProposalNumber). */
  quoteNo: z.string().min(1),
  premiumAmount: z.coerce.number().positive(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  email: z.string().email(),
});

export type PaymentInitiateRequest = z.infer<typeof PaymentInitiateRequestSchema>;

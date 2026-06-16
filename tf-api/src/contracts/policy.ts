import { z } from "zod";
import { PolicyLifecycleStatusSchema } from "./enums.ts";

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

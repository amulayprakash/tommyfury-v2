import { z } from "zod";
import { OvdDocTypeSchema } from "./enums.ts";

// ─── CKYC (PAN / CKYC number / Aadhaar) ───────────────────────────────────────

/** Plain object (used for OpenAPI; cross-field rules live on the refined schema). */
export const CkycRequestObjectSchema = z.object({
  transactionId: z.string().min(1),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  panNumber: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/).optional(),
  ckycNumber: z.string().optional(),
  aadhaarNumber: z.string().length(12).optional(),
  nameAsPerAadhaar: z.string().optional(),
  gender: z.enum(["M", "F", "O"]).optional(),
  policyType: z.enum(["motor", "health", "travel", "sme"]).default("motor"),
  // FG VerifyCKYC mandates these; other vendors ignore them.
  fullName: z.string().optional(),
  mobile: z.string().regex(/^[6-9]\d{9}$/).optional(),
  /** Absolute URL FG returns to after manual KYC document upload. */
  redirectUrl: z.string().url().optional(),
});

export const CkycRequestSchema = CkycRequestObjectSchema.refine(
  (d) => d.panNumber ?? d.ckycNumber ?? d.aadhaarNumber,
  { message: "One of panNumber, ckycNumber or aadhaarNumber is required" },
).refine((d) => !d.aadhaarNumber || (d.nameAsPerAadhaar && d.gender), {
  message: "nameAsPerAadhaar and gender are required when aadhaarNumber is provided",
});

export type CkycRequest = z.infer<typeof CkycRequestSchema>;

export const KycResultSchema = z.object({
  kycId: z.string().optional(),
  isKycSuccess: z.boolean(),
  name: z.string().optional(),
  dob: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  gender: z.string().optional(),
  permanentAddress: z.string().optional(),
  correspondenceAddress: z.string().optional(),
  displayMessage: z.string().optional(),
  // FG CKYC extras: the verified CKYC number feeds CreateProposal; proposalId
  // keys a later GetCKYCStatus poll; redirectUrl is the manual-KYC fallback.
  ckycNumber: z.string().optional(),
  ckycRefId: z.string().optional(),
  proposalId: z.string().optional(),
  redirectUrl: z.string().optional(),
  requiresRedirect: z.boolean().optional(),
  _rawResponse: z.unknown().optional(),
});

export type KycResult = z.infer<typeof KycResultSchema>;

// ─── OVD (document upload) ────────────────────────────────────────────────────
// Files arrive as multipart and are validated separately; this is the text body.

export const OvdRequestSchema = z.object({
  transactionId: z.string().min(1),
  proofOfIdentityType: OvdDocTypeSchema,
  proofOfAddressType: OvdDocTypeSchema,
  policyType: z.enum(["motor", "health", "travel", "sme"]).default("motor"),
});

export type OvdRequest = z.infer<typeof OvdRequestSchema>;

/** An uploaded document, provider-agnostic (decoupled from multer's type). */
export interface OvdFile {
  fieldName: "proofOfIdentity" | "proofOfAddress";
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export const OvdResultSchema = z.object({
  kycId: z.string().optional(),
  customerName: z.string().optional(),
  isKycSuccess: z.boolean(),
  _rawResponse: z.unknown().optional(),
});

export type OvdResult = z.infer<typeof OvdResultSchema>;

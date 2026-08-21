import { z } from "zod";
import { OvdDocTypeSchema } from "./enums.ts";

// ─── CKYC (PAN / CKYC number / Aadhaar) ───────────────────────────────────────

/** Plain object (used for OpenAPI; cross-field rules live on the refined schema). */
export const CkycRequestObjectSchema = z.object({
  transactionId: z.string().min(1),
  // Mandatory even for a corporate request, which has no natural date of birth —
  // today a corporate caller must duplicate dateOfIncorporation into this field.
  // The correct fix is splitting CkycRequest into individual/corporate
  // discriminated-union variants; deliberately deferred rather than smuggled
  // into this task. Whoever builds the corporate mapper next: this is known,
  // not overlooked.
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
  // ─── Corporate (non-individual) KYC ─────────────────────────────────────────
  // HDFC Pehchaan ships a separate corporate kit (/partner/corporate/kyc) taking
  // entity-shaped inputs. Optional here so the individual path is unchanged and
  // other vendors ignore them, exactly as they ignore the FG-only fields above.
  customerType: z.enum(["individual", "corporate"]).optional(),
  /** PAN of the entity. */
  entityPan: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/).optional(),
  /** Corporate Identity Number. */
  entityCin: z.string().optional(),
  /** CKYC number of the entity. */
  entityCkycNumber: z.string().optional(),
  /** Date of incorporation, YYYY-MM-DD. Pehchaan wants DD/MM/YYYY; the mapper converts. */
  dateOfIncorporation: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  entityType: z
    .enum([
      "company",
      "partnershipFirm",
      "trust",
      "unincorporatedInstitution",
      "properietor",
      "huf",
      "llp",
      "societyOrEducationalInstitute",
      "governmentEntity",
      "foreignEmbassy",
    ])
    .optional(),
});

export const CkycRequestSchema = CkycRequestObjectSchema.refine(
  // Corporate requests identify by entity fields instead (validated below), so
  // they're exempt from the individual identifier requirement here. `||`, not
  // `??` — panNumber/ckycNumber/aadhaarNumber are plain optional strings with no
  // .min(1), so an empty string is a *defined* value that `??` would stop on
  // and never fall through to a later, actually-populated field.
  (d) => d.customerType === "corporate" || (d.panNumber || d.ckycNumber || d.aadhaarNumber),
  { message: "One of panNumber, ckycNumber or aadhaarNumber is required" },
)
  .refine((d) => !d.aadhaarNumber || (d.nameAsPerAadhaar && d.gender), {
    message: "nameAsPerAadhaar and gender are required when aadhaarNumber is provided",
  })
  .refine(
    // Same `||` vs `??` reasoning as the individual-identifier refine above.
    (d) =>
      d.customerType !== "corporate" ||
      (d.entityPan || d.entityCin || d.entityCkycNumber),
    { message: "A corporate request needs one of entityPan, entityCin or entityCkycNumber" },
  )
  .refine((d) => d.customerType !== "corporate" || d.dateOfIncorporation, {
    message: "dateOfIncorporation is required for a corporate request",
  })
  .refine((d) => d.customerType !== "corporate" || d.entityType, {
    message: "entityType is required for a corporate request",
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
  /**
   * FG CKYC correlation key (`PR_xxx`) returned by VerifyCKYC. FG's UploadDocBytes
   * requires it to attach the document to the pending KYC case; other vendors ignore it.
   */
  proposalId: z.string().optional(),
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
  /** Vendor's verbatim reason when the uploaded documents were rejected. */
  displayMessage: z.string().optional(),
  /** FG CKYC proposal id echoed back so the caller can poll GetKycStatus for the number. */
  proposalId: z.string().optional(),
  _rawResponse: z.unknown().optional(),
});

export type OvdResult = z.infer<typeof OvdResultSchema>;

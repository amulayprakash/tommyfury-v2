import { z } from "zod";
import { ProposerSchema, AddressSchema } from "../quote-request.ts";
import {
  HealthProductSchema,
  MemberRelationSchema,
  GenderSchema,
  InstallmentSchema,
} from "./health-enums.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// ─── Nominee ──────────────────────────────────────────────────────────────────

export const HealthNomineeSchema = z.object({
  name: z.string().min(1),
  relation: MemberRelationSchema,
  age: z.coerce.number().int().positive().optional(),
  dob: isoDate.optional(),
  gender: GenderSchema.optional(),
  /** Appointee (required when the nominee is a minor). */
  appointeeName: z.string().optional(),
  appointeeRelation: MemberRelationSchema.optional(),
});
export type HealthNominee = z.infer<typeof HealthNomineeSchema>;

// ─── PA cover selection (Personal Accident only) ──────────────────────────────
// PA prices a set of benefit covers (AD = Accidental Death, PT/PP = disability …)
// rather than a single sum insured. Codes resolve to the vendor's PA cover master.
export const PaCoverSelectionSchema = z.object({
  coverCode: z.string().min(1),
  sumInsured: z.coerce.number().nonnegative().optional(),
  /** "M" mandatory / "O" optional in the vendor catalog; passed through. */
  coverType: z.string().optional(),
});
export type PaCoverSelection = z.infer<typeof PaCoverSelectionSchema>;

// ─── Member (insured person) ──────────────────────────────────────────────────
// A superset across products. Core fields are required; product-specific ones are
// optional and validated per-product in the provider mapper.
export const HealthMemberSchema = z.object({
  /** 1-based member index in the policy; auto-assigned when omitted. */
  memberId: z.coerce.number().int().positive().optional(),
  relation: MemberRelationSchema,
  /** Full insured name (FG InsuredName). */
  name: z.string().min(1),
  dob: isoDate,
  gender: GenderSchema,
  occupationCode: z.string().optional(),

  /** Coverage sum insured in rupees (indemnity). Required for indemnity products. */
  sumInsured: z.coerce.number().positive().optional(),
  /** Product cover/plan type (e.g. "Classic", "Vital", "Elite"); product default applies. */
  coverType: z.string().optional(),
  planType: z.string().optional(),
  /** Aggregate deductible in rupees (Advantage Top-Up). */
  deductible: z.coerce.number().nonnegative().optional(),

  heightCm: z.coerce.number().positive().optional(),
  weightKg: z.coerce.number().positive().optional(),
  smoking: z.boolean().optional(),
  alcohol: z.boolean().optional(),
  tobacco: z.boolean().optional(),
  isGoodHealth: z.boolean().default(true),
  /** Manual medical loading % (Varishta Bima). */
  medicalLoading: z.coerce.number().nonnegative().optional(),
  annualIncome: z.coerce.number().nonnegative().optional(),
  abhaNo: z.string().optional(),

  /** Disability declaration (DIY). */
  disability: z
    .object({
      has: z.boolean().default(false),
      udidNumber: z.string().optional(),
      percent: z.coerce.number().min(0).max(100).optional(),
    })
    .optional(),

  nominee: HealthNomineeSchema.optional(),

  /** Personal-accident-specific data (only consumed when product = personalAccident). */
  pa: z
    .object({
      occupationClass: z.string().optional(),
      covers: z.array(PaCoverSelectionSchema).default([]),
    })
    .optional(),
});
export type HealthMember = z.infer<typeof HealthMemberSchema>;

// ─── Quote request ────────────────────────────────────────────────────────────
// Base = everything except `product`, so the compare endpoint can reuse it to
// price one member set across several products.
export const HealthQuoteBaseSchema = z.object({
  /** Policy period in years (FG Duration). */
  policyTermYears: z.coerce.number().int().min(1).max(3).default(1),
  installments: InstallmentSchema.default("FULL"),
  isFgEmployee: z.boolean().default(false),
  /** Co-pay opted (Varishta Bima). */
  coPay: z.boolean().optional(),

  members: z.array(HealthMemberSchema).min(1),

  // PA policy-level inputs (only used when product = personalAccident).
  paPlan: z.string().optional(),
  paUnit: z.coerce.number().int().positive().optional(),
  coverageClass: z.enum(["Individual", "Family"]).optional(),

  // Proposer locator used for pricing (zone / state loadings).
  pincode: z.string().regex(/^\d{6}$/).optional(),
  city: z.string().optional(),
  state: z.string().optional(),

  policyStartDate: isoDate.optional(),
});

export const HealthQuoteRequestSchema = HealthQuoteBaseSchema.extend({
  product: HealthProductSchema,
});
export type HealthQuoteRequest = z.infer<typeof HealthQuoteRequestSchema>;

// ─── Compare (multi-product / multi-vendor) request ───────────────────────────
export const HealthCompareRequestSchema = HealthQuoteBaseSchema.extend({
  /** Restrict to these products; when omitted, every product a vendor supports is priced. */
  products: z.array(HealthProductSchema).optional(),
  /** Restrict to these provider slugs; when omitted, every eligible provider is queried. */
  providers: z.array(z.string().min(1)).optional(),
});
export type HealthCompareRequest = z.infer<typeof HealthCompareRequestSchema>;

// ─── Full quote (proposal) request ────────────────────────────────────────────
export const HealthFullQuoteRequestSchema = HealthQuoteRequestSchema.extend({
  /** QuotationNo from the prior quote (FG strPolicyQuoteNumber). */
  quoteId: z.string().min(1),
  proposer: ProposerSchema,
  address: AddressSchema,
  maritalStatus: z.enum(["S", "M", "D", "W"]).optional(),
  kycRefId: z.string().optional(),
  ckyc: z.string().optional(),
});
export type HealthFullQuoteRequest = z.infer<typeof HealthFullQuoteRequestSchema>;

import { z } from "zod";

// ─── Health line of business ──────────────────────────────────────────────────
// Health is a separate line from motor. The vendor (FG) ships several products;
// all but Personal Accident share an indemnity "members + sum-insured" shape — PA
// is benefit/cover based (see HealthLine).

/** Canonical health products (vendor-agnostic). FG maps each to its own codes. */
export const HealthProductSchema = z.enum([
  "healthAbsolute",
  "healthVital",
  "healthTotal",
  "diy",
  "advantageTopup",
  "varishtaBima",
  "personalAccident",
]);
export type HealthProduct = z.infer<typeof HealthProductSchema>;

/** Indemnity (members + sum insured) vs PA (occupation + benefit covers). */
export const HealthLineSchema = z.enum(["indemnity", "pa"]);
export type HealthLine = z.infer<typeof HealthLineSchema>;

/** Canonical insured/nominee relationship (resolved to a vendor code by the provider). */
export const MemberRelationSchema = z.enum([
  "self",
  "spouse",
  "father",
  "mother",
  "son",
  "daughter",
  "brother",
  "sister",
  "grandfather",
  "grandmother",
  "fatherInLaw",
  "motherInLaw",
  "other",
]);
export type MemberRelation = z.infer<typeof MemberRelationSchema>;

export const GenderSchema = z.enum(["M", "F", "O"]);
export type Gender = z.infer<typeof GenderSchema>;

/** Premium payment frequency. Only FULL (single) is wired for now. */
export const InstallmentSchema = z.enum(["FULL", "YEARLY", "HALFYEARLY", "QUARTERLY", "MONTHLY"]);
export type Installment = z.infer<typeof InstallmentSchema>;

export const HealthQuoteStatusSchema = z.enum(["pending", "success", "no_quote", "error"]);
export type HealthQuoteStatus = z.infer<typeof HealthQuoteStatusSchema>;

// ─── Per-provider health capability matrix ────────────────────────────────────
// Declares, per product, the cover/plan types a provider supports. Kept structured
// (mirrors MotorCapabilities) so eligibility/compare can filter without API churn.
export interface HealthProductCapability {
  line: HealthLine;
  /** Cover/plan type codes the provider offers for this product (e.g. "Classic"). */
  coverTypes: string[];
}
export type HealthCapabilities = Partial<Record<HealthProduct, HealthProductCapability>>;

/** Display metadata for the product selector, in presentation order. */
export interface HealthProductMeta {
  product: HealthProduct;
  label: string;
  line: HealthLine;
}

export const HEALTH_PRODUCT_METADATA: readonly HealthProductMeta[] = [
  { product: "healthAbsolute", label: "FG Health Absolute", line: "indemnity" },
  { product: "healthVital", label: "FG Health Vital", line: "indemnity" },
  { product: "healthTotal", label: "FG Health Total", line: "indemnity" },
  { product: "diy", label: "FG Health DIY", line: "indemnity" },
  { product: "advantageTopup", label: "Future Advantage Top-Up", line: "indemnity" },
  { product: "varishtaBima", label: "Future Varishta Bima", line: "indemnity" },
  { product: "personalAccident", label: "Personal Accident", line: "pa" },
];

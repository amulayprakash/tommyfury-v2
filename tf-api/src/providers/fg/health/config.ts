import type {
  HealthProduct,
  HealthLine,
  HealthCapabilities,
  MemberRelation,
  Gender,
} from "@/contracts/health/health-enums.ts";

// ─── Canonical → FG code maps (also seeded into the health masters) ────────────
// FG is the master data source; these defaults mirror the seeded HealthRelationMaster
// so the mapper stays synchronous/testable. The DB resolver can override per provider.
export const RELATION_FG_CODE: Record<MemberRelation, string> = {
  self: "SELF",
  spouse: "SPOU",
  father: "FATH",
  mother: "MOTH",
  son: "SONM",
  daughter: "DAUG",
  brother: "BROT",
  sister: "SIST",
  grandfather: "GRFA",
  grandmother: "GRMO",
  fatherInLaw: "FILW",
  motherInLaw: "MILW",
  other: "OTHR",
};

/** FG salutation by gender (used when no title is supplied). */
export const SALUTATION_BY_GENDER: Record<Gender, string> = { M: "MR", F: "MS", O: "MR" };

// ─── FG Health product registry ───────────────────────────────────────────────
// Every FG health product rides the same SOAP service (CreatePolicy / Product
// discriminator). Each maps a canonical product to its class codes plus the
// per-member field flags FG's strict DataTable expects (matched to the API-kit
// sample XMLs). Indemnity products share the BeneficiaryDetails/Member shape;
// Personal Accident is benefit/cover based (line = "pa").

export interface FgMemberFeatures {
  /** Member carries a CoverType column (indemnity plans). */
  coverType: boolean;
  /** Advantage Top-Up: Deductible + Plantype columns. */
  topUp: boolean;
  smoking: boolean;
  alcohol: boolean;
  tobacco: boolean;
  /** Manual MedicalLoading column (Total / Varishta). */
  medicalLoading: boolean;
  /** Risk-level CoPay flag (Varishta Bima). */
  coPay: boolean;
  /** Absolute IsExistingAbsolutePolicy column. */
  existingAbsolute: boolean;
  /** Client-level disability declaration (DIY). */
  disability: boolean;
}

export interface FgHealthProductDef {
  product: HealthProduct;
  line: HealthLine;
  /** `<tem:Product>` value. */
  soapProduct: string;
  majorClass: string;
  contractType: string;
  /** Risk.PolicyType (indemnity). For PA the CoverageClassCode is used instead. */
  policyType: string;
  defaultCoverType?: string;
  coverTypes: string[];
  features: FgMemberFeatures;
}

const NO_FEATURES: FgMemberFeatures = {
  coverType: false,
  topUp: false,
  smoking: false,
  alcohol: false,
  tobacco: false,
  medicalLoading: false,
  coPay: false,
  existingAbsolute: false,
  disability: false,
};

export const FG_HEALTH_PRODUCTS: Record<HealthProduct, FgHealthProductDef> = {
  healthAbsolute: {
    product: "healthAbsolute",
    line: "indemnity",
    soapProduct: "HealthAbsolute",
    majorClass: "FHA",
    contractType: "FHA",
    policyType: "HAI",
    defaultCoverType: "Classic",
    coverTypes: ["Classic", "Premier", "Elite"],
    features: { ...NO_FEATURES, coverType: true, tobacco: true, smoking: true, existingAbsolute: true },
  },
  healthVital: {
    product: "healthVital",
    line: "indemnity",
    soapProduct: "HealthVital",
    majorClass: "VIT",
    contractType: "VIT",
    policyType: "HVI",
    defaultCoverType: "Vital",
    coverTypes: ["Vital", "Classic"],
    features: { ...NO_FEATURES, coverType: true, smoking: true, alcohol: true },
  },
  healthTotal: {
    product: "healthTotal",
    line: "indemnity",
    soapProduct: "HealthTotal",
    majorClass: "HTO",
    contractType: "HTO",
    policyType: "HTI",
    defaultCoverType: "VITAL",
    coverTypes: ["VITAL", "Superior"],
    features: { ...NO_FEATURES, coverType: true, medicalLoading: true },
  },
  diy: {
    product: "diy",
    line: "indemnity",
    soapProduct: "DIY",
    majorClass: "DIY",
    contractType: "DIY",
    policyType: "DYI",
    defaultCoverType: "Mini",
    coverTypes: ["Mini", "Midi", "Maxi"],
    features: { ...NO_FEATURES, coverType: true, smoking: true, disability: true },
  },
  advantageTopup: {
    product: "advantageTopup",
    line: "indemnity",
    soapProduct: "AdvantageTopup",
    majorClass: "FAT",
    contractType: "FAT",
    policyType: "HTI",
    defaultCoverType: undefined,
    coverTypes: ["Classic", "Elite"],
    features: { ...NO_FEATURES, topUp: true, medicalLoading: true },
  },
  varishtaBima: {
    product: "varishtaBima",
    line: "indemnity",
    soapProduct: "VarishtaBima",
    majorClass: "FVB",
    contractType: "FVB",
    policyType: "VBI",
    defaultCoverType: undefined,
    coverTypes: ["Bronze", "Silver", "Gold"],
    features: { ...NO_FEATURES, medicalLoading: true, coPay: true },
  },
  personalAccident: {
    product: "personalAccident",
    line: "pa",
    // NOTE: confirm PA `<tem:Product>` with FG — bare-Root samples omit the envelope.
    soapProduct: "PA",
    majorClass: "PAC",
    contractType: "PAL",
    policyType: "",
    defaultCoverType: undefined,
    coverTypes: [],
    features: { ...NO_FEATURES },
  },
};

export function getFgHealthProduct(product: HealthProduct): FgHealthProductDef {
  return FG_HEALTH_PRODUCTS[product];
}

/** Capability matrix advertised by the FG provider (drives compare eligibility). */
export const FG_HEALTH_CAPABILITIES: HealthCapabilities = Object.fromEntries(
  Object.values(FG_HEALTH_PRODUCTS).map((p) => [
    p.product,
    { line: p.line, coverTypes: p.coverTypes },
  ]),
) as HealthCapabilities;

// ─── FG Health gateway auth (separate WSO2 subscription, like CKYC/renewal) ────
export interface FgHealthAuth {
  baseUrl: string;
  tokenUrl: string;
  clientBasic: string;
  agentCode: string;
  branchCode: string;
}

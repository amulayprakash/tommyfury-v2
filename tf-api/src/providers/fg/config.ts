import { env } from "@/config/env.ts";
import type {
  VehicleCategory,
  ProviderOperation,
  PolicyType,
  BusinessType,
  AddonKey,
  MotorCapabilities,
} from "@/contracts/enums.ts";
import type { FgHealthAuth } from "./health/config.ts";

export const FG_SLUG = "fg";
export const FG_DISPLAY_NAME = "Future Generali";

/** FG is our first commercial-capable provider (private car + GCV + PCV). */
export const FG_CAPABILITIES: ReadonlySet<VehicleCategory> = new Set([
  "fourWheeler",
  "commercial",
  "newCommercial",
]);

/**
 * Quote, proposal, CKYC, OVD (UploadDocBytes) and issuance are wired.
 * policyStatus / COI remain deferred — declaring an operation here without an
 * implementation would make the capability type-guards lie (see
 * insurance-provider.ts).
 */
const FG_BASE_OPERATIONS: ProviderOperation[] = [
  "quote",
  "proposal",
  "ckyc",
  "ovd",
  "issuance",
  "renewal",
  "inspection",
];

// Health line of business (see providers/fg/health/*). Advertised only when the
// health gateway is configured, so compare/eligibility skip it otherwise.
const FG_HEALTH_OPERATIONS: ProviderOperation[] = [
  "healthQuote",
  "healthProposal",
  "healthIssuance",
];

export const FG_OPERATIONS: ReadonlySet<ProviderOperation> = new Set([
  ...FG_BASE_OPERATIONS,
  ...(env.FG_HEALTH_ENABLED ? FG_HEALTH_OPERATIONS : []),
]);

/** Per-product gateway credentials (motor / CKYC / renewal each have their own). */
export interface FgProductAuth {
  baseUrl: string;
  tokenUrl: string;
  clientBasic: string;
  /**
   * Product-specific resource-owner credentials. Some WSO2 products issue their
   * token to a dedicated user rather than the shared motor login (FG TechSupport:
   * CKYC uses GCCKYC_Dev/GCKYC@dev26). Falls back to the motor username/password
   * when unset.
   */
  username?: string;
  password?: string;
  /** Optional static gateway subscription key (CKYC `Token` header). */
  subscriptionToken?: string;
  /** CKYC-only: return URL for the self-hosted redirect bridge (VISoF_Return_URL). */
  returnUrl?: string;
}

export interface FgPaymentConfig {
  url: string;
  paymentOption: string;
  /** "1"=PHP (plaintext response, 12-field checksum); ""/"0"=.NET (DES, 11-field). */
  vendor: string;
  responseUrl?: string;
  checksumSecret?: string;
  successUrl?: string;
  failureUrl?: string;
  /** FetchTRNDetails SOAP recon endpoint. */
  reconUrl: string;
  /** `source` sent in the recon request (e.g. "webaggregator"). */
  reconSource: string;
  /** Which pg id FetchTRNDetails is keyed by: "tid" (our TransactionID) or "wsPId" (WS_P_ID). */
  reconKey: "tid" | "wsPId";
  /** Hard-block issuance on a recon miss. false = log both ids + outcome and proceed. */
  reconEnforce: boolean;
}

export interface FgInspectionConfig {
  baseUrl: string;
  appKey?: string;
  companyId?: string;
  appId?: string;
}

export interface FgConfig {
  baseUrl: string;
  tokenUrl: string;
  clientBasic: string;
  username: string;
  password: string;
  vendorCode: string;
  agentCode: string;
  branchCode: string;
  credentialSetId: string;
  /** CKYC product (GCKYC/3.0.0) — falls back to motor token URL/client when unset. */
  ckyc: FgProductAuth;
  /** Motor renewal product (Renewal/1.0.0/RenewalModify — full-JSON 3-op). */
  renewal: FgProductAuth;
  /** Health products (TCS BO Service) — own WSO2 subscription + agent code. */
  health: FgHealthAuth;
  payment: FgPaymentConfig;
  inspection: FgInspectionConfig;
}

/**
 * Reads FG config from env. Throws only when FG is enabled but misconfigured —
 * fixtures-based tests construct the provider with explicit config instead.
 */
export function loadFgConfig(): FgConfig {
  const missing: string[] = [];
  if (!env.FG_CLIENT_BASIC) missing.push("FG_CLIENT_BASIC");
  if (!env.FG_USERNAME) missing.push("FG_USERNAME");
  if (!env.FG_PASSWORD) missing.push("FG_PASSWORD");
  if (missing.length > 0) {
    throw new Error(`FG provider enabled but missing env: ${missing.join(", ")}`);
  }
  return {
    baseUrl: env.FG_BASE_URL.replace(/\/$/, ""),
    tokenUrl: env.FG_TOKEN_URL,
    clientBasic: env.FG_CLIENT_BASIC!,
    username: env.FG_USERNAME!,
    password: env.FG_PASSWORD!,
    vendorCode: env.FG_VENDOR_CODE,
    agentCode: env.FG_AGENT_CODE,
    branchCode: env.FG_BRANCH_CODE,
    credentialSetId: "default",
    ckyc: {
      baseUrl: env.FG_CKYC_BASE_URL.replace(/\/$/, ""),
      tokenUrl: env.FG_CKYC_TOKEN_URL ?? env.FG_TOKEN_URL,
      clientBasic: env.FG_CKYC_CLIENT_BASIC ?? env.FG_CLIENT_BASIC!,
      // CKYC has its own resource-owner login (per FG TechSupport); fall back to
      // the shared motor credentials when the dedicated ones aren't set.
      username: env.FG_CKYC_USERNAME,
      password: env.FG_CKYC_PASSWORD,
      subscriptionToken: env.FG_CKYC_SUBSCRIPTION_TOKEN,
      returnUrl: env.FG_CKYC_RETURN_URL,
    },
    renewal: {
      baseUrl: env.FG_RENEWAL_BASE_URL.replace(/\/$/, ""),
      tokenUrl: env.FG_RENEWAL_TOKEN_URL ?? env.FG_TOKEN_URL,
      clientBasic: env.FG_RENEWAL_CLIENT_BASIC ?? env.FG_CLIENT_BASIC!,
    },
    health: {
      baseUrl: env.FG_HEALTH_BASE_URL.replace(/\/$/, ""),
      tokenUrl: env.FG_HEALTH_TOKEN_URL ?? env.FG_TOKEN_URL,
      clientBasic: env.FG_HEALTH_CLIENT_BASIC ?? env.FG_CLIENT_BASIC!,
      agentCode: env.FG_HEALTH_AGENT_CODE ?? env.FG_AGENT_CODE,
      branchCode: env.FG_BRANCH_CODE,
    },
    payment: {
      url: env.FG_PAYMENT_URL,
      paymentOption: env.FG_PAYMENT_OPTION,
      vendor: env.FG_PAYMENT_VENDOR,
      responseUrl: env.FG_PAYMENT_RESPONSE_URL,
      checksumSecret: env.FG_PAYMENT_CHECKSUM_SECRET,
      successUrl: env.FG_PAYMENT_SUCCESS_URL,
      failureUrl: env.FG_PAYMENT_FAILURE_URL,
      reconUrl: env.FG_PAYMENT_RECON_URL,
      reconSource: env.FG_PAYMENT_RECON_SOURCE,
      reconKey: env.FG_PAYMENT_RECON_KEY,
      reconEnforce: env.FG_PAYMENT_RECON_ENFORCE,
    },
    inspection: {
      baseUrl: env.LIVECHEK_BASE_URL.replace(/\/$/, ""),
      appKey: env.LIVECHEK_APP_KEY,
      companyId: env.LIVECHEK_COMPANY_ID,
      appId: env.LIVECHEK_APP_ID,
    },
  };
}

// ─── Contract type + Risk type (from the master "Contract Type" sheet) ────────
// VERIFIED against Motor field Master.xls → "Contract Type" sheet (Normal channel):
//   Private Car Annual            → ContractType FPV, RiskType FPV (CO 1+1, LO 0+1)
//   Private Car Bundled (New)     → F13 / F13 (CO 1yr OD + 3yr TP)
//   Private Car Standalone OD     → FVO / FVO (OD 1+0)
//   Goods Carrying (GCV)          → ContractType FCV, RiskType FGV
//   Passenger Carrying (PCV)      → ContractType FCV, RiskType FPC
// GCI confirmed (2026-07-26) a SECOND bundled new-vehicle product exists:
//   Private Car Bundled (New) 3OD+3TP → F33 / F33 (CO 3yr OD + 3yr TP), POS: P33/P33.
// We currently sell only the 1OD+3TP bundle (F13); the canonical contract has no
// tenure-choice field, so F33 is unwired — add a product selector before using it.
// POS/MISP channels map to P13/P33 etc. — not used on the Webagg channel.
// New-vs-rollover is additionally carried via PreviousInsDtls flags.
// Standalone TP for a NEW car: GCI's answer lists ONLY the bundled products for
// new vehicles — confirming assertSupportedJourney()'s refusal of new+TP-only.
export type CommercialSubType = "goods" | "passenger";

export interface FgContractResolution {
  contractType: string;
  riskType: string;
  cover: "CO" | "OD" | "LO";
  /** Policy period in years (F13 bundled new vehicle = 3yr; everything else 1yr). */
  tenureYears: number;
}

/** Cover code by canonical policy type. */
export const COVER_MAP: Record<PolicyType, "CO" | "OD" | "LO"> = {
  comprehensive: "CO",
  standAloneOD: "OD",
  thirdParty: "LO",
};

interface ContractInput {
  vehicleType: VehicleCategory;
  selectedPolicy: PolicyType;
  businessType: BusinessType;
  commercialSubType?: CommercialSubType;
}

export function resolveContract(req: ContractInput): FgContractResolution {
  const cover = COVER_MAP[req.selectedPolicy];

  if (req.vehicleType === "commercial" || req.vehicleType === "newCommercial") {
    const riskType = req.commercialSubType === "passenger" ? "FPC" : "FGV";
    return { contractType: "FCV", riskType, cover, tenureYears: 1 };
  }

  // four-wheeler / new four-wheeler (twoWheeler is out of scope for FG)
  if (req.selectedPolicy === "standAloneOD") {
    return { contractType: "FVO", riskType: "FVO", cover, tenureYears: 1 };
  }
  // Third-party-only is never the *bundled* F13 (1yr OD + 3yr TP) product — FG
  // rejects a "new + TP under F13" ENQ with the misleading "Incorrect AgentCode
  // Combination Passed". A standalone TP rides the annual private-car product
  // (FPV, cover LO) for both new and rollover, matching the live-verified
  // rollover-TP path.
  if (req.selectedPolicy === "thirdParty") {
    return { contractType: "FPV", riskType: "FPV", cover, tenureYears: 1 };
  }
  if (req.businessType === "new" || req.vehicleType === "newVehicle") {
    // Bundled new vehicle = 1yr OD + 3yr TP → 3-year policy period.
    return { contractType: "F13", riskType: "F13", cover, tenureYears: 3 };
  }
  return { contractType: "FPV", riskType: "FPV", cover, tenureYears: 1 };
}

// ─── Fuel type ────────────────────────────────────────────────────────────────
// FG FuelType field codes (per the sample API + Fuel Type master).
export const FUEL_MAP: Record<string, string> = {
  petrol: "P",
  diesel: "D",
  cng: "CNG",
  lpg: "LPG",
  electric: "B", // Battery
  hybrid: "P",
};

/** "electric" add-on section in the master (EV-only combo covers). */
export function fuelClassOf(fuelType: string): "electric" | "standard" {
  return fuelType === "electric" ? "electric" : "standard";
}

// ─── Per-category capability matrix ───────────────────────────────────────────

const PRIVATE_CAR_ADDONS: AddonKey[] = [
  "zeroDep",
  "engineProtect",
  "rsa",
  "tyreProtect",
  "rti",
  "consumables",
  "paOwner",
  "paUnnamedPassenger",
  "legalLiabilityPaidDriver",
];

// Commercial OD add-ons are limited; PA / LL covers still apply.
const COMMERCIAL_ADDONS: AddonKey[] = [
  "consumables",
  "paOwner",
  "paUnnamedPassenger",
  "legalLiabilityPaidDriver",
];

export const FG_MOTOR_CAPABILITIES: MotorCapabilities = {
  fourWheeler: {
    // "thirdParty" removed 2026-07-26 on GCI's written confirmation: standalone
    // third-party is BLOCKED for this channel per UW guidelines (every TP-only
    // request referral-declines as "Declined Vehicle" by design, agent 60001464).
    // Re-add here if GCI enables TP-only for the Web Aggregator channel.
    policyTypes: ["comprehensive", "standAloneOD"],
    addons: PRIVATE_CAR_ADDONS,
  },
  commercial: {
    policyTypes: ["comprehensive", "thirdParty"],
    addons: COMMERCIAL_ADDONS,
  },
  newCommercial: {
    policyTypes: ["comprehensive", "thirdParty"],
    addons: COMMERCIAL_ADDONS,
  },
};

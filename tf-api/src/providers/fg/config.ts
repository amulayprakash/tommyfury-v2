import { env } from "@/config/env.ts";
import { API_BASE_URL } from "@/config/app-urls.ts";
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

// ─── Vendor settings (was .env — only the credentials stayed there) ───────────
// These are FG's data, not this deployment's: they change when FG changes them,
// identically everywhere we run. Nothing below is env-overridable.

/** Registers the FG provider at startup. */
export const FG_ENABLED = true;

/**
 * Gates the FG health line of business (in addition to FG_ENABLED). Off: the
 * health gateway subscription is not live yet, and advertising healthQuote
 * without it makes compare/eligibility fan out to a product FG will refuse.
 */
export const FG_HEALTH_ENABLED = false;

/**
 * WSO2 gateway hosts. Each FG product is its own subscription; the ones with no
 * entry of their own mint their token against `tokenUrl` (add a dedicated URL
 * here if FG ever splits the token hosts).
 *
 * ⚠️ UAT values. PROD hosts are not in the vendor kit — confirm with FG at
 * go-live, including the motor token host (the rebranded gateway moved to
 * generalicentralinsurance.com; the old futuregenerali.in host survives only for
 * the legacy renewal product).
 */
export const FG_GATEWAY = {
  /** API gateway base (JSON motor endpoints live under /MotorAPI/1.0.0). */
  baseUrl: "https://uat-internal-apigw.generalicentralinsurance.com:8243",
  /** OAuth2 token endpoint (password grant), shared by every product below. */
  tokenUrl: "https://uat-internal-apim.generalicentralinsurance.com:9443/oauth2/token",
  /**
   * CKYC gateway base (…/GCKYC/3.0.0). Two UAT candidates exist post-rebrand and
   * only ONE answers. The rebranded host below is what the live .env pointed at;
   * the legacy alternative is
   *   https://uat-internal-apigw.futuregenerali.in:8243/GCKYC/3.0.0
   * Verify before switching:  npx tsx --env-file=.env scripts/verify-fg-ckyc-host.ts
   */
  ckycBaseUrl: "https://uat-internal-apigw.generalicentralinsurance.com:8243/GCKYC/3.0.0",
  /**
   * Motor renewal (full-JSON 3-op product). The adapter appends
   * /ModifyRenewalQuote, /ModifyRenewalProposal, /ModifyRenewalPolicyIssuance.
   */
  renewalBaseUrl:
    "https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify",
  /** Health SOAP service base (the BO/Service.svc gateway path). */
  healthBaseUrl:
    "https://uat-internal-apigw.generalicentralinsurance.com:8243/Health/1.0.0/BO/Service.svc",
} as const;

/** Our channel identity with FG (broker IMD IM-2388598 → agent code 60001464). */
export const FG_CHANNEL = {
  vendorCode: "Webagg",
  agentCode: "60001464",
  branchCode: "10",
  /** Health rides its own agent code when FG issues one; falls back to agentCode. */
  healthAgentCode: undefined as string | undefined,
} as const;

/**
 * Absolute URL the eKYC portal returns the browser to after manual KYC
 * (redirect bridge VISoF_Return_URL). Unset — FG has not confirmed the bridge.
 */
export const FG_CKYC_RETURN_URL: string | undefined = undefined;

/** Web-Aggregator payment gateway (checksum-signed form POST, v1.41). */
export const FG_PAYMENT = {
  /** Hosted payment page the signed form POSTs to (WebAggPayNew.aspx, v1.41). */
  url: "https://digiuat.generalicentralinsurance.com/Ecom_UAT/WEBAPPLN/UI/Common/WebAggPayNew.aspx",
  /** PaymentOption code: 1=PayTm, 2=HDFC, 3=PayU (PayU is mandated for web-agg). */
  paymentOption: "3",
  /**
   * Integration mode sent as the `Vendor` field. "1" = PHP mode (FG returns
   * plaintext result params on the ResponseURL; checksum appends a 12th timestamp
   * field). ""/"0" = .NET mode (DES-encrypted ResponseData; 11-field checksum).
   * PHP because OpenSSL 3 disables legacy single-DES on this runtime.
   */
  vendor: "1",
  /** Where FG posts the payment result — our own callback route. */
  responseUrl: `${API_BASE_URL}/api/v1/fg/payment/callback`,
  /** Absolute web URLs the callback 302-redirects the browser to. Unset = default. */
  successUrl: undefined as string | undefined,
  failureUrl: undefined as string | undefined,
  /**
   * Server-side reconciliation endpoint (FetchTRNDetails), v1.41 — one service
   * for both UAT and production (the doc lists no UAT variant). This is the SOAP
   * endpoint from the live WSDL's `soap:address`, i.e. the bare `.asmx`. The doc
   * also prints a slash form (`.../comservice.asmx/FetchTRNDetails`), ASP.NET's
   * HTTP-POST binding; both work (the transport picks the encoding) but prefer
   * this one.
   */
  reconUrl: "https://pg.generalicentralinsurance.com/quick_pay/quickpay/comservice.asmx",
  /** `source` value in the FetchTRNDetails request (web-agg transactions). */
  reconSource: "webaggregator",
  /**
   * Which id `FetchTRNDetails` is keyed by: "tid" = our TransactionID
   * (== quoteNo == pg.tid); "wsPId" = FG's PG txn id (WS_P_ID). UNVERIFIED — the
   * v1.41 PDF sample ids look like PG/quickpay ids, so if recon is keyed by
   * WS_P_ID a "tid" guess returns "not found" for every real txn.
   */
  reconKey: "tid" as "tid" | "wsPId",
  /**
   * Hard-block issuance when recon fails / returns "not found". **false** until
   * reconKey is confirmed on UAT — a wrong key guess would block 100% of
   * issuance. While false, the callback LOGS both ids (tid + WS_P_ID) and the
   * recon outcome, then proceeds.
   */
  reconEnforce: false,
} as const;

/** LiveChek break-in / inspection (third-party REST; credentials stay in env). */
export const LIVECHEK_BASE_URL = "https://newapi.test.livechek.com/api";

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
  ...(FG_HEALTH_ENABLED ? FG_HEALTH_OPERATIONS : []),
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
 * Builds the FG config from the constants above plus the credentials in env.
 * Throws only when FG is enabled but its credentials are missing — fixtures-based
 * tests construct the provider with explicit config instead.
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
    baseUrl: FG_GATEWAY.baseUrl.replace(/\/$/, ""),
    tokenUrl: FG_GATEWAY.tokenUrl,
    clientBasic: env.FG_CLIENT_BASIC!,
    username: env.FG_USERNAME!,
    password: env.FG_PASSWORD!,
    vendorCode: FG_CHANNEL.vendorCode,
    agentCode: FG_CHANNEL.agentCode,
    branchCode: FG_CHANNEL.branchCode,
    credentialSetId: "default",
    ckyc: {
      baseUrl: FG_GATEWAY.ckycBaseUrl.replace(/\/$/, ""),
      tokenUrl: FG_GATEWAY.tokenUrl,
      clientBasic: env.FG_CKYC_CLIENT_BASIC ?? env.FG_CLIENT_BASIC!,
      // CKYC has its own resource-owner login (per FG TechSupport); fall back to
      // the shared motor credentials when the dedicated ones aren't set.
      username: env.FG_CKYC_USERNAME,
      password: env.FG_CKYC_PASSWORD,
      subscriptionToken: env.FG_CKYC_SUBSCRIPTION_TOKEN,
      returnUrl: FG_CKYC_RETURN_URL,
    },
    renewal: {
      baseUrl: FG_GATEWAY.renewalBaseUrl.replace(/\/$/, ""),
      tokenUrl: FG_GATEWAY.tokenUrl,
      clientBasic: env.FG_RENEWAL_CLIENT_BASIC ?? env.FG_CLIENT_BASIC!,
    },
    health: {
      baseUrl: FG_GATEWAY.healthBaseUrl.replace(/\/$/, ""),
      tokenUrl: FG_GATEWAY.tokenUrl,
      clientBasic: env.FG_HEALTH_CLIENT_BASIC ?? env.FG_CLIENT_BASIC!,
      agentCode: FG_CHANNEL.healthAgentCode ?? FG_CHANNEL.agentCode,
      branchCode: FG_CHANNEL.branchCode,
    },
    payment: {
      url: FG_PAYMENT.url,
      paymentOption: FG_PAYMENT.paymentOption,
      vendor: FG_PAYMENT.vendor,
      responseUrl: FG_PAYMENT.responseUrl,
      checksumSecret: env.FG_PAYMENT_CHECKSUM_SECRET,
      successUrl: FG_PAYMENT.successUrl,
      failureUrl: FG_PAYMENT.failureUrl,
      reconUrl: FG_PAYMENT.reconUrl,
      reconSource: FG_PAYMENT.reconSource,
      reconKey: FG_PAYMENT.reconKey,
      reconEnforce: FG_PAYMENT.reconEnforce,
    },
    inspection: {
      baseUrl: LIVECHEK_BASE_URL.replace(/\/$/, ""),
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

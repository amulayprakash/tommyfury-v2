import { env } from "@/config/env.ts";
import type {
  VehicleCategory,
  ProviderOperation,
  PolicyType,
  AddonKey,
  MotorCapabilities,
} from "@/contracts/enums.ts";

export const HDFC_SLUG = "hdfc";
export const HDFC_DISPLAY_NAME = "HDFC ERGO";

/**
 * Private Car only (PRODUCT_CODE 2311). The vendor kit ships no two-wheeler or
 * commercial Postman collection, product code or master data, so advertising
 * those categories would make every such request fail at the vendor.
 */
export const HDFC_CAPABILITIES: ReadonlySet<VehicleCategory> = new Set<VehicleCategory>([
  "fourWheeler",
  "newVehicle",
]);

/**
 * Four operations are deliberately absent because HDFC exposes no endpoint:
 *
 * - `retrieveQuote` — no get-quote-by-id call; premium is recomputed each time.
 * - `policyStatus`  — nothing in the kit.
 * - `inspection`    — break-in is triggered automatically at HDFC's end
 *                     (PVTcarTestScenarios.xls: "Proposal should be triggered
 *                     for Inspection"), same as ITGI. Nothing to call.
 * - `ovd`           — the Pehchaan kit has no document-upload API; documents are
 *                     captured inside HDFC's own hosted journey.
 */
export const HDFC_OPERATIONS: ReadonlySet<ProviderOperation> = new Set<ProviderOperation>([
  "quote",
  "proposal",
  "ckyc",
  "issuance",
  "renewal",
  "coi",
]);

/** HDFC POLICY_TYPE vocabulary (exact strings from the Postman collection). */
export const HDFC_POLICY_TYPE = {
  comprehensive: "OD Plus TP",
  thirdParty: "TP Only",
  standAloneOD: "OD Only",
} as const;

export type HdfcPolicyTypeValue = (typeof HDFC_POLICY_TYPE)[keyof typeof HDFC_POLICY_TYPE];

export function hdfcPolicyType(policyType: PolicyType): HdfcPolicyTypeValue {
  return HDFC_POLICY_TYPE[policyType];
}

/** HDFC business-type vocabulary (BusinessType_Mandatary). */
export const HDFC_BUSINESS_TYPE = {
  new: "New Vehicle",
  rollover: "Roll Over",
  used: "Used Car",
} as const;

export type HdfcBusinessType = (typeof HDFC_BUSINESS_TYPE)[keyof typeof HDFC_BUSINESS_TYPE];

/** The eight HEI operations. Identical across products; only PRODUCT_CODE varies. */
export const HDFC_ENDPOINTS = {
  authenticate: "authenticate",
  getCalculateIDV: "getcalculateidv",
  calculatePremium: "calculatepremium",
  createProposal: "createproposal",
  getProposalDocument: "getproposaldocument",
  submitPaymentDetails: "submitpaymentdetails",
  getPolicyDocument: "getpolicydocument",
  renewalExtract: "getpolicydataforrenewal",
} as const;

export type HdfcEndpointName = keyof typeof HDFC_ENDPOINTS;

/**
 * Canonical add-on flags HDFC honours, each backed by a Req_PvtCar cover field.
 * HDFC has no rimProtect / keyProtect / garageCash / drivingAccessories.
 */
const PRIVATE_CAR_ADDONS: AddonKey[] = [
  "zeroDep",
  "tyreProtect",
  "ncbProtection",
  "rti",
  "consumables",
  "engineProtect",
  "rsa",
  "lossOfBelongings",
  "paOwner",
  "paUnnamedPassenger",
  "legalLiabilityPaidDriver",
  "batteryProtect",
];

export const HDFC_MOTOR_CAPABILITIES: MotorCapabilities = {
  fourWheeler: {
    policyTypes: ["comprehensive", "thirdParty", "standAloneOD"],
    addons: PRIVATE_CAR_ADDONS,
  },
  // A brand-new vehicle is always sold as a package; the collection's New
  // Business folder has no TP-only or SA-OD variant.
  newVehicle: {
    policyTypes: ["comprehensive"],
    addons: PRIVATE_CAR_ADDONS,
  },
};

export interface HdfcConfig {
  baseUrl: string;
  source: string;
  channelId: string;
  credential: string;
  productCode: string;
  tokenTtlSeconds: number;
  kyc: {
    baseUrl: string;
    apiKey: string;
    tokenTtlSeconds: number;
    returnUrl: string;
  };
}

/**
 * Reads HDFC config from env. Throws only when HDFC is enabled but misconfigured;
 * fixture-driven tests construct a config literal and never call this.
 */
export function loadHdfcConfig(): HdfcConfig {
  const missing: string[] = [];
  if (!env.HDFC_CREDENTIAL) missing.push("HDFC_CREDENTIAL");
  if (!env.HDFC_SOURCE) missing.push("HDFC_SOURCE");
  if (!env.HDFC_CHANNEL_ID) missing.push("HDFC_CHANNEL_ID");
  if (missing.length > 0) {
    throw new Error(`HDFC provider enabled but missing env: ${missing.join(", ")}`);
  }
  return {
    baseUrl: env.HDFC_BASE_URL.replace(/\/?$/, "/"),
    source: env.HDFC_SOURCE,
    channelId: env.HDFC_CHANNEL_ID,
    credential: env.HDFC_CREDENTIAL!,
    productCode: env.HDFC_PRODUCT_PVTCAR,
    tokenTtlSeconds: env.HDFC_TOKEN_TTL,
    kyc: {
      baseUrl: env.HDFC_KYC_BASE_URL.replace(/\/$/, ""),
      apiKey: env.HDFC_KYC_API_KEY ?? "",
      tokenTtlSeconds: env.HDFC_KYC_TOKEN_TTL,
      returnUrl: env.HDFC_KYC_RETURN_URL,
    },
  };
}

/** Absolute URL for an HEI operation. */
export function hdfcEndpointUrl(config: HdfcConfig, name: HdfcEndpointName): string {
  return config.baseUrl + HDFC_ENDPOINTS[name];
}

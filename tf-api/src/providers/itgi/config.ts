import { env } from "@/config/env.ts";
import type {
  VehicleCategory,
  ProviderOperation,
  AddonKey,
  MotorCapabilities,
} from "@/contracts/enums.ts";

export const ITGI_SLUG = "itgi";
export const ITGI_DISPLAY_NAME = "IFFCO-Tokio";

/**
 * Private car + two-wheeler + new vehicle. Commercial (CVI) is deliberately
 * excluded: the vendor kit ships no CVI master data, so its codes cannot be
 * resolved (see docs/itgi-integration-notes.md §6).
 */
export const ITGI_CAPABILITIES: ReadonlySet<VehicleCategory> = new Set<VehicleCategory>([
  "fourWheeler",
  "twoWheeler",
  "newVehicle",
]);

/**
 * Declaring an operation without an implementation would make the capability
 * type-guards lie, so three are intentionally absent:
 *
 * - `retrieveQuote` — ITGI has no retrieve-quote-by-id call (same as FG).
 * - `renewal` — the vendor exposes no renewal API at all. Single-year OD
 *   *renewal* is still supported, but as a policy TYPE inside the normal
 *   quote/proposal flow (`selectedPolicy: "standAloneOD"` → ITGI PolicyType=OD),
 *   not via the FG-shaped RenewalProvider (fetch-by-policy-no → modify → create).
 * - `inspection` — break-in inspection happens automatically at ITGI's end; there
 *   is no create-inspection endpoint to call. Break-in itself IS fully supported
 *   (inception+3, the breakInofMorethan90days flag, inspection-evidence tags on
 *   the proposal, and the PAYMENT_ACCEPTED_BREAK_IN outcome); progress is
 *   observed through `policyStatus`.
 */
export const ITGI_OPERATIONS: ReadonlySet<ProviderOperation> = new Set<ProviderOperation>([
  "quote",
  "proposal",
  "ckyc",
  "ovd",
  "issuance",
  "policyStatus",
  "coi",
]);

/**
 * ITGI keys coverages by an exact NAME string, not a code. This vocabulary is a
 * small fixed set that changes only when the vendor revises its kit, so it lives
 * in code rather than a DB table.
 */
export const ITGI_COVERAGE = {
  IDV_BASIC: "IDV Basic",
  PA_OWNER_DRIVER: "PA Owner / Driver",
  PA_TO_PASSENGER: "PA to Passenger",
  TPPD: "TPPD",
  LL_DRIVER: "Legal Liability to Driver",
  LL_EMPLOYEE: "Legal Liability to Employee",
  NCB: "No Claim Bonus",
  ELECTRICAL_ACCESSORIES: "Electrical Accessories",
  COST_OF_ACCESSORIES: "Cost of Accessories",
  CNG_KIT: "CNG Kit",
  CNG_KIT_COMPANY_FIT: "CNG Kit Company Fit",
  VOLUNTARY_EXCESS: "Voluntary Excess",
  AAI_DISCOUNT: "AAI Discount",
  ANTI_THEFT: "Anti-Theft",
  DEPRECIATION_WAIVER: "Depreciation Waiver",
  TOWING: "Towing & Related",
  CONSUMABLE: "Consumable",
  ENGINE_GEAR_BOX: "Engine Gear Box Protection",
  RIM: "RIM",
  TYRE_PROTECTION: "Tyre Protection",
  HELMET: "HELMET",
  PAY_AS_YOU_DRIVE: "Pay As You Drive",
  PREFERRED_GARAGE: "Preferred Garage Opted cover",
} as const;

/** Canonical add-on flag (MotorQuoteRequest) → ITGI coverage name. */
const ADDON_TO_COVERAGE: Partial<Record<string, string>> = {
  zeroDep: ITGI_COVERAGE.DEPRECIATION_WAIVER,
  engineProtect: ITGI_COVERAGE.ENGINE_GEAR_BOX,
  tyreProtect: ITGI_COVERAGE.TYRE_PROTECTION,
  rimProtect: ITGI_COVERAGE.RIM,
  consumables: ITGI_COVERAGE.CONSUMABLE,
  rsa: ITGI_COVERAGE.TOWING,
  paOwner: ITGI_COVERAGE.PA_OWNER_DRIVER,
  paUnnamedPassenger: ITGI_COVERAGE.PA_TO_PASSENGER,
  legalLiabilityPaidDriver: ITGI_COVERAGE.LL_EMPLOYEE,
};

export function itgiCoverageName(addonKey: string): string | undefined {
  return ADDON_TO_COVERAGE[addonKey];
}

/** Allowed-value constraints the vendor enforces (kit master sheets). */
export const ITGI_ALLOWED = {
  ncbPercent: [20, 25, 35, 45, 50] as readonly number[],
  voluntaryExcess: {
    fourWheeler: [2500, 5000, 7500, 15000] as readonly number[],
    twoWheeler: [500, 750, 1000, 1500, 3000] as readonly number[],
  },
  tppdSumInsured: { fourWheeler: 750000, twoWheeler: 100000 },
  helmetMaxSI: 50000,
  tyreMaxVehicleAgeYears: 4,
} as const;

export interface ItgiConfig {
  soapBaseUrl: string;
  restBaseUrl: string;
  partnerCode: string;
  partnerBranch: string;
  partnerSubBranch: string;
  responseUrl: string;
  downloadUser: string;
  downloadPassword: string;
}

export function itgiConfig(): ItgiConfig {
  return {
    soapBaseUrl: env.ITGI_SOAP_BASE_URL.replace(/\/$/, ""),
    restBaseUrl: env.ITGI_REST_BASE_URL.replace(/\/$/, ""),
    partnerCode: env.ITGI_PARTNER_CODE,
    partnerBranch: env.ITGI_PARTNER_BRANCH,
    partnerSubBranch: env.ITGI_PARTNER_SUB_BRANCH,
    responseUrl: env.ITGI_RESPONSE_URL,
    downloadUser: env.ITGI_DOWNLOAD_USER,
    downloadPassword: env.ITGI_DOWNLOAD_PASSWORD,
  };
}

/** Per-service endpoints (UAT paths from the vendor kit). */
export const ITGI_ENDPOINTS = {
  idv: (c: ItgiConfig) => `${c.soapBaseUrl}/IDVWebService`,
  premium: (c: ItgiConfig) => `${c.soapBaseUrl}/MotorPremiumWebserviceVA`,
  newVehiclePremium: (c: ItgiConfig) => `${c.soapBaseUrl}/NewVehiclePremiumWebserviceVA`,
  proposal: (c: ItgiConfig) => `${c.soapBaseUrl}/PartnerProposalRequest`,
  payment: (c: ItgiConfig) => `${c.soapBaseUrl}/PaymentUpdateWS`,
  policyStatus: (c: ItgiConfig) => `${c.soapBaseUrl}/CheckPolicyStatus`,
  kycFetch: (c: ItgiConfig) => `${c.restBaseUrl}/kyc/fetch`,
  kycValidateOtp: (c: ItgiConfig) => `${c.restBaseUrl}/kyc/fetch-validate-otp`,
  kycCreate: (c: ItgiConfig) => `${c.restBaseUrl}/kyc/create`,
  policyDownload: (c: ItgiConfig) => `${c.restBaseUrl}/policy/download`,
} as const;

const PRIVATE_CAR_ADDONS: AddonKey[] = [
  "zeroDep",
  "engineProtect",
  "rsa",
  "tyreProtect",
  "rimProtect",
  "consumables",
  "paOwner",
  "paUnnamedPassenger",
  "legalLiabilityPaidDriver",
];

// RIM / Tyre / Engine Gear Box are valid for two-wheelers too per the updated
// vendor kit ("applicable only Private Car and Two Wheeler").
const TWO_WHEELER_ADDONS: AddonKey[] = [
  "zeroDep",
  "engineProtect",
  "rsa",
  "tyreProtect",
  "rimProtect",
  "consumables",
  "paOwner",
  "paUnnamedPassenger",
];

export const ITGI_MOTOR_CAPABILITIES: MotorCapabilities = {
  fourWheeler: {
    policyTypes: ["comprehensive", "thirdParty", "standAloneOD"],
    addons: PRIVATE_CAR_ADDONS,
  },
  twoWheeler: {
    policyTypes: ["comprehensive", "thirdParty", "standAloneOD"],
    addons: TWO_WHEELER_ADDONS,
  },
  // New vehicles are sold as a long-term bundled package.
  newVehicle: {
    policyTypes: ["comprehensive"],
    addons: PRIVATE_CAR_ADDONS,
  },
};

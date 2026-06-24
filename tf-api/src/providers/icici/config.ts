import { env } from "@/config/env.ts";
import { AddonKeySchema } from "@/contracts/enums.ts";
import type {
  VehicleCategory,
  ProviderOperation,
  BusinessType,
  PolicyType,
  AddonKey,
  MotorCapabilities,
} from "@/contracts/enums.ts";

export const ICICI_SLUG = "icici";
export const ICICI_DISPLAY_NAME = "ICICI Lombard";

export const ICICI_CAPABILITIES: ReadonlySet<VehicleCategory> = new Set([
  "fourWheeler",
  "twoWheeler",
]);

export const ICICI_OPERATIONS: ReadonlySet<ProviderOperation> = new Set([
  "quote",
  "retrieveQuote",
  "proposal",
  "ckyc",
  "ovd",
  "policyStatus",
  "coi",
]);

/** Physical vehicle line → ICICI premium endpoint segment. */
export type IciciVehicleLine = "tw" | "fw";

export interface IciciConfig {
  baseUrl: string;
  login: string;
  password: string;
  aesKey: string;
  aesMode: string;
  credentialSetId: string;
}

/**
 * Reads ICICI config from env. Throws only when ICICI is enabled but
 * misconfigured — fixtures-based tests run without these set.
 */
export function loadIciciConfig(): IciciConfig {
  const missing: string[] = [];
  if (!env.ICICI_LOGIN) missing.push("ICICI_LOGIN");
  if (!env.ICICI_PASSWORD) missing.push("ICICI_PASSWORD");
  if (!env.ICICI_AES_KEY) missing.push("ICICI_AES_KEY");
  if (missing.length > 0) {
    throw new Error(`ICICI provider enabled but missing env: ${missing.join(", ")}`);
  }
  return {
    baseUrl: env.ICICI_BASE_URL.replace(/\/$/, ""),
    login: env.ICICI_LOGIN!,
    password: env.ICICI_PASSWORD!,
    aesKey: env.ICICI_AES_KEY!,
    aesMode: env.ICICI_AES_MODE,
    credentialSetId: "default",
  };
}

// ─── Product Master (Product Code) ────────────────────────────────────────────
// ProductCode encodes physical line + business type + tenure (PDF "Product Master").

interface ProductKey {
  line: IciciVehicleLine;
  business: BusinessType;
  policyType: PolicyType;
  tenureYears: number;
}

// Product Master per the partner PDFs ("Generic 2W/4W" → Product Master table).
// TP uses the dedicated "2W TP" (26) / "4W TP" (29) codes — NOT the 24/25 "Roll
// Over" rows. ⚠️ Confirm 26/29 against a live UAT TP quote before go-live.
const PRODUCT_CODES: Record<string, number> = {
  // 2-Wheeler
  "tw|new|comprehensive|1": 10, // Brand New
  "tw|rollover|comprehensive|1": 13, // Roll Over
  "tw|renewal|comprehensive|1": 13,
  "tw|rollover|standAloneOD|1": 16, // Own Damage
  "tw|rollover|thirdParty|1": 26, // 2W TP
  "tw|renewal|thirdParty|1": 26,
  "tw|rollover|comprehensive|2": 14,
  "tw|rollover|comprehensive|3": 15,
  // 4-Wheeler
  "fw|new|comprehensive|1": 20,
  "fw|rollover|comprehensive|1": 21,
  "fw|renewal|comprehensive|1": 21,
  "fw|rollover|standAloneOD|1": 22,
  "fw|rollover|thirdParty|1": 29, // 4W TP
  "fw|renewal|thirdParty|1": 29,
  "fw|rollover|comprehensive|2": 36,
  "fw|rollover|comprehensive|3": 53,
};

export function resolveProductCode(key: ProductKey): number | undefined {
  const k = `${key.line}|${key.business}|${key.policyType}|${key.tenureYears}`;
  return PRODUCT_CODES[k];
}

// ─── Addon code maps ──────────────────────────────────────────────────────────
// Canonical addon flag → ICICI addon string code (category-specific eligibility).

export const ADDON_CODES_4W: Record<string, string> = {
  rsa: "RSA",
  zeroDep: "ZD",
  engineProtect: "EP",
  keyProtect: "KP",
  garageCash: "GC",
  lossOfBelongings: "LOPB",
  consumables: "CS",
  tyreProtect: "TP",
  // ATD and VD-2500/VD-5000 are handled via dedicated request fields, not flags.
};

export const ADDON_CODES_2W: Record<string, string> = {
  rsa: "RSA",
  zeroDep: "ZD",
  rti: "RTI",
  engineProtect: "EP",
  batteryProtect: "LDBP",
  keyProtect: "KP",
  tyreProtect: "TP",
  drivingAccessories: "DA",
  consumables: "CS",
};

// ─── Motor capability matrix (derived from product + addon code maps) ──────────
// Plan types come from which ProductCodes exist per line; add-ons come from the
// add-on code maps, intersected with the canonical actionable AddonKey set.

const VALID_ADDON_KEYS: ReadonlySet<string> = new Set(AddonKeySchema.options);

function policyTypesForLine(line: IciciVehicleLine): PolicyType[] {
  const set = new Set<PolicyType>();
  for (const key of Object.keys(PRODUCT_CODES)) {
    const parts = key.split("|");
    if (parts[0] === line && parts[2]) set.add(parts[2] as PolicyType);
  }
  return [...set];
}

function addonsFromCodes(codes: Record<string, string>): AddonKey[] {
  return Object.keys(codes).filter((k): k is AddonKey => VALID_ADDON_KEYS.has(k));
}

export const ICICI_MOTOR_CAPABILITIES: MotorCapabilities = {
  fourWheeler: { policyTypes: policyTypesForLine("fw"), addons: addonsFromCodes(ADDON_CODES_4W) },
  twoWheeler: { policyTypes: policyTypesForLine("tw"), addons: addonsFromCodes(ADDON_CODES_2W) },
};

// ─── Voluntary deductible ─────────────────────────────────────────────────────
// ICICI passes the voluntary deductible as an AddOns array entry (e.g. "VD-2500").
// Allowed amounts per the doc: 2500 / 5000 (and the wider PayURange-style set).
export const VOLUNTARY_DEDUCTIBLE_CODES: Record<number, string> = {
  2500: "VD-2500",
  5000: "VD-5000",
  7500: "VD-7500",
  10000: "VD-10000",
};

export function voluntaryDeductibleCode(amount: number | undefined): string | undefined {
  return amount ? VOLUNTARY_DEDUCTIBLE_CODES[amount] : undefined;
}

// ─── Bi-fuel (CNG/LPG) kit type ───────────────────────────────────────────────
// GasKitType numeric codes (Save-Quote field). GasKitSI mandatory for CNG/LPG.
export const GAS_KIT_TYPE = {
  NA: 0,
  CNG: 1,
  LPG: 2,
  FactoryFittedCNG: 3,
  FactoryFittedLPG: 4,
} as const;
export type BifuelKitType = keyof typeof GAS_KIT_TYPE;

// ─── IDV type ─────────────────────────────────────────────────────────────────

export const IDV_TYPE = { min: 1, max: 2, avg: 3 } as const;

// ─── Policy type for KYC PolicyType field ─────────────────────────────────────

export const KYC_POLICY_TYPE = { motor: 1, health: 2, travel: 3, sme: 5 } as const;

// ─── Previous policy type code ────────────────────────────────────────────────

export const PREV_POLICY_TYPE = { comprehensive: 1, thirdParty: 2 } as const;

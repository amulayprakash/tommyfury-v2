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

const PRODUCT_CODES: Record<string, number> = {
  // 2-Wheeler
  "tw|new|comprehensive|1": 10, // Brand New
  "tw|rollover|comprehensive|1": 13, // Roll Over
  "tw|renewal|comprehensive|1": 13,
  "tw|rollover|standAloneOD|1": 16, // Own Damage
  "tw|rollover|thirdParty|1": 24, // TP
  "tw|renewal|thirdParty|1": 24,
  "tw|rollover|comprehensive|2": 14,
  "tw|rollover|comprehensive|3": 15,
  // 4-Wheeler
  "fw|new|comprehensive|1": 20,
  "fw|rollover|comprehensive|1": 21,
  "fw|renewal|comprehensive|1": 21,
  "fw|rollover|standAloneOD|1": 22,
  "fw|rollover|thirdParty|1": 25,
  "fw|renewal|thirdParty|1": 25,
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

// ─── IDV type ─────────────────────────────────────────────────────────────────

export const IDV_TYPE = { min: 1, max: 2, avg: 3 } as const;

// ─── Policy type for KYC PolicyType field ─────────────────────────────────────

export const KYC_POLICY_TYPE = { motor: 1, health: 2, travel: 3, sme: 5 } as const;

// ─── Previous policy type code ────────────────────────────────────────────────

export const PREV_POLICY_TYPE = { comprehensive: 1, thirdParty: 2 } as const;

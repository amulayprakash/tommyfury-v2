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

// Only categories ICICI can ACTUALLY quote (i.e. has master data for). Commercial
// (PCV/GCV) is intentionally excluded until ICICI delivers the CV make/model/RTO master
// CSVs — the product codes + CV mapper scaffolding below are ready, but advertising a
// capability we have no data for makes ICICI return errors for every commercial request.
// Re-add "commercial"/"newCommercial" here once the CV master is imported.
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
export type IciciVehicleLine = "tw" | "fw" | "cv";

/** Commercial-vehicle product class (ICICI CV product master). */
export type IciciCvClass = "pcv" | "gcv" | "misc";

export interface IciciConfig {
  baseUrl: string;
  login: string;
  password: string;
  /**
   * AES key shared by ICICI, used to encrypt the plaintext password. When unset,
   * ICICI_PASSWORD is treated as ALREADY encrypted and sent verbatim — ICICI may
   * hand over a pre-encrypted password string to use directly (confirmed on UAT
   * for the "generic v1" login).
   */
  aesKey?: string;
  aesMode: string;
  credentialSetId: string;
}

/**
 * Reads ICICI config from env. Throws only when ICICI is enabled but
 * misconfigured — fixtures-based tests run without these set. ICICI_AES_KEY is
 * optional: omit it when ICICI_PASSWORD is already an encrypted value.
 */
export function loadIciciConfig(): IciciConfig {
  const missing: string[] = [];
  if (!env.ICICI_LOGIN) missing.push("ICICI_LOGIN");
  if (!env.ICICI_PASSWORD) missing.push("ICICI_PASSWORD");
  if (missing.length > 0) {
    throw new Error(`ICICI provider enabled but missing env: ${missing.join(", ")}`);
  }
  return {
    baseUrl: env.ICICI_BASE_URL.replace(/\/$/, ""),
    login: env.ICICI_LOGIN!,
    password: env.ICICI_PASSWORD!,
    aesKey: env.ICICI_AES_KEY || undefined,
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
  /** Commercial product class — required (and only used) when line === "cv". */
  cvClass?: IciciCvClass;
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
  // ── Commercial Vehicle (Generic 5 — Product Master) ──────────────────────────
  // CV keys carry the product class (pcv/gcv/misc) in the line segment.
  // ⚠️ The PDF Product Master table is column-garbled — these are a best-effort
  // mapping; confirm the exact PCV/GCV/MISC × comprehensive/TP/new codes with the
  // ICICI RM before go-live. (Code 47 "PCV-TP Roll Over" is unconfirmed; omitted.)
  // PCV — Passenger Carrying Vehicle
  "cv-pcv|rollover|comprehensive|1": 41, // PCV Roll Over (comprehensive)
  "cv-pcv|renewal|comprehensive|1": 41,
  "cv-pcv|rollover|thirdParty|1": 42, // PCV TP
  "cv-pcv|renewal|thirdParty|1": 42,
  "cv-pcv|new|comprehensive|1": 49, // PCV Brand New
  // GCV — Goods Carrying Vehicle
  "cv-gcv|rollover|comprehensive|1": 44, // GCV Roll Over (comprehensive)
  "cv-gcv|renewal|comprehensive|1": 44,
  "cv-gcv|rollover|thirdParty|1": 43, // GCV TP
  "cv-gcv|renewal|thirdParty|1": 43,
  "cv-gcv|new|comprehensive|1": 50, // GCV Brand New
  // MISC — Miscellaneous / special vehicles (TP-only per the master)
  "cv-misc|rollover|thirdParty|1": 48, // MISC TP
  "cv-misc|renewal|thirdParty|1": 48,
  "cv-misc|new|thirdParty|1": 40, // MISC TP Brand New
};

export function resolveProductCode(key: ProductKey): number | undefined {
  const line = key.line === "cv" ? `cv-${key.cvClass ?? "gcv"}` : key.line;
  const k = `${line}|${key.business}|${key.policyType}|${key.tenureYears}`;
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

// CV add-ons per the "Commercial Vehicle Generic 5" doc: RSA, ZD, EP, RTI, EME,
// CS, GC, LDBP (Battery Protect — EV only). EME (Emergency Medical Expense) has no
// canonical actionable AddonKey yet, so it is intentionally omitted here — it still
// surfaces in the raw response (see normalizer). batteryProtect (LDBP) applies to EVs.
export const ADDON_CODES_CV: Record<string, string> = {
  rsa: "RSA",
  zeroDep: "ZD",
  engineProtect: "EP",
  rti: "RTI",
  consumables: "CS",
  garageCash: "GC",
  batteryProtect: "LDBP",
};

// ─── Motor capability matrix (derived from product + addon code maps) ──────────
// Plan types come from which ProductCodes exist per line; add-ons come from the
// add-on code maps, intersected with the canonical actionable AddonKey set.

const VALID_ADDON_KEYS: ReadonlySet<string> = new Set(AddonKeySchema.options);

function policyTypesForLine(line: IciciVehicleLine): PolicyType[] {
  const set = new Set<PolicyType>();
  // CV product keys carry a "cv-<class>" prefix, so match on the line prefix.
  const matches = (segment: string | undefined) =>
    line === "cv" ? !!segment?.startsWith("cv") : segment === line;
  for (const key of Object.keys(PRODUCT_CODES)) {
    const parts = key.split("|");
    if (matches(parts[0]) && parts[2]) set.add(parts[2] as PolicyType);
  }
  return [...set];
}

function addonsFromCodes(codes: Record<string, string>): AddonKey[] {
  return Object.keys(codes).filter((k): k is AddonKey => VALID_ADDON_KEYS.has(k));
}

export const ICICI_MOTOR_CAPABILITIES: MotorCapabilities = {
  fourWheeler: { policyTypes: policyTypesForLine("fw"), addons: addonsFromCodes(ADDON_CODES_4W) },
  twoWheeler: { policyTypes: policyTypesForLine("tw"), addons: addonsFromCodes(ADDON_CODES_2W) },
  commercial: { policyTypes: policyTypesForLine("cv"), addons: addonsFromCodes(ADDON_CODES_CV) },
  newCommercial: { policyTypes: policyTypesForLine("cv"), addons: addonsFromCodes(ADDON_CODES_CV) },
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

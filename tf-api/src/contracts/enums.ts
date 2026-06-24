import { z } from "zod";

export const VehicleCategorySchema = z.enum([
  "fourWheeler",
  "twoWheeler",
  "commercial",
  "newVehicle",
  "newCommercial",
]);
export type VehicleCategory = z.infer<typeof VehicleCategorySchema>;

export const PolicyTypeSchema = z.enum(["comprehensive", "thirdParty", "standAloneOD"]);
export type PolicyType = z.infer<typeof PolicyTypeSchema>;

export const FuelTypeSchema = z.enum(["petrol", "diesel", "electric", "cng", "lpg", "hybrid"]);
export type FuelType = z.infer<typeof FuelTypeSchema>;

export const BusinessTypeSchema = z.enum(["new", "rollover", "renewal"]);
export type BusinessType = z.infer<typeof BusinessTypeSchema>;

export const QuoteStatusSchema = z.enum(["pending", "success", "no_quote", "error"]);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

/** Lifecycle operations a provider may support beyond the base quote. */
export const ProviderOperationSchema = z.enum([
  "quote",
  "retrieveQuote",
  "proposal",
  "ckyc",
  "ovd",
  "issuance",
  "renewal",
  "inspection",
  "policyStatus",
  "coi",
]);
export type ProviderOperation = z.infer<typeof ProviderOperationSchema>;

/** Mirrors ICICI policy status values (other vendors map onto this set). */
export const PolicyLifecycleStatusSchema = z.enum([
  "ISSUED",
  "IN_PROGRESS",
  "REJECTED",
  "INSPECTION_PENDING",
  "INSPECTION_REJECTED",
  "INSPECTION_APPROVED",
  "INSPECTION_CLOSED",
  "UNKNOWN",
]);
export type PolicyLifecycleStatus = z.infer<typeof PolicyLifecycleStatusSchema>;

/** KYC document types accepted by the OVD flow. */
export const OvdDocTypeSchema = z.enum(["AADHAAR", "PAN", "VOTER", "PASSPORT", "DL"]);
export type OvdDocType = z.infer<typeof OvdDocTypeSchema>;

// ─── Add-ons ───────────────────────────────────────────────────────────────────
// Canonical, *actionable* add-on keys — i.e. the boolean flags a quote request can
// actually toggle (see MotorQuoteRequestSchema). The per-provider capability matrix
// (see MotorCapabilities) declares which of these each vendor honours per category.
// Vendors expose more cover types internally; a cover is added here once it is wired
// into the quote request (the lower block was wired for ICICI Lombard).
export const AddonKeySchema = z.enum([
  "zeroDep",
  "engineProtect",
  "rsa",
  "tyreProtect",
  "rimProtect",
  "rti",
  "consumables",
  "paOwner",
  "paUnnamedPassenger",
  "legalLiabilityPaidDriver",
  // Wired for ICICI (see src/providers/icici/config.ts ADDON_CODES_*).
  "keyProtect",
  "garageCash",
  "lossOfBelongings",
  "batteryProtect",
  "drivingAccessories",
  "ncbProtection",
]);
export type AddonKey = z.infer<typeof AddonKeySchema>;

export interface AddonMeta {
  key: AddonKey;
  label: string;
}

/** Display metadata for the add-on selector, in presentation order. */
export const ADDON_METADATA: readonly AddonMeta[] = [
  { key: "zeroDep", label: "Zero Depreciation" },
  { key: "engineProtect", label: "Engine Protection Cover" },
  { key: "rsa", label: "Road Side Assistance (RSA)" },
  { key: "tyreProtect", label: "Tyre Protect" },
  { key: "rimProtect", label: "Rim Protect" },
  { key: "rti", label: "Return To Invoice" },
  { key: "consumables", label: "Consumables Cover" },
  { key: "paOwner", label: "Personal Accident (Owner-Driver)" },
  { key: "paUnnamedPassenger", label: "PA — Unnamed Passenger" },
  { key: "legalLiabilityPaidDriver", label: "Legal Liability to Paid Driver" },
  { key: "keyProtect", label: "Key & Lock Protect" },
  { key: "garageCash", label: "Garage Cash" },
  { key: "lossOfBelongings", label: "Loss of Personal Belongings" },
  { key: "batteryProtect", label: "Battery Protect" },
  { key: "drivingAccessories", label: "Driving Accessories" },
  { key: "ncbProtection", label: "NCB Protection" },
];

// ─── Per-provider motor capability matrix ───────────────────────────────────────
// Declares, per vehicle category, which plan types and add-ons a provider supports.
// Kept structured so per-vendor "sub-cases" can be encoded later without API churn.
export interface MotorCategoryCapability {
  policyTypes: PolicyType[];
  addons: AddonKey[];
}
export type MotorCapabilities = Partial<Record<VehicleCategory, MotorCategoryCapability>>;

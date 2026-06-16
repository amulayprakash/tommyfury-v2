/**
 * Clean aliases over the auto-generated tf-api types. Regenerate the source with
 * `npm run gen:api` whenever the backend OpenAPI changes.
 */
import type { components } from "@/lib/api/generated/vendor-api";

export type MotorQuoteRequest = components["schemas"]["MotorQuoteRequest"];
export type CompareQuotesRequest = components["schemas"]["CompareQuotesRequest"];
export type MotorFullQuoteRequest = components["schemas"]["MotorFullQuoteRequest"];
export type CanonicalQuote = components["schemas"]["CanonicalQuoteResult"];

export type ProvidersResponse = components["schemas"]["ProvidersResponse"];
export type ProviderInfo = ProvidersResponse["providers"][number];
export type MotorCapabilities = ProviderInfo["motorCapabilities"];
export type MotorCategoryCapability = NonNullable<MotorCapabilities["fourWheeler"]>;

export type CompareResponseData = components["schemas"]["CompareResponseData"];
export type CompareResult = CompareResponseData["results"][number];

export type CkycRequest = components["schemas"]["CkycRequest"];
export type KycResult = components["schemas"]["KycResult"];
export type PolicyStatusRequest = components["schemas"]["PolicyStatusRequest"];
export type PolicyStatusResult = components["schemas"]["PolicyStatusResult"];

export type VehicleCategory = MotorQuoteRequest["vehicleType"];
export type PolicyType = MotorQuoteRequest["selectedPolicy"];
export type BusinessType = MotorQuoteRequest["businessType"];
export type FuelType = MotorQuoteRequest["fuelType"];
export type AddonKey = MotorCategoryCapability["addons"][number];

/** tf-api wraps quote/compare responses in this envelope. */
export interface ApiEnvelope<T> {
  status: "success" | "error";
  message: string;
  requestId: string;
  response: T;
}

/** Categories the wizard currently supports (new/commercial journeys are deferred). */
export const SUPPORTED_CATEGORIES = ["twoWheeler", "fourWheeler"] as const;
export type SupportedCategory = (typeof SUPPORTED_CATEGORIES)[number];

export const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  comprehensive: "Comprehensive",
  thirdParty: "Third Party",
  standAloneOD: "Own Damage",
};

/** Short tab labels matching the legacy tp / od / comprehensive toggle. */
export const POLICY_TYPE_TABS: Record<PolicyType, string> = {
  thirdParty: "TP",
  standAloneOD: "OD",
  comprehensive: "Comprehensive",
};

export const ADDON_LABELS: Record<AddonKey, string> = {
  zeroDep: "Zero Depreciation",
  engineProtect: "Engine Protection",
  rsa: "Road Side Assistance",
  tyreProtect: "Tyre Protect",
  rimProtect: "Rim Protect",
  rti: "Return To Invoice",
  consumables: "Consumables Cover",
  paOwner: "Personal Accident (Owner)",
  paUnnamedPassenger: "PA — Unnamed Passenger",
  legalLiabilityPaidDriver: "Legal Liability to Paid Driver",
};

/** Every add-on key, in presentation order. */
export const ALL_ADDON_KEYS = Object.keys(ADDON_LABELS) as AddonKey[];

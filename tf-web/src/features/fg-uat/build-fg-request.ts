import type { AddonKey, CompareQuotesRequest } from "../vehicle/api/types";
import { ALL_ADDON_KEYS } from "../vehicle/api/types";
import type { FgConditions } from "./fg-uat-store";

/**
 * The canonical quote request for one set of certification conditions.
 *
 * Mirrors the customer wizard's `buildQuoteRequest`, but pinned to FG and always
 * asking for the raw exchange. Fields the harness captures for LATER steps
 * (engine/chassis number, break-in inspection evidence) have no place on the
 * quote contract and are carried in the store until the proposal needs them.
 *
 * It lives outside both pages because the review step must send CreateProposal
 * the very conditions the quote was priced under — FG re-rates from what it
 * receives, so a second, hand-built copy of this that drifted would quietly
 * change the premium.
 */
export function buildFgQuoteRequest(
  category: string,
  c: FgConditions,
  providerAddonCodes: string[],
): CompareQuotesRequest {
  // FG prices add-ons ONLY from its own cover codes (providerAddonCodes), so the
  // canonical flags all stay off — except the compulsory owner PA, which is the
  // contract's own default and is suppressed only by the stated condition (TC_06).
  const addonFlags = Object.fromEntries(
    ALL_ADDON_KEYS.map((key) => [key, key === "paOwner" && c.paOwner]),
  ) as Record<AddonKey, boolean>;

  return {
    vehicleType: category as CompareQuotesRequest["vehicleType"],
    selectedPolicy: c.planType as CompareQuotesRequest["selectedPolicy"],
    businessType: c.businessType,
    makeId: c.makeId,
    makeName: c.makeName,
    modelId: c.modelId,
    modelName: c.modelName,
    variantId: c.variantId,
    variantName: c.variantName,
    fuelType: c.fuelType as CompareQuotesRequest["fuelType"],
    // engineCC 0 (EVs) fails contract validation server-side — send it only when positive.
    engineCC: c.engineCC || undefined,
    rtoCode: c.rtoCode,
    registrationDate: c.registrationDate,
    registrationNumber: c.registrationNumber || undefined,
    previousPolicyNumber: c.previousPolicyNumber || undefined,
    previousInsurerName: c.previousInsurerName || undefined,
    previousPolicyStartDate: c.previousPolicyStartDate,
    previousPolicyExpiryDate: c.previousPolicyExpiryDate,
    isPreviousPolicyExpired: c.isPreviousPolicyExpired,
    claimInPreviousPolicy: c.claimInPreviousPolicy,
    ncbPercent: c.ncbPercent,
    // The harness sells an annual policy, like the wizard — long-term terms have no case.
    tenureYears: 1,
    // FG needs an ACTIVE third-party policy for standalone OD.
    ...(c.planType === "standAloneOD"
      ? {
          previousTpPolicyNumber: c.previousTpPolicyNumber,
          previousTpStartDate: c.previousTpStartDate,
          previousTpExpiryDate: c.previousTpExpiryDate,
        }
      : {}),
    ...(c.idvValue ? { idvValue: c.idvValue } : {}),
    ...(c.seatingCapacity ? { seatingCapacity: c.seatingCapacity } : {}),
    ...(c.commercialSubType ? { commercialSubType: c.commercialSubType } : {}),
    ...(c.grossVehicleWeight ? { grossVehicleWeight: c.grossVehicleWeight } : {}),
    ...(c.carryingCapacity ? { carryingCapacity: c.carryingCapacity } : {}),
    ...(providerAddonCodes.length ? { providerAddonCodes } : {}),
    // The backend echoes `_rawResponse` only when this is set AND
    // ENABLE_DEBUG_PAYLOAD is on in its env — an empty drawer means that env var.
    includeRawExchange: true,
    ...addonFlags,
  };
}

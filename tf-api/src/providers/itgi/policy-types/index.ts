import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import type { ItgiPolicyPath } from "./types.ts";

export type { ItgiPolicyPath } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A break-in exists when the previous policy has already expired. */
export function isBreakIn(req: MotorQuoteRequest, asOf = new Date()): boolean {
  if (req.businessType === "new") return false;
  if (req.isPreviousPolicyExpired) return true;
  if (!req.previousPolicyExpiryDate) return false;
  return new Date(req.previousPolicyExpiryDate).getTime() < asOf.getTime();
}

function daysSinceExpiry(req: MotorQuoteRequest, asOf: Date): number {
  if (!req.previousPolicyExpiryDate) return 0;
  return Math.floor((asOf.getTime() - new Date(req.previousPolicyExpiryDate).getTime()) / DAY_MS);
}

/**
 * Resolves the canonical request onto ITGI's policy vocabulary.
 *
 * Note the two shape mismatches with our canonical model: a new vehicle is a
 * VehicleCategory (not a PolicyType), and break-in is a *modifier* that composes
 * onto whichever base path applies rather than a path of its own.
 */
export function selectPolicyPath(req: MotorQuoteRequest, asOf = new Date()): ItgiPolicyPath {
  const isNewVehicle = req.vehicleType === "newVehicle" || req.businessType === "new";
  const breakIn = !isNewVehicle && isBreakIn(req, asOf);

  const base: ItgiPolicyPath = {
    zcover: "CO",
    policyType: "CP",
    requiresTpPolicyDetails: false,
    usesNewVehicleEndpoint: false,
    breakIn,
    breakInMoreThan90Days: breakIn && daysSinceExpiry(req, asOf) > 90 ? "Y" : "N",
    // Break-in inception is read as date+3 when ITGI inspects at their end.
    inceptionOffsetDays: breakIn ? 3 : 0,
  };

  if (isNewVehicle) {
    return { ...base, policyType: "BP", newVehicleFlag: "Y", usesNewVehicleEndpoint: true };
  }
  if (req.selectedPolicy === "thirdParty") {
    return { ...base, zcover: "AC", policyType: "TP", idvSumInsuredOverride: 1 };
  }
  if (req.selectedPolicy === "standAloneOD") {
    return { ...base, policyType: "OD", requiresTpPolicyDetails: true };
  }
  return base;
}

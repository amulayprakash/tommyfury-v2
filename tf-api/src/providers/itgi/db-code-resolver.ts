import {
  getProviderMmvCode,
  getProviderRtoCode,
  getProviderInsurerCode,
} from "@/repositories/master.repository.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import { ItgiUnmappedCodeError } from "./errors.ts";
import { ITGI_SLUG } from "./config.ts";

export interface ItgiCodes {
  /** ITGI's 5–6 char MAKE variant code (e.g. MRSFT) — the only MMV join key. */
  makeCode: string;
  /** ITGI's rtoCity token. Never derived: strictly from ProviderRtoCode. */
  rtoCity: string;
  engineCC?: number;
  seatingCapacity?: number;
  previousInsurerCode?: string;
}

export type ItgiCodeResolver = (req: MotorQuoteRequest) => Promise<ItgiCodes>;

/** Canonical vehicle category → the line ProviderRtoCode is partitioned by. */
function rtoLine(category: string): "tw" | "fw" {
  return category === "twoWheeler" ? "tw" : "fw";
}

/**
 * Production resolver.
 *
 * ITGI's MMV identity is a single variant code (the master's MAKE column); the
 * import stores it as `providerModelCode` with the manufacturer in
 * `providerMakeCode` (the shared repository helper requires both to be set).
 *
 * RTO resolution is STRICT by design: the vendor kit ships no RTO master, so an
 * unmapped RTO fails closed with ItgiUnmappedCodeError (surfaced as no_quote)
 * rather than guessing a token from the canonical city name. Importing the real
 * master later needs no code change here.
 */
export const itgiDbCodeResolver: ItgiCodeResolver = async (req) => {
  const mmv = await getProviderMmvCode(
    ITGI_SLUG,
    req.makeId,
    req.modelId,
    req.fuelType,
    req.variantId,
  );
  const makeCode = mmv?.modelCode ?? mmv?.makeCode;
  if (!makeCode) {
    throw new ItgiUnmappedCodeError("vehicle", `${req.makeName} ${req.modelName}`);
  }

  const rtoCity = await getProviderRtoCode(ITGI_SLUG, req.rtoCode, rtoLine(req.vehicleType));
  if (!rtoCity) {
    throw new ItgiUnmappedCodeError("RTO", req.rtoCode);
  }

  const previousInsurerCode = req.previousInsurerId
    ? await getProviderInsurerCode(ITGI_SLUG, req.previousInsurerId)
    : undefined;

  return {
    makeCode,
    rtoCity,
    engineCC: req.engineCC,
    seatingCapacity: req.seatingCapacity,
    previousInsurerCode,
  };
};

/** Dev/fixture resolver — passes canonical values straight through. */
export const passthroughItgiCodeResolver: ItgiCodeResolver = async (req) => ({
  makeCode: req.modelId,
  rtoCity: req.rtoCode,
  engineCC: req.engineCC,
  seatingCapacity: req.seatingCapacity,
  previousInsurerCode: req.previousInsurerId,
});

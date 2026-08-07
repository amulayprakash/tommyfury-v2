import { NotFoundError } from "@/errors/app-error.ts";
import {
  getProviderMmvCode,
  getProviderRtoCode,
  getProviderInsurerCode,
} from "@/repositories/master.repository.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import { HDFC_SLUG } from "./config.ts";
import type { HdfcResolvedCodes } from "./types.ts";

export type HdfcCodeResolver = (req: MotorQuoteRequest) => Promise<HdfcResolvedCodes>;

/** Dev/fixtures resolver: canonical ids are already the HDFC codes. */
export const passthroughCodeResolver: HdfcCodeResolver = async (req) => ({
  modelCode: String(req.modelId),
  rtoCode: String(req.rtoCode),
  previousInsurerCode: req.previousInsurerId,
});

/**
 * Production resolver. A vehicle or RTO HDFC has not onboarded fails closed with
 * a readable NotFound (surfacing as no_quote on the compare page) rather than
 * being priced against a guessed code.
 */
export const dbCodeResolver: HdfcCodeResolver = async (req) => {
  const mmv = await getProviderMmvCode(
    HDFC_SLUG,
    req.makeId,
    req.modelId,
    req.fuelType,
    req.variantId,
  );
  if (!mmv?.modelCode) {
    throw new NotFoundError(`HDFC vehicle-code mapping for ${req.makeName} ${req.modelName}`);
  }

  // HDFC is Private Car only, so the RTO code is always resolved for the "fw"
  // line the import wrote.
  const rtoCode = await getProviderRtoCode(HDFC_SLUG, req.rtoCode, "fw");
  if (!rtoCode) {
    throw new NotFoundError(`HDFC RTO-code mapping for "${req.rtoCode}" (fw)`);
  }

  // HDFC only accepts previous-insurer codes from its own master:
  // "OTHERS" fails with "No Data found for given previous insured code".
  // Undefined is correct when nothing was mapped — never substitute a default.
  const previousInsurerCode = req.previousInsurerId
    ? await getProviderInsurerCode(HDFC_SLUG, req.previousInsurerId)
    : undefined;

  return { modelCode: String(mmv.modelCode), rtoCode: String(rtoCode), previousInsurerCode };
};

import { NotFoundError } from "@/errors/app-error.ts";
import {
  getProviderMmvCode,
  getProviderRtoCode,
  getProviderInsurerCode,
} from "@/repositories/master.repository.ts";
import { ICICI_SLUG } from "./config.ts";
import type { IciciCodeResolver } from "./icici.provider.ts";

/**
 * Production resolver — maps canonical IDs to ICICI's numeric master codes via
 * the provider code-mapping tables. Throws a clear 404 when a mapping is absent
 * (a vehicle/RTO ICICI hasn't onboarded can't be quoted).
 */
export const dbCodeResolver: IciciCodeResolver = async (req) => {
  const mmv = await getProviderMmvCode(
    ICICI_SLUG,
    req.makeId,
    req.modelId,
    req.fuelType,
    req.variantId,
  );
  if (!mmv?.makeCode || !mmv.modelCode) {
    throw new NotFoundError(`ICICI vehicle-code mapping for ${req.makeName} ${req.modelName}`);
  }

  const rtoCode = await getProviderRtoCode(ICICI_SLUG, req.rtoCode);
  if (!rtoCode) {
    throw new NotFoundError(`ICICI RTO-code mapping for "${req.rtoCode}"`);
  }

  const previousInsurerCode = req.previousInsurerId
    ? await getProviderInsurerCode(ICICI_SLUG, req.previousInsurerId)
    : undefined;

  return {
    makeCode: Number(mmv.makeCode),
    modelCode: Number(mmv.modelCode),
    rtoCode: Number(rtoCode),
    previousInsurerCode,
  };
};

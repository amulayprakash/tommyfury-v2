import { NotFoundError } from "@/errors/app-error.ts";
import {
  findMmvRow,
  getRtoByCode,
  findFgInsurerCodeByName,
} from "@/repositories/master.repository.ts";
import type { FgCodeResolver } from "./fg.provider.ts";

/**
 * Production resolver — FG is the master data source, so MmvMaster already holds
 * the FG Make (makeName) and ModelCode (modelId = PASIA_CODE) plus body/CC/GVW/
 * seating used to build the quote. Zone comes from the RTO master (derived at
 * seed time: metro → A, else B). The RTO code itself is passed through verbatim.
 */
export const dbCodeResolver: FgCodeResolver = async (req) => {
  const mmv = await findMmvRow(req.makeId, req.modelId);
  if (!mmv) {
    throw new NotFoundError(`FG vehicle "${req.makeName} ${req.modelName}" (${req.modelId})`);
  }

  const rto = await getRtoByCode(req.rtoCode);
  if (!rto) {
    throw new NotFoundError(`FG RTO "${req.rtoCode}"`);
  }

  const previousInsurerCode = req.previousInsurerName
    ? await findFgInsurerCodeByName(req.previousInsurerName)
    : undefined;

  return {
    previousInsurerCode,
    make: mmv.makeName,
    modelCode: mmv.modelId,
    rtoCode: rto.code,
    zone: rto.zone ?? "B",
    bodyType: mmv.bodyType ?? undefined,
    engineCC: mmv.engineCC ?? undefined,
    gvw: mmv.gvw ?? undefined,
    seatingCapacity: mmv.seatingCapacity ?? undefined,
    carryingCapacity: mmv.carryingCapacity ?? undefined,
    // FG VehicleClass code = the prefix of VEHICLE_TYPE ("A1-Goods Carrying…" → "A1").
    vehicleClass: mmv.vehicleType?.split("-")[0]?.trim() || undefined,
  };
};

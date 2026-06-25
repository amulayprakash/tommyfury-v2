/**
 * Shared definition of the portable data snapshot.
 *
 * Lists every master / reference table whose contents the app needs at runtime
 * (RTO + MMV + insurer + add-on + pincode + occupation + health masters and
 * their provider-code mappings, plus the provider registry). Transactional
 * tables (`quotes`, `health_quotes`) are intentionally excluded.
 *
 * The order is FK-safe: parents come before the child tables that reference
 * them, so `import-data.ts` can insert top-to-bottom and delete bottom-to-top.
 */
import type { PrismaClient } from "@prisma/client";

/** A snapshot table: its JSON key + the matching Prisma model delegate name. */
export interface SnapshotTable {
  /** Key used in the JSON file. */
  key: string;
  /** PrismaClient property for the model (e.g. "mmvMaster"). */
  model:
    | "provider"
    | "rtoMaster"
    | "providerRtoCode"
    | "mmvMaster"
    | "providerMmvCode"
    | "insurerMaster"
    | "providerInsurerCode"
    | "motorAddon"
    | "pincodeMaster"
    | "occupationMaster"
    | "healthProductMaster"
    | "healthCoverMaster"
    | "healthOccupationMaster"
    | "healthRelationMaster";
}

// Parents first, children last (see import/delete ordering above).
export const SNAPSHOT_TABLES: SnapshotTable[] = [
  { key: "providers", model: "provider" },
  { key: "rtoMaster", model: "rtoMaster" },
  { key: "mmvMaster", model: "mmvMaster" },
  { key: "insurerMaster", model: "insurerMaster" },
  { key: "providerRtoCodes", model: "providerRtoCode" },
  { key: "providerMmvCodes", model: "providerMmvCode" },
  { key: "providerInsurerCodes", model: "providerInsurerCode" },
  { key: "motorAddons", model: "motorAddon" },
  { key: "pincodeMaster", model: "pincodeMaster" },
  { key: "occupationMaster", model: "occupationMaster" },
  { key: "healthProductMaster", model: "healthProductMaster" },
  { key: "healthCoverMaster", model: "healthCoverMaster" },
  { key: "healthOccupationMaster", model: "healthOccupationMaster" },
  { key: "healthRelationMaster", model: "healthRelationMaster" },
];

export interface Snapshot {
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
}

/** Path to the snapshot file, relative to the tf-api project root. */
export const SNAPSHOT_PATH = "prisma/data-snapshot.json";

/** Helper to grab a model delegate off the client by name. */
export function delegate(prisma: PrismaClient, model: SnapshotTable["model"]) {
  // The delegates share the findMany/createMany/deleteMany shape we use.
  return prisma[model] as unknown as {
    findMany: (args?: unknown) => Promise<Record<string, unknown>[]>;
    createMany: (args: { data: unknown[] }) => Promise<{ count: number }>;
    deleteMany: (args?: unknown) => Promise<{ count: number }>;
  };
}

/**
 * Imports IFFCO-Tokio (ITGI) master data using the aggregator CROSS-WALK model:
 * ITGI codes are attached to the SAME canonical rows (MmvMaster) the UI selects
 * from, via ProviderMmvCode(providerSlug="itgi").
 *
 *   npm run db:import:itgi
 *
 * Source: the vendor kit's "ITGI_Motor Data_Updated_01032024.xlsx" MAKE sheet
 * (~16.7k rows). ITGI's MMV identity is a SINGLE variant code (the MAKE column,
 * e.g. "MRSFT"); there is no separate make/model code. The shared repository
 * helper requires both providerMakeCode and providerModelCode to be set, so we
 * store the manufacturer in providerMakeCode and the ITGI variant code in
 * providerModelCode (which is what db-code-resolver reads back).
 *
 * RTO: deliberately NOT imported. The vendor kit ships no RTO master, so there
 * is nothing to cross-walk. ITGI quotes fail closed (no_quote) until ITGI
 * supplies it — see docs/itgi-integration-notes.md §8. Writing guessed tokens
 * into the shared production master tables is not acceptable.
 *
 * Idempotent + partition-scoped: upserts only the itgi partition, never deletes
 * another provider's codes.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type * as XLSXType from "xlsx";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof XLSXType;

const prisma = new PrismaClient();
export const ITGI_IMPORT_SLUG = "itgi";

const BASE_DIR =
  process.env.ITGI_MASTER_DIR ??
  "C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/itgi kit/ITGI_PARTNER_MOTOR_INTEGRATION_KIT_v4.0/ITGI_PARTNER_MOTOR_INTEGRATION_KIT_v4.0/Master Data";
const MAKE_FILE = "ITGI_Motor Data_Updated_01032024.xlsx";

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────────

/**
 * ITGI's fuel labels are inconsistent across rows (BATTERY vs Electric, HYBRID
 * vs Hybrid Electric, "Petrol + CNG"). Normalize onto our canonical FuelType.
 */
export function normalizeItgiFuel(raw: string): string {
  const f = raw.trim().toLowerCase();
  if (f.includes("hybrid")) return "hybrid";
  if (f.includes("battery") || f.includes("electric")) return "electric";
  if (f.includes("cng")) return "cng";
  if (f.includes("lpg")) return "lpg";
  if (f.includes("diesel")) return "diesel";
  return "petrol";
}

/** ITGI CONTRACT_TYPE → our vehicle line. */
export function toItgiLine(contractType: string): "fw" | "tw" {
  return contractType.trim().toUpperCase() === "TWP" ? "tw" : "fw";
}

export interface ItgiMakeRow {
  variantCode: string;
  make: string;
  model: string;
  variant: string;
  engineCC: number;
  seatingCapacity: number;
  fuelType: string;
  line: "fw" | "tw";
}

export function parseMakeRow(row: Record<string, unknown>): ItgiMakeRow | null {
  const variantCode = String(row.MAKE ?? "").trim();
  if (!variantCode) return null;
  return {
    variantCode,
    make: String(row.MANUFACTURE ?? "").trim(),
    model: String(row.MODEL ?? "").trim(),
    variant: String(row.VARIANT ?? "").trim(),
    engineCC: Number(row.CC ?? 0) || 0,
    seatingCapacity: Number(row.SEATING_CAPACITY ?? 0) || 0,
    fuelType: normalizeItgiFuel(String(row.FUEL_TYPE ?? "")),
    line: toItgiLine(String(row.CONTRACT_TYPE ?? "")),
  };
}

/** Normalizes a make/model string for fuzzy cross-walk matching. */
export function normalizeName(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]/g, "");
}

// ─── Import ───────────────────────────────────────────────────────────────────

async function chunked<T>(
  label: string,
  rows: T[],
  toOp: (row: T) => Prisma.PrismaPromise<unknown>,
  size = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await prisma.$transaction(rows.slice(i, i + size).map(toOp));
  }
  console.log(`  ${label}: ${rows.length}`);
}

async function main(): Promise<void> {
  const path = `${BASE_DIR}/${MAKE_FILE}`;
  if (!existsSync(path)) {
    console.error(`ITGI master workbook not found at:\n  ${path}`);
    console.error("Set ITGI_MASTER_DIR to the kit's 'Master Data' folder.");
    process.exit(1);
  }

  console.log("Reading ITGI MAKE sheet…");
  const wb = XLSX.readFile(path);
  const sheet = wb.Sheets["MAKE"];
  if (!sheet) {
    console.error(`The workbook has no "MAKE" sheet (found: ${wb.SheetNames.join(", ")})`);
    process.exit(1);
  }

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  const rows = raw.map(parseMakeRow).filter((r): r is ItgiMakeRow => r !== null);
  console.log(`  parsed ${rows.length} ITGI variants (skipped ${raw.length - rows.length})`);

  // Index the canonical catalog by normalized make+model+fuel for cross-walk.
  const canonical = await prisma.mmvMaster.findMany({
    select: { id: true, makeName: true, modelName: true, fuelType: true },
  });
  const index = new Map<string, number>();
  for (const c of canonical) {
    index.set(`${normalizeName(c.makeName)}|${normalizeName(c.modelName)}|${c.fuelType}`, c.id);
  }

  const codes: { mmvId: number; makeCode: string; modelCode: string }[] = [];
  const unmatched: string[] = [];
  for (const r of rows) {
    const mmvId = index.get(`${normalizeName(r.make)}|${normalizeName(r.model)}|${r.fuelType}`);
    if (!mmvId) {
      unmatched.push(`${r.make} ${r.model} (${r.fuelType})`);
      continue;
    }
    // Last writer wins per canonical row; ITGI is variant-grained while our
    // provider codes are model-grained, so siblings collapse onto one code.
    codes.push({ mmvId, makeCode: r.make, modelCode: r.variantCode });
  }

  const deduped = [...new Map(codes.map((c) => [c.mmvId, c])).values()];
  console.log(`Cross-walk: ${deduped.length} canonical rows matched, ${unmatched.length} ITGI rows unmatched`);

  await chunked("ProviderMmvCode(itgi)", deduped, (c) =>
    prisma.providerMmvCode.upsert({
      where: { providerSlug_mmvId: { providerSlug: ITGI_IMPORT_SLUG, mmvId: c.mmvId } },
      create: {
        providerSlug: ITGI_IMPORT_SLUG,
        mmvId: c.mmvId,
        providerMakeCode: c.makeCode,
        providerModelCode: c.modelCode,
      },
      update: { providerMakeCode: c.makeCode, providerModelCode: c.modelCode },
    }),
  );

  console.log("");
  console.log("⚠ RTO codes were NOT imported: the ITGI kit ships no RTO master.");
  console.log("  ITGI quotes will return no_quote until ProviderRtoCode(itgi) is populated.");
  console.log("  See tf-api/docs/itgi-integration-notes.md §8 (blocker 3).");

  if (unmatched.length) {
    console.log("");
    console.log(`Sample unmatched ITGI vehicles (${Math.min(10, unmatched.length)} of ${unmatched.length}):`);
    for (const u of unmatched.slice(0, 10)) console.log(`  - ${u}`);
  }
}

// Only run when invoked directly, so the pure helpers stay unit-testable.
if (process.argv[1]?.includes("import-itgi-master")) {
  main()
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => void prisma.$disconnect());
}

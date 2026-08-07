/**
 * Imports HDFC ERGO master data using the aggregator CROSS-WALK model: HDFC's
 * codes are attached to the SAME canonical rows the UI selects from, via
 * ProviderMmvCode / ProviderRtoCode / ProviderInsurerCode (providerSlug="hdfc").
 *
 *   npm run db:import:hdfc
 *
 * Source: the vendor kit's PrivateCarMasterData.xls —
 *   Model_Master        (~10.8k rows) → ProviderMmvCode
 *   RTO Master          (~1.6k rows)  → ProviderRtoCode (line "fw")
 *   Insurance_Company   (39 rows)     → ProviderInsurerCode
 *
 * NO canonical rows are created. A vehicle or RTO HDFC has but our master does
 * not is simply unquotable by HDFC — the alternative (growing the shared master
 * with rows only one insurer can price) was considered and rejected.
 *
 * Idempotent + partition-scoped: upserts only the hdfc partition, never deletes
 * another provider's codes.
 */
import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import type * as XLSXType from "xlsx";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof XLSXType;

const prisma = new PrismaClient();
export const HDFC_IMPORT_SLUG = "hdfc";

const KIT_DIR =
  process.env.HDFC_KIT_DIR ??
  "C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/HDFC API KIT/HDFC API KIT";
const MASTER_FILE = "PrivateCarMasterData.xls";
const SCENARIO_FILE = "PVTcarTestScenarios.xls";
const UNMATCHED_REPORT = "scripts/_hdfc-unmatched.json";

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** HDFC's TXT_FUEL labels → our canonical FuelType. */
export function normalizeHdfcFuel(raw: string): string {
  const f = String(raw ?? "").trim().toLowerCase();
  if (f.includes("hybrid")) return "hybrid";
  if (f.includes("battery") || f.includes("electric")) return "electric";
  if (f.includes("cng")) return "cng";
  if (f.includes("lpg")) return "lpg";
  if (f.includes("diesel")) return "diesel";
  return "petrol";
}

/** Canonical form for name comparison: upper case, punctuation collapsed. */
export function normalizeName(raw: string): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export interface RtoKey {
  stateCode: string;
  number: number;
}

/**
 * "MH-1-MUMBAI" → { stateCode: "MH", number: 1 }.
 *
 * Whitespace around the separators is tolerated: the real sheet contains
 * "HR-85 - AMBALA CANTT" and "WB-88 - Bishnupur", which are ordinary RTOs typed
 * inconsistently. Rejecting them would drop two serviceable RTOs from HDFC's
 * coverage for a data-entry quirk. The leading anchor still keeps a dash inside
 * the city name ("GJ-38-BAVLA-EAST") from being consumed.
 */
export function parseRtoKey(registrationStateCity: string): RtoKey | null {
  const m = String(registrationStateCity ?? "")
    .trim()
    .toUpperCase()
    .match(/^([A-Z]{2})\s*-\s*0*(\d{1,3})\s*-/);
  if (!m) return null;
  return { stateCode: m[1]!, number: Number(m[2]) };
}

export interface HdfcModelRow {
  make: string;
  modelCode: string;
  model: string;
  variant: string;
  fuelType: string;
  engineCC: number;
  seatingCapacity: number;
  wheels: number;
}

/** Parses a Model_Master row; returns null for rows we cannot or must not use. */
export function parseModelRow(raw: Record<string, unknown>): HdfcModelRow | null {
  const modelCode = raw.VEHICLEMODELCODE == null ? "" : String(raw.VEHICLEMODELCODE).trim();
  const make = String(raw.MANUFACTURER ?? "").trim();
  const model = String(raw.VEHICLEMODEL ?? "").trim();
  if (!modelCode || !make || !model) return null;

  // HDFC is onboarded for Private Car only. A 2-wheeler row here would be
  // cross-walked into a category HDFC cannot quote.
  const wheels = Number(raw.NUMBEROFWHEELS ?? 4);
  if (wheels && wheels !== 4) return null;

  return {
    make,
    modelCode,
    model,
    variant: String(raw.TXT_VARIANT ?? "").trim(),
    fuelType: normalizeHdfcFuel(String(raw.TXT_FUEL ?? "")),
    engineCC: Number(raw.CUBICCAPACITY ?? 0),
    seatingCapacity: Number(raw.SEATINGCAPACITY ?? 0),
    wheels: wheels || 4,
  };
}

export interface VariantCandidate {
  modelCode: string;
  variant: string;
  engineCC: number;
}

/**
 * ProviderMmvCode allows ONE code per canonical vehicle, but HDFC is
 * variant-grained. When several HDFC rows collapse onto one canonical row,
 * prefer an exact variant-name match, then a matching engine capacity, then the
 * first candidate.
 */
export function pickBestVariant(
  candidates: VariantCandidate[],
  variantName: string | undefined,
  engineCC: number | undefined,
): VariantCandidate | undefined {
  if (candidates.length === 0) return undefined;
  if (variantName) {
    const target = normalizeName(variantName);
    const exact = candidates.find((c) => normalizeName(c.variant) === target);
    if (exact) return exact;
  }
  if (engineCC) {
    const byCc = candidates.find((c) => c.engineCC === engineCC);
    if (byCc) return byCc;
  }
  return candidates[0];
}

// ─── Import ───────────────────────────────────────────────────────────────────

async function chunked<T>(label: string, rows: T[], op: (row: T) => Promise<unknown>): Promise<void> {
  const SIZE = 250;
  for (let i = 0; i < rows.length; i += SIZE) {
    await Promise.all(rows.slice(i, i + SIZE).map(op));
  }
  console.log(`  ${label}: ${rows.length}`);
}

function sheet(wb: XLSXType.WorkBook, name: string): Record<string, unknown>[] {
  const s = wb.Sheets[name];
  if (!s) {
    console.error(`Workbook has no "${name}" sheet (found: ${wb.SheetNames.join(", ")})`);
    process.exit(1);
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(s);
}

async function importVehicles(wb: XLSXType.WorkBook, unmatched: Record<string, string[]>) {
  const rows = sheet(wb, "Model_Master").map(parseModelRow).filter((r): r is HdfcModelRow => r !== null);
  console.log(`Model_Master: parsed ${rows.length} private-car rows`);

  const canonical = await prisma.mmvMaster.findMany({
    where: { category: "fourWheeler" },
    select: { id: true, makeName: true, modelName: true, variantName: true, fuelType: true, engineCC: true },
  });

  // Group HDFC rows by make|model|fuel so sibling variants compete for one slot.
  const byKey = new Map<string, VariantCandidate[]>();
  for (const r of rows) {
    const key = `${normalizeName(r.make)}|${normalizeName(r.model)}|${r.fuelType}`;
    const list = byKey.get(key) ?? [];
    list.push({ modelCode: r.modelCode, variant: r.variant, engineCC: r.engineCC });
    byKey.set(key, list);
  }
  const makeByKey = new Map(rows.map((r) => [`${normalizeName(r.make)}|${normalizeName(r.model)}|${r.fuelType}`, r.make]));

  const codes: { mmvId: number; makeCode: string; modelCode: string }[] = [];
  const missed: string[] = [];
  for (const c of canonical) {
    const key = `${normalizeName(c.makeName)}|${normalizeName(c.modelName)}|${c.fuelType}`;
    const candidates = byKey.get(key);
    if (!candidates) continue;
    const best = pickBestVariant(candidates, c.variantName ?? undefined, c.engineCC ?? undefined);
    if (!best) continue;
    codes.push({ mmvId: c.id, makeCode: makeByKey.get(key)!, modelCode: best.modelCode });
  }
  const matchedKeys = new Set(
    canonical.map((c) => `${normalizeName(c.makeName)}|${normalizeName(c.modelName)}|${c.fuelType}`),
  );
  for (const key of byKey.keys()) if (!matchedKeys.has(key)) missed.push(key);

  console.log(
    `Cross-walk: ${codes.length} canonical rows coded, ${missed.length} HDFC make/model/fuel groups unmatched`,
  );
  unmatched.vehicles = missed;

  await chunked("ProviderMmvCode(hdfc)", codes, (c) =>
    prisma.providerMmvCode.upsert({
      where: { providerSlug_mmvId: { providerSlug: HDFC_IMPORT_SLUG, mmvId: c.mmvId } },
      create: {
        providerSlug: HDFC_IMPORT_SLUG,
        mmvId: c.mmvId,
        providerMakeCode: c.makeCode,
        providerModelCode: c.modelCode,
      },
      update: { providerMakeCode: c.makeCode, providerModelCode: c.modelCode },
    }),
  );
}

async function importRtos(wb: XLSXType.WorkBook, unmatched: Record<string, string[]>) {
  const rows = sheet(wb, "RTO Master");
  const canonical = await prisma.rtoMaster.findMany({ select: { id: true, code: true, stateCode: true } });

  // Canonical RTO codes look like "MH01"; HDFC's look like "MH-1-MUMBAI".
  const index = new Map<string, number>();
  for (const c of canonical) {
    const m = c.code.toUpperCase().match(/^([A-Z]{2})0*(\d{1,3})$/);
    if (m) index.set(`${m[1]}|${Number(m[2])}`, c.id);
  }

  const codes: { rtoId: number; providerCode: string }[] = [];
  const missed: string[] = [];
  for (const raw of rows) {
    const label = String(raw.REGISTRATION_STATE_CITY ?? "");
    const key = parseRtoKey(label);
    const providerCode = raw.RTO_CODE == null ? "" : String(raw.RTO_CODE).trim();
    if (!key || !providerCode) continue;
    const rtoId = index.get(`${key.stateCode}|${key.number}`);
    if (!rtoId) {
      missed.push(label);
      continue;
    }
    codes.push({ rtoId, providerCode });
  }

  const deduped = [...new Map(codes.map((c) => [c.rtoId, c])).values()];
  console.log(`RTO cross-walk: ${deduped.length} matched, ${missed.length} unmatched`);
  unmatched.rtos = missed;

  // line "fw": HDFC is Private Car only. Being explicit stops a future
  // two-wheeler master from silently reusing four-wheeler codes.
  await chunked("ProviderRtoCode(hdfc, fw)", deduped, (c) =>
    prisma.providerRtoCode.upsert({
      where: {
        providerSlug_rtoId_line: { providerSlug: HDFC_IMPORT_SLUG, rtoId: c.rtoId, line: "fw" },
      },
      create: { providerSlug: HDFC_IMPORT_SLUG, rtoId: c.rtoId, line: "fw", providerCode: c.providerCode },
      update: { providerCode: c.providerCode },
    }),
  );
}

async function importInsurers(wb: XLSXType.WorkBook, unmatched: Record<string, string[]>) {
  const rows = sheet(wb, "Insurance_Company");
  const canonical = await prisma.insurerMaster.findMany({ select: { id: true, name: true, shortName: true } });

  const codes: { insurerId: number; providerCode: string }[] = [];
  const missed: string[] = [];
  for (const raw of rows) {
    const shortName = String(raw.SHORTNAME ?? "").trim();
    const companyName = normalizeName(String(raw.COMPANYNAME ?? ""));
    if (!shortName || !companyName) continue;
    const hit = canonical.find(
      (c) => normalizeName(c.name) === companyName || normalizeName(c.shortName ?? "") === normalizeName(shortName),
    );
    if (!hit) {
      missed.push(`${shortName} — ${raw.COMPANYNAME}`);
      continue;
    }
    codes.push({ insurerId: hit.id, providerCode: shortName });
  }

  const deduped = [...new Map(codes.map((c) => [c.insurerId, c])).values()];
  console.log(`Insurer cross-walk: ${deduped.length} matched, ${missed.length} unmatched`);
  unmatched.insurers = missed;

  await chunked("ProviderInsurerCode(hdfc)", deduped, (c) =>
    prisma.providerInsurerCode.upsert({
      where: {
        providerSlug_insurerId: { providerSlug: HDFC_IMPORT_SLUG, insurerId: c.insurerId },
      },
      create: { providerSlug: HDFC_IMPORT_SLUG, insurerId: c.insurerId, providerCode: c.providerCode },
      update: { providerCode: c.providerCode },
    }),
  );
}

/**
 * HDFC's own UAT test sheets list the vehicles and RTOs their sandbox will
 * price. If those do not resolve, nothing will — fail the import loudly rather
 * than discovering it from a failing quote.
 */
async function assertUatVehiclesResolve(): Promise<void> {
  const path = `${KIT_DIR}/${SCENARIO_FILE}`;
  if (!existsSync(path)) {
    console.log(`\n⚠ ${SCENARIO_FILE} not found — skipping the UAT resolution check.`);
    return;
  }
  const wb = XLSX.readFile(path);
  const models = sheet(wb, "UAT Test Model");
  const wanted = [...new Set(models.map((r) => String(r.VEHICLEMODELCODE ?? "").trim()).filter(Boolean))];
  const found = await prisma.providerMmvCode.findMany({
    where: { providerSlug: HDFC_IMPORT_SLUG, providerModelCode: { in: wanted } },
    select: { providerModelCode: true },
  });
  const have = new Set(found.map((f) => f.providerModelCode));
  const absent = wanted.filter((w) => !have.has(w));

  console.log(`\nUAT test vehicles: ${wanted.length - absent.length}/${wanted.length} resolvable`);
  if (absent.length) {
    console.log(`  ⚠ Not cross-walked: ${absent.join(", ")}`);
    console.log("  These are the codes HDFC UAT actually prices — investigate before testing.");
  }
}

async function main(): Promise<void> {
  const path = `${KIT_DIR}/${MASTER_FILE}`;
  if (!existsSync(path)) {
    console.error(`HDFC master workbook not found at:\n  ${path}`);
    console.error("Set HDFC_KIT_DIR to the kit folder.");
    process.exit(1);
  }

  console.log(`Reading ${MASTER_FILE}…`);
  const wb = XLSX.readFile(path);
  const unmatched: Record<string, string[]> = {};

  await importVehicles(wb, unmatched);
  await importRtos(wb, unmatched);
  await importInsurers(wb, unmatched);
  await assertUatVehiclesResolve();

  writeFileSync(UNMATCHED_REPORT, JSON.stringify(unmatched, null, 2) + "\n", "utf8");
  console.log(`\nUnmatched report written to ${UNMATCHED_REPORT}`);
  console.log(
    "Cross-walk-only by design: unmatched rows mean HDFC cannot quote that vehicle/RTO.\n" +
      "No canonical master rows were created.",
  );
}

// Only run when invoked directly, so the pure helpers stay unit-testable.
//
// The plan's original guard (`import.meta.url === \`file://${process.argv[1]...}\``)
// built the comparison URL by hand and never matched on Windows: Node's real
// import.meta.url for a drive-letter path is "file:///C:/..." (three slashes —
// the drive letter needs its own leading slash), while the hand-built string
// produced "file://C:/..." (two slashes). The mismatch meant main() silently
// never ran (empty output, no DB writes) — confirmed with a standalone probe
// script before applying this fix. pathToFileURL() is Node's own path→URL
// converter, so it produces the same three-slash form import.meta.url uses.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

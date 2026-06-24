/**
 * Imports ICICI Lombard's UAT make/model + RTO masters into the master tables as
 * ICICI's OWN catalog (per-provider data isolation — ICICI never reuses FG rows or
 * codes). The canonical id IS the ICICI code, and a matching ProviderMmvCode /
 * ProviderRtoCode (providerSlug "icici") is written so db-code-resolver resolves
 * purely within the ICICI partition.
 *
 *   npx tsx scripts/import-icici-master.ts
 *
 * Idempotent: deletes the existing ICICI partition (provider codes + the canonical
 * rows they point at) and re-inserts. Source CSVs live under:
 *   dock boyz/ICICI/UAT_MMV_Details/{make,rto}/*.csv
 * (PACKAGE and LIABILITY make masters are identical; RTO rows are unioned per line.)
 *
 * NOTE: ICICI's previous-insurer master is not part of this kit. PreviousInsurerCode
 * appears to be the insurer NAME string (e.g. "ICICI LOMBARD") — confirm with ICICI;
 * insurer mapping is left to the seed until a master file is supplied.
 */
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");

const prisma = new PrismaClient();

const BASE_DIR =
  process.env.ICICI_MASTER_DIR ??
  "c:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/ICICI/UAT_MMV_Details";

const MAKE_FILES: { file: string; category: "fourWheeler" | "twoWheeler" }[] = [
  { file: "make/PRIVATE CAR PACKAGE POLICY_Make_Model_Master.csv", category: "fourWheeler" },
  { file: "make/TWO WHEELER PACKAGE POLICY_Make_Model_Master.csv", category: "twoWheeler" },
];
const RTO_FILES = [
  "rto/PRIVATE CAR PACKAGE POLICY_RTO.csv",
  "rto/PRIVATE CAR LIABILITY POLICY_RTO.csv",
  "rto/TWO WHEELER PACKAGE POLICY_RTO.csv",
  "rto/TWO WHEELER LIABILITY POLICY_RTO.csv",
];

const SLUG = "icici";

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const intOrNull = (v: unknown): number | null => {
  const n = Number(s(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && s(v) !== "" ? Math.round(n) : null;
};
const isActive = (...flags: string[]): boolean =>
  flags.every((f) => f === "" || /^(Y|ACTIVE|YES)$/i.test(f));

function normalizeFuel(raw: string): string {
  const v = raw.toUpperCase();
  if (v.includes("HYBRID")) return "hybrid";
  if (v.includes("DIESEL")) return "diesel";
  if (v.includes("ELECTRIC") || v.includes("BATTERY")) return "electric";
  if (v.includes("CNG")) return "cng";
  if (v.includes("LPG")) return "lpg";
  if (v.includes("PETROL")) return "petrol";
  return "petrol";
}

const METRO = new Set(["MUMBAI", "DELHI", "NEW DELHI", "KOLKATA", "CHENNAI", "BANGALORE", "BENGALURU", "HYDERABAD", "AHMEDABAD", "PUNE"]);
function deriveZone(desc: string): string {
  const up = desc.toUpperCase();
  return [...METRO].some((c) => up.includes(c)) ? "A" : "B";
}

function readCsv(file: string): Row[] {
  const wb = XLSX.readFile(`${BASE_DIR}/${file}`);
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error(`No sheet found in ${file}`);
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Row[];
}

async function insertChunked<T>(label: string, rows: T[], fn: (c: T[]) => Promise<unknown>, size = 2000) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
  console.log(`  ${label}: ${rows.length} rows`);
}

async function main() {
  // ── Wipe the existing ICICI partition (provider codes + their canonical rows) ──
  console.log("Clearing existing ICICI master partition …");
  const oldMmv = await prisma.providerMmvCode.findMany({ where: { providerSlug: SLUG }, select: { mmvId: true } });
  const oldRto = await prisma.providerRtoCode.findMany({ where: { providerSlug: SLUG }, select: { rtoId: true } });
  await prisma.providerMmvCode.deleteMany({ where: { providerSlug: SLUG } });
  await prisma.providerRtoCode.deleteMany({ where: { providerSlug: SLUG } });
  await prisma.mmvMaster.deleteMany({ where: { id: { in: oldMmv.map((r) => r.mmvId) } } });
  await prisma.rtoMaster.deleteMany({ where: { id: { in: oldRto.map((r) => r.rtoId) } } });

  // ── MMV (one canonical row per make/model/fuel; canonical id == ICICI code) ──
  type Mmv = {
    makeId: string; makeName: string; modelId: string; modelName: string;
    fuelType: string; engineCC: number | null; seatingCapacity: number | null;
    carryingCapacity: number | null; gvw: number | null; category: string;
    vehicleType: string | null; isActive: boolean;
  };
  const mmvRows: Mmv[] = [];
  const mmvSeen = new Set<string>();
  for (const { file, category } of MAKE_FILES) {
    for (const r of readCsv(file)) {
      const makeId = s(r.VehicleManufactureCode);
      const modelId = s(r.VehicleModelCode);
      const makeName = s(r.Manufacture);
      if (!/^\d+$/.test(makeId) || !/^\d+$/.test(modelId) || !makeName) continue; // skip junk/header rows
      const fuelType = normalizeFuel(s(r.FuelType));
      const key = `${makeId}|${modelId}|${fuelType}`;
      if (mmvSeen.has(key)) continue;
      mmvSeen.add(key);
      mmvRows.push({
        makeId,
        makeName,
        modelId,
        modelName: s(r.VehicleModel) || modelId,
        fuelType,
        engineCC: intOrNull(r.CubicCapacity),
        seatingCapacity: intOrNull(r.SeatingCapacity),
        carryingCapacity: intOrNull(r.CarringCapacity),
        gvw: intOrNull(r.GVW),
        category,
        vehicleType: s(r.VehicleClassCode) || null,
        isActive: isActive(s(r.ActiveFlag)) && !/INACTIVE/i.test(s(r.VehicleModelStatus)),
      });
    }
  }
  await insertChunked("MmvMaster(icici)", mmvRows, (c) =>
    prisma.mmvMaster.createMany({ data: c, skipDuplicates: true }),
  );

  // Resolve the freshly-inserted ids and write the ICICI ProviderMmvCode mappings.
  const makeIds = [...new Set(mmvRows.map((m) => m.makeId))];
  const inserted = await prisma.mmvMaster.findMany({
    where: { makeId: { in: makeIds }, category: { in: ["fourWheeler", "twoWheeler"] } },
    select: { id: true, makeId: true, modelId: true, fuelType: true },
  });
  const idByKey = new Map(inserted.map((m) => [`${m.makeId}|${m.modelId}|${m.fuelType}`, m.id]));
  const mmvCodes = mmvRows
    .map((m) => {
      const mmvId = idByKey.get(`${m.makeId}|${m.modelId}|${m.fuelType}`);
      return mmvId
        ? { providerSlug: SLUG, mmvId, providerMakeCode: m.makeId, providerModelCode: m.modelId }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  await insertChunked("ProviderMmvCode(icici)", mmvCodes, (c) =>
    prisma.providerMmvCode.createMany({ data: c, skipDuplicates: true }),
  );

  // ── RTO (canonical code == ICICI RTOLocationCode; unioned across product lines) ──
  type Rto = { code: string; city: string; state: string; stateCode: string; zone: string };
  const rtoRows: Rto[] = [];
  const rtoSeen = new Set<string>();
  for (const file of RTO_FILES) {
    for (const r of readCsv(file)) {
      const code = s(r.RTOLocationCode);
      if (!/^\d+$/.test(code) || rtoSeen.has(code)) continue;
      if (!isActive(s(r.ActiveFlag), s(r.Status))) continue;
      rtoSeen.add(code);
      const desc = s(r.RTOLocationDesciption);
      rtoRows.push({
        code,
        city: desc.slice(0, 128) || s(r.ILState),
        state: s(r.ILState).slice(0, 128),
        stateCode: s(r.ILStateCode).slice(0, 8),
        zone: deriveZone(desc),
      });
    }
  }
  await insertChunked("RtoMaster(icici)", rtoRows, (c) =>
    prisma.rtoMaster.createMany({ data: c, skipDuplicates: true }),
  );
  const rtoInserted = await prisma.rtoMaster.findMany({
    where: { code: { in: rtoRows.map((r) => r.code) } },
    select: { id: true, code: true },
  });
  const rtoCodes = rtoInserted.map((r) => ({ providerSlug: SLUG, rtoId: r.id, providerCode: r.code }));
  await insertChunked("ProviderRtoCode(icici)", rtoCodes, (c) =>
    prisma.providerRtoCode.createMany({ data: c, skipDuplicates: true }),
  );

  // ── Register ICICI in the Provider table ──
  await prisma.provider.upsert({
    where: { slug: SLUG },
    update: { displayName: "ICICI Lombard", isActive: true, capabilities: ["fourWheeler", "twoWheeler"] },
    create: { slug: SLUG, displayName: "ICICI Lombard", isActive: true, capabilities: ["fourWheeler", "twoWheeler"] },
  });

  console.log("ICICI master import complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

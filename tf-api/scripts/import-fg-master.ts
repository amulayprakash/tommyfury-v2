/**
 * Imports the Future Generali "Motor field Master.xls" into the master tables.
 *
 *   npx tsx scripts/import-fg-master.ts
 *
 * Idempotent + partition-scoped: UPSERTS FG-owned master rows (source="fg") and
 * marks rows missing from the sheet inactive. It NEVER deletes provider codes or
 * canonical rows, so ICICI's ProviderMmvCode/ProviderRtoCode FK references survive an
 * FG re-import (import order no longer matters). FG is the data source, so
 * MmvMaster.modelId holds the FG PASIA_CODE and makeName the FG Make — the FG resolver
 * reads these directly (no ProviderMmvCode needed).
 */
import { createRequire } from "node:module";
import { PrismaClient, Prisma } from "@prisma/client";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");

const prisma = new PrismaClient();

const XLS_PATH =
  process.env.FG_MASTER_XLS ??
  "c:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/FG API Kit/FG API Kit/TCS Motor API KIT - XML Latest Revised Rebranding/TCS Motor API KIT - XML/TCS Motor API KIT - XML/Motor field  Master.xls";

const METRO_CITIES = new Set([
  "MUMBAI",
  "NAVI MUMBAI",
  "THANE",
  "DELHI",
  "NEW DELHI",
  "KOLKATA",
  "CHENNAI",
  "BANGALORE",
  "BENGALURU",
  "HYDERABAD",
  "AHMEDABAD",
  "PUNE",
]);

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const intOrNull = (v: unknown): number | null => {
  const n = Number(s(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && s(v).toUpperCase() !== "NULL" && s(v) !== "" ? Math.round(n) : null;
};

function normalizeFuel(raw: string): string {
  const v = raw.toUpperCase();
  if (v.includes("HYBRID")) return "hybrid";
  if (v.includes("DIESEL")) return "diesel";
  if (v.includes("BATTERY") || v.includes("ELECTRIC")) return "electric";
  if (v.includes("CNG")) return "cng";
  if (v.includes("LPG")) return "lpg";
  if (v.includes("PETROL")) return "petrol";
  return "petrol";
}

function deriveZone(city: string): string {
  return METRO_CITIES.has(city.toUpperCase()) ? "A" : "B";
}

function maxAge(raw: string): number | null {
  const m = raw.match(/([\d.]+)/);
  return m ? Number(m[1]) : null;
}

async function insertChunked<T>(
  label: string,
  rows: T[],
  fn: (chunk: T[]) => Promise<unknown>,
  size = 2000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
  console.log(`  ${label}: ${rows.length} rows`);
}

/** Runs per-row upserts in batched transactions (idempotent, preserves row ids so
 *  other providers' FK references survive). */
async function upsertChunked<T>(
  label: string,
  rows: T[],
  toOp: (row: T) => Prisma.PrismaPromise<unknown>,
  size = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await prisma.$transaction(rows.slice(i, i + size).map(toOp));
  }
  console.log(`  ${label}: ${rows.length} rows`);
}

async function main() {
  console.log(`Reading ${XLS_PATH} …`);
  const wb = XLSX.readFile(XLS_PATH);
  const sheet = (name: string): Row[] =>
    wb.Sheets[name] ? (XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" }) as Row[]) : [];
  const grid = (name: string): unknown[][] =>
    wb.Sheets[name]
      ? (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: "" }) as unknown[][])
      : [];

  // ── Idempotent, partition-scoped refresh (NEVER wipes provider codes or canonical
  // rows, so ICICI's ProviderMmvCode/ProviderRtoCode FK references survive an FG
  // re-import). Normalize legacy NULL variantId → "" so the
  // (makeId,modelId,variantId,fuelType) unique key is fully effective and upserts match
  // deterministically. Then mark FG-owned masters stale; the upserts below reactivate
  // the rows still present in the sheet (rows truly removed stay isActive=false). ──
  console.log("Refreshing FG-owned master rows (upsert; no destructive wipe) …");
  await prisma.$executeRawUnsafe("UPDATE mmv_master SET variantId='' WHERE variantId IS NULL");
  await prisma.mmvMaster.updateMany({ where: { source: "fg" }, data: { isActive: false } });
  await prisma.rtoMaster.updateMany({ where: { source: "fg" }, data: { isActive: false } });
  // FG-owned tables with NO inbound FK can be safely replaced wholesale.
  await prisma.pincodeMaster.deleteMany({});
  await prisma.occupationMaster.deleteMany({});
  await prisma.motorAddon.deleteMany({ where: { providerSlug: "fg" } });

  // ── MMV (PVT Car=4W, GCV+PCV=commercial) ──
  const mmvRows: {
    makeId: string; makeName: string; modelId: string; modelName: string;
    variantId: string; variantName: string | null; fuelType: string; engineCC: number | null;
    category: string; bodyType: string | null; gvw: number | null; seatingCapacity: number | null;
    carryingCapacity: number | null; vehicleType: string | null;
  }[] = [];
  const seenMmv = new Set<string>();
  const pushMmv = (r: Row, category: string) => {
    const pasia = s(r.PASIA_CODE);
    const make = s(r.VEHICLE_MAKE);
    const fuel = normalizeFuel(s(r.FUEL_TYPE));
    if (!pasia || !make) return;
    if (s(r.VEHICLE_STATUS).toUpperCase() === "INACTIVE") return;
    const key = `${make}|${pasia}|${fuel}`;
    if (seenMmv.has(key)) return;
    seenMmv.add(key);
    mmvRows.push({
      makeId: make,
      makeName: make,
      modelId: pasia,
      modelName: s(r.VEHICLE_MODEL) || pasia,
      variantId: "", // FG has no per-variant id; "" keeps the unique key non-null
      variantName: s(r.Variant_Name) || null,
      fuelType: fuel,
      engineCC: intOrNull(r.CC),
      category,
      bodyType: s(r.BODY_TYPE) || null,
      gvw: intOrNull(r.GVW),
      seatingCapacity: intOrNull(r.SEATING_CAPACITY),
      carryingCapacity: intOrNull(r.CARRYING_CAPACITY),
      vehicleType: s(r.VEHICLE_TYPE) || null,
    });
  };
  for (const r of sheet("PVT Car MMV")) pushMmv(r, "fourWheeler");
  for (const r of sheet("GCV MMV")) pushMmv(r, "commercial");
  for (const r of sheet("PCV MMV")) pushMmv(r, "commercial");
  await upsertChunked("MmvMaster(fg)", mmvRows, (r) =>
    prisma.mmvMaster.upsert({
      where: {
        makeId_modelId_variantId_fuelType: {
          makeId: r.makeId, modelId: r.modelId, variantId: r.variantId, fuelType: r.fuelType,
        },
      },
      update: { ...r, source: "fg", isActive: true },
      create: { ...r, source: "fg", isActive: true },
    }),
  );

  // ── RTO + derived zone ──
  const rtoSeen = new Set<string>();
  const rtoRows = sheet("RTO Code")
    .map((r) => {
      const code = s(r["RTO Code"]).toUpperCase();
      const city = s(r["RTO City"]) || s(r["RTO DISTRICT"]);
      return {
        code,
        city,
        state: s(r["RTO State"]),
        stateCode: code.slice(0, 2),
        zone: deriveZone(city),
      };
    })
    .filter((r) => r.code && !rtoSeen.has(r.code) && rtoSeen.add(r.code));
  await upsertChunked("RtoMaster(fg)", rtoRows, (r) =>
    prisma.rtoMaster.upsert({
      where: { code: r.code },
      update: { ...r, source: "fg", isActive: true },
      create: { ...r, source: "fg", isActive: true },
    }),
  );

  // ── Add-On catalog (3 sections by vehicle class) ──
  const addonRows: {
    providerSlug: string; category: string; fuelClass: string; code: string;
    label: string; maxAgeYears: number | null; requiresZeroDep: boolean; sortOrder: number;
  }[] = [];
  let section: { category: string; fuelClass: string } | null = null;
  let order = 0;
  for (const row of grid("Add On Covers")) {
    const c0 = s(row[0]);
    const c1 = s(row[1]);
    const head = c0.toUpperCase();
    if (head === "PVT CAR") { section = { category: "fourWheeler", fuelClass: "standard" }; continue; }
    if (head === "GCV") { section = { category: "commercial", fuelClass: "standard" }; continue; }
    if (head.startsWith("PVT CAR ELECTRIC")) { section = { category: "fourWheeler", fuelClass: "electric" }; continue; }
    if (!section || !c1 || c1.toUpperCase() === "COVER CODE") continue;
    if (!/^[A-Z]{4,6}$/.test(c1)) continue; // CoverCode column
    addonRows.push({
      providerSlug: "fg",
      category: section.category,
      fuelClass: section.fuelClass,
      code: c1,
      label: c0.replace(/\s*\(This Add-on.*$/i, "").trim(),
      maxAgeYears: maxAge(s(row[2])),
      requiresZeroDep: /STNCB|STINC|CONSM/.test(c1),
      sortOrder: order++,
    });
  }
  await insertChunked("MotorAddon(fg)", addonRows, (c) =>
    prisma.motorAddon.createMany({ data: c, skipDuplicates: true }),
  );

  // ── Pincodes (3 sheets) ──
  const pinRows: { pincode: string; area: string; city: string; state: string }[] = [];
  for (const name of ["Pincode Master", "Pincode Master1", "Pincode Master2"]) {
    for (const r of sheet(name)) {
      const pincode = s(r.PINCODE);
      if (!pincode) continue;
      pinRows.push({
        pincode,
        area: s(r.AREA).slice(0, 191),
        city: s(r.CITY_DISTRICT).slice(0, 128),
        state: s(r.STATE).slice(0, 128),
      });
    }
  }
  await insertChunked("PincodeMaster", pinRows, (c) =>
    prisma.pincodeMaster.createMany({ data: c, skipDuplicates: true }),
  );

  // ── Occupations ──
  const occSeen = new Set<string>();
  const occRows = sheet("Occupation Code")
    .map((r) => ({ code: s(r["Occupation Code"]), description: s(r["Occupation Description"]).slice(0, 191) }))
    .filter((r) => r.code && !occSeen.has(r.code) && occSeen.add(r.code));
  await insertChunked("OccupationMaster", occRows, (c) =>
    prisma.occupationMaster.createMany({ data: c, skipDuplicates: true }),
  );

  // ── FG insurers (PreviousTPInsDtls.PreviousInsurer code for standalone OD) ──
  // TP Policy Insurer sheet: [TPCompanyDescription, ClientCode].
  const insSeen = new Set<string>();
  const insurerRows = grid("TP Policy Insurer")
    .slice(1)
    .map((r) => ({ code: s(r[1]), name: s(r[0]).slice(0, 255) }))
    .filter((r) => r.code && r.name && !insSeen.has(r.code) && insSeen.add(r.code));
  await upsertChunked("InsurerMaster(fg)", insurerRows, (r) =>
    prisma.insurerMaster.upsert({
      where: { code: r.code },
      update: { name: r.name, source: "fg", isActive: true },
      create: { code: r.code, name: r.name, source: "fg", isActive: true },
    }),
  );

  // ── Register FG in the Provider table ──
  await prisma.provider.upsert({
    where: { slug: "fg" },
    update: { displayName: "Future Generali", isActive: true },
    create: {
      slug: "fg",
      displayName: "Future Generali",
      isActive: true,
      capabilities: ["fourWheeler", "commercial", "newCommercial"],
    },
  });

  console.log("FG master import complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

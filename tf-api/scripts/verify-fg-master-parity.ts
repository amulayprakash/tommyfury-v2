/**
 * READ-ONLY parity check: diffs the FG "Motor field Master.xls" against the CURRENT DB
 * masters (source="fg"). Reports additions / removals / field drift for MMV + RTO +
 * insurer ClientCodes, and surfaces the un-imported PYP-insurer master. It NEVER writes
 * to the DB — the master tables are production and feed the live resolver (see CLAUDE.md).
 *
 *   npm run db:verify:fg                     # diff new workbook vs the dev DB (tf_api_dev)
 *   npm run db:verify:fg -- --xls="<path>"   # diff a specific workbook
 *   npm run db:verify:fg -- --limit=20       # show up to N examples per bucket (default 10)
 *   npm run db:verify:fg -- --strict         # exit 1 if any row is REMOVED (DB-only)
 */
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import {
  FG_SHEETS, FG_MASTER_DEFAULT_PATH, normalizeFuel, deriveZone, str, numStr, mmvKey,
} from "./lib/fg-master-sheets.ts";
import { diffKeyed, type KeyedDiff } from "./lib/keyed-diff.ts";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");
const prisma = new PrismaClient();

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.includes(`--${k}`);
const XLS = arg("xls") ?? process.env.FG_MASTER_XLS ?? FG_MASTER_DEFAULT_PATH;
const strict = has("strict");
const limit = Number(arg("limit") ?? 10);

type Row = Record<string, unknown>;
type Wb = ReturnType<typeof XLSX.readFile>;
const readSheet = (wb: Wb, name: string): Row[] =>
  wb.Sheets[name] ? (XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" }) as Row[]) : [];

// ── MMV ──────────────────────────────────────────────────────────────────────
interface MmvVal extends Record<string, unknown> {
  modelName: string; bodyType: string; gvw: string; seatingCapacity: string;
  carryingCapacity: string; engineCC: string; vehicleType: string;
}
const MMV_FIELDS: (keyof MmvVal)[] = [
  "modelName", "bodyType", "gvw", "seatingCapacity", "carryingCapacity", "engineCC", "vehicleType",
];

function workbookMmv(wb: Wb): Map<string, MmvVal> {
  const m = new Map<string, MmvVal>();
  for (const sheet of [FG_SHEETS.pvtCarMmv, FG_SHEETS.gcvMmv, FG_SHEETS.pcvMmv]) {
    for (const r of readSheet(wb, sheet)) {
      const pasia = str(r.PASIA_CODE), make = str(r.VEHICLE_MAKE);
      if (!pasia || !make) continue;
      if (str(r.VEHICLE_STATUS).toUpperCase() === "INACTIVE") continue;
      const key = mmvKey(make, pasia, normalizeFuel(str(r.FUEL_TYPE)));
      if (m.has(key)) continue; // first wins, matching the importer's seenMmv de-dup
      m.set(key, {
        modelName: str(r.VEHICLE_MODEL) || pasia,
        bodyType: str(r.BODY_TYPE),
        gvw: numStr(r.GVW),
        seatingCapacity: numStr(r.SEATING_CAPACITY),
        carryingCapacity: numStr(r.CARRYING_CAPACITY),
        engineCC: numStr(r.CC),
        vehicleType: str(r.VEHICLE_TYPE),
      });
    }
  }
  return m;
}

async function dbMmv(): Promise<Map<string, MmvVal>> {
  const rows = await prisma.mmvMaster.findMany({
    where: { source: "fg", isActive: true },
    select: {
      makeId: true, modelId: true, fuelType: true, modelName: true, bodyType: true,
      gvw: true, seatingCapacity: true, carryingCapacity: true, engineCC: true, vehicleType: true,
    },
  });
  const m = new Map<string, MmvVal>();
  for (const r of rows) {
    m.set(mmvKey(r.makeId, r.modelId, r.fuelType), {
      modelName: str(r.modelName), bodyType: str(r.bodyType), gvw: numStr(r.gvw),
      seatingCapacity: numStr(r.seatingCapacity), carryingCapacity: numStr(r.carryingCapacity),
      engineCC: numStr(r.engineCC), vehicleType: str(r.vehicleType),
    });
  }
  return m;
}

// ── RTO ──────────────────────────────────────────────────────────────────────
interface RtoVal extends Record<string, unknown> { city: string; state: string; zone: string; }
const RTO_FIELDS: (keyof RtoVal)[] = ["city", "state", "zone"];

function workbookRto(wb: Wb): Map<string, RtoVal> {
  const m = new Map<string, RtoVal>();
  for (const r of readSheet(wb, FG_SHEETS.rto)) {
    const code = str(r["RTO Code"]).toUpperCase();
    if (!code || m.has(code)) continue;
    const city = str(r["RTO City"]) || str(r["RTO DISTRICT"]);
    m.set(code, { city, state: str(r["RTO State"]), zone: deriveZone(city) });
  }
  return m;
}

async function dbRto(): Promise<Map<string, RtoVal>> {
  const rows = await prisma.rtoMaster.findMany({
    where: { source: "fg", isActive: true },
    select: { code: true, city: true, state: true, zone: true },
  });
  const m = new Map<string, RtoVal>();
  for (const r of rows) m.set(str(r.code).toUpperCase(), { city: str(r.city), state: str(r.state), zone: str(r.zone) });
  return m;
}

// ── Insurer ClientCode (TP Policy Insurer) ────────────────────────────────────
interface InsVal extends Record<string, unknown> { name: string; }

function workbookInsurers(wb: Wb): Map<string, InsVal> {
  const m = new Map<string, InsVal>();
  // noUncheckedIndexedAccess: Sheets[name] is WorkSheet | undefined — narrow before sheet_to_json.
  const ws = wb.Sheets[FG_SHEETS.tpInsurer];
  if (!ws) throw new Error(`missing sheet "${FG_SHEETS.tpInsurer}"`);
  const grid = XLSX.utils.sheet_to_json(ws, {
    header: 1, blankrows: false, defval: "",
  }) as unknown[][];
  for (const row of grid.slice(1)) {
    const code = str(row[1]), name = str(row[0]); // [TPCompanyDescription, ClientCode]
    if (!code || !name || m.has(code)) continue;
    m.set(code, { name });
  }
  return m;
}

async function dbInsurers(): Promise<Map<string, InsVal>> {
  const rows = await prisma.insurerMaster.findMany({ where: { source: "fg" }, select: { code: true, name: true } });
  const m = new Map<string, InsVal>();
  for (const r of rows) m.set(str(r.code), { name: str(r.name) });
  return m;
}

// ── report ───────────────────────────────────────────────────────────────────
function report(title: string, d: KeyedDiff): number {
  console.log(`\n── ${title} ──`);
  console.log(`  added (workbook, not DB):  ${d.added.length}`);
  console.log(`  removed (DB, not workbook): ${d.removed.length}`);
  console.log(`  changed (field drift):      ${d.changed.length}`);
  console.log(`  unchanged:                  ${d.unchanged}`);
  if (d.added.length) console.log(`   e.g. added:   ${d.added.slice(0, limit).join(", ")}`);
  if (d.removed.length) console.log(`   e.g. removed: ${d.removed.slice(0, limit).join(", ")}`);
  for (const c of d.changed.slice(0, limit)) console.log(`   Δ ${c.key} ${c.field}: "${c.from}" → "${c.to}"`);
  return d.added.length + d.removed.length + d.changed.length;
}

async function main() {
  console.log(`FG master parity (READ-ONLY) — workbook vs DB (source="fg")\n  XLS: ${XLS}`);
  const wb = XLSX.readFile(XLS);

  const mmv = diffKeyed(workbookMmv(wb), await dbMmv(), MMV_FIELDS);
  const mmvDelta = report("MMV (make|PASIA|fuel)", mmv);
  const rto = diffKeyed(workbookRto(wb), await dbRto(), RTO_FIELDS);
  const rtoDelta = report("RTO (code)", rto);
  const dbIns = await dbInsurers();
  const ins = diffKeyed(workbookInsurers(wb), dbIns, ["name"]);
  const insDelta = report("Insurer ClientCode (TP Policy Insurer)", ins);

  // PYP insurer master is NOT imported — surface the gap.
  const pyp = new Set<string>();
  for (const r of readSheet(wb, FG_SHEETS.pypInsurer)) { const c = str(r.ClientCode); if (c) pyp.add(c); }
  const pypMissing = [...pyp].filter((c) => !dbIns.has(c));
  console.log(`\n── PYP Policy Insurer (rollover ClientCode) — DATA GAP ──`);
  console.log(`  workbook PYP ClientCodes: ${pyp.size}; not present in insurer_master: ${pypMissing.length}`);
  console.log(`  (importer only ingests "TP Policy Insurer"; PYP rollover codes are unimported — open confirmation with GCI.)`);

  const removed = mmv.removed.length + rto.removed.length + ins.removed.length;
  console.log(`\nSUMMARY: MMV Δ=${mmvDelta}, RTO Δ=${rtoDelta}, Insurer Δ=${insDelta}. Removed total=${removed}.`);
  if (strict && removed > 0) {
    console.error("STRICT: removals detected (rows in DB but absent from workbook).");
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());

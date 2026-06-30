/**
 * Imports ICICI Lombard's UAT master data using the aggregator CROSS-WALK model:
 * one canonical catalog (MmvMaster / RtoMaster) + per-provider code mappings
 * (ProviderMmvCode / ProviderRtoCode). ICICI codes are attached to the SAME
 * canonical rows the UI selects from, so a single chosen vehicle can be quoted by
 * every insurer that has a mapping. (Replaces the earlier "own catalog" import.)
 *
 *   npx tsx scripts/import-icici-master.ts
 *
 * Category strategy:
 *  - Four-wheeler: FG's rows are the shared canonical. We MATCH each ICICI 4W to a
 *    canonical row (make + model + fuel) and write ProviderMmvCode(icici) onto it.
 *    No new 4W rows are created (avoids duplicate selector entries).
 *  - Two-wheeler: no other provider has 2W, so ICICI's 2W IS the canonical — we
 *    insert those rows + their ProviderMmvCode.
 *  - RTO: cross-walked onto FG's shared RtoMaster (state + city), category-agnostic.
 *
 * Matching is fuzzy (normalized make/model/state/city); the long tail is curated via
 * an optional scripts/icici-master-overrides.json. A coverage report is printed.
 * Idempotent: re-running rebuilds the ICICI partition without touching FG rows.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");

const prisma = new PrismaClient();
const SLUG = "icici";
const INSURER_PATH = `${import.meta.dirname}/icici-insurer-master.json`;

/** Batched upsert in transactions (idempotent, preserves ids → no FK churn). */
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

const BASE_DIR =
  process.env.ICICI_MASTER_DIR ??
  "c:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/ICICI/UAT_MMV_Details";
const OVERRIDES_PATH = `${import.meta.dirname}/icici-master-overrides.json`;

const MAKE_4W = "make/PRIVATE CAR PACKAGE POLICY_Make_Model_Master.csv";
const MAKE_2W = "make/TWO WHEELER PACKAGE POLICY_Make_Model_Master.csv";
// RTO CSVs are tagged with the vehicle line they belong to. ICICI assigns DIFFERENT
// RTO codes per line for the same city (Private Car ≠ Two Wheeler), so we store one
// ProviderRtoCode row per line instead of collapsing them to a single code.
const RTO_FILES: { file: string; line: string }[] = [
  { file: "rto/PRIVATE CAR PACKAGE POLICY_RTO.csv", line: "fw" },
  { file: "rto/PRIVATE CAR LIABILITY POLICY_RTO.csv", line: "fw" },
  { file: "rto/TWO WHEELER PACKAGE POLICY_RTO.csv", line: "tw" },
  { file: "rto/TWO WHEELER LIABILITY POLICY_RTO.csv", line: "tw" },
];

// ── Commercial Vehicle (deferred) ────────────────────────────────────────────
// ICICI has NOT yet supplied CV make/model/RTO master CSVs (UAT_MMV_Details holds
// only Private Car + Two Wheeler). The CV import below is fully scaffolded and
// NO-OPS when these files are absent; drop the delivered files in at these paths
// (adjust the names to match what ICICI ships) and the import runs unchanged.
// Expected filenames mirror the PCV/GCV product master in "Commercial Vehicle
// Generic 5". GCV = Goods Carrying, PCV = Passenger Carrying.
const MAKE_CV_FILES: { file: string; cvClass: string }[] = [
  { file: "make/GCV PACKAGE POLICY_Make_Model_Master.csv", cvClass: "gcv" },
  { file: "make/PCV PACKAGE POLICY_Make_Model_Master.csv", cvClass: "pcv" },
];
const RTO_CV_FILES = [
  "rto/GCV PACKAGE POLICY_RTO.csv",
  "rto/PCV PACKAGE POLICY_RTO.csv",
];

// ── helpers ───────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const intOrNull = (v: unknown): number | null => {
  const n = Number(s(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && s(v) !== "" ? Math.round(n) : null;
};
const alnum = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Word tokens (len>1) for name-overlap scoring — mirrors the UI's pickBestVariant. */
const tokenize = (v: string): string[] =>
  v.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1);

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

// Common multi-word make aliases → a stable key shared by FG and ICICI spellings.
const MAKE_ALIASES: Record<string, string> = {
  TATAMOTORS: "TATA", TATA: "TATA",
  MARUTISUZUKI: "MARUTI", MARUTI: "MARUTI", SUZUKI: "MARUTI",
  MAHINDRAMAHINDRA: "MAHINDRA", MAHINDRA: "MAHINDRA",
  MERCEDESBENZ: "MERCEDES", MERCEDES: "MERCEDES",
  ASHOKLEYLAND: "ASHOK", LANDROVER: "LANDROVER", RANGEROVER: "LANDROVER",
  HINDUSTANMOTORS: "HINDUSTAN", FORCEMOTORS: "FORCE", FORCE: "FORCE",
};
function makeKey(name: string): string {
  const a = alnum(name);
  if (MAKE_ALIASES[a]) return MAKE_ALIASES[a];
  const first = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim().split(/\s+/)[0] ?? "";
  return MAKE_ALIASES[first] ?? first;
}
const stateKey = (v: string): string => alnum(v).replace(/^UTTARANCHAL$/, "UTTARAKHAND");
/** ICICI RTO description is "STATE-CITY"; take the city part. */
const iciciCity = (desc: string): string => alnum(desc.includes("-") ? desc.slice(desc.lastIndexOf("-") + 1) : desc);

function readCsv(file: string): Row[] {
  const wb = XLSX.readFile(`${BASE_DIR}/${file}`);
  const name = wb.SheetNames[0];
  const sheet = name ? wb.Sheets[name] : undefined;
  if (!sheet) throw new Error(`No sheet in ${file}`);
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Row[];
}
async function chunked<T>(label: string, rows: T[], fn: (c: T[]) => Promise<unknown>, size = 2000) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
  console.log(`  ${label}: ${rows.length} rows`);
}

async function main() {
  // ── 1. Clear the ICICI partition by explicit `source` (not makeId format) ──
  // Provider codes are fully rebuilt each run. ICICI-owned canonical rows (2W, future
  // CV) are upserted by source below; we mark them stale here and the upserts reactivate
  // the ones still present. FG-owned canonical rows are never touched. Normalize legacy
  // NULL variantId → "" so the (makeId,modelId,variantId,fuelType) unique key + upserts
  // are deterministic regardless of FG/ICICI import order.
  console.log("Clearing ICICI provider codes + marking ICICI-owned rows stale …");
  await prisma.$executeRawUnsafe("UPDATE mmv_master SET variantId='' WHERE variantId IS NULL");
  await prisma.providerMmvCode.deleteMany({ where: { providerSlug: SLUG } });
  await prisma.providerRtoCode.deleteMany({ where: { providerSlug: SLUG } });
  await prisma.providerInsurerCode.deleteMany({ where: { providerSlug: SLUG } });
  await prisma.mmvMaster.updateMany({ where: { source: SLUG }, data: { isActive: false } });

  // ── 2. Load the shared canonical catalog (FG rows) ──
  const canon4w = await prisma.mmvMaster.findMany({
    where: { category: "fourWheeler" },
    select: { id: true, makeName: true, modelName: true, variantName: true, fuelType: true, engineCC: true },
  });
  const canonRto = await prisma.rtoMaster.findMany({ select: { id: true, code: true, city: true, state: true } });

  // ── 3. 4W cross-walk: index ICICI 4W by makeKey|fuel, then RANK candidates per canonical row ──
  // ICICI's ModelCode is VARIANT-grained ("VENUE 1.5 CRDI SX(O)") while our canonical model
  // is coarse ("VENUE"), so a loose name substring can't tell which variant code to use. We
  // keep the same broad candidate gate (model-name substring, either direction) but RANK the
  // qualifiers by engine-CC proximity + variant-name token overlap and emit the full ranked
  // list to a sidecar. The validation pass (validate-icici-codes.ts --fallback) then probes
  // candidates in rank order against live UAT and keeps the FIRST that actually prices — so a
  // wrong-but-plausible code is never committed blind, and a UAT gap falls through to the next.
  type Cand = { modelKey: string; name: string; cc: number | null; makeCode: string; modelCode: string };
  const idx4w = new Map<string, Cand[]>();
  for (const r of readCsv(MAKE_4W)) {
    const makeCode = s(r.VehicleManufactureCode), modelCode = s(r.VehicleModelCode);
    if (!/^\d+$/.test(makeCode) || !/^\d+$/.test(modelCode)) continue;
    const key = `${makeKey(s(r.Manufacture))}|${normalizeFuel(s(r.FuelType))}`;
    (idx4w.get(key) ?? idx4w.set(key, []).get(key)!).push({
      modelKey: alnum(s(r.VehicleModel)), name: s(r.VehicleModel), cc: intOrNull(r.CubicCapacity), makeCode, modelCode,
    });
  }

  /** Score an ICICI candidate against a canonical row: CC proximity + name-token overlap. */
  const scoreCand = (c: Cand, row: (typeof canon4w)[number]): number => {
    let sc = 0;
    if (row.engineCC && c.cc) {
      const d = Math.abs(c.cc - row.engineCC);
      if (d === 0) sc += 3;
      else if (d <= 50) sc += 1;
      else sc -= 1; // a clearly different displacement is the wrong variant
    }
    const rTokens = tokenize(`${row.modelName} ${row.variantName ?? ""}`);
    const cTokens = new Set(tokenize(c.name));
    sc += rTokens.filter((t) => cTokens.has(t)).length;
    return sc;
  };

  // Persist the BEST candidate now (baseline) + the full ranked list to a sidecar for fallback.
  const mmvCodes: { providerSlug: string; mmvId: number; providerMakeCode: string; providerModelCode: string }[] = [];
  const candidateSidecar: Record<string, { makeCode: string; modelCode: string }[]> = {};
  let matched4w = 0;
  const sampleMiss4w: string[] = [];
  for (const row of canon4w) {
    const cands = idx4w.get(`${makeKey(row.makeName)}|${row.fuelType}`);
    if (!cands) { if (sampleMiss4w.length < 8) sampleMiss4w.push(`${row.makeName} ${row.modelName} (${row.fuelType})`); continue; }
    const mk = alnum(row.modelName);
    // Same broad gate as before: model-name substring either direction.
    const qualifiers = cands.filter((c) => c.modelKey.startsWith(mk) || c.modelKey.includes(mk) || mk.includes(c.modelKey));
    if (qualifiers.length === 0) { if (sampleMiss4w.length < 8) sampleMiss4w.push(`${row.makeName} ${row.modelName} (${row.fuelType})`); continue; }
    // Rank by score desc, then closest CC, then shortest name (most generic variant first).
    const ranked = [...qualifiers].sort((a, b) =>
      scoreCand(b, row) - scoreCand(a, row) ||
      (Math.abs((a.cc ?? 1e9) - (row.engineCC ?? 0)) - Math.abs((b.cc ?? 1e9) - (row.engineCC ?? 0))) ||
      a.name.length - b.name.length,
    );
    // Dedup identical make|model codes, preserving rank order.
    const seen = new Set<string>();
    const deduped = ranked.filter((c) => {
      const k = `${c.makeCode}|${c.modelCode}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    const best = deduped[0]!;
    mmvCodes.push({ providerSlug: SLUG, mmvId: row.id, providerMakeCode: best.makeCode, providerModelCode: best.modelCode });
    candidateSidecar[row.id] = deduped.map((c) => ({ makeCode: c.makeCode, modelCode: c.modelCode }));
    matched4w++;
  }
  writeFileSync(`${import.meta.dirname}/_icici-mmv-candidates.json`, JSON.stringify(candidateSidecar));
  console.log(`  4W ranked-candidate sidecar: ${Object.keys(candidateSidecar).length} rows → scripts/_icici-mmv-candidates.json`);

  // ── 4. 2W own-catalog: ICICI is the sole 2W source → upsert canonical rows + codes ──
  type Tw = { makeId: string; makeName: string; modelId: string; modelName: string; variantId: string; fuelType: string; engineCC: number | null; seatingCapacity: number | null; category: string; source: string; isActive: boolean };
  const twRows: Tw[] = [];
  const twSeen = new Set<string>();
  for (const r of readCsv(MAKE_2W)) {
    const makeId = s(r.VehicleManufactureCode), modelId = s(r.VehicleModelCode), makeName = s(r.Manufacture);
    if (!/^\d+$/.test(makeId) || !/^\d+$/.test(modelId) || !makeName) continue;
    const fuelType = normalizeFuel(s(r.FuelType));
    const key = `${makeId}|${modelId}|${fuelType}`;
    if (twSeen.has(key)) continue;
    twSeen.add(key);
    twRows.push({
      makeId, makeName, modelId, modelName: s(r.VehicleModel) || modelId, variantId: "", fuelType,
      engineCC: intOrNull(r.CubicCapacity), seatingCapacity: intOrNull(r.SeatingCapacity),
      category: "twoWheeler", source: SLUG,
      isActive: /^Y$/i.test(s(r.ActiveFlag)) && !/INACTIVE/i.test(s(r.VehicleModelStatus)),
    });
  }
  await upsertChunked("MmvMaster(icici 2W)", twRows, (r) =>
    prisma.mmvMaster.upsert({
      where: { makeId_modelId_variantId_fuelType: { makeId: r.makeId, modelId: r.modelId, variantId: r.variantId, fuelType: r.fuelType } },
      update: r,
      create: r,
    }),
  );
  const twInserted = await prisma.mmvMaster.findMany({
    where: { category: "twoWheeler", source: SLUG }, select: { id: true, makeId: true, modelId: true, fuelType: true },
  });
  const twId = new Map(twInserted.map((m) => [`${m.makeId}|${m.modelId}|${m.fuelType}`, m.id]));
  for (const r of twRows) {
    const id = twId.get(`${r.makeId}|${r.modelId}|${r.fuelType}`);
    if (id) mmvCodes.push({ providerSlug: SLUG, mmvId: id, providerMakeCode: r.makeId, providerModelCode: r.modelId });
  }

  // ── 4b. Commercial Vehicle (deferred): insert ICICI-canonical CV rows + codes ──
  // ICICI is treated as the CV canonical source (like 2W). NO-OPS until ICICI
  // delivers the CV master CSVs. Column names mirror the 2W/4W masters plus the CV
  // enrichment fields (GVW / carrying / seating); adjust them to the shipped headers.
  let cvRows = 0;
  const cvPresent = MAKE_CV_FILES.some((f) => existsSync(`${BASE_DIR}/${f.file}`));
  if (cvPresent) {
    type Cv = {
      makeId: string; makeName: string; modelId: string; modelName: string; variantId: string; fuelType: string;
      engineCC: number | null; seatingCapacity: number | null; gvw: number | null;
      carryingCapacity: number | null; vehicleType: string | null; category: string; source: string; isActive: boolean;
    };
    const rows: Cv[] = [];
    const seen = new Set<string>();
    for (const { file, cvClass } of MAKE_CV_FILES) {
      if (!existsSync(`${BASE_DIR}/${file}`)) continue;
      for (const r of readCsv(file)) {
        const makeId = s(r.VehicleManufactureCode), modelId = s(r.VehicleModelCode), makeName = s(r.Manufacture);
        if (!/^\d+$/.test(makeId) || !/^\d+$/.test(modelId) || !makeName) continue;
        const fuelType = normalizeFuel(s(r.FuelType));
        const key = `${makeId}|${modelId}|${fuelType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          makeId, makeName, modelId, modelName: s(r.VehicleModel) || modelId, variantId: "", fuelType,
          engineCC: intOrNull(r.CubicCapacity), seatingCapacity: intOrNull(r.SeatingCapacity),
          gvw: intOrNull(r.GrossVehicleWeight), carryingCapacity: intOrNull(r.CarryingCapacity),
          vehicleType: cvClass.toUpperCase(), category: "commercial", source: SLUG,
          isActive: /^Y$/i.test(s(r.ActiveFlag)) && !/INACTIVE/i.test(s(r.VehicleModelStatus)),
        });
      }
    }
    await upsertChunked("MmvMaster(icici CV)", rows, (r) =>
      prisma.mmvMaster.upsert({
        where: { makeId_modelId_variantId_fuelType: { makeId: r.makeId, modelId: r.modelId, variantId: r.variantId, fuelType: r.fuelType } },
        update: r,
        create: r,
      }),
    );
    const inserted = await prisma.mmvMaster.findMany({
      where: { category: "commercial", source: SLUG },
      select: { id: true, makeId: true, modelId: true, fuelType: true },
    });
    const cvId = new Map(inserted.map((m) => [`${m.makeId}|${m.modelId}|${m.fuelType}`, m.id]));
    for (const r of rows) {
      const id = cvId.get(`${r.makeId}|${r.modelId}|${r.fuelType}`);
      if (id) mmvCodes.push({ providerSlug: SLUG, mmvId: id, providerMakeCode: r.makeId, providerModelCode: r.modelId });
    }
    cvRows = rows.length;
    // Fold any CV-specific RTO files into the per-line RTO cross-walk below (line "cv").
    for (const f of RTO_CV_FILES) if (existsSync(`${BASE_DIR}/${f}`)) RTO_FILES.push({ file: f, line: "cv" });
  } else {
    console.log("  CV master files absent — skipping commercial import (deferred until ICICI delivers CV CSVs).");
  }

  // ── 5. RTO cross-walk (PER LINE): ICICI RTO codes differ by vehicle line for the
  // same city, so index + match each line independently and store one ProviderRtoCode
  // row per line. A canonical RTO can therefore carry an "fw", a "tw" and a "cv" code. ──
  const idxRtoByLine = new Map<string, Map<string, { cityKey: string; code: string }[]>>();
  for (const { file, line } of RTO_FILES) {
    let idx = idxRtoByLine.get(line);
    if (!idx) idxRtoByLine.set(line, (idx = new Map()));
    const seen = new Set<string>(); // dedup ICICI codes WITHIN a line, not across lines
    for (const r of readCsv(file)) {
      const code = s(r.RTOLocationCode);
      if (!/^\d+$/.test(code) || seen.has(code)) continue;
      seen.add(code);
      const k = stateKey(s(r.ILState));
      (idx.get(k) ?? idx.set(k, []).get(k)!).push({ cityKey: iciciCity(s(r.RTOLocationDesciption)), code });
    }
  }
  const rtoCodes: { providerSlug: string; rtoId: number; providerCode: string; line: string }[] = [];
  const matchedRtoByLine: Record<string, number> = {};
  const sampleMissRto: string[] = [];
  for (const [line, idx] of idxRtoByLine) {
    let matched = 0;
    for (const row of canonRto) {
      const list = idx.get(stateKey(row.state));
      const ck = alnum(row.city);
      const hit = list?.find((c) => c.cityKey === ck) ?? list?.find((c) => c.cityKey.includes(ck) || ck.includes(c.cityKey));
      if (!hit) {
        if (line === "fw" && sampleMissRto.length < 8) sampleMissRto.push(`${row.code} ${row.city}, ${row.state}`);
        continue;
      }
      rtoCodes.push({ providerSlug: SLUG, rtoId: row.id, providerCode: hit.code, line });
      matched++;
    }
    matchedRtoByLine[line] = matched;
  }

  // ── 6. Apply manual overrides (optional curation file) ──
  let overrideMmv = 0, overrideRto = 0;
  try {
    const ov = JSON.parse(readFileSync(OVERRIDES_PATH, "utf8")) as {
      mmv?: { make: string; model: string; fuel?: string; iciciMakeCode: string; iciciModelCode: string }[];
      rto?: { rtoCode: string; iciciRtoCode: string; line?: string }[];
    };
    for (const o of ov.mmv ?? []) {
      const row = await prisma.mmvMaster.findFirst({
        where: { makeName: { contains: o.make }, modelName: { contains: o.model }, ...(o.fuel ? { fuelType: o.fuel } : {}) },
      });
      if (!row) continue;
      await prisma.providerMmvCode.upsert({
        where: { providerSlug_mmvId: { providerSlug: SLUG, mmvId: row.id } },
        update: { providerMakeCode: o.iciciMakeCode, providerModelCode: o.iciciModelCode },
        create: { providerSlug: SLUG, mmvId: row.id, providerMakeCode: o.iciciMakeCode, providerModelCode: o.iciciModelCode },
      });
      overrideMmv++;
    }
    for (const o of ov.rto ?? []) {
      const row = await prisma.rtoMaster.findUnique({ where: { code: o.rtoCode } });
      if (!row) continue;
      const line = o.line ?? "all";
      await prisma.providerRtoCode.upsert({
        where: { providerSlug_rtoId_line: { providerSlug: SLUG, rtoId: row.id, line } },
        update: { providerCode: o.iciciRtoCode },
        create: { providerSlug: SLUG, rtoId: row.id, providerCode: o.iciciRtoCode, line },
      });
      overrideRto++;
    }
  } catch {
    /* no overrides file — fine */
  }

  // ── 7. Persist mappings (skip ones overrides already created) ──
  await chunked("ProviderMmvCode(icici)", mmvCodes, (c) => prisma.providerMmvCode.createMany({ data: c, skipDuplicates: true }));
  await chunked("ProviderRtoCode(icici)", rtoCodes, (c) => prisma.providerRtoCode.createMany({ data: c, skipDuplicates: true }));

  // ── 7b. Previous-insurer mapping: ICICI's insurer master (transcribed from the partner
  // doc → icici-insurer-master.json) fuzzy-matched onto the canonical InsurerMaster, so
  // ProviderInsurerCode(icici) is no longer empty for rollover/OD. ──
  let insurerMapped = 0;
  try {
    const { insurers: iciciInsurers } = JSON.parse(readFileSync(INSURER_PATH, "utf8")) as {
      insurers: { code: string; name: string }[];
    };
    const STOP = new Set(["GENERAL", "INSURANCE", "CO", "LTD", "LIMITED", "COMPANY", "INDIA", "THE", "AND", "ASSURANCE", "GIC", "INS", "OF"]);
    const toks = (n: string) => n.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
    const idx = iciciInsurers.map((i) => ({ code: i.code, set: new Set(toks(i.name)) }));
    const canonInsurers = await prisma.insurerMaster.findMany({ select: { id: true, name: true } });
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const ins of canonInsurers) {
      const t = toks(ins.name);
      if (!t.length) continue;
      let best: { code: string; score: number } | undefined;
      for (const cand of idx) {
        const score = t.filter((x) => cand.set.has(x)).length;
        if (score > 0 && (!best || score > best.score)) best = { code: cand.code, score };
      }
      if (!best) continue;
      ops.push(
        prisma.providerInsurerCode.upsert({
          where: { providerSlug_insurerId: { providerSlug: SLUG, insurerId: ins.id } },
          update: { providerCode: best.code },
          create: { providerSlug: SLUG, insurerId: ins.id, providerCode: best.code },
        }),
      );
      insurerMapped++;
    }
    for (let i = 0; i < ops.length; i += 500) await prisma.$transaction(ops.slice(i, i + 500));
  } catch (e) {
    console.log(`  insurer mapping skipped: ${(e as Error).message}`);
  }

  // Only categories ICICI has master data for. Re-add commercial/newCommercial when the
  // CV master CSVs are delivered + imported (see ICICI_CAPABILITIES in config.ts).
  const iciciCapabilities = ["fourWheeler", "twoWheeler"];
  await prisma.provider.upsert({
    where: { slug: SLUG },
    update: { displayName: "ICICI Lombard", isActive: true, capabilities: iciciCapabilities },
    create: { slug: SLUG, displayName: "ICICI Lombard", isActive: true, capabilities: iciciCapabilities },
  });

  // ── 8. Coverage report ──
  const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : "0") + "%";
  console.log("\n── ICICI cross-walk coverage ──");
  console.log(`  4W vehicles : ${matched4w}/${canon4w.length} canonical rows mapped (${pct(matched4w, canon4w.length)}) + ${overrideMmv} overrides`);
  console.log(`  2W vehicles : ${twRows.length} ICICI-canonical rows`);
  console.log(`  CV vehicles : ${cvPresent ? `${cvRows} ICICI-canonical rows` : "deferred (no CV master files)"}`);
  const rtoLineReport = ["fw", "tw", "cv"]
    .filter((l) => matchedRtoByLine[l] != null)
    .map((l) => `${l}:${matchedRtoByLine[l]}/${canonRto.length} (${pct(matchedRtoByLine[l]!, canonRto.length)})`)
    .join("  ");
  console.log(`  RTO (per line): ${rtoLineReport} + ${overrideRto} overrides`);
  console.log(`  Insurers    : ${insurerMapped} canonical insurers mapped to ICICI codes`);
  // Per-fuel 4W coverage gaps (problem 7 visibility): how many canonical 4W rows per fuel
  // got no ICICI code (so QA knows which fuels are under-covered, e.g. CNG/electric).
  const fwByFuel = new Map<string, { total: number; mapped: number }>();
  const mappedMmvIds = new Set(mmvCodes.map((c) => c.mmvId));
  for (const row of canon4w) {
    const f = fwByFuel.get(row.fuelType) ?? { total: 0, mapped: 0 };
    f.total++;
    if (mappedMmvIds.has(row.id)) f.mapped++;
    fwByFuel.set(row.fuelType, f);
  }
  console.log(
    "  4W by fuel  : " +
      [...fwByFuel.entries()].map(([f, v]) => `${f} ${v.mapped}/${v.total}`).join("  "),
  );
  if (sampleMiss4w.length) console.log("  4W misses (sample):", sampleMiss4w.slice(0, 5));
  if (sampleMissRto.length) console.log("  RTO misses (sample):", sampleMissRto.slice(0, 5));
  console.log("\nICICI cross-walk import complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

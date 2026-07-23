# FG Motor Masters Re-import + Parity Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution order:** This plan is fully isolated — it touches only `scripts/`, `package.json`, and DB imports, and shares no `env.ts`/`config.ts`/provider/contract surface with the other four FG-migration plans, so it can run at ANY point in the sequence (recommended last). See `docs/superpowers/plans/2026-07-22-fg-migration-execution-order.md`.

**Goal:** Re-import the FG motor masters from the rebranded Generali Central "Motor field Master.xls" (the new JSON-kit workbook) and prove — via row-count assertions on the test DB and a non-destructive parity diff against the live DB — that the masters are identical in shape/keys to the current FG import, so the shared production master/provider-code tables can be refreshed safely.

**Architecture:** The existing importer (`scripts/import-fg-master.ts`) is already idempotent, source-tagged (`source="fg"`), and UPSERT-based (it never wipes provider codes or canonical rows). This plan (a) centralises the sheet-name/column expectations into a shared lib guarded by a workbook-shape test so a rebranded rename can't slip through; (b) points the importer at the new workbook (CLI `--xls` arg + new default) and asserts the exact deduped/active row counts it produces against a freshly-migrated `tf_api_test`; (c) adds a read-only `verify-fg-master-parity.ts` that diffs the workbook vs the live DB (additions / removals / field drift for MMV, RTO, insurer ClientCodes, plus surfacing the un-imported PYP-insurer master); (d) proves idempotency by importing twice and confirming zero parity drift and stable counts. No schema change: `PASIA_CODE` is still `MmvMaster.modelId`; the masters are unchanged vs the current import.

**Tech Stack:** TypeScript (ESM, `.ts` extension imports, `@/*` → `src/*` alias), `tsx` runner, Prisma + MySQL, the `xlsx` npm package, Vitest (tests run against a separate `tf_api_test` MySQL DB set by `vitest.config.ts`). Windows-first; the Bash tool (Git Bash) and PowerShell are both available.

---

## Context the engineer must know before starting

- **Two independent npm projects.** All commands below run inside `tf-api/` (`cd tf-api` first). The repo root is `c:/Users/ASUS/Desktop/QUAGNITIA/tommyfurry-v2`.
- **The new workbook (source of truth for this plan):**
  `C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/FG API Kit/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor KIT - JSON/Motor field  Master.xls`
  ⚠ The filename has a **double space**: `Motor field  Master.xls`. Copy it verbatim.
- **The current importer default** still points at the OLD **XML-kit** workbook
  (`…/FG API Kit/FG API Kit/TCS Motor API KIT - XML …/Motor field  Master.xls`). Task 1 repoints the default to the new JSON-kit workbook.
- **Confirmed via `xlsx` dump of the new workbook (29 sheets):** every sheet name the importer reads is present and unchanged by the rebrand — `PVT Car MMV`, `GCV MMV`, `PCV MMV` (cols `PASIA_CODE, VEHICLE_MAKE, VEHICLE_MODEL, Variant_Name, VEHICLE_TYPE, FUEL_TYPE, BODY_TYPE, CC, GVW, SEATING_CAPACITY, CARRYING_CAPACITY, VEHICLE_STATUS, VEHICLE_TYPE2, BANCS_MODEL_CODE, VEHICLE_CODE`), `RTO Code` (`RTO Code, RTO State, RTO DISTRICT, RTO City`), `Add On Covers`, `Pincode Master`/`Pincode Master1`/`Pincode Master2` (`PINCODE, AREA, CITY_DISTRICT, STATE`), `Occupation Code` (`Occupation Code, Occupation Description`), `TP Policy Insurer` (`TPCompanyDescription, ClientCode`), plus a `PYP Policy Insurer` (`ClientCode, InsuredName`) sheet the importer does **not** read.
- **Exact counts the importer produces from the new workbook** (computed by replaying the importer's dedup/filter rules over the workbook — these are the assertion targets):

  | Table | Filter | Count |
  |---|---|---|
  | `mmv_master` (`source="fg"`, `isActive=true`) | unique `(VEHICLE_MAKE\|PASIA_CODE\|normalizedFuel)` over PVT+GCV+PCV, skipping `VEHICLE_STATUS=InActive` (6,140 skipped) | **20310** |
  | `rto_master` (`source="fg"`, `isActive=true`) | unique uppercased `RTO Code` | **1535** |
  | `occupation_master` (all) | unique `Occupation Code` | **140** |
  | `insurer_master` (`source="fg"`) | unique `ClientCode` from `TP Policy Insurer` | **24** |
  | `motor_addons` (`providerSlug="fg"`) | `Add On Covers` CoverCodes matching `/^[A-Z]{4,6}$/` | **17** |
  | `pincode_master` (all) | rows with a `PINCODE` across the 3 sheets (no unique key → no de-dup) | **168011** |

- **Known pre-existing importer quirks (do NOT "fix" in this plan — masters are meant to be re-imported as-is):**
  1. The Add-On regex `/^[A-Z]{4,6}$/` silently drops **alphanumeric** CoverCodes, so GCV towing add-ons **`AT10K` and `AT20K`** are excluded (hence 17, not 19). Identical behaviour on the old workbook. Surfaced as a data note, not a code change.
  2. The importer ingests only `TP Policy Insurer` (24 codes, used for `PreviousTPInsDtls.PreviousInsurer` on standalone-OD). The `PYP Policy Insurer` sheet (**30** rollover `ClientCode`s) is **not imported**. The parity script surfaces this gap (see §Open confirmations).
- **CRITICAL — production safety (CLAUDE.md + project memory):** the master/provider-code tables are PRODUCTION and feed the live FG resolver (`src/providers/fg/db-code-resolver.ts`). The importer is idempotent + partition-scoped (`UPDATE … isActive=false WHERE source="fg"` then UPSERT; it never deletes `ProviderMmvCode`/`ProviderRtoCode`, so ICICI's FK references survive). The parity script is **strictly read-only**. Never wipe or override these tables to make an assertion pass.
- **Test DB target juggling:** the `db:import:fg` npm script hardcodes `--env-file=.env` (→ `tf_api_dev`). To import into `tf_api_test` we bypass the npm wrapper and set `DATABASE_URL` in the shell (PrismaClient reads it from `process.env`). Do **not** rely on Node `--env-file` for the test run — an already-set `DATABASE_URL` and the file can disagree; setting the shell var is unambiguous. Vitest itself sets `DATABASE_URL=…/tf_api_test` for all test files (`vitest.config.ts`), so the count test connects to the test DB automatically.

---

## File Structure

**New files**

- `scripts/lib/fg-master-sheets.ts` — single source of truth for the workbook's sheet names, MMV columns, the new default XLS path, and the pure parse helpers (`str`, `normalizeFuel`, `deriveZone`, `intOrNull`, `numStr`, `mmvKey`, `METRO_CITIES`). Imported by both the importer and the parity script so they can never drift. No I/O, no DB — safe to import from tests.
- `scripts/lib/keyed-diff.ts` — a pure `diffKeyed()` set/field diff + `KeyedDiff` type. No I/O — safe to import from tests.
- `scripts/verify-fg-master-parity.ts` — read-only CLI that diffs the workbook vs the live DB (`source="fg"`) for MMV / RTO / insurer ClientCodes and surfaces the PYP gap. Never writes.
- `scripts/__tests__/fg-master-sheets.test.ts` — opens the real new workbook via `xlsx` and asserts every expected sheet + MMV column is present (rebrand-rename guard). No DB.
- `scripts/__tests__/keyed-diff.test.ts` — pure unit test for `diffKeyed()`. No DB.
- `scripts/__tests__/fg-master-import-counts.test.ts` — asserts the exact `tf_api_test` row counts + PASIA_CODE spot-checks after the import. Reads `tf_api_test`.

**Modified files**

- `scripts/import-fg-master.ts` — import constants/helpers from `scripts/lib/fg-master-sheets.ts`; replace inline sheet-name literals with the shared constants; add `--xls=` CLI-arg resolution and repoint the default to the new JSON-kit workbook.
- `package.json` — add the `db:verify:fg` script.

---

## Task 1: Centralise the workbook shape + guard against a rebranded rename

**Files:**
- Create: `scripts/lib/fg-master-sheets.ts`
- Test: `scripts/__tests__/fg-master-sheets.test.ts`
- Modify: `scripts/import-fg-master.ts`

- [ ] **Step 1: Create the shared sheet/column/helper module**

Create `scripts/lib/fg-master-sheets.ts`:

```ts
/**
 * Single source of truth for the FG "Motor field Master.xls" shape + the pure parse
 * helpers shared by the importer (scripts/import-fg-master.ts) and the read-only parity
 * check (scripts/verify-fg-master-parity.ts). Keeping them here means a rebranded sheet
 * rename is caught by scripts/__tests__/fg-master-sheets.test.ts, and the importer and
 * the parity diff can never drift apart. No I/O — safe to import from tests.
 */

/** New (JSON-kit, rebranded Generali Central) master workbook. Double space in the
 *  filename is intentional. Overridable per-run via --xls= or FG_MASTER_XLS. */
export const FG_MASTER_DEFAULT_PATH =
  "C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/FG API Kit/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor KIT - JSON/Motor field  Master.xls";

/** Exact sheet names the importer reads (unchanged by the rebrand). */
export const FG_SHEETS = {
  pvtCarMmv: "PVT Car MMV",
  gcvMmv: "GCV MMV",
  pcvMmv: "PCV MMV",
  rto: "RTO Code",
  addOnCovers: "Add On Covers",
  pincode: ["Pincode Master", "Pincode Master1", "Pincode Master2"],
  occupation: "Occupation Code",
  tpInsurer: "TP Policy Insurer",
  pypInsurer: "PYP Policy Insurer", // NOT imported — surfaced as a gap by the parity check
} as const;

/** Columns every MMV sheet (PVT/GCV/PCV) must expose for pushMmv(). */
export const FG_MMV_COLUMNS = [
  "PASIA_CODE", "VEHICLE_MAKE", "VEHICLE_MODEL", "Variant_Name", "VEHICLE_TYPE",
  "FUEL_TYPE", "BODY_TYPE", "CC", "GVW", "SEATING_CAPACITY", "CARRYING_CAPACITY",
  "VEHICLE_STATUS",
] as const;

export const METRO_CITIES = new Set([
  "MUMBAI", "NAVI MUMBAI", "THANE", "DELHI", "NEW DELHI", "KOLKATA", "CHENNAI",
  "BANGALORE", "BENGALURU", "HYDERABAD", "AHMEDABAD", "PUNE",
]);

/** Coerce any cell to a trimmed string. */
export const str = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Whole-number cell → int, or null for blank / "NULL" / non-numeric. */
export const intOrNull = (v: unknown): number | null => {
  const cleaned = str(v).replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && str(v).toUpperCase() !== "NULL" && str(v) !== "" ? Math.round(n) : null;
};

/** intOrNull rendered as a string ("" for null) — used to compare numeric fields on
 *  both sides of the parity diff without format false-positives. */
export const numStr = (v: unknown): string => {
  const n = intOrNull(v);
  return n == null ? "" : String(n);
};

/** FG FUEL_TYPE (e.g. "BATTERY(B)", "PETROL") → canonical fuel used as a de-dup key part. */
export function normalizeFuel(raw: string): string {
  const v = raw.toUpperCase();
  if (v.includes("HYBRID")) return "hybrid";
  if (v.includes("DIESEL")) return "diesel";
  if (v.includes("BATTERY") || v.includes("ELECTRIC")) return "electric";
  if (v.includes("CNG")) return "cng";
  if (v.includes("LPG")) return "lpg";
  if (v.includes("PETROL")) return "petrol";
  return "petrol";
}

/** No RTO→zone in the FG master; derive it (metro city → "A", else "B"). */
export function deriveZone(city: string): string {
  return METRO_CITIES.has(city.toUpperCase()) ? "A" : "B";
}

/** Canonical MMV identity shared by the importer's de-dup and the parity diff. The
 *  importer stores makeId=VEHICLE_MAKE, modelId=PASIA_CODE, fuelType=normalizeFuel(...),
 *  so this same key joins workbook rows to DB rows. */
export function mmvKey(make: string, pasia: string, fuel: string): string {
  return `${make}|${pasia}|${fuel}`;
}
```

- [ ] **Step 2: Write the failing workbook-shape test**

Create `scripts/__tests__/fg-master-sheets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { FG_SHEETS, FG_MMV_COLUMNS, FG_MASTER_DEFAULT_PATH } from "../lib/fg-master-sheets.ts";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");
const XLS = process.env.FG_MASTER_XLS ?? FG_MASTER_DEFAULT_PATH;

describe("FG 'Motor field Master.xls' workbook shape (rebrand-rename guard)", () => {
  it("the new JSON-kit workbook file exists at the default path", () => {
    expect(existsSync(XLS)).toBe(true);
  });

  const wb = existsSync(XLS)
    ? XLSX.readFile(XLS)
    : ({ SheetNames: [] as string[], Sheets: {} } as ReturnType<typeof XLSX.readFile>);

  it("contains every sheet the importer reads", () => {
    const names = new Set(wb.SheetNames);
    const expected = [
      FG_SHEETS.pvtCarMmv, FG_SHEETS.gcvMmv, FG_SHEETS.pcvMmv, FG_SHEETS.rto,
      FG_SHEETS.addOnCovers, FG_SHEETS.occupation, FG_SHEETS.tpInsurer, ...FG_SHEETS.pincode,
    ];
    for (const name of expected) expect(names.has(name), `missing sheet "${name}"`).toBe(true);
  });

  it("every MMV sheet exposes the columns pushMmv() needs", () => {
    for (const sheetName of [FG_SHEETS.pvtCarMmv, FG_SHEETS.gcvMmv, FG_SHEETS.pcvMmv]) {
      // noUncheckedIndexedAccess: Sheets[name] is WorkSheet | undefined — narrow before sheet_to_json.
      const ws = wb.Sheets[sheetName];
      if (!ws) throw new Error(`missing sheet "${sheetName}"`);
      const hdr = (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] ?? []) as unknown[];
      const cols = new Set(hdr.map((h) => String(h).trim()));
      for (const c of FG_MMV_COLUMNS) expect(cols.has(c), `${sheetName} missing column "${c}"`).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run the shape guard — green baseline**

Run: `cd tf-api && npx vitest run scripts/__tests__/fg-master-sheets.test.ts`
Expected: **PASS — 3 tests pass.** The module was created in Step 1 and the real workbook exists, so this is a green baseline, not a red checkpoint: it confirms `../lib/fg-master-sheets.ts` resolves and that the current workbook already matches the expected sheet names + MMV columns. This guard's value is regression: it flips to RED only if a future rebrand renames a sheet or drops a column (that is what it protects against — verify by temporarily editing an `FG_SHEETS` value and re-running if you want to see it fail).

- [ ] **Step 4: Refactor the importer to consume the shared constants/helpers**

In `scripts/import-fg-master.ts`:

Add the import after the existing `@prisma/client` import (line ~14):

```ts
import {
  FG_SHEETS, FG_MASTER_DEFAULT_PATH, normalizeFuel, deriveZone,
} from "./lib/fg-master-sheets.ts";
```

Delete the now-duplicated local declarations. Remove the `METRO_CITIES` block (lines ~26-39), the local `normalizeFuel` function (lines ~48-57), and the local `deriveZone` function (lines ~59-61). `METRO_CITIES` is now encapsulated inside the imported `deriveZone`, so it is **not** imported into the importer (importing it unused would trip `no-unused-vars`). Keep the local `s`, `intOrNull`, and `maxAge` helpers as they are.

Replace the sheet-name string literals with the shared constants:

```ts
  for (const r of sheet(FG_SHEETS.pvtCarMmv)) pushMmv(r, "fourWheeler");
  for (const r of sheet(FG_SHEETS.gcvMmv)) pushMmv(r, "commercial");
  for (const r of sheet(FG_SHEETS.pcvMmv)) pushMmv(r, "commercial");
```

```ts
  const rtoRows = sheet(FG_SHEETS.rto)
```

```ts
  for (const row of grid(FG_SHEETS.addOnCovers)) {
```

```ts
  for (const name of FG_SHEETS.pincode) {
```

```ts
  const occRows = sheet(FG_SHEETS.occupation)
```

```ts
  const insurerRows = grid(FG_SHEETS.tpInsurer)
```

Finally, repoint the workbook path in the **same** step so `FG_MASTER_DEFAULT_PATH` is used immediately (it must be, or `noUnusedLocals` fails Step 6's typecheck with TS6133). Replace the existing `XLS_PATH` declaration — currently the `process.env.FG_MASTER_XLS ?? "…XML…/Motor field  Master.xls"` constant (lines ~22-24) — with CLI-arg-first resolution that consumes the new default:

```ts
// Workbook path precedence: --xls=<path>  >  FG_MASTER_XLS env  >  new JSON-kit default.
const argXls = process.argv.find((a) => a.startsWith("--xls="))?.split("=")[1];
const XLS_PATH = argXls ?? process.env.FG_MASTER_XLS ?? FG_MASTER_DEFAULT_PATH;
```

> Folding the repoint in here (rather than in Task 2) means every imported symbol — including `FG_MASTER_DEFAULT_PATH` — is used the moment it is introduced, so Task 1's typecheck gate (Step 6) passes cleanly under `noUnusedLocals`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tf-api && npx vitest run scripts/__tests__/fg-master-sheets.test.ts`
Expected: PASS — 3 tests pass (file exists; all sheets present; all MMV columns present).

- [ ] **Step 6: Typecheck the refactor**

Run: `cd tf-api && npm run typecheck`
Expected: exits 0 (no type errors). Confirms the importer still compiles after moving the helpers out.

- [ ] **Step 7: Commit**

```bash
cd tf-api
git add scripts/lib/fg-master-sheets.ts scripts/__tests__/fg-master-sheets.test.ts scripts/import-fg-master.ts
git commit -m "refactor(fg-import): centralise workbook sheet/column constants + --xls arg/new-default repoint; guard against rebrand renames"
```

---

## Task 2: Assert exact row counts on the test DB (new workbook)

**Files:**
- Test: `scripts/__tests__/fg-master-import-counts.test.ts`

> The `--xls=` arg resolution + new-default repoint of `scripts/import-fg-master.ts` was folded into **Task 1 Step 4** (so `FG_MASTER_DEFAULT_PATH` is used in the task it is imported, keeping Task 1's typecheck green). This task consumes that change; it does not edit `import-fg-master.ts` again.

- [ ] **Step 1: Verify the importer already resolves the new workbook (done in Task 1)**

Confirm `scripts/import-fg-master.ts` already contains the CLI-arg-first `XLS_PATH` resolution added in Task 1 Step 4 — no new edit here:

```ts
// Workbook path precedence: --xls=<path>  >  FG_MASTER_XLS env  >  new JSON-kit default.
const argXls = process.argv.find((a) => a.startsWith("--xls="))?.split("=")[1];
const XLS_PATH = argXls ?? process.env.FG_MASTER_XLS ?? FG_MASTER_DEFAULT_PATH;
```

(`FG_MASTER_DEFAULT_PATH` is imported from `./lib/fg-master-sheets.ts` in Task 1.) If it is missing, apply Task 1 Step 4's repoint before proceeding.

- [ ] **Step 2: Write the row-count + spot-check assertion test**

Create `scripts/__tests__/fg-master-import-counts.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

// Vitest sets DATABASE_URL → tf_api_test (vitest.config.ts), so this reads the TEST DB.
const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });

/**
 * Expected counts after `import-fg-master.ts` runs from the NEW JSON-kit workbook against
 * a freshly-migrated tf_api_test. Numbers are derived from the workbook by replaying the
 * importer's de-dup/filter rules (see docs/superpowers/plans/2026-07-22-fg-masters-reimport-verification.md).
 * MMV/RTO use the isActive+source guard so a stale prior import can't skew them.
 */
describe("FG master import row counts (tf_api_test)", () => {
  it("MmvMaster(fg) active rows = 20310", async () => {
    expect(await prisma.mmvMaster.count({ where: { source: "fg", isActive: true } })).toBe(20310);
  });

  it("RtoMaster(fg) active rows = 1535", async () => {
    expect(await prisma.rtoMaster.count({ where: { source: "fg", isActive: true } })).toBe(1535);
  });

  it("OccupationMaster rows = 140", async () => {
    expect(await prisma.occupationMaster.count()).toBe(140);
  });

  it("InsurerMaster(fg) rows = 24 (TP Policy Insurer ClientCodes)", async () => {
    expect(await prisma.insurerMaster.count({ where: { source: "fg" } })).toBe(24);
  });

  it("MotorAddon(fg) rows = 17 (AT10K/AT20K excluded by the /^[A-Z]{4,6}$/ regex)", async () => {
    expect(await prisma.motorAddon.count({ where: { providerSlug: "fg" } })).toBe(17);
  });

  it("PincodeMaster rows = 168011", async () => {
    expect(await prisma.pincodeMaster.count()).toBe(168011);
  });

  it("spot-checks known PASIA_CODEs (modelId) resolve to the right make/model", async () => {
    const audi = await prisma.mmvMaster.findFirst({ where: { modelId: "AU0229" } });
    expect(audi?.makeName).toBe("AUDI");
    expect(audi?.modelName).toBe("A4");

    expect(await prisma.mmvMaster.findFirst({ where: { modelId: "BM0202" } })).not.toBeNull();

    const alfa = await prisma.mmvMaster.findFirst({ where: { modelId: "AF0001" } });
    expect(alfa?.makeName).toBe("ALFA ROMEO");
  });
});
```

- [ ] **Step 3: Clean-slate the test DB (empty masters), then run the count test to see it fail**

Ensure the MySQL container is up (`npm run db:up` if needed). Reset the test schema so the masters start empty and the insurer count is deterministic:

Bash (Git Bash):
```bash
cd tf-api
DATABASE_URL="mysql://root:password@localhost:3306/tf_api_test" npx prisma migrate reset --force --skip-seed
```
PowerShell equivalent:
```powershell
cd tf-api
$env:DATABASE_URL = "mysql://root:password@localhost:3306/tf_api_test"
npx prisma migrate reset --force --skip-seed
```

Then run the count test:

Run: `cd tf-api && npx vitest run scripts/__tests__/fg-master-import-counts.test.ts`
Expected: FAIL — every count is `0` (masters empty), e.g. `expected 0 to be 20310`, and the spot-check `audi?.makeName` is `undefined`.

- [ ] **Step 4: Import the new workbook into the test DB**

Bash (Git Bash):
```bash
cd tf-api
DATABASE_URL="mysql://root:password@localhost:3306/tf_api_test" \
  npx tsx scripts/import-fg-master.ts \
  --xls="C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/FG API Kit/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor KIT - JSON/Motor field  Master.xls"
```
PowerShell equivalent (the `DATABASE_URL` from Step 3 is still set in this shell):
```powershell
cd tf-api
npx tsx scripts/import-fg-master.ts --xls="C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/FG API Kit/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor KIT - JSON/Motor field  Master.xls"
```

Expected stdout (the importer logs `<label>: <n> rows` per table):
```
Reading C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/FG API Kit/…/Motor field  Master.xls …
Refreshing FG-owned master rows (upsert; no destructive wipe) …
  MmvMaster(fg): 20310 rows
  RtoMaster(fg): 1535 rows
  MotorAddon(fg): 17 rows
  PincodeMaster: 168011 rows
  OccupationMaster: 140 rows
  InsurerMaster(fg): 24 rows
FG master import complete.
```

> If you used PowerShell, unset the override afterwards so later dev-DB steps don't accidentally hit the test DB: `Remove-Item Env:\DATABASE_URL`.

- [ ] **Step 5: Run the count test to verify it passes**

Run: `cd tf-api && npx vitest run scripts/__tests__/fg-master-import-counts.test.ts`
Expected: PASS — all 7 tests pass (counts 20310 / 1535 / 140 / 24 / 17 / 168011; spot-checks resolve).

- [ ] **Step 6: Commit**

```bash
cd tf-api
git add scripts/__tests__/fg-master-import-counts.test.ts
git commit -m "test(fg-import): assert new JSON-kit workbook row counts on tf_api_test"
```

---

## Task 3: Non-destructive parity check (workbook vs live DB)

**Files:**
- Create: `scripts/lib/keyed-diff.ts`
- Create: `scripts/verify-fg-master-parity.ts`
- Test: `scripts/__tests__/keyed-diff.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing pure diff test**

Create `scripts/__tests__/keyed-diff.test.ts` (the `diffKeyed` helper it imports does not exist yet — that is deliberate, so Step 2 sees a true red):

```ts
import { describe, it, expect } from "vitest";
import { diffKeyed } from "../lib/keyed-diff.ts";

describe("diffKeyed", () => {
  type Row = { name: string; gvw: string };
  const wb = new Map<string, Row>([
    ["A", { name: "Audi", gvw: "0" }], // unchanged
    ["B", { name: "Bmw", gvw: "1500" }], // changed gvw
    ["C", { name: "Cadillac", gvw: "0" }], // added (not in db)
  ]);
  const db = new Map<string, Row>([
    ["A", { name: "Audi", gvw: "0" }],
    ["B", { name: "Bmw", gvw: "1200" }],
    ["Z", { name: "Zeta", gvw: "0" }], // removed (not in wb)
  ]);

  it("classifies added / removed / changed / unchanged", () => {
    const d = diffKeyed(wb, db, ["name", "gvw"]);
    expect(d.added).toEqual(["C"]);
    expect(d.removed).toEqual(["Z"]);
    expect(d.changed).toEqual([{ key: "B", field: "gvw", from: "1200", to: "1500" }]);
    expect(d.unchanged).toBe(1);
  });

  it("only diffs the requested fields", () => {
    const d = diffKeyed(wb, db, ["name"]); // ignore gvw → B is now unchanged
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(2); // A and B
  });

  it("treats null/undefined and missing as empty-string-equal", () => {
    const a = new Map([["K", { name: "x", gvw: "" }]]);
    const b = new Map([["K", { name: "x", gvw: undefined as unknown as string }]]);
    expect(diffKeyed(a, b, ["gvw"]).changed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tf-api && npx vitest run scripts/__tests__/keyed-diff.test.ts`
Expected: **FAIL** — the import of `../lib/keyed-diff.ts` cannot be resolved (the helper does not exist yet). Vitest reports a transform/resolve error for the test file — a genuine red before the implementation lands.

- [ ] **Step 3: Create the pure diff helper**

Create `scripts/lib/keyed-diff.ts`:

```ts
/** Pure set/field diff between two identically-keyed maps. No I/O — unit-tested. */
export interface KeyedDiff {
  added: string[]; // keys in `wb` but not `db`
  removed: string[]; // keys in `db` but not `wb`
  changed: { key: string; field: string; from: unknown; to: unknown }[];
  unchanged: number;
}

/**
 * Diffs a workbook map (`wb`) against a DB map (`db`). For keys common to both, compares
 * each field in `fields` by stringified value (pre-normalise numerics with numStr before
 * building the maps to avoid format false-positives).
 */
export function diffKeyed<T extends Record<string, unknown>>(
  wb: Map<string, T>,
  db: Map<string, T>,
  fields: (keyof T)[],
): KeyedDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: { key: string; field: string; from: unknown; to: unknown }[] = [];
  let unchanged = 0;

  for (const [k, wv] of wb) {
    const dv = db.get(k);
    if (!dv) { added.push(k); continue; }
    let dirty = false;
    for (const f of fields) {
      if (String(wv[f] ?? "") !== String(dv[f] ?? "")) {
        changed.push({ key: k, field: String(f), from: dv[f], to: wv[f] });
        dirty = true;
      }
    }
    if (!dirty) unchanged++;
  }
  for (const k of db.keys()) if (!wb.has(k)) removed.push(k);

  return { added, removed, changed, unchanged };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tf-api && npx vitest run scripts/__tests__/keyed-diff.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Create the read-only parity script**

Create `scripts/verify-fg-master-parity.ts`:

```ts
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
```

- [ ] **Step 6: Add the `db:verify:fg` npm script**

In `package.json`, add the line after `"db:import:icici"`:

```json
    "db:verify:fg": "tsx --env-file=.env scripts/verify-fg-master-parity.ts",
```

- [ ] **Step 7: Smoke-run the parity script against the dev DB (preview delta)**

Ensure `tf_api_dev` is up and seeded (`npm run db:up` then, if the dev DB is empty, `npm run db:migrate` + `npm run db:seed`). Then:

Run: `cd tf-api && npm run db:verify:fg`
Expected: it prints the four sections and a `SUMMARY` line, and exits 0. Because the dev DB currently holds the OLD (XML-kit) FG import, this preview may show a non-zero delta (e.g. MMV `added`/`changed` where the new workbook differs) — that is the informative before-picture. It must run to completion with **no DB writes** and no exception. (Task 4 re-runs it after importing the new workbook to confirm the delta collapses to zero.)

- [ ] **Step 8: Commit**

```bash
cd tf-api
git add scripts/lib/keyed-diff.ts scripts/__tests__/keyed-diff.test.ts scripts/verify-fg-master-parity.ts package.json
git commit -m "feat(fg-import): read-only workbook↔DB parity check (MMV/RTO/insurer + PYP gap)"
```

---

## Task 4: Real idempotent import into the dev DB + prove idempotency

**Files:** none (operational task — runs the importer/parity against `tf_api_dev`).

> This step touches the PRODUCTION-shaped dev DB. The importer is idempotent and source-scoped and never deletes provider codes; still, snapshot first so the run is reversible.

- [ ] **Step 1: Snapshot the dev DB before the import (reversibility)**

Run: `cd tf-api && npm run db:export`
Expected: writes a snapshot of the seed-relevant tables (per `scripts/export-data.ts`) — a restore point if anything looks wrong.

- [ ] **Step 2: Run the real import into the dev DB (new default workbook)**

Run: `cd tf-api && npm run db:import:fg`
Expected stdout ends with `FG master import complete.` and logs `MmvMaster(fg): 20310 rows`, `RtoMaster(fg): 1535 rows`, `MotorAddon(fg): 17 rows`, `PincodeMaster: 168011 rows`, `OccupationMaster: 140 rows`, `InsurerMaster(fg): 24 rows`. (`db:import:fg` now defaults to the new JSON-kit workbook — no `--xls` needed.)

- [ ] **Step 3: Parity must now be zero-drift**

Run: `cd tf-api && npm run db:verify:fg`
Expected: `SUMMARY: MMV Δ=0, RTO Δ=0, Insurer Δ=0. Removed total=0.` (the workbook now exactly matches the DB). The PYP data-gap line still reports `not present in insurer_master: 30` — that is expected and intentional (PYP is not imported).

- [ ] **Step 4: Re-run the import to prove idempotency (no duplicates, stable counts)**

Run: `cd tf-api && npm run db:import:fg`
Expected: identical row-count log as Step 2 (`MmvMaster(fg): 20310 rows`, … `InsurerMaster(fg): 24 rows`). Re-running does not create duplicates — MMV/RTO/insurer go through `upsert` on their unique keys; pincode/occupation/addon are delete-then-`createMany`.

- [ ] **Step 5: Confirm counts and zero-drift are unchanged after the second run**

Run: `cd tf-api && npm run db:verify:fg -- --strict`
Expected: `SUMMARY: MMV Δ=0, RTO Δ=0, Insurer Δ=0. Removed total=0.` and exit code 0 (no removals). Stable across the two imports ⇒ idempotent. Import order independence is inherent: the importer only ever touches `source="fg"` rows and never deletes `ProviderMmvCode`/`ProviderRtoCode`, so an ICICI import before/after is unaffected (do not re-verify ICICI here — it is out of scope for this plan).

- [ ] **Step 6: Full test + typecheck gate**

Run: `cd tf-api && npm run typecheck && npx vitest run scripts/__tests__/`
Expected: typecheck exits 0; all three new script test files pass (`fg-master-sheets`, `keyed-diff`, `fg-master-import-counts`).

> The `fg-master-import-counts` test reads `tf_api_test`. If Task 2's test-DB import has since been overwritten, re-run Task 2 Steps 3-4 (reset + import into `tf_api_test`) before this gate.

---

## Task 5: Record open confirmations + commit

**Files:**
- Modify: `docs/fg-rebranding-notes.md` (append a status line under §8 gap #7)

- [ ] **Step 1: Mark gap #7 done + record the two data gaps in the intel doc**

In `docs/fg-rebranding-notes.md`, under the `## 8. Gap list` item **7. Masters re-import**, append:

```markdown
   - ✅ DONE (2026-07-22): re-imported from the new JSON-kit `Motor field Master.xls` via `db:import:fg`; parity verified zero-drift (`db:verify:fg`), idempotency proven (double-import, stable counts 20310 MMV / 1535 RTO / 140 occ / 24 insurer / 17 addon / 168011 pincode). Two DATA GAPS remain, both open with GCI (not code):
     - **PYP Policy Insurer** (30 rollover `ClientCode`s) is not ingested — the importer only reads `TP Policy Insurer` (24 codes, standalone-OD). Confirm whether rollover `PreviousInsDtls.ClientCode` must resolve against PYP.
     - Add-On CoverCodes with digits (**AT10K, AT20K** GCV towing) are dropped by the importer's `/^[A-Z]{4,6}$/` filter (pre-existing; unchanged by rebrand).
     - Production insurer `ClientCode` master + declined-RTO/MMV/blacklist masters are NOT in the workbook (only in test cases) — get authoritative decline masters + prod `ClientCode` list from GCI (already tracked in §10 #12).
```

- [ ] **Step 2: Commit**

```bash
cd tf-api
git add docs/fg-rebranding-notes.md
git commit -m "docs(fg): mark masters re-import verified; record PYP + decline-master data gaps"
```

---

## Self-Review

**Spec coverage** (against the task's four goals + suggested tasks):

| Requirement | Task |
|---|---|
| (a) Confirm sheet names/columns match; fix if a rebranded sheet was renamed | Task 1 (shared constants + workbook-shape guard test). Verified: **no rename** — all names/columns match. |
| (b) Dry-run import against TEST DB; assert row counts + PASIA_CODE spot-check | Task 2 (import into `tf_api_test`; 6 exact counts + 3 spot-checks) |
| (c) Non-destructive parity script diffing DB vs workbook (adds/removes/changes; new ClientCodes; MMV; RTO) + a test | Task 3 (`verify-fg-master-parity.ts` read-only; `diffKeyed` unit-tested) |
| (d) Capture that decline/blacklist masters are not in the workbook (data-gap, not code) | Task 5 note + PYP gap surfaced live by the parity script |
| Suggested task 4: real idempotent import + re-run to prove no dupes | Task 4 |
| Suggested task 5: commit | every task ends in a commit; Task 5 records the GCI open confirmations |
| Production safety: idempotent, source-tagged, upserted, never wiped; import order independence | encoded in Task 4 Steps 4-5 + Context section; the parity script is read-only |
| Tests against `tf_api_test`; ESM `.ts` imports, `@/*` alias | Task 2 test reads `tf_api_test`; all new modules use `.ts` extension imports |

**Placeholder scan:** none — every step has real code, real commands, and real expected counts/output.

**Type consistency:** `mmvKey`, `str`, `normalizeFuel`, `deriveZone`, `numStr`, `intOrNull`, `FG_SHEETS`, `FG_MASTER_DEFAULT_PATH` are defined once in `scripts/lib/fg-master-sheets.ts` and consumed identically by the importer, the parity script, and the tests. `diffKeyed`/`KeyedDiff` are defined once in `scripts/lib/keyed-diff.ts`. The importer stores `makeId=VEHICLE_MAKE`, `modelId=PASIA_CODE`, `fuelType=normalizeFuel(...)`, so `mmvKey(makeId, modelId, fuelType)` joins DB rows to workbook rows on both sides.

## Open confirmations (GCI — carry into go-live)

1. **PYP Policy Insurer master (30 ClientCodes)** — is a separate rollover `PreviousInsDtls.ClientCode` master required, or does `TP Policy Insurer` cover both flows? Currently only TP (24) is imported.
2. **AT10K / AT20K GCV towing add-ons** — dropped by the importer's alpha-only CoverCode regex. Confirm whether web-agg offers them (if so, widen the regex to accept alphanumerics — out of scope here).
3. **Production insurer `ClientCode` master + declined-RTO / declined-MMV / blacklist masters** — absent from the workbook (only in test cases). Source authoritative lists from GCI (tracked in `fg-rebranding-notes.md` §10 #12).

## Execution Handoff

Two options to execute this plan:
1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review between tasks (superpowers:subagent-driven-development).
2. **Inline Execution** — batch execution with checkpoints in this session (superpowers:executing-plans).

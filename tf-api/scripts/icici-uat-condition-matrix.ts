/**
 * ICICI UAT full condition-coverage matrix: 4 business types (Rollover / Breakin /
 * Renewal / new) × 3 plan types (Third Party / Own Damage / Comprehensive) = 12 rows,
 * for all three integrated lines (4W/2W/CV) — the grid ICICI's own template groups by
 * category.
 *
 * Quote-level only (no CKYC/proposal): the CKYC blocker (needs a real UAT-seeded PAN/
 * Aadhaar — synthetic identities are rejected) already fully documented once in
 * docs/icici-uat-scenarios.md Open item 1 and applies uniformly regardless of which of
 * these cells it's attached to, so repeating it adds no new evidence.
 * What IS new here: live confirmation of which (business, plan) combos ICICI actually
 * prices vs. correctly rejects (no product for that combo), and the real premium/
 * TransactionId for every priceable cell.
 *
 * "Breakin" is not a distinct ICICI product — it's businessType:"rollover" with an
 * expired previous policy (isPreviousPolicyExpired:true), reusing the rollover product
 * codes; see src/providers/icici/config.ts resolveProductCode.
 *
 * CV is a reduced-evidence line: ICICI has never delivered a CV make/model/RTO master
 * (see docs/icici-uat-scenarios.md), so only the Rollover group has a confirmed vehicle
 * (ICICI's own documented Save-Quote sample) — Breakin/Renewal/New cells that would
 * need a real vehicle are marked `blocked` rather than reusing that one vehicle across
 * a different policy state; cells ICICI has no product for at all (e.g. every Own
 * Damage cell) are still fully tested, since a rejection never touches the network.
 *
 * Uses REAL ICICI UAT Make/Model/RTO codes directly (passthroughCodeResolver), same
 * roster as scripts/icici-uat-scenarios.ts. No DB/Prisma dependency.
 *
 *   npx tsx --env-file=.env scripts/icici-uat-condition-matrix.ts [--line=fw|tw|cv|both|all] [--dry-run] [--rps=2]
 *
 * Writes scripts/_icici-uat-condition-matrix-results.json and
 * docs/icici-uat-condition-matrix.xlsx (one tab per line, ICICI's grid layout).
 */
import { createRequire } from "node:module";
import { writeFileSync, readFileSync } from "node:fs";
import { IciciProvider, passthroughCodeResolver } from "@/providers/icici/icici.provider.ts";
import { loadIciciConfig } from "@/providers/icici/config.ts";
import { buildSaveQuotePayload } from "@/providers/icici/mapper.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import type { VehicleCategory, BusinessType, PolicyType } from "@/contracts/enums.ts";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.includes(`--${k}`);
const LINE_FILTER = (arg("line") ?? "both") as "fw" | "tw" | "cv" | "both" | "all";
const DRY_RUN = has("dry-run");
const RPS = Number(arg("rps") ?? 2);
const REGEN_ONLY = has("regen"); // rebuild the xlsx from the last saved results, no live calls
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RESULTS_JSON = `${import.meta.dirname}/_icici-uat-condition-matrix-results.json`;
const OUT_XLSX = `${import.meta.dirname}/../docs/icici-uat-condition-matrix.xlsx`;

const todayIso = () => new Date().toISOString().slice(0, 10);
function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type Line = "fw" | "tw" | "cv";
type Plan = PolicyType;
/** Sheet-facing category label — "breakin" is a flow variant of rollover, not a distinct businessType. */
type BizGroup = "rollover" | "breakin" | "renewal" | "new";

// ─── ICICI Product Master (mirrors src/providers/icici/config.ts PRODUCT_CODES) ────
// Undefined cell = ICICI has no product for that combo → request must be REJECTED
// (ProviderCapabilityError), not mis-priced. Matches docs/icici-test-cases.md's
// documented "3 rejected rows per wheel" (new+OD, new+TP, renewal+OD).
// cv = PCV class only (the one class we have a confirmed-live vehicle for). CV has no
// standAloneOD product at all in any class, and no new+thirdParty for PCV — both are
// genuine "always REJECT" cells here, not an artifact of missing vehicle data.
const PRODUCT_CODES: Record<Line, Partial<Record<BusinessType, Partial<Record<Plan, number>>>>> = {
  tw: {
    new: { comprehensive: 10 },
    rollover: { comprehensive: 13, standAloneOD: 16, thirdParty: 26 },
    renewal: { comprehensive: 13, thirdParty: 26 },
  },
  fw: {
    new: { comprehensive: 20 },
    rollover: { comprehensive: 21, standAloneOD: 22, thirdParty: 29 },
    renewal: { comprehensive: 21, thirdParty: 29 },
  },
  cv: {
    new: { comprehensive: 49 },
    rollover: { comprehensive: 41, thirdParty: 42 },
    renewal: { comprehensive: 41, thirdParty: 42 },
  },
};
function expectedProductCode(line: Line, biz: BusinessType, plan: Plan): number | undefined {
  return PRODUCT_CODES[line][biz]?.[plan];
}

// ─── Vehicle roster — same real ICICI UAT rows as scripts/icici-uat-scenarios.ts ───
interface IciciVehicle {
  makeCode: number;
  makeName: string;
  modelCode: number;
  modelName: string;
  rtoCode: number;
  rtoCity: string;
  pincode: string;
}
// 4W: docs/icici-test-cases.md's V1-V4 roster no longer resolves live ("Vehicle details
// not found", confirmed 2026-07-07). A vehicle's insurance status (rollover / lapsed /
// renewing / brand-new) is inherently a single mutually-exclusive state, so each business
// category MUST use a genuinely distinct vehicle — one vehicle can't credibly represent
// four different states at once. Reusing a single anchor across all four (as an earlier
// version of this script did) was wrong; sourced 3 more confirmed-live 4W codes by
// probing ICICI's own delivered master (dock boyz/ICICI/UAT_MMV_Details) live at the
// Audi V6 anchor's RTO (2125) — mass-market economy models (Alto, i20) still return
// "Vehicle details not found", but every Audi model tried priced fine, plus one Honda.
const FW_VEHICLE: Record<BizGroup, IciciVehicle> = {
  new: { makeCode: 13, makeName: "AUDI", modelCode: 2046, modelName: "V6", rtoCode: 2125, rtoCity: "Dharampur (Gujarat)", pincode: "396050" },
  rollover: { makeCode: 7, makeName: "HONDA", modelCode: 2457, modelName: "CIVIC 1.8 MT", rtoCode: 2125, rtoCity: "Dharampur (Gujarat)", pincode: "396050" },
  breakin: { makeCode: 13, makeName: "AUDI", modelCode: 2908, modelName: "AUDI Q7", rtoCode: 2125, rtoCity: "Dharampur (Gujarat)", pincode: "396050" },
  renewal: { makeCode: 13, makeName: "AUDI", modelCode: 12197, modelName: "A6 2.8 FSI", rtoCode: 2125, rtoCity: "Dharampur (Gujarat)", pincode: "396050" },
};
// 2W: mirrors docs/icici-test-cases.md's W1-W4 assignment (New→Jupiter, Rollover→Splendor,
// Breakin→Pulsar150, Renewal→Pulsar180) for continuity with the existing documented roster
// — already one distinct vehicle per category, no change needed.
const TW_VEHICLE: Record<BizGroup, IciciVehicle> = {
  new: { makeCode: 39, makeName: "TVS", modelCode: 17877, modelName: "JUPITER", rtoCode: 192, rtoCity: "Mumbai", pincode: "400001" },
  rollover: { makeCode: 32, makeName: "HERO", modelCode: 21646, modelName: "SPLENDOR PLUS DRUM", rtoCode: 634, rtoCity: "Pune", pincode: "411001" },
  breakin: { makeCode: 31, makeName: "BAJAJ", modelCode: 12637, modelName: "PULSAR 150", rtoCode: 2029, rtoCity: "Thane", pincode: "400601" },
  renewal: { makeCode: 31, makeName: "BAJAJ", modelCode: 380, modelName: "PULSAR 180", rtoCode: 412, rtoCity: "Nashik", pincode: "422001" },
};
// CV: ICICI has never delivered a CV make/model/RTO master (no CSV in dock boyz/ICICI —
// only the 2W/4W ones), and `commercial`/`newCommercial` aren't even advertised in
// ICICI_CAPABILITIES yet pending that data. The ONE CV vehicle confirmed live here is
// literally ICICI's own documented Save-Quote sample (dock boyz/ICICI/cv_out.txt §C) —
// a real recorded example (its TransactionId chains straight into their Proposal sample
// too), re-confirmed live 2026-07-08 as PCV/Roll Over (ProductCode 41). It's used ONLY
// for the Rollover group — Breakin/Renewal/New each need their own confirmed vehicle by
// the same rule as 4W/2W above, and we have no second one, so those QUOTE-expecting
// cells are marked `blocked` rather than reusing this vehicle across a different policy
// state. (Trying the same vehicle as GCV, and 3 nearby model codes, all returned
// "Vehicle make not found" — CV codes appear product-class-specific, not a shared pool.)
const CV_VEHICLE: IciciVehicle = { makeCode: 99, makeName: "ICICI Sample PCV", modelCode: 15425, modelName: "(make/model name not disclosed)", rtoCode: 3501, rtoCity: "Pune", pincode: "411001" };
const CV_CONFIRMED_GROUP: BizGroup = "rollover";

function vehicleFor(line: Line, g: BizGroup): IciciVehicle {
  if (line === "cv") return CV_VEHICLE; // placeholder outside CV_CONFIRMED_GROUP — see `blocked` in cellsFor
  return (line === "fw" ? FW_VEHICLE : TW_VEHICLE)[g];
}

// ─── Grid cells — order matches ICICI's own template image (top→bottom) ────────────
const GROUPS: { g: BizGroup; biz: BusinessType; breakin: boolean }[] = [
  { g: "rollover", biz: "rollover", breakin: false },
  { g: "breakin", biz: "rollover", breakin: true },
  { g: "renewal", biz: "renewal", breakin: false },
  { g: "new", biz: "new", breakin: false },
];
const PLANS: Plan[] = ["thirdParty", "standAloneOD", "comprehensive"];

interface Cell {
  line: Line;
  bizGroup: BizGroup;
  businessType: BusinessType;
  breakin: boolean;
  plan: Plan;
  vehicle: IciciVehicle;
  regNo?: string;
  expected: number | undefined; // undefined = expect REJECT
  /** True only when expected is a real product code but no confirmed vehicle exists for
   *  this group (CV Breakin/Renewal/New) — skipped entirely rather than fired live, since
   *  REJECT-expected cells never need a real vehicle (the rejection is a local product-code
   *  lookup that never reaches the network) but a QUOTE-expected cell genuinely does. */
  blocked: boolean;
  blockedReason?: string;
}

function cellsFor(line: Line): Cell[] {
  const cells: Cell[] = [];
  let seq = 0;
  for (const { g, biz, breakin } of GROUPS) {
    for (const plan of PLANS) {
      seq++;
      const expected = expectedProductCode(line, biz, plan);
      const blocked = line === "cv" && g !== CV_CONFIRMED_GROUP && expected !== undefined;
      cells.push({
        line, bizGroup: g, businessType: biz, breakin, plan,
        vehicle: vehicleFor(line, g),
        regNo: g === "new" ? undefined : `${line === "fw" ? "GJ07CM" : line === "cv" ? "MH12CV" : "MH12CM"}${String(seq).padStart(4, "0")}`,
        expected,
        blocked,
        blockedReason: blocked ? "No second confirmed CV vehicle — ICICI hasn't delivered the CV master (see docs/icici-uat-scenarios.md)" : undefined,
      });
    }
  }
  return cells;
}

// ─── Request builder ────────────────────────────────────────────────────────────
const DEFAULT_FLAGS = {
  zeroDep: false, engineProtect: false, rsa: false, tyreProtect: false, rimProtect: false,
  rti: false, consumables: false, paOwner: true, paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false, keyProtect: false, garageCash: false,
  lossOfBelongings: false, batteryProtect: false, drivingAccessories: false, ncbProtection: false,
};
function vehicleCategory(line: Line): VehicleCategory {
  return line === "fw" ? "fourWheeler" : line === "tw" ? "twoWheeler" : "commercial";
}
function buildRequest(c: Cell): MotorQuoteRequest {
  const v = c.vehicle;
  const isNew = c.bizGroup === "new";
  const isOD = c.plan === "standAloneOD";
  return {
    vehicleType: vehicleCategory(c.line),
    ...(c.line === "cv" ? { commercialSubType: "passenger" as const } : {}),
    selectedPolicy: c.plan,
    businessType: c.businessType,
    makeId: String(v.makeCode), makeName: v.makeName,
    modelId: String(v.modelCode), modelName: v.modelName,
    fuelType: c.line === "cv" ? "diesel" : "petrol",
    rtoCode: String(v.rtoCode),
    registrationNumber: c.regNo,
    registrationDate: isNew ? todayIso() : "2021-06-01",
    pincode: v.pincode,
    previousPolicyNumber: isNew ? undefined : `OLD-${c.line.toUpperCase()}-${c.bizGroup}`,
    previousInsurerId: isNew ? undefined : "GODI",
    previousPolicyExpiryDate: isNew ? undefined : c.breakin ? isoOffset(-45) : isoOffset(20),
    isPreviousPolicyExpired: c.breakin,
    claimInPreviousPolicy: false,
    ncbPercent: isNew ? 0 : 20,
    ...(isOD && !isNew ? { previousTpPolicyNumber: "TP-ACTIVE-001", previousTpStartDate: "2024-07-01", previousTpExpiryDate: "2026-12-31" } : {}),
    ...DEFAULT_FLAGS,
  };
}

/** The parsed ICICI response body carried on AppError.details (lost by .message alone). */
function errBody(e: unknown): Record<string, unknown> {
  const details = (e as { details?: unknown } | undefined)?.details;
  return details && typeof details === "object" ? (details as Record<string, unknown>) : {};
}
function errDetail(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const details = (e as { details?: unknown } | undefined)?.details;
  if (details === undefined) return msg;
  const body = typeof details === "string" ? details : JSON.stringify(details);
  return `${msg} :: ${body.slice(0, 300)}`;
}
function isTransientIciciError(e: unknown): boolean {
  const raw = `${e instanceof Error ? e.message : String(e)} ${JSON.stringify(errBody(e))}`;
  // Covers both the raw HTML gateway page ICICI sometimes wraps in a 200 body AND the
  // .NET HttpClient-style message ("Response status code does not indicate success:
  // 502 (Bad Gateway).") seen from a couple of cells in this run — neither is a real
  // business rejection, so match on the bare 50x code rather than one exact phrasing.
  return /\b50[234]\b|<html|ECONNRESET|ETIMEDOUT|fetch failed/i.test(raw);
}
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 2500): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransientIciciError(e) || i >= attempts) throw e;
      console.log(`   (transient gateway error, retry ${i}/${attempts - 1})`);
      await sleep(delayMs);
    }
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────
type Verdict = "PASS" | "FAIL" | "WARN" | "BLOCKED";
interface RowResult extends Cell {
  productCode?: number;
  transactionId?: string;
  grossPremium?: number;
  isInspectionRequired?: boolean;
  error?: string;
  verdict: Verdict;
}

async function main() {
  if (REGEN_ONLY) {
    const saved = JSON.parse(readFileSync(RESULTS_JSON, "utf8")) as { results: RowResult[] };
    writeWorkbook(saved.results);
    console.log(`Regenerated ${OUT_XLSX} from ${RESULTS_JSON} (${saved.results.length} cells, no live calls)`);
    return;
  }

  const lines: Line[] =
    LINE_FILTER === "all" ? ["fw", "tw", "cv"] : LINE_FILTER === "both" ? ["fw", "tw"] : [LINE_FILTER];
  const all = lines.flatMap(cellsFor);
  console.log(`ICICI UAT condition matrix: lines=${lines.join(",")} cells=${all.length} dryRun=${DRY_RUN}\n`);

  const provider = DRY_RUN ? undefined : new IciciProvider({ config: loadIciciConfig(), codeResolver: passthroughCodeResolver });
  const results: RowResult[] = [];

  for (const c of all) {
    const label = `[${c.line.toUpperCase()}] ${c.bizGroup}/${c.plan} — ${c.vehicle.makeName} ${c.vehicle.modelName}`;

    if (c.blocked) {
      console.log(`${label}: BLOCKED — ${c.blockedReason}`);
      results.push({ ...c, verdict: "BLOCKED", error: c.blockedReason });
      continue;
    }

    const req = buildRequest(c);

    if (!provider) {
      const codes = await passthroughCodeResolver(req);
      let productCode: number | undefined;
      let error: string | undefined;
      try {
        productCode = buildSaveQuotePayload(req, codes, "dry-run").payload.ProductCode as number;
      } catch (e) {
        error = errDetail(e);
      }
      const ok = c.expected === undefined ? productCode === undefined : productCode === c.expected;
      console.log(`${label}: expected=${c.expected ?? "REJECT"} got=${productCode ?? "REJECT"} ${ok ? "OK" : "⚠ MISMATCH"}`);
      results.push({ ...c, productCode, error, verdict: ok ? "PASS" : "FAIL" });
      continue;
    }

    try {
      const quote = await withRetry(() => provider.getQuote(req, { requestId: `icici-matrix-${c.line}-${c.bizGroup}-${c.plan}` }));
      const productCode = c.expected; // request succeeded, so the code we sent is the one ICICI accepted
      const verdict: Verdict = c.expected !== undefined ? "PASS" : "FAIL"; // succeeded when we expected a reject
      console.log(`${label}: QUOTED gross=₹${quote.grossPremium} TransactionId=${quote.transactionId} [${verdict}]`);
      results.push({
        ...c, productCode, transactionId: quote.transactionId || undefined,
        grossPremium: quote.grossPremium, isInspectionRequired: quote.isInspectionRequired, verdict,
      });
    } catch (e) {
      const rejectedAsExpected = c.expected === undefined;
      const msg = errDetail(e);
      const verdict: Verdict = rejectedAsExpected ? "PASS" : isTransientIciciError(e) ? "WARN" : "FAIL";
      console.log(`${label}: ${rejectedAsExpected ? "REJECTED (expected)" : "ERROR (unexpected)"} [${verdict}] ${msg.slice(0, 150)}`);
      results.push({ ...c, error: msg, verdict });
    }
    await sleep(1000 / RPS);
  }

  const tally = results.reduce<Record<Verdict, number>>((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), { PASS: 0, FAIL: 0, WARN: 0, BLOCKED: 0 });
  console.log(`\n═══ SUMMARY: ${results.length} cells — PASS ${tally.PASS} · FAIL ${tally.FAIL} · WARN ${tally.WARN} · BLOCKED ${tally.BLOCKED} ═══`);

  writeFileSync(RESULTS_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`Wrote ${RESULTS_JSON}`);
  writeWorkbook(results);
  console.log(`Wrote ${OUT_XLSX}`);
}

// ─── xlsx generation — ICICI's own grid layout: Category | Business | Plan | ... ──
const PLAN_LABEL: Record<Plan, string> = { thirdParty: "Third Party", standAloneOD: "Own Damage", comprehensive: "Comprehensive" };
const GROUP_LABEL: Record<BizGroup, string> = { rollover: "Rollover", breakin: "Breakin", renewal: "Renewal", new: "new" };

function resultCell(r: RowResult): string {
  if (r.verdict === "BLOCKED") return `⏸ BLOCKED — ${r.blockedReason}`;
  if (r.expected === undefined) return r.verdict === "PASS" ? "Correctly rejected — not offered" : `⚠ Unexpectedly quoted (ProductCode ${r.productCode})`;
  if (r.transactionId) return `Quoted — ₹${r.grossPremium?.toLocaleString("en-IN")}`;
  return `⚠ ${r.error?.slice(0, 80) ?? "error"}`;
}
const SHEET_NAME: Record<Line, string> = { fw: "4W", tw: "2W", cv: "CV" };

function writeWorkbook(results: RowResult[]): void {
  const wb = XLSX.utils.book_new();
  for (const line of ["fw", "tw", "cv"] as Line[]) {
    const rows = results.filter((r) => r.line === line);
    if (rows.length === 0) continue;
    const aoa: (string | number)[][] = [
      [SHEET_NAME[line], "", "", "Vehicle", "Reg No", "Product Code", "Transaction Id", "Gross Premium (UAT)", "Result"],
    ];
    for (const r of rows) {
      aoa.push([
        "", GROUP_LABEL[r.bizGroup], PLAN_LABEL[r.plan],
        r.verdict === "BLOCKED" ? "— (no confirmed vehicle)" : `${r.vehicle.makeName} ${r.vehicle.modelName}`,
        r.verdict === "BLOCKED" ? "—" : (r.regNo ?? "N/A (brand-new)"),
        r.expected ?? "—", r.transactionId ?? "", r.grossPremium ?? "",
        resultCell(r),
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Column A: "4W"/"2W"/"CV" merged across all 12 rows. Column B: business-type group
    // merged across its 3 plan rows — mirrors ICICI's own template image exactly.
    ws["!merges"] = [
      { s: { r: 1, c: 0 }, e: { r: 12, c: 0 } },
      { s: { r: 1, c: 1 }, e: { r: 3, c: 1 } },
      { s: { r: 4, c: 1 }, e: { r: 6, c: 1 } },
      { s: { r: 7, c: 1 }, e: { r: 9, c: 1 } },
      { s: { r: 10, c: 1 }, e: { r: 12, c: 1 } },
    ];
    ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 36 }];
    XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME[line]);
  }
  XLSX.writeFile(wb, OUT_XLSX);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

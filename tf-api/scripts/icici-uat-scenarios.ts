/**
 * ICICI UAT certification scenario runner + xlsx generator.
 *
 * Fires ICICI's 7 standard certification scenarios — policy without add-ons, policy
 * with add-ons, no break-in, claim=true, without claim, break-in, add-ons vs vehicle
 * age — for both integrated lines (2W/4W) against the LIVE ICICI UAT API, then writes
 * ICICI's POS-header scenario template to docs/icici-uat-scenario-sheet.xlsx.
 *
 * Uses REAL ICICI UAT Make/Model/RTO codes directly (passthroughCodeResolver — same
 * mechanism as src/providers/icici/__tests__/real-vehicle-coverage.test.ts) instead of
 * going through our own DB cross-walk, so results don't depend on that cross-walk's
 * accuracy (see docs/full-flow-test-cases.md Known Issue #2). No DB/Prisma dependency —
 * only ICICI_LOGIN/ICICI_PASSWORD (+ optional ICICI_AES_KEY) need to be set.
 *
 * Every proposal call sends isProposalOnly:true, amountCollected:0 — payment is never
 * bound (ICICI's /payment/initiate is 501 server-side; see docs/full-flow-test-cases.md).
 *
 *   npx tsx --env-file=.env scripts/icici-uat-scenarios.ts [--line=fw|tw|both] [--dry-run] [--rows=2,6] [--rps=2]
 *
 * Writes scripts/_icici-uat-scenario-results.json (raw per-row request/response) and
 * docs/icici-uat-scenario-sheet.xlsx.
 */
import { createRequire } from "node:module";
import { writeFileSync, readFileSync } from "node:fs";
import { IciciProvider, passthroughCodeResolver } from "@/providers/icici/icici.provider.ts";
import { loadIciciConfig } from "@/providers/icici/config.ts";
import { buildSaveQuotePayload } from "@/providers/icici/mapper.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { VehicleCategory, BusinessType } from "@/contracts/enums.ts";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.includes(`--${k}`);
const LINE_FILTER = (arg("line") ?? "both") as "fw" | "tw" | "cv" | "both" | "all";
const DRY_RUN = has("dry-run");
const ROWS_FILTER = arg("rows")
  ?.split(",")
  .map((n) => Number(n.trim()));
const RPS = Number(arg("rps") ?? 2);
const REGEN_ONLY = has("regen"); // rebuild the xlsx from the last saved results, no live calls
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RESULTS_JSON = `${import.meta.dirname}/_icici-uat-scenario-results.json`;
const OUT_XLSX = `${import.meta.dirname}/../docs/icici-uat-scenario-sheet.xlsx`;

// ─── Date helpers ───────────────────────────────────────────────────────────────
const todayIso = () => new Date().toISOString().slice(0, 10);
function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── ICICI Product Master (mirrors src/providers/icici/config.ts PRODUCT_CODES) ────
type Line = "fw" | "tw" | "cv";
const PRODUCT_CODE: Record<Line, Record<BusinessType, number>> = {
  fw: { new: 20, rollover: 21, renewal: 21 },
  tw: { new: 10, rollover: 13, renewal: 13 },
  cv: { new: 49, rollover: 41, renewal: 41 }, // PCV class only — the one class we have a confirmed vehicle for
};

// ─── Vehicle roster — real rows from ICICI's UAT MMV master (docs/icici-test-cases.md) ──
interface IciciVehicle {
  makeCode: number;
  makeName: string;
  modelCode: number;
  modelName: string;
  rtoCode: number;
  rtoCity: string;
  pincode: string;
}
// NOTE: docs/icici-test-cases.md's documented 4W roster (V1-V4: Hyundai Creta 8/10184,
// Maruti Swift VXI 10/22193, Honda Amaze 7/21899, Maruti Baleno Sigma 10/23078) all
// returned a clean, definitive "Vehicle details not found." on live UAT (confirmed
// 2026-07-07) — that roster was only ever exercised at the fixture/unit-test level (see
// that doc's own disclaimer) and has drifted from ICICI's current UAT master. Replaced
// with 4 codes independently confirmed live by probing ICICI's own delivered master
// (dock boyz/ICICI/UAT_MMV_Details) at the known-good Audi V6 anchor's RTO (2125): every
// Audi model tried priced fine, plus one Honda; mass-market economy models (Alto, i20)
// still return "Vehicle details not found". A vehicle's insurance status (new / an
// existing rollover policy) is a single state, so New and Rollover never share a vehicle
// below — `audi` is New-only, the rollover-family rows (2-7) rotate through the other three.
const FW = {
  audi: { makeCode: 13, makeName: "AUDI", modelCode: 2046, modelName: "V6", rtoCode: 2125, rtoCity: "Dharampur (Gujarat)", pincode: "396050" },
  civic: { makeCode: 7, makeName: "HONDA", modelCode: 2457, modelName: "CIVIC 1.8 MT", rtoCode: 2125, rtoCity: "Dharampur (Gujarat)", pincode: "396050" },
  q7: { makeCode: 13, makeName: "AUDI", modelCode: 2908, modelName: "AUDI Q7", rtoCode: 2125, rtoCity: "Dharampur (Gujarat)", pincode: "396050" },
  a6: { makeCode: 13, makeName: "AUDI", modelCode: 12197, modelName: "A6 2.8 FSI", rtoCode: 2125, rtoCity: "Dharampur (Gujarat)", pincode: "396050" },
} satisfies Record<string, IciciVehicle>;
const TW = {
  jupiter: { makeCode: 39, makeName: "TVS", modelCode: 17877, modelName: "JUPITER", rtoCode: 192, rtoCity: "Mumbai", pincode: "400001" },
  splendor: { makeCode: 32, makeName: "HERO", modelCode: 21646, modelName: "SPLENDOR PLUS DRUM", rtoCode: 634, rtoCity: "Pune", pincode: "411001" },
  pulsar150: { makeCode: 31, makeName: "BAJAJ", modelCode: 12637, modelName: "PULSAR 150", rtoCode: 2029, rtoCity: "Thane", pincode: "400601" },
  pulsar180: { makeCode: 31, makeName: "BAJAJ", modelCode: 380, modelName: "PULSAR 180", rtoCode: 412, rtoCity: "Nashik", pincode: "422001" },
} satisfies Record<string, IciciVehicle>;
// CV: ICICI has never delivered a CV make/model/RTO master (no CSV in dock boyz/ICICI —
// only 2W/4W). The one CV vehicle confirmed live here is ICICI's own documented
// Save-Quote sample (dock boyz/ICICI/cv_out.txt §C) — a real recorded example, not a
// fabricated one — re-confirmed live 2026-07-08 as PCV/Roll Over/Comprehensive
// (ProductCode 41). Third Party (42) for this same vehicle returned "Vehicle make not
// found" — CV codes appear registered per exact product code, not just per class.
const CV = {
  pcv: { makeCode: 99, makeName: "ICICI Sample PCV", modelCode: 15425, modelName: "(make/model name not disclosed)", rtoCode: 3501, rtoCity: "Pune", pincode: "411001" },
} satisfies Record<string, IciciVehicle>;

// ─── Scenario definitions ────────────────────────────────────────────────────────
interface AddonFlags {
  zeroDep?: boolean;
  engineProtect?: boolean;
  rsa?: boolean;
  tyreProtect?: boolean;
  rti?: boolean;
  consumables?: boolean;
  keyProtect?: boolean;
  garageCash?: boolean;
  lossOfBelongings?: boolean;
  batteryProtect?: boolean;
  drivingAccessories?: boolean;
}
function activeAddons(a: AddonFlags): string {
  const keys = Object.keys(a) as (keyof AddonFlags)[];
  return keys.filter((k) => a[k]).join(", ") || "None";
}

interface Scenario {
  no: number;
  line: Line;
  scenario: string; // ICICI sheet wording ("Following scenarios")
  transactionType: string; // filled Transaction Type (New Business / Roll Over)
  businessType: BusinessType;
  vehicle: IciciVehicle;
  regNo?: string; // undefined ⇒ brand-new (RegistrationNo sent empty)
  registrationDate: string;
  claimInPreviousPolicy: boolean;
  ncbPercent: number;
  isPreviousPolicyExpired: boolean;
  previousPolicyExpiryDate?: string;
  previousPolicyNumber?: string;
  previousInsurerId?: string; // ICICI short code (scripts/icici-insurer-master.json), passed through verbatim
  voluntaryDeductible?: number;
  addons: AddonFlags;
  notes: string;
}

function buildScenarios(args: {
  line: Line;
  row1: IciciVehicle;
  row2: IciciVehicle;
  row3: IciciVehicle;
  row4: IciciVehicle;
  row5: IciciVehicle;
  row6: IciciVehicle;
  row7: IciciVehicle;
  regNos: { r1?: string; r2: string; r3: string; r4: string; r5: string; r6: string; r7: string };
  addonsAll: AddonFlags;
  addonsAge: AddonFlags;
  /** When true, row 1 is tested as an additional no-add-ons Roll Over instead of New
   *  Business — used for CV, where we have no second confirmed vehicle to isolate New
   *  from the Rollover-family rows without violating "one vehicle, one category". */
  noNewCategory?: boolean;
}): Scenario[] {
  const { line, regNos } = args;
  const prevExpiryOk = isoOffset(20); // not yet expired — isolates the variable under test
  const prevExpiryLapsed = isoOffset(-45); // lapsed 45 days ago (<90d, NCB still carries) ⇒ break-in
  const regDate = "2021-06-01";
  const oldRegDate = "2018-06-01"; // ~8-year-old vehicle, to probe age-gated add-ons
  const prevIns = "GODI"; // Go Digit — ICICI short code, sent verbatim as PreviousInsurerCode

  return [
    args.noNewCategory
      ? {
          no: 1, line, scenario: "Policy without Add-on covers", transactionType: "Roll Over",
          businessType: "rollover" as const, vehicle: args.row1, regNo: regNos.r1, registrationDate: regDate,
          claimInPreviousPolicy: false, ncbPercent: 20, isPreviousPolicyExpired: false,
          previousPolicyExpiryDate: prevExpiryOk, previousPolicyNumber: `OLD-${line.toUpperCase()}-01`,
          previousInsurerId: prevIns, addons: {},
          notes: "New Business not tested for this line — no second confirmed vehicle available " +
            "(see docs/icici-uat-scenarios.md); shown as an additional no-add-ons Roll Over case instead.",
        }
      : {
          no: 1, line, scenario: "Policy without Add-on covers", transactionType: "New Business",
          businessType: "new" as const, vehicle: args.row1, regNo: undefined, registrationDate: todayIso(),
          claimInPreviousPolicy: false, ncbPercent: 0, isPreviousPolicyExpired: false, addons: {},
          notes: "Brand-new vehicle, no previous policy, no add-ons — RegistrationNo sent empty (no plate yet).",
        },
    {
      no: 2, line, scenario: "Check the policy with add-on covers", transactionType: "Roll Over",
      businessType: "rollover", vehicle: args.row2, regNo: regNos.r2, registrationDate: regDate,
      claimInPreviousPolicy: false, ncbPercent: 20, isPreviousPolicyExpired: false,
      previousPolicyExpiryDate: prevExpiryOk, previousPolicyNumber: `OLD-${line.toUpperCase()}-02`,
      previousInsurerId: prevIns, voluntaryDeductible: 2500, addons: args.addonsAll,
      notes: `${activeAddons(args.addonsAll)} + Voluntary Deductible ₹2,500.`,
    },
    {
      no: 3, line, scenario: "No Break-In scenario", transactionType: "Roll Over",
      businessType: "rollover", vehicle: args.row3, regNo: regNos.r3, registrationDate: regDate,
      claimInPreviousPolicy: false, ncbPercent: 20, isPreviousPolicyExpired: false,
      previousPolicyExpiryDate: prevExpiryOk, previousPolicyNumber: `OLD-${line.toUpperCase()}-03`,
      previousInsurerId: prevIns, addons: {},
      notes: "Previous policy still has ~20 days remaining (not expired) — expect IsInspectionRequire=false.",
    },
    {
      no: 4, line, scenario: "With Claim as True", transactionType: "Roll Over",
      businessType: "rollover", vehicle: args.row4, regNo: regNos.r4, registrationDate: regDate,
      claimInPreviousPolicy: true, ncbPercent: 0, isPreviousPolicyExpired: false,
      previousPolicyExpiryDate: prevExpiryOk, previousPolicyNumber: `OLD-${line.toUpperCase()}-04`,
      previousInsurerId: prevIns, addons: {},
      notes: "PreviousPolicyClaimed=true, NCB reset to 0% (a claim breaks the no-claim streak).",
    },
    {
      no: 5, line, scenario: "Without claim", transactionType: "Roll Over",
      businessType: "rollover", vehicle: args.row5, regNo: regNos.r5, registrationDate: regDate,
      claimInPreviousPolicy: false, ncbPercent: 20, isPreviousPolicyExpired: false,
      previousPolicyExpiryDate: prevExpiryOk, previousPolicyNumber: `OLD-${line.toUpperCase()}-05`,
      previousInsurerId: prevIns, addons: {},
      notes: "PreviousPolicyClaimed=false, NCB carried forward at 20%.",
    },
    {
      no: 6, line, scenario: "Break-In scenario", transactionType: "Roll Over",
      businessType: "rollover", vehicle: args.row6, regNo: regNos.r6, registrationDate: regDate,
      claimInPreviousPolicy: false, ncbPercent: 20, isPreviousPolicyExpired: true,
      previousPolicyExpiryDate: prevExpiryLapsed, previousPolicyNumber: `OLD-${line.toUpperCase()}-06`,
      previousInsurerId: prevIns, addons: {},
      notes: "Previous policy lapsed 45 days ago ⇒ expect IsInspectionRequire=true; proposal is submitted proposal-only (payment never bound) pending inspection approval.",
    },
    {
      no: 7, line, scenario: "Selection of Add-on Covers with vehicle age", transactionType: "Roll Over",
      businessType: "rollover", vehicle: args.row7, regNo: regNos.r7, registrationDate: oldRegDate,
      claimInPreviousPolicy: false, ncbPercent: 20, isPreviousPolicyExpired: false,
      previousPolicyExpiryDate: prevExpiryOk, previousPolicyNumber: `OLD-${line.toUpperCase()}-07`,
      previousInsurerId: prevIns, addons: args.addonsAge,
      notes: `Vehicle registered ${oldRegDate} (~8 years old) — records whether ICICI prices or rejects age-sensitive covers at this age.`,
    },
  ];
}

// row1 (New) is Audi V6 exclusively; rows 2-7 (all Rollover-family) never reuse it —
// they rotate through the other 3 confirmed vehicles instead (repeats *within* the
// Rollover category are fine, since that's genuinely the same policy state).
const FW_SCENARIOS = buildScenarios({
  line: "fw",
  row1: FW.audi, row2: FW.civic, row3: FW.q7, row4: FW.a6, row5: FW.civic, row6: FW.q7, row7: FW.a6,
  regNos: { r2: "GJ07AB1234", r3: "GJ07AB2345", r4: "GJ07AB3456", r5: "GJ07AB4567", r6: "GJ07AB5678", r7: "GJ07AB2018" },
  addonsAll: { zeroDep: true, rsa: true, engineProtect: true, keyProtect: true, garageCash: true, lossOfBelongings: true, consumables: true, tyreProtect: true },
  addonsAge: { zeroDep: true, engineProtect: true, tyreProtect: true },
});

// row1 (New) is TVS Jupiter exclusively; rows 2-7 (all Rollover-family) never reuse it.
const TW_SCENARIOS = buildScenarios({
  line: "tw",
  row1: TW.jupiter, row2: TW.splendor, row3: TW.pulsar180, row4: TW.pulsar150, row5: TW.pulsar150, row6: TW.splendor, row7: TW.pulsar180,
  regNos: { r2: "MH12XY4321", r3: "MH15JK7788", r4: "MH04UV2109", r5: "MH01ZW8765", r6: "MH12XY9876", r7: "MH15JK2018" },
  // zeroDep omitted: ICICI UAT declines it for Hero Splendor Plus Drum specifically
  // ("Base Rate not found for ZeroDepreciation") — a real per-vehicle underwriting rule,
  // confirmed live 2026-07-07. (zeroDep prices fine on Pulsar 180 — see addonsAge below.)
  addonsAll: { rsa: true, rti: true, engineProtect: true, batteryProtect: true, keyProtect: true, tyreProtect: true, drivingAccessories: true, consumables: true },
  addonsAge: { zeroDep: true, engineProtect: true, rti: true },
});

// Only one confirmed CV vehicle exists (see the `CV` roster above) — every row uses it,
// which is fine here because every row is genuinely Rollover/Comprehensive (the one
// combination confirmed live); row 1 is relabeled Roll Over instead of New Business
// (noNewCategory) since a second confirmed vehicle would be needed to test New without
// reusing this one across a different policy state.
const CV_SCENARIOS = buildScenarios({
  line: "cv",
  row1: CV.pcv, row2: CV.pcv, row3: CV.pcv, row4: CV.pcv, row5: CV.pcv, row6: CV.pcv, row7: CV.pcv,
  regNos: {
    r1: "MH12CV0001", r2: "MH12CV0002", r3: "MH12CV0003", r4: "MH12CV0004",
    r5: "MH12CV0005", r6: "MH12CV0006", r7: "MH12CV0007",
  },
  // ADDON_CODES_CV (src/providers/icici/config.ts): rsa, zeroDep, engineProtect, rti,
  // consumables, garageCash, batteryProtect — no keyProtect/tyreProtect/drivingAccessories/
  // lossOfBelongings for CV specifically.
  addonsAll: { rsa: true, zeroDep: true, engineProtect: true, rti: true, consumables: true, garageCash: true, batteryProtect: true },
  addonsAge: { zeroDep: true, engineProtect: true, rti: true },
  noNewCategory: true,
});

// ─── Shared proposer test data (docs/full-flow-test-cases.md §D copy-paste data) ────
const PROPOSER_DOB = "1990-05-15";
const PROPOSER_PAN = "ABCPK1234F";

// ─── Request builders ─────────────────────────────────────────────────────────
const DEFAULT_FLAGS = {
  zeroDep: false, engineProtect: false, rsa: false, tyreProtect: false, rimProtect: false,
  rti: false, consumables: false, paOwner: true, paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false, keyProtect: false, garageCash: false,
  lossOfBelongings: false, batteryProtect: false, drivingAccessories: false, ncbProtection: false,
};

function vehicleCategory(line: Line): VehicleCategory {
  return line === "fw" ? "fourWheeler" : line === "tw" ? "twoWheeler" : "commercial";
}

function buildRequest(s: Scenario): MotorQuoteRequest {
  const v = s.vehicle;
  return {
    vehicleType: vehicleCategory(s.line),
    ...(s.line === "cv" ? { commercialSubType: "passenger" as const } : {}),
    selectedPolicy: "comprehensive",
    businessType: s.businessType,
    makeId: String(v.makeCode), makeName: v.makeName,
    modelId: String(v.modelCode), modelName: v.modelName,
    fuelType: s.line === "cv" ? "diesel" : "petrol",
    rtoCode: String(v.rtoCode),
    registrationNumber: s.regNo,
    registrationDate: s.registrationDate,
    pincode: v.pincode,
    previousPolicyNumber: s.previousPolicyNumber,
    previousInsurerId: s.previousInsurerId,
    previousPolicyExpiryDate: s.previousPolicyExpiryDate,
    isPreviousPolicyExpired: s.isPreviousPolicyExpired,
    claimInPreviousPolicy: s.claimInPreviousPolicy,
    ncbPercent: s.ncbPercent,
    voluntaryDeductible: s.voluntaryDeductible,
    ...DEFAULT_FLAGS,
    ...s.addons,
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
  return `${msg} :: ${body.slice(0, 400)}`;
}

/**
 * ICICI's gateway occasionally wraps an upstream 502/503 HTML page inside a normal
 * HTTP-200 { Success:false, ErrorMessage:"<html>..." } body — a transient failure that
 * FetchTransport's own 5xx-status retry can't see (it never left the 200 status code).
 * Retried at this layer instead of patching the shared transport for a script-only need.
 */
function isTransientIciciError(e: unknown): boolean {
  const raw = `${e instanceof Error ? e.message : String(e)} ${JSON.stringify(errBody(e))}`;
  // Covers both the raw HTML gateway page ICICI sometimes wraps in a 200 body AND the
  // .NET HttpClient-style message ("Response status code does not indicate success:
  // 502 (Bad Gateway).") — neither is a real business rejection, so match on the bare
  // 50x code rather than one exact phrasing (see icici-uat-condition-matrix.ts, same fix).
  return /\b50[234]\b|<html|ECONNRESET|ETIMEDOUT|fetch failed/i.test(raw);
}
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 2500): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransientIciciError(e) || i >= attempts) throw e;
      console.log(`   (transient gateway error, retry ${i}/${attempts - 1}: ${errDetail(e).slice(0, 100)})`);
      await sleep(delayMs);
    }
  }
}

let seq = 0;
function buildFullRequest(s: Scenario, quoteId: string): MotorFullQuoteRequest {
  seq += 1;
  const tag = String(seq).padStart(3, "0");
  return {
    ...buildRequest(s),
    quoteId,
    isProposalOnly: true,
    amountCollected: 0,
    isVehicleUnderLoan: false,
    proposer: {
      firstName: "Ravi", lastName: "Kumar", email: "ravi.kumar@example.com",
      mobile: "9876543210", dob: PROPOSER_DOB, gender: "M", panNumber: PROPOSER_PAN,
    },
    address: { addressLine1: "12 MG Road", city: s.vehicle.rtoCity, state: "Maharashtra", pincode: s.vehicle.pincode },
    vehicle: { engineNumber: `ENG${tag}ICICIUAT`, chassisNumber: `CHS${tag}ICICIUATTESTVIN0`, financeType: "none" },
    nomineeName: "Sita Kumar", nomineeRelation: "spouse", nomineeAge: 30,
  };
}

// ─── Run ──────────────────────────────────────────────────────────────────────
interface RowResult extends Scenario {
  productCode: number;
  transactionId?: string;
  grossPremium?: number;
  isInspectionRequired?: boolean;
  isKycSuccess?: boolean;
  kycId?: string;
  policyNumber?: string;
  policyReferenceId?: string;
  inspectionId?: string;
  proposalStatus?: string;
  paymentUrl?: string;
  quoteError?: string;
  ckycError?: string;
  proposalError?: string;
}

async function main() {
  if (REGEN_ONLY) {
    const saved = JSON.parse(readFileSync(RESULTS_JSON, "utf8")) as { results: RowResult[] };
    writeWorkbook(saved.results);
    console.log(`Regenerated ${OUT_XLSX} from ${RESULTS_JSON} (${saved.results.length} rows, no live calls)`);
    return;
  }

  const lines: Line[] =
    LINE_FILTER === "all" ? ["tw", "fw", "cv"] : LINE_FILTER === "both" ? ["tw", "fw"] : [LINE_FILTER];
  const SCENARIOS_BY_LINE: Record<Line, Scenario[]> = { fw: FW_SCENARIOS, tw: TW_SCENARIOS, cv: CV_SCENARIOS };
  const all = lines
    .flatMap((l) => SCENARIOS_BY_LINE[l])
    .filter((s) => !ROWS_FILTER || ROWS_FILTER.includes(s.no));

  console.log(`ICICI UAT scenario run: lines=${lines.join(",")} rows=${ROWS_FILTER?.join(",") ?? "all"} dryRun=${DRY_RUN}\n`);

  const provider = DRY_RUN
    ? undefined
    : new IciciProvider({ config: loadIciciConfig(), codeResolver: passthroughCodeResolver });
  const results: RowResult[] = [];

  for (const s of all) {
    console.log(`[${s.line.toUpperCase()} #${s.no}] ${s.scenario} — ${s.vehicle.makeName} ${s.vehicle.modelName} (${s.regNo ?? "brand-new"})`);
    const row: RowResult = { ...s, productCode: PRODUCT_CODE[s.line][s.businessType] };

    if (!provider) {
      const req = buildRequest(s);
      const codes = await passthroughCodeResolver(req);
      const { payload } = buildSaveQuotePayload(req, codes, `dry-${s.line}-${s.no}`);
      const ok = payload.ProductCode === row.productCode;
      console.log(
        `   dry-run: ProductCode=${payload.ProductCode} (expected ${row.productCode}) ${ok ? "OK" : "⚠ MISMATCH"}  ` +
          `MakeCode=${payload.MakeCode} ModelCode=${payload.ModelCode} RTOCode=${payload.RTOCode} ` +
          `AddOns=[${(payload.AddOns as string[]).join(",")}]`,
      );
      results.push(row);
      console.log("");
      continue;
    }

    try {
      const req = buildRequest(s);
      const quote = await withRetry(() => provider.getQuote(req, { requestId: `icici-uat-${s.line}-${s.no}` }));
      row.transactionId = quote.transactionId || undefined;
      row.grossPremium = quote.grossPremium;
      row.isInspectionRequired = quote.isInspectionRequired;
      console.log(
        `   quote: TransactionId=${row.transactionId ?? "—"} gross=₹${quote.grossPremium} inspectionRequired=${quote.isInspectionRequired ?? false}`,
      );

      if (!row.transactionId) {
        row.quoteError = "No TransactionId returned by ICICI";
      } else {
        // ICICI's UAT proposal rejects with ErrorCode 443 "KYC PENDING" unless CKYC has
        // already completed for this TransactionId — despite the wizard's own Proposal→KYC
        // step order (docs/full-flow-test-cases.md §D). Confirmed live 2026-07-07.
        try {
          const kyc = await withRetry(() =>
            provider.completeCkyc(
              { transactionId: row.transactionId!, dob: PROPOSER_DOB, panNumber: PROPOSER_PAN, policyType: "motor" },
              { requestId: `icici-uat-${s.line}-${s.no}-ckyc` },
            ),
          );
          row.isKycSuccess = kyc.isKycSuccess;
          row.kycId = kyc.kycId;
          console.log(`   ckyc: kycId=${row.kycId ?? "—"} isKycSuccess=${row.isKycSuccess}`);
        } catch (e) {
          row.ckycError = errDetail(e);
          console.log(`   ckyc: ERROR ${row.ckycError}`);
        }

        try {
          // Retried here even though the shared provider treats proposal as non-idempotent —
          // safe only because every proposal in this script is isProposalOnly/amountCollected:0,
          // so a retry can never double-bind a payment. Don't copy this pattern for a real proposal.
          const full = buildFullRequest(s, row.transactionId);
          const proposal = await withRetry(() =>
            provider.getFullQuote(full, { requestId: `icici-uat-${s.line}-${s.no}-prop` }),
          );
          row.policyNumber = proposal.policyNumber;
          row.paymentUrl = proposal.paymentUrl;
          const details = proposal.contractDetails ?? {};
          row.policyReferenceId = typeof details.policyReferenceId === "string" ? details.policyReferenceId : undefined;
          row.inspectionId = typeof details.inspectionId === "string" ? details.inspectionId : undefined;
          row.proposalStatus = typeof details.status === "string" ? details.status : undefined;
          console.log(
            `   proposal: PolicyNo=${row.policyNumber ?? "—"} status=${row.proposalStatus ?? "—"} ` +
              `policyRefId=${row.policyReferenceId ?? "—"} inspectionId=${row.inspectionId ?? "—"}`,
          );
        } catch (e) {
          row.proposalError = errDetail(e);
          // Even a rejected proposal (e.g. KYC PENDING) carries a real PolicyReferenceId —
          // surface it so the sheet shows partial evidence instead of just an error string.
          const body = errBody(e);
          if (typeof body.PolicyReferenceId === "string") row.policyReferenceId = body.PolicyReferenceId;
          console.log(`   proposal: ERROR ${row.proposalError}`);
        }
      }
    } catch (e) {
      row.quoteError = errDetail(e);
      console.log(`   quote: ERROR ${row.quoteError}`);
    }
    results.push(row);
    console.log("");
    await sleep(1000 / RPS);
  }

  const ok = results.filter((r) => r.transactionId && !r.ckycError && !r.proposalError).length;
  const errored = results.filter((r) => r.quoteError || r.ckycError || r.proposalError).length;
  console.log(`═══ SUMMARY: ${results.length} rows, ${ok} clean, ${errored} with an error ═══`);

  // Merge into any previously saved results (keyed by line+no) rather than overwriting
  // wholesale — a scoped re-run (--line=fw --rows=6) must only touch that one row, not
  // wipe the other lines'/rows' already-captured data.
  const key = (r: { line: Line; no: number }) => `${r.line}-${r.no}`;
  let merged = results;
  try {
    const prior = (JSON.parse(readFileSync(RESULTS_JSON, "utf8")) as { results: RowResult[] }).results;
    const byKey = new Map(prior.map((r) => [key(r), r]));
    for (const r of results) byKey.set(key(r), r);
    merged = [...byKey.values()];
  } catch {
    // no prior file (or unreadable) — first run, nothing to merge
  }

  writeFileSync(RESULTS_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), results: merged }, null, 2));
  console.log(`Wrote ${RESULTS_JSON} (${merged.length} total rows)`);
  writeWorkbook(merged);
  console.log(`Wrote ${OUT_XLSX}`);
}

// ─── xlsx generation ────────────────────────────────────────────────────────────
const POS_NA = "NA – Broker integration";
const SHEET_HEADER = [
  "Sr.No", "Following scenarios", "Transaction Type", "Policy Number", "Transaction Id",
  "Licence No", "Certificate No", "PAN No", "Adhar No", "Product Code",
  "Test Vehicle", "Reg No",
];

function policyNumberCell(r: RowResult): string {
  if (r.policyNumber) return r.policyNumber;
  if (r.policyReferenceId && r.ckycError) return `${r.policyReferenceId} (proposal ref — blocked on CKYC, see Test Data tab)`;
  if (r.policyReferenceId) return `${r.policyReferenceId} (proposal ref, pending issuance)`;
  if (r.isInspectionRequired) return "Pending inspection approval";
  if (r.ckycError) return `ERROR (CKYC): ${r.ckycError.slice(0, 70)}`;
  if (r.proposalError) return `ERROR: ${r.proposalError.slice(0, 70)}`;
  if (r.quoteError) return `ERROR: ${r.quoteError.slice(0, 70)}`;
  return "";
}
function transactionIdCell(r: RowResult): string {
  if (r.transactionId) return r.transactionId;
  if (r.quoteError) return `ERROR: ${r.quoteError.slice(0, 70)}`;
  return "";
}
/** ICICI's own template literally reads "Roll Over / New Bussiness" (their spelling)
 *  for rows 1-2 — preserved verbatim here. `r.transactionType` stays the semantically
 *  accurate value (New Business / Roll Over) for the Test Data tab and console/notes. */
function posTransactionTypeCell(r: RowResult): string {
  return r.no === 1 || r.no === 2 ? "Roll Over / New Bussiness" : r.transactionType;
}

function scenarioSheetRows(rows: RowResult[]): (string | number)[][] {
  const aoa: (string | number)[][] = [];
  aoa.push(["", "", "", "", "", "POS Headers (mandatory only in case of POS integration)", "", "", "", "", "", ""]);
  aoa.push(SHEET_HEADER);
  for (const r of rows) {
    aoa.push([
      r.no, r.scenario, posTransactionTypeCell(r),
      policyNumberCell(r), transactionIdCell(r),
      POS_NA, POS_NA, POS_NA, POS_NA,
      r.productCode,
      `${r.vehicle.makeName} ${r.vehicle.modelName}`, r.regNo ?? "N/A (brand-new)",
    ]);
  }
  return aoa;
}

function testDataSheetRows(rows: RowResult[]): (string | number)[][] {
  const header = [
    "Sr.No", "Line", "Scenario", "Make", "Model", "ICICI MakeCode", "ICICI ModelCode",
    "RTO City", "ICICI RTOCode", "Reg No", "Registration Date", "Business Type",
    "Previous Policy No", "Previous Insurer", "Prev Policy Expiry", "Claim", "NCB %",
    "Add-ons Requested", "Gross Premium (UAT)", "Inspection Required", "Inspection Id",
    "CKYC Success", "Proposal Status", "Payment Link", "Notes",
  ];
  const aoa: (string | number)[][] = [header];
  for (const r of rows) {
    aoa.push([
      r.no, r.line.toUpperCase(), r.scenario, r.vehicle.makeName, r.vehicle.modelName,
      r.vehicle.makeCode, r.vehicle.modelCode, r.vehicle.rtoCity, r.vehicle.rtoCode,
      r.regNo ?? "N/A (brand-new)", r.registrationDate, r.transactionType,
      r.previousPolicyNumber ?? "", r.previousInsurerId ?? "", r.previousPolicyExpiryDate ?? "",
      r.claimInPreviousPolicy ? "Yes" : "No", r.ncbPercent,
      activeAddons(r.addons), r.grossPremium ?? "", r.isInspectionRequired ? "Yes" : "No",
      r.inspectionId ?? "",
      r.isKycSuccess === undefined ? "" : r.isKycSuccess ? "Yes" : `No${r.ckycError ? ` (${r.ckycError.slice(0, 60)})` : ""}`,
      r.proposalStatus ?? "", r.paymentUrl ?? "", r.notes,
    ]);
  }
  return aoa;
}

const SCENARIO_SHEET_NAME: Record<Line, string> = { tw: "2W Scenarios", fw: "4W Scenarios", cv: "CV Scenarios" };

function writeWorkbook(rows: RowResult[]): void {
  const wb = XLSX.utils.book_new();
  for (const line of ["tw", "fw", "cv"] as Line[]) {
    const subset = rows.filter((r) => r.line === line);
    if (subset.length === 0) continue;
    const ws = XLSX.utils.aoa_to_sheet(scenarioSheetRows(subset));
    ws["!merges"] = [{ s: { r: 0, c: 5 }, e: { r: 0, c: 8 } }];
    ws["!cols"] = [{ wch: 6 }, { wch: 38 }, { wch: 16 }, { wch: 26 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 26 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, SCENARIO_SHEET_NAME[line]);
  }
  const testWs = XLSX.utils.aoa_to_sheet(testDataSheetRows(rows));
  testWs["!cols"] = Array.from({ length: 25 }, () => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, testWs, "Test Data");
  XLSX.writeFile(wb, OUT_XLSX);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

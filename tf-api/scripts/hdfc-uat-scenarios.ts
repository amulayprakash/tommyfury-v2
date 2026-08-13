/**
 * HDFC ERGO UAT certification scenario runner.
 *
 * Encodes every condition from HDFC's own test pack — `PVTcarTestScenarios.xls`
 * in the HDFC API KIT, sheets "New and Rollover" (36), "Long Team" (152),
 * "Used Car" (12) and "Break In" (5) — and fires each against LIVE HDFC UAT
 * through the real provider (`HdfcProvider.getQuote`), then classifies the row.
 *
 * READ-ONLY. Only Authenticate → GetCalculateIDV → CalculatePremium are called.
 * CreateProposal / SubmitPaymentDetails are never invoked: this is a shared UAT
 * environment and binding policies in it is not ours to do. Any condition that
 * can only be judged after CreateProposal is reported BLOCKED with that reason.
 *
 *   npm run hdfc:scenarios -- [--sheet=all|new-rollover|long-term|used-car|break-in]
 *                             [--rows=1,2,3] [--rps=0.5] [--dry-run] [--regen]
 *
 * Writes scripts/_hdfc-uat-scenario-results.json (raw per-row request/response,
 * gitignored by `scripts/_*`) and docs/hdfc-uat-scenario-results.md.
 *
 * Verdicts
 *   PASS        the call succeeded AND the condition's expectation held (which
 *               includes "HDFC rejected it, exactly as the condition demands").
 *   FAIL        our defect: HDFC rejected something we sent, or HDFC silently
 *               accepted something this condition says it must not — meaning the
 *               rule is ours to enforce and today we do not.
 *   VENDOR_DATA HDFC's sandbox could not price it (no IDV for the model, no rate
 *               in an R-master, a Blaze exception, a term its own data dictionary
 *               documents but its rules engine refuses). Not our code.
 *   BLOCKED     our integration cannot express the condition at all. Each such
 *               row states the exact missing field / code path.
 *   MANUAL      a UI/manual condition with no API surface.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { loadHdfcConfig } from "@/providers/hdfc/config.ts";
import { HdfcProvider } from "@/providers/hdfc/hdfc.provider.ts";
import { passthroughCodeResolver } from "@/providers/hdfc/db-code-resolver.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";

// ─── CLI ───────────────────────────────────────────────────────────────────────
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.includes(`--${k}`);
const SHEET_FILTER = (arg("sheet") ?? "all") as SheetKey | "all";
const DRY_RUN = has("dry-run");
const REGEN_ONLY = has("regen");
const ROWS_FILTER = arg("rows")
  ?.split(",")
  .map((n) => Number(n.trim()));
/**
 * Requests per second. HDFC UAT answers HTTP 429 well before one request a
 * second sustained (observed while mapping this pack), and every row costs TWO
 * calls (IDV + premium), so the default is deliberately slow.
 */
const RPS = Number(arg("rps") ?? 0.5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RESULTS_JSON = `${import.meta.dirname}/_hdfc-uat-scenario-results.json`;
const OUT_MD = `${import.meta.dirname}/../docs/hdfc-uat-scenario-results.md`;

// ─── Dates ─────────────────────────────────────────────────────────────────────
const todayIso = () => new Date().toISOString().slice(0, 10);
function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const yearsAgo = (y: number) => isoOffset(-365 * y);

// ─── Vehicles ──────────────────────────────────────────────────────────────────
/**
 * Every code below was confirmed priceable on LIVE UAT (2026-08-07) as a ~1-year-old
 * Roll Over at RTO 10406. The controlling variable is VEHICLE AGE, not the code:
 * 28 of the 33 codes in HDFC's "UAT Test Model" sheet + Postman collection price at
 * ~1 year, while HDFC's IDV master returns nothing ("Please provide Vehicle IDV")
 * from roughly 11 years old. So scenarios are built on a ~1-year-old vehicle unless
 * the condition is itself about age.
 */
interface Vehicle {
  code: string;
  make: string;
  model: string;
  fuel: MotorQuoteRequest["fuelType"];
}
const V = {
  swift: { code: "12798", make: "MARUTI", model: "SWIFT ZXI", fuel: "petrol" },
  rapid: { code: "28735", make: "SKODA", model: "RAPID 1.5 TDI", fuel: "diesel" },
  nexonEv: { code: "42774", make: "TATA MOTORS LTD", model: "NEXON EV XZ PLUS", fuel: "electric" },
  innova: { code: "32415", make: "TOYOTA KIRLOSKAR", model: "INNOVA CRYSTA", fuel: "petrol" },
  alto: { code: "12763", make: "MARUTI", model: "ALTO LXI", fuel: "petrol" },
  city: { code: "17430", make: "HONDA", model: "CITY 1.3 EXI", fuel: "petrol" },
  niosCng: { code: "42907", make: "HYUNDAI", model: "GRAND I10 NIOS CNG", fuel: "cng" },
  santroLpg: { code: "17434", make: "HYUNDAI", model: "SANTRO GL LPG", fuel: "lpg" },
  hycrossHybrid: {
    code: "48622",
    make: "TOYOTA KIRLOSKAR",
    model: "INNOVA HYCROSS HYBRID",
    fuel: "hybrid",
  },
  // Used Car sheet rows 6 & 12 demand a Mercedes-Benz. Every MB code tried on UAT
  // (50904, 53431, 39500, 41334, 42914, 48556, 45164, 47999) answers "Please provide
  // Vehicle IDV" — the whole make is absent from HDFC's UAT IDV master.
  mercedes: { code: "39500", make: "MERCEDES-BENZ.", model: "C-CLASS C 220 D", fuel: "diesel" },
} satisfies Record<string, Vehicle>;

/** RTO 10406 (MH-1 Mumbai) from the kit's "RTO" sheet — the one used by every sample. */
const RTO = "10406";

// ─── Scenario model ────────────────────────────────────────────────────────────
type SheetKey = "new-rollover" | "long-term" | "used-car" | "break-in";
type Verdict = "PASS" | "FAIL" | "VENDOR_DATA" | "BLOCKED" | "MANUAL";

interface Assertion {
  ok: boolean;
  detail: string;
}
/** Raw HDFC `Resp_PvtCar`, the ground truth every value assertion reads. */
type Resp = Record<string, unknown>;

interface Scenario {
  sheet: SheetKey;
  no: number;
  transactionType: string;
  /** The market's OD+TP notation as HDFC's own sheet writes it. */
  policyTerm: string;
  condition: string;
  /** The sheet's own "Expected result" column, where it has one. */
  expected?: string;
  vehicle: Vehicle;
  /** Canonical request overrides. Absent ⇒ the row is static (BLOCKED/MANUAL). */
  req?: Partial<MotorQuoteRequest>;
  /**
   * Assigned without calling HDFC. Used only where the condition is genuinely
   * unreachable (BLOCKED) or has no API surface (MANUAL).
   */
  staticVerdict?: { verdict: Verdict; reason: string };
  /**
   * Fire the request even though the verdict is already decided, so HDFC's own
   * answer is on the record for whoever later unblocks the row. The verdict is
   * NOT re-derived from that answer — a BLOCKED row stays BLOCKED.
   */
  probeAnyway?: boolean;
  /** Judges a SUCCESSFUL response. Absent ⇒ "it priced" is the whole condition. */
  assert?: (r: Resp, q: CanonicalQuoteResult) => Assertion;
  /**
   * The condition asserts HDFC must REFUSE. `test` matches HDFC's verbatim error;
   * a match is PASS, a successful quote is FAIL (the rule is ours to enforce).
   */
  expectRejection?: { test: RegExp; describe: string };
  /**
   * The one row per long-term policy term that establishes whether HDFC will
   * write that term at all. ONLY this row may set the term gate: without the
   * restriction a per-model data gap (a hybrid with no IDV, say) would gate the
   * other 37 conditions of a term HDFC actually honours.
   */
  termProbe?: boolean;
  /** Anything the reader needs in order to trust the verdict. */
  notes?: string;
  /** Set when this row's input deviates from the standard base (per the brief). */
  inputDeviation?: string;
}

interface RowResult extends Omit<Scenario, "req" | "assert" | "expectRejection"> {
  verdict: Verdict;
  reason: string;
  /** HDFC's verbatim message, never paraphrased. */
  vendorMessage?: string;
  request?: MotorQuoteRequest;
  grossPremium?: number;
  odPremium?: number;
  tpPremium?: number;
  idv?: number;
  respPvtCar?: Resp;
  sharedWithRow?: string;
}

// ─── Request assembly ──────────────────────────────────────────────────────────
const ADDONS_OFF = {
  zeroDep: false,
  engineProtect: false,
  rsa: false,
  tyreProtect: false,
  rimProtect: false,
  rti: false,
  consumables: false,
  paOwner: true,
  paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false,
  keyProtect: false,
  garageCash: false,
  lossOfBelongings: false,
  batteryProtect: false,
  drivingAccessories: false,
  ncbProtection: false,
} as const;

/**
 * Every canonical add-on flag HDFC honours (config.ts PRIVATE_CAR_ADDONS).
 *
 * `rsaWorldwide` (IsEAW_Cover) and `garageCash` (IsLossofUseDownTimeProt_Cover)
 * joined this list on 2026-08-10, when they stopped being hardcoded off. Both
 * belong in an "all cover" request on HDFC's own evidence: its New Business
 * premium sample sends IsEAW_Cover 1 and its New Business proposal sample sends
 * IsLossofUseDownTimeProt_Cover 1.
 *
 * `emiProtect` is deliberately NOT here even though it is now expressible. HDFC
 * refuses the WHOLE payload when it cannot rate the cover rather than declining
 * just that cover, so folding it into the shared "all cover" bundle would let one
 * unrated combination take down a dozen unrelated rows. It gets its own row.
 */
const ADDONS_ALL = {
  ...ADDONS_OFF,
  zeroDep: true,
  engineProtect: true,
  rsa: true,
  rsaWorldwide: true,
  garageCash: true,
  tyreProtect: true,
  rti: true,
  consumables: true,
  ncbProtection: true,
  paUnnamedPassenger: true,
  legalLiabilityPaidDriver: true,
  lossOfBelongings: true,
  unnamedPaSumInsured: 200_000,
} as const;

/** A registered vehicle whose cover has just lapsed — the pack's Roll Over baseline. */
const ROLLOVER = {
  businessType: "rollover",
  registrationNumber: "MH01QQ7878",
  registrationDate: yearsAgo(1),
  previousPolicyExpiryDate: isoOffset(-1),
  isPreviousPolicyExpired: true,
  previousPolicyNumber: "PREVPOL0001",
  ncbPercent: 20,
} as const satisfies Partial<MotorQuoteRequest>;

/** A vehicle bought today with no insurance history. */
const NEW_BUSINESS = {
  businessType: "new",
  vehicleType: "newVehicle",
  registrationNumber: undefined,
  registrationDate: todayIso(),
  previousPolicyExpiryDate: undefined,
  isPreviousPolicyExpired: false,
  ncbPercent: 0,
} as const satisfies Partial<MotorQuoteRequest>;

/** Standalone OD needs the paired, still-running TP policy identified. */
const PREV_TP = {
  previousTpPolicyNumber: "TPPOL0001",
  previousTpStartDate: yearsAgo(1),
  previousTpExpiryDate: isoOffset(700),
} as const satisfies Partial<MotorQuoteRequest>;

function buildRequest(s: Scenario): MotorQuoteRequest {
  const v = s.vehicle;
  return {
    vehicleType: "fourWheeler",
    selectedPolicy: "comprehensive",
    makeId: v.code,
    makeName: v.make,
    modelId: v.code,
    modelName: v.model,
    fuelType: v.fuel,
    rtoCode: RTO,
    claimInPreviousPolicy: false,
    ...ADDONS_OFF,
    ...ROLLOVER,
    ...s.req,
  } as MotorQuoteRequest;
}

// ─── Assertion helpers ─────────────────────────────────────────────────────────
const n = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? (x as number) : 0;
};
const ok = (detail: string): Assertion => ({ ok: true, detail });
const bad = (detail: string): Assertion => ({ ok: false, detail });

/** Every listed response field must be strictly positive. */
function positive(...fields: string[]) {
  return (r: Resp): Assertion => {
    const zero = fields.filter((f) => n(r[f]) <= 0);
    return zero.length === 0
      ? ok(fields.map((f) => `${f}=${n(r[f])}`).join(", "))
      : bad(`expected > 0 but got ${zero.map((f) => `${f}=${JSON.stringify(r[f])}`).join(", ")}`);
  };
}
/** Every listed response field must be exactly zero. */
function zero(...fields: string[]) {
  return (r: Resp): Assertion => {
    const nonZero = fields.filter((f) => n(r[f]) !== 0);
    return nonZero.length === 0
      ? ok(fields.map((f) => `${f}=0`).join(", "))
      : bad(`expected 0 but got ${nonZero.map((f) => `${f}=${JSON.stringify(r[f])}`).join(", ")}`);
  };
}
/**
 * The rating-verification rows of the "Long Team" sheet ("verify the OD Rate",
 * "verify the Other loading calculation", …) state no expected value, so the
 * strongest honest assertion is that HDFC actually returned the rating component.
 */
function present(...fields: string[]) {
  return (r: Resp): Assertion => {
    const missing = fields.filter((f) => r[f] === undefined);
    return missing.length === 0
      ? ok(fields.map((f) => `${f}=${JSON.stringify(r[f])}`).join(", "))
      : bad(`HDFC returned no ${missing.join(", ")} field`);
  };
}
/**
 * The canonical consequence of a break-in: `CanonicalQuoteResult.isInspectionRequired`,
 * which is what the compare card actually reads. Asserted alongside the raw
 * HDFC fields so a row proves both that HDFC signalled the break-in and that our
 * normalizer carried the signal through.
 */
function flaggedForInspection(expected: boolean) {
  return (_r: Resp, q: CanonicalQuoteResult): Assertion =>
    q.isInspectionRequired === expected
      ? ok(`isInspectionRequired=${expected}`)
      : bad(`expected isInspectionRequired=${expected} but got ${JSON.stringify(q.isInspectionRequired)}`);
}
function both(a: Scenario["assert"], b: Scenario["assert"]): Scenario["assert"] {
  return (r, q) => {
    const x = a!(r, q);
    if (!x.ok) return x;
    const y = b!(r, q);
    return y.ok ? ok(`${x.detail}; ${y.detail}`) : bad(`${x.detail}; ${y.detail}`);
  };
}

/** HDFC sandbox limitations — never our defect. */
const VENDOR_DATA_PATTERNS: { test: RegExp; why: string }[] = [
  { test: /Exception while Call Blaze/i, why: "HDFC rules-engine crash (truncated stack trace)" },
  { test: /Please provide Vehicle IDV/i, why: "no IDV in HDFC's UAT master for this model/age" },
  {
    // Scoped to the IDV step and to a bare "BUSINESS EXCEPTION" with no further
    // text — HDFC's body is literally {"StatusCode":400,"Error":"BUSINESS EXCEPTION"}.
    // Reproduced on all three HYBRID codes tried (48622, 53024, 47921) and on no
    // other fuel, so it is the IDV master having no hybrid rows, not a bad payload.
    test: /getCalculateIDV failed:\s*BUSINESS EXCEPTION\s*$/i,
    why: "HDFC's GetCalculateIDV gave up with a bare, unexplained 'BUSINESS EXCEPTION' — its UAT IDV master has no row for this model",
  },
  { test: /Rate is not defined in the R\d+ Master/i, why: "missing rate row in HDFC's UAT masters" },
  { test: /Add on system rate is not available/i, why: "add-on has no rate in HDFC's UAT masters" },
  {
    /**
     * Raised on a PACKAGE (OD Plus TP) new-business policy whose OD leg is two
     * years. HDFC's own data dictionary lists the term — "03 CalculatePremium
     * Request" row 40 gives PRODUCT_CODE 2311 New Policy as "1OD – 3TP, 2OD -
     * 3TP, 3OD - 3TP" — but its rules engine will not write the middle one.
     *
     * Re-proven on 2026-08-13 (scripts/_hdfc-term-probe.ts, model 12798 / RTO
     * 10406, policy starting 13/08/2026) by exhausting both routes HDFC gives
     * for stating a term on this product:
     *
     *   POLICY_TENURE=1, no end date          priced, OD ₹8,284, no IDV ladder
     *   POLICY_TENURE=3, no end date          priced, OD ₹12,300, IdvYear1..3
     *   POLICY_TENURE=2, no end date          THIS refusal
     *   POLICY_TENURE=2, end 12/08/2028       THIS refusal  (start + 2y − 1d)
     *   POLICY_TENURE=2, end 12/08/2029       priced — but OD ₹12,300 with
     *                                         IdvYear3 populated, i.e. the
     *                                         THREE-year figures exactly
     *
     * So the one end date in that region HDFC accepts writes a 3+3 wearing a
     * 2+3 label; there is no payload that buys the two-year OD the customer
     * asked for, and quoting the 3-year one would sell a term nobody chose.
     * Every other end date is refused earlier and for a different reason
     * ("Kindly pass valid policy start and end dates. Policy should be
     * year-based"), which also shows the date itself is well-formed. CPA_Tenure
     * is not involved — the refusal is identical with compulsory PA off, and it
     * never carries the illegal value 2 (mapper/canonical.ts sends 1 or 0,
     * matching the dictionary's "PA cover tenure values should be 1 Or 3").
     * Nor is there a vendor sample to copy: every Req_PvtCar in BOTH Postman
     * collections sends POLICY_TENURE 1.
     */
    test: /SA_OD Policy is only allowed for Short Term Policy period/i,
    why:
      "HDFC's rules engine refuses a 2-year OD term its own data dictionary documents (2OD-3TP under PRODUCT_CODE 2311). " +
      "Both routes for stating the term were exhausted on 2026-08-13: POLICY_TENURE=2 alone is refused, and so is POLICY_TENURE=2 with a year-based PolicyEndDate at start+2y−1d, while the identical payload prices at tenure 1 (OD ₹8,284) and tenure 3 (OD ₹12,300). " +
      "The only end date in that region HDFC accepts is start+3y−1d, which returns the three-year figures with IdvYear3 populated — a 3+3 wearing a 2+3 label, so no payload buys the term the customer asked for. " +
      "CPA_Tenure is not involved (identical refusal with compulsory PA off), and every Req_PvtCar sample in both vendor Postman collections sends POLICY_TENURE 1, so there is no working 2OD-3TP example to copy",
  },
  {
    // Raised when Policy_Details.PolicyEndDate lands 366–730 days after
    // inception — i.e. on a straight two-year standalone OD. Mapped live on
    // 2026-08-10 by sweeping the end date one day at a time from +6 months to
    // +3 years (policy starting 10/08/2026, model 12798, RTO 10406):
    //
    //     ≤   365 days   priced as a one-year OD, no IDV ladder
    //     366–730 days   THIS refusal
    //     731–1095 days  priced multi-year, IdvYear1 + IdvYear2 populated
    //     ≥  1096 days   "Invalid Short Term Policy period"
    //
    // So HDFC UAT has exactly one multi-year standalone-OD band and a two-year
    // term falls in the hole beneath it. Not our payload: POLICY_TENURE is inert
    // for this product (identical results at 1, 2 and 3 for every end date
    // tried), and the refusal tracks the end date alone.
    test: /Policy Tenure is not Correct for Short-Term/i,
    why: "HDFC's rules engine has no two-year standalone-OD band: an end date 366–730 days out is refused outright, while 731–1095 days prices as a multi-year OD",
  },
  {
    test: /Invalid Short Term Policy period/i,
    why: "HDFC caps a standalone OD below a full three years — an end date on or past the third anniversary of inception is refused",
  },
  {
    /**
     * Raised ONLY by `BusinessType_Mandatary: "Used Car"`, and isolated to that
     * one field on live UAT (2026-08-10, model 12798 / RTO 10406, 3-year-old
     * Swift): the Roll Over payload with nothing changed but that string is
     * refused, while the Used Car payload with the string flipped back to
     * "Roll Over" prices normally at ₹12,863. So it is neither our templates nor
     * our credentials in general — every other row in this very run authenticates
     * and prices on the same channel — but our channel specifically not being
     * entitled to HDFC's used-car product on UAT.
     */
    test: /Channel Not Authorized to consume given method/i,
    why: 'HDFC refuses the "Used Car" business type for our UAT channel. Proven to be that field alone: the same payload prices when BusinessType_Mandatary is flipped back to "Roll Over", and the Roll Over payload is refused identically when it is flipped to "Used Car". A vendor entitlement to be requested, not a payload defect',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Sheet: New and Rollover (36 conditions)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rows 3, 9 and 12 demand "HDFC Quote should not display" for a break-in. HDFC's
 * own "Break In" sheet, five tabs later in the SAME workbook, says the opposite:
 * a break-in IS quoted, "Break-in loading premium will be charged", and the
 * proposal is routed to inspection. Live UAT sides with the Break In sheet — it
 * quotes and it charges the loading.
 *
 * These three rows now assert THE BREAK IN SHEET'S READING: the quote is
 * produced, and it reaches the customer FLAGGED, i.e.
 * CanonicalQuoteResult.isInspectionRequired is true. That is a deliberate change
 * from the earlier `expectRejection` assertion, made because:
 *
 *  - the two vendor statements cannot both be tested, and only one of them is
 *    corroborated by the vendor's live behaviour;
 *  - suppressing a quote the insurer is willing to write would hide a real,
 *    buyable policy from the customer, whereas flagging it loses nothing;
 *  - the "should not display" wording is about a UI decision (an aggregator
 *    hiding the card), while "triggered for Inspection" is about the contract —
 *    and it is the contract half that our API can honour.
 *
 * The defect the earlier FAIL was pointing at is real either way and is now
 * fixed: normalizer.normalizeQuote read neither break-in field, so
 * isInspectionRequired stayed undefined and a broken-in HDFC quote reached the
 * compare card indistinguishable from a clean one.
 */
const BREAKIN_SHEET_CONFLICT =
  "ASSERTION DELIBERATELY CHANGED. This row's wording ('HDFC Quote should not display') is contradicted by HDFC's own 'Break In' sheet in the same workbook, which says a break-in IS quoted with a loading premium and an inspection — and live UAT behaves that way. The row now tests the Break In sheet's reading: the quote is produced and reaches the customer FLAGGED (CanonicalQuoteResult.isInspectionRequired), rather than being suppressed. Suppressing a policy HDFC is willing to write would hide a real option from the customer; flagging it loses nothing and is the half our API can actually honour, since 'should not display' is a UI decision. The underlying defect was ours and is fixed: normalizer.normalizeQuote read neither BreakInLoadingPercent nor BreakIN_Premium, so isInspectionRequired was never set.";

/**
 * Rows 5 and 15 ask for "all cover" on a liability-only policy. HDFC returns
 * Basic_OD_Premium = 0 (correct — there is no own-damage section) yet used to
 * bill every own-damage add-on alongside it, because the mapper sent the cover
 * flags regardless of POLICY_TYPE and HDFC does not police the combination.
 * mapper/canonical.ts now forces them off; these two rows are what proves it.
 */
const LIABILITY_ADDON_CONFLICT =
  "HDFC prices own-damage add-ons on a policy that has no own-damage section: Basic_OD_Premium comes back 0 while Zero Dep, Tyre Secure, NCB Protect, RTI, Consumables, Engine-Gearbox and Emergency Assistance are all charged. HDFC does not police the combination, so the eligibility is ours: mapper/canonical.ts now forces every OD cover, accessory IDV and the voluntary excess off when POLICY_TYPE is 'TP Only'. What survives is what HDFC itself rates on a liability policy — UnnamedPerson_premium and PaidDriver_Premium came back populated on these very rows — plus compulsory PA and the bi-fuel kit, which carries its own BiFuel_Kit_TP_Premium.";

/** Every own-damage cover HDFC was observed billing on a TP-only policy. */
const OD_ADDON_PREMIUM_FIELDS = [
  "Vehicle_Base_ZD_Premium",
  "Vehicle_Base_TySec_Premium",
  "Vehicle_Base_NCB_Premium",
  "Vehicle_Base_RTI_Premium",
  "Vehicle_Base_COC_Premium",
  "Vehicle_Base_ENG_Premium",
  "EA_premium",
  "EAW_premium",
  "Loss_of_Use_Premium",
  "LossOfPersonalBelongings_Premium",
] as const;

const NEW_AND_ROLLOVER: Scenario[] = [
  {
    sheet: "new-rollover", no: 1, transactionType: "New Business", policyTerm: "1+3",
    condition: "Create policy without cover (1+3)", vehicle: V.swift,
    req: { ...NEW_BUSINESS, tenureYears: 1 },
    assert: positive("Basic_OD_Premium", "Basic_TP_Premium", "Total_Premium"),
    notes: "POLICY_TENURE=1 is the OD leg; the statutory 3-year TP leg follows from BusinessType 'New Vehicle'.",
  },
  {
    sheet: "new-rollover", no: 2, transactionType: "New Business", policyTerm: "1+3",
    condition: "Create policy with all cover (1+3)", vehicle: V.swift,
    req: { ...NEW_BUSINESS, tenureYears: 1, ...ADDONS_ALL },
    assert: positive(
      "Vehicle_Base_ZD_Premium", "Vehicle_Base_RTI_Premium", "Vehicle_Base_COC_Premium",
      "Vehicle_Base_ENG_Premium", "Vehicle_Base_TySec_Premium", "Vehicle_Base_NCB_Premium",
      "EA_premium", "UnnamedPerson_premium", "PaidDriver_Premium",
    ),
  },
  {
    sheet: "new-rollover", no: 3, transactionType: "New Business", policyTerm: "1+3",
    condition: "Try Create policy with Break-in (1+3), HDFC Quote should not display",
    expected: "Break In sheet reading: quote produced, inspection flagged if HDFC charges break-in loading.",
    vehicle: V.swift,
    req: { ...NEW_BUSINESS, tenureYears: 1, registrationDate: isoOffset(-100), isPreviousPolicyExpired: true },
    assert: both(zero("BreakInLoadingPercent", "BreakIN_Premium"), flaggedForInspection(false)),
    notes:
      BREAKIN_SHEET_CONFLICT +
      " This particular row is ALSO not a break-in in HDFC's sense, and that is a live finding rather than an assumption: a vehicle delivered 100 days ago and never insured has no lapsed cover, and HDFC prices it with BreakInLoadingPercent 0 and BreakIN_Premium 0 (gross ₹21,301 — an ordinary 1+3 new-business premium). So the assertion is that HDFC charges no loading here AND our quote is correspondingly not flagged. Rows 9 and 12, where a policy really did lapse, carry the positive half.",
    inputDeviation: "registrationDate set 100 days back (a new vehicle delivered but never insured) — a brand-new vehicle has no lapse to break in from.",
  },
  {
    sheet: "new-rollover", no: 4, transactionType: "New Business / SATP", policyTerm: "0+3",
    condition: "Create policy without cover (0+3)", vehicle: V.swift,
    req: { ...NEW_BUSINESS, selectedPolicy: "thirdParty", tenureYears: 3 },
    assert: both(positive("Basic_TP_Premium"), zero("Basic_OD_Premium")),
    notes: "0 OD + 3 TP. POLICY_TENURE carries the TP leg here (data dictionary: PRODUCT_CODE 2319, 'New Policy - 3TP').",
  },
  {
    sheet: "new-rollover", no: 5, transactionType: "New Business / SATP", policyTerm: "0+3",
    condition: "Create policy with all cover (0+3)", vehicle: V.swift,
    req: { ...NEW_BUSINESS, selectedPolicy: "thirdParty", tenureYears: 3, ...ADDONS_ALL },
    assert: both(
      positive("Basic_TP_Premium"),
      zero("Basic_OD_Premium", ...OD_ADDON_PREMIUM_FIELDS),
    ),
    notes:
      "A liability-only policy carries no own-damage covers; the assertion is that not one of them is charged on a policy whose own-damage premium is zero. " +
      LIABILITY_ADDON_CONFLICT,
  },
  {
    sheet: "new-rollover", no: 6, transactionType: "New Business / SATP", policyTerm: "0+3",
    condition: "Create policy with Break-in (0+3)", vehicle: V.swift,
    req: { ...NEW_BUSINESS, selectedPolicy: "thirdParty", tenureYears: 3, registrationDate: isoOffset(-100), isPreviousPolicyExpired: true },
    assert: present("BreakInLoadingPercent", "BreakIN_Premium"),
    inputDeviation: "registrationDate 100 days back, as row 3.",
  },
  {
    sheet: "new-rollover", no: 7, transactionType: "Roll-over", policyTerm: "1+1",
    condition: "Create policy without cover (1+1)", vehicle: V.swift,
    req: { tenureYears: 1 },
    assert: positive("Basic_OD_Premium", "Basic_TP_Premium", "Total_Premium"),
  },
  {
    sheet: "new-rollover", no: 8, transactionType: "Roll-over", policyTerm: "1+1",
    condition: "Create policy with all cover (1+1)", vehicle: V.swift,
    req: { tenureYears: 1, ...ADDONS_ALL },
    assert: positive(
      "Vehicle_Base_ZD_Premium", "Vehicle_Base_RTI_Premium", "Vehicle_Base_COC_Premium",
      "Vehicle_Base_ENG_Premium", "Vehicle_Base_TySec_Premium", "Vehicle_Base_NCB_Premium",
      "EA_premium", "UnnamedPerson_premium", "PaidDriver_Premium",
    ),
  },
  {
    sheet: "new-rollover", no: 9, transactionType: "Roll-over", policyTerm: "1+1",
    condition: "Try to Create policy Break-in (1+1), HDFC Quote should not display",
    expected: "Break In sheet reading: quote produced with break-in loading charged, and flagged for inspection.",
    vehicle: V.swift,
    req: { previousPolicyExpiryDate: isoOffset(-45), isPreviousPolicyExpired: true },
    assert: both(positive("BreakInLoadingPercent", "BreakIN_Premium"), flaggedForInspection(true)),
    notes: BREAKIN_SHEET_CONFLICT,
    inputDeviation: "previous policy lapsed 45 days ago (a real break-in window).",
  },
  {
    sheet: "new-rollover", no: 10, transactionType: "SAOD", policyTerm: "0+1",
    condition: "Create policy without cover (0+1)", vehicle: V.swift,
    req: { selectedPolicy: "standAloneOD", tenureYears: 1, ...PREV_TP },
    assert: both(positive("Basic_OD_Premium"), zero("Basic_TP_Premium")),
    notes: "HDFC's sheet writes SAOD as '0+1'; a standalone-OD policy is 1 OD + 0 TP. Treated as 1-year OD with the paired TP policy still running.",
  },
  {
    sheet: "new-rollover", no: 11, transactionType: "SAOD", policyTerm: "0+1",
    condition: "Create policy with all cover (0+1)", vehicle: V.swift,
    req: { selectedPolicy: "standAloneOD", tenureYears: 1, ...PREV_TP, ...ADDONS_ALL },
    assert: positive("Vehicle_Base_ZD_Premium", "Vehicle_Base_RTI_Premium", "Vehicle_Base_COC_Premium"),
  },
  {
    sheet: "new-rollover", no: 12, transactionType: "SAOD", policyTerm: "0+1",
    condition: "Try to Create policy Break-in (0+1), HDFC Quote should not display",
    expected: "Break In sheet reading: quote produced with break-in loading charged, and flagged for inspection.",
    vehicle: V.swift,
    req: { selectedPolicy: "standAloneOD", tenureYears: 1, ...PREV_TP, previousPolicyExpiryDate: isoOffset(-45), isPreviousPolicyExpired: true },
    assert: both(positive("BreakInLoadingPercent", "BreakIN_Premium"), flaggedForInspection(true)),
    notes: BREAKIN_SHEET_CONFLICT,
    inputDeviation: "previous OD policy lapsed 45 days ago; the paired TP policy is still running.",
  },
  {
    sheet: "new-rollover", no: 13, transactionType: "SAOD", policyTerm: "0+1",
    condition: "CPA cover is not applicable", vehicle: V.swift,
    req: { selectedPolicy: "standAloneOD", tenureYears: 1, ...PREV_TP, paOwner: true },
    assert: zero("PAOwnerDriver_Premium"),
    notes: "paOwner=true is sent deliberately: the condition is that HDFC must still charge no CPA on a standalone-OD policy.",
  },
  {
    sheet: "new-rollover", no: 14, transactionType: "Liability", policyTerm: "0+1",
    condition: "Create policy without cover", vehicle: V.swift,
    req: { selectedPolicy: "thirdParty", tenureYears: 1 },
    assert: both(positive("Basic_TP_Premium"), zero("Basic_OD_Premium")),
  },
  {
    sheet: "new-rollover", no: 15, transactionType: "Liability", policyTerm: "0+1",
    condition: "Create policy with all cover", vehicle: V.swift,
    req: { selectedPolicy: "thirdParty", tenureYears: 1, ...ADDONS_ALL },
    assert: both(
      positive("Basic_TP_Premium"),
      zero("Basic_OD_Premium", ...OD_ADDON_PREMIUM_FIELDS),
    ),
    notes: LIABILITY_ADDON_CONFLICT,
  },
  {
    sheet: "new-rollover", no: 16, transactionType: "Liability", policyTerm: "0+1",
    condition: "Create policy with Break-in", vehicle: V.swift,
    req: { selectedPolicy: "thirdParty", tenureYears: 1, previousPolicyExpiryDate: isoOffset(-100), isPreviousPolicyExpired: true },
    assert: zero("BreakIN_Premium"),
    notes: "Break In sheet row 6 says a liability break-in needs no inspection; the API-visible consequence is no break-in loading premium.",
    inputDeviation: "previous policy lapsed 100 days ago.",
  },
  {
    sheet: "new-rollover", no: 17, transactionType: "Roll-Over", policyTerm: "1+1",
    condition: "Vehicle age should not be up to 15 year's for all comprehensive motor product.",
    vehicle: V.swift,
    req: { registrationDate: yearsAgo(16) },
    expectRejection: { test: /age|decline|not\s+eligible|IDV/i, describe: "a 16-year-old car must not get a comprehensive quote" },
    inputDeviation: "registrationDate 16 years back — the condition is itself about age.",
  },
  {
    sheet: "new-rollover", no: 18, transactionType: "Roll-Over", policyTerm: "0+1",
    condition: "Vehicle age should not be up to 15 year's for all liability motor product.",
    vehicle: V.swift,
    req: { selectedPolicy: "thirdParty", registrationDate: yearsAgo(16) },
    expectRejection: { test: /age|decline|not\s+eligible|IDV/i, describe: "a 16-year-old car must not get a liability quote either" },
    inputDeviation: "registrationDate 16 years back.",
  },
  {
    sheet: "new-rollover", no: 19, transactionType: "Roll-Over", policyTerm: "0+1",
    condition: "All motor liability product break-in cases RSD should be T+1 day.",
    vehicle: V.swift,
    req: { selectedPolicy: "thirdParty", previousPolicyExpiryDate: isoOffset(-100), isPreviousPolicyExpired: true },
    assert: zero("BreakIN_Premium"),
    notes: "The RSD (risk start date) itself is only fixed at CreateProposal, which this runner never calls; what CalculatePremium can prove is that a liability break-in attracts no loading. Verdict covers that half only.",
  },
  {
    sheet: "new-rollover", no: 20, transactionType: "Roll-Over", policyTerm: "1+1",
    condition: "Financier detail's should be sent if selected", vehicle: V.swift,
    staticVerdict: {
      verdict: "BLOCKED",
      reason:
        "PARTLY FIXED, and irreducible for the rest. AgreementType was ours to fill and now is: the canonical VehicleIdentitySchema.financeType already says whether the loan is a hypothecation or a lease, and mapper/canonical.ts maps it onto HDFC's field (unit-tested). FinancierCode is not ours to fill — HDFC wants a numeric code from its own GENMST_FINANCIER master (65k rows in PrivateCarMasterData.xls) while the canonical request carries only a financier NAME, and unlike insurers (InsurerMaster + ProviderInsurerCode) there is no canonical financier master to hang a cross-walk off; a guessed code is worse than a null. BranchName has no canonical source at all. All three are Policy_Details fields judged at CreateProposal, which this read-only runner must never call, so no part of this row is observable here.",
    },
  },
  {
    sheet: "new-rollover", no: 21, transactionType: "Roll-Over", policyTerm: "1+1",
    condition: "ADD ON cover is valid up to 5 year's for private car and commercial product.",
    vehicle: V.swift,
    req: { registrationDate: yearsAgo(6), ...ADDONS_ALL },
    expectRejection: { test: /5 years|decline|not\s+eligible|age/i, describe: "add-ons must be declined on a 6-year-old vehicle" },
    inputDeviation: "registrationDate 6 years back — the condition is itself about age.",
  },
  {
    sheet: "new-rollover", no: 22, transactionType: "(blank in sheet)", policyTerm: "1+1",
    condition: "ADD ON cover is valid up to 5 year's for private car and commercial product.",
    vehicle: V.city,
    req: { registrationDate: yearsAgo(8), ...ADDONS_ALL },
    expectRejection: { test: /5 years|decline|not\s+eligible|age/i, describe: "add-ons must be declined on an 8-year-old vehicle" },
    notes: "Duplicate of row 21 in HDFC's sheet with no transaction type; run on a different model and a further age to widen the evidence.",
    inputDeviation: "registrationDate 8 years back, Honda City instead of Swift.",
  },
  {
    sheet: "new-rollover", no: 23, transactionType: "(blank in sheet)", policyTerm: "1+1",
    condition: "RTI cover is valid up to 3 year's for all product.", vehicle: V.swift,
    req: { registrationDate: yearsAgo(4), rti: true },
    assert: zero("Vehicle_Base_RTI_Premium"),
    notes:
      "ASSERTION DELIBERATELY CHANGED, from 'HDFC must refuse' to 'no RTI premium is charged'. HDFC does decline RTI by age, but its rules engine sets the bar higher than its own pack: at 5 years it answers '<> Upto 3 years = decline Cover not eligible for selected vehicle age', while at 4 years it priced the cover at ₹1,049 (gross ₹6,792). The pack's rule is the underwriting rule, so mapper/canonical.ts now drops IsRTI_Cover past three years — which means there is no longer anything for HDFC to refuse. The condition itself is unchanged and still fully tested: a vehicle past the ceiling must end up with no Return-to-Invoice cover on its policy.",
    inputDeviation: "registrationDate 4 years back — one year past the stated RTI ceiling.",
  },
  {
    sheet: "new-rollover", no: 24, transactionType: "Roll-Over", policyTerm: "1+1",
    condition: "RTI cover is valid up to 3 year's for all product.", vehicle: V.swift,
    req: { registrationDate: yearsAgo(3), rti: true },
    assert: positive("Vehicle_Base_RTI_Premium"),
    notes: "The in-bounds half of the same rule: at exactly 3 years RTI must still price.",
    inputDeviation: "registrationDate 3 years back.",
  },
  {
    sheet: "new-rollover", no: 25, transactionType: "Roll-Over", policyTerm: "1+1",
    condition: "Total of Accessories(Electrical/Non Electrical/LPG-CNG KIT) cannot be greater than 25% of the vehicle SI",
    vehicle: V.swift,
    req: { electricalAccessoriesSI: 200_000, nonElectricalAccessoriesSI: 200_000 },
    expectRejection: { test: /25%|optional covers SI/i, describe: "₹4L of accessories on a ~₹5.6L IDV must be refused" },
  },
  {
    sheet: "new-rollover", no: 26, transactionType: "Roll-Over", policyTerm: "1+1",
    condition: "Accessories cover (Electrical/Non Electrical/LPG-CNG KIT) should ask to input SI amount",
    vehicle: V.swift,
    staticVerdict: {
      verdict: "MANUAL",
      reason:
        "A UI prompt, not an API behaviour. The API side (ElecticalAccessoryIDV / NonElecticalAccessoryIDV / BiFuel_Kit_Value) is exercised by rows 25 and by the Long Team accessory/bi-fuel rows.",
    },
  },
  {
    sheet: "new-rollover", no: 27, transactionType: "Roll-Over", policyTerm: "1+1",
    condition: "Anti Theft Discount not applicable for all motor product.", vehicle: V.swift,
    req: { hasAntiTheftDevice: true },
    assert: zero("AntiTheftDisc_Premium"),
    notes:
      "hasAntiTheftDevice=true is declared deliberately: the condition is that no discount may result. HDFC granted one anyway (AntiTheftDisc_Premium=37) when the flag was passed through, so the rule is ours: mapper/canonical.ts now hardcodes AntiTheftDiscFlag=false for HDFC, matching HDFC's own liability sample. The canonical flag is untouched — it is a real customer fact and ICICI Lombard prices a genuine discount from it.",
  },
  {
    sheet: "new-rollover", no: 28, transactionType: "New/Rollover Comprehensive", policyTerm: "1+1",
    condition: "NCB should be applicable increasingly", vehicle: V.swift,
    req: { ncbPercent: 20, claimInPreviousPolicy: false },
    assert: (r) => {
      const applied = n(r.Current_NCB_Per);
      return applied > 20
        ? ok(`declared 20% → HDFC applied ${applied}% (NCBBonusDisc_Premium=${n(r.NCBBonusDisc_Premium)})`)
        : bad(`declared 20% but HDFC applied ${applied}% — no step up the NCB ladder`);
    },
    notes: "HDFC computes the next slab itself from PreviousPolicy_NCBPercentage (live ladder: 0→20, 20→25, 25→35, 35→45, 45→50, 50→50).",
  },
  {
    sheet: "new-rollover", no: 29, transactionType: "New/Rollover", policyTerm: "1+1",
    condition: "NCB should not applicable if claimed on previous policy", vehicle: V.swift,
    req: { ncbPercent: 20, claimInPreviousPolicy: true },
    assert: zero("Current_NCB_Per", "NCBBonusDisc_Premium"),
    notes: "20% NCB is declared alongside claim=true on purpose — the condition is that the claim must void it.",
  },
  {
    sheet: "new-rollover", no: 30, transactionType: "Liability", policyTerm: "0+1",
    condition: "NCB is not applicable", vehicle: V.swift,
    req: { selectedPolicy: "thirdParty", ncbPercent: 20 },
    assert: zero("Current_NCB_Per", "NCBBonusDisc_Premium"),
  },
  {
    sheet: "new-rollover", no: 31, transactionType: "New/Rollover Comprehensive/ Liability", policyTerm: "1+1",
    condition:
      'CPA is mandatory and by default selected as yes. If user deselects it there should be a warning containing "Owner has no valid driving liecense or Having CPA in anoter policy"',
    vehicle: V.swift,
    req: { paOwner: true },
    assert: positive("PAOwnerDriver_Premium"),
    notes:
      "paOwner defaults to true in the canonical contract, so the API-testable half is that a default request actually BUYS compulsory PA cover. The warning text itself is a UI concern. HDFC gates CPA on Effectivedrivinglicense (data dictionary, CPA_Tenure: 'Effectivedrivinglicense tag should be false'): with it true, CPA_Tenure=1 is accepted but PAOwnerDriver_Premium comes back 0; flipping it to false on UAT yields ₹325. mapper/canonical.ts hardcodes effectiveDrivingLicense: true, so paOwner never actually buys CPA.",
  },
  {
    sheet: "new-rollover", no: 32, transactionType: "New/Rollover", policyTerm: "1+1",
    condition: "Chassis number should be 17-digit.", vehicle: V.swift,
    staticVerdict: {
      verdict: "BLOCKED",
      reason:
        "CalculatePremium sends Policy_Details.ChassisNumber = null: a plain quote carries no vehicle identity (mapper/policy-details.ts reads it from MotorFullQuoteRequest.vehicle, which only the proposal path supplies). The rule can only be exercised at CreateProposal, which this runner must not call.",
    },
  },
  {
    sheet: "new-rollover", no: 33, transactionType: "All", policyTerm: "—",
    condition: "Customer should able to select IDV from minimum and maximum range",
    vehicle: V.swift,
    staticVerdict: {
      verdict: "MANUAL",
      reason:
        "An IDV slider in the UI. The API half is already proven by every other row: GetCalculateIDV returns MIN_IDV_AMOUNT/MAX_IDV_AMOUNT and they are carried into CanonicalQuoteResult.minIdv/maxIdv. Note that our provider then prices with HDFC's RECOMMENDED IDV regardless (normalizer.selectIdvForPremium), because HDFC rejects any deviation with 'IDV Deviation not allowed' — so a customer-chosen IDV is not honoured today.",
    },
  },
  {
    sheet: "new-rollover", no: 34, transactionType: "All", policyTerm: "—",
    condition: "Check with Customer Type as Corporate", vehicle: V.swift,
    staticVerdict: {
      verdict: "BLOCKED",
      reason:
        'EXPRESSIBLE NOW, UNOBSERVABLE HERE. mapper/customer.ts no longer hardcodes Customer_Type: "Individual" — it follows the canonical MotorFullQuoteRequest.customerType, with companyName and gstin filling HDFC\'s existing Company_Name and Customer_GSTIN_Number keys, so this is a value change and no golden key set moves (unit-tested in __tests__/plans-and-covers.test.ts). What remains irreducible is that Customer_Details is not part of CalculatePremium AT ALL: HDFC first sees the customer type at CreateProposal, which this read-only runner must never call on a shared sandbox. Note too that the vendor kit ships a separate corporate e-KYC document ("Pehchaan Integration KIT - Corporate.docx"), so a live corporate proposal also needs a corporate Pehchaan journey that is not wired.',
    },
  },
  {
    sheet: "new-rollover", no: 35, transactionType: "All", policyTerm: "—",
    condition: "On Corporate customer check all add-on covers", vehicle: V.swift,
    staticVerdict: {
      verdict: "BLOCKED",
      reason:
        "Same as row 34: the customer type is expressible now but is never sent at quote time, so a corporate quote and an individual one are the identical CalculatePremium payload. Any difference in add-on eligibility for a company can only appear at CreateProposal.",
    },
  },
  {
    sheet: "new-rollover", no: 36, transactionType: "All", policyTerm: "—",
    condition: "On Corporate customer check break-in cases", vehicle: V.swift,
    staticVerdict: {
      verdict: "BLOCKED",
      reason:
        "Same as row 34, compounded: break-in inspection is a proposal-time trigger, so this row needs BOTH halves of what CalculatePremium cannot show.",
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Sheet: Break In (5 conditions)
// ═══════════════════════════════════════════════════════════════════════════════
const BREAK_IN: Scenario[] = [
  {
    sheet: "break-in", no: 1, transactionType: "ALL", policyTerm: "1+1",
    condition: "Verify if Break-in <24 hrs.", expected: "Proposal should be triggered for Inspection",
    vehicle: V.swift,
    req: { previousPolicyExpiryDate: isoOffset(-1), isPreviousPolicyExpired: true },
    assert: zero("BreakInLoadingPercent", "BreakIN_Premium"),
    notes: "Under 24 hours HDFC charges no break-in loading. Whether the PROPOSAL is routed to inspection cannot be observed from CalculatePremium — that half is untested here.",
  },
  {
    sheet: "break-in", no: 2, transactionType: "ALL", policyTerm: "1+1",
    condition: "Verify if Break-in > 24 hrs.",
    expected: "Proposal should be triggered for Inspection & Break-in loading premium will be charged.",
    vehicle: V.swift,
    req: { previousPolicyExpiryDate: isoOffset(-3), isPreviousPolicyExpired: true },
    assert: positive("BreakInLoadingPercent", "BreakIN_Premium"),
    inputDeviation: "previous policy lapsed 3 days ago (> 24 h, well under 90 days).",
  },
  {
    sheet: "break-in", no: 3, transactionType: "ALL", policyTerm: "1+1",
    condition: "Verify if Break-in < 90 days.",
    expected: "Proposal should be triggered for Inspection & Break-in loading premium will be charged.",
    vehicle: V.swift,
    req: { previousPolicyExpiryDate: isoOffset(-60), isPreviousPolicyExpired: true },
    assert: both(positive("BreakInLoadingPercent", "BreakIN_Premium"), positive("Current_NCB_Per")),
    notes: "Inside 90 days the NCB survives, so the assertion also checks Current_NCB_Per is still granted.",
    inputDeviation: "previous policy lapsed 60 days ago.",
  },
  {
    sheet: "break-in", no: 4, transactionType: "ALL", policyTerm: "1+1",
    condition: "Verify if Break-in > 90 days.",
    expected: "1. Proposal should be triggered for Inspection & Break-in loading premium will be charged. 2. NCB % should not be applicable.",
    vehicle: V.swift,
    req: { previousPolicyExpiryDate: isoOffset(-120), isPreviousPolicyExpired: true, ncbPercent: 20 },
    assert: both(positive("BreakInLoadingPercent", "BreakIN_Premium"), zero("Current_NCB_Per", "NCBBonusDisc_Premium")),
    notes: "Both halves of HDFC's own expected result are asserted: loading charged AND the NCB voided by the >90-day lapse.",
    inputDeviation: "previous policy lapsed 120 days ago; 20% NCB declared so the void is observable.",
  },
  {
    sheet: "break-in", no: 5, transactionType: "ALL", policyTerm: "0+1",
    condition: "Verify if Break-in in laibility product.",
    expected: "Inspection not required and RSD should be T+1 day.",
    vehicle: V.swift,
    req: { selectedPolicy: "thirdParty", previousPolicyExpiryDate: isoOffset(-120), isPreviousPolicyExpired: true },
    assert: zero("BreakIN_Premium"),
    notes: "'Inspection not required' shows up as a zero break-in loading premium. RSD = T+1 is set at CreateProposal, which is out of scope here.",
    inputDeviation: "previous policy lapsed 120 days ago.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Sheet: Used Car (12 conditions)
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Every Used Car row used to be BLOCKED for one structural reason: the canonical
 * contract could not say "this is a second-hand purchase", so
 * `resolveBusinessType()` never returned HDFC_BUSINESS_TYPE.used and the Used Car
 * Req_PvtCar / Policy_Details templates were unreachable dead code.
 *
 * That is fixed. `MotorQuoteRequest.isUsedVehiclePurchase` — optional and
 * default-false, so FG, ICICI and ITGI are untouched — now selects them, and
 * every row below is FIRED FOR REAL against HDFC's Used Car product.
 *
 * It is deliberately a separate flag rather than a fourth `businessType` member:
 * `businessType` is required and FG, ICICI and ITGI all branch on it directly
 * (ICICI passes it into its own product resolver), so widening that union would
 * change what three other vendors are sent for a value they have no concept of.
 *
 * What the rows now find is a VENDOR entitlement gap rather than a gap in our
 * code — see the "Channel Not Authorized" pattern above, and the two rows that
 * remain BLOCKED for the unrelated reason that an RSD is only fixed at
 * CreateProposal, which this runner must never call.
 */
const USED_BASE = { isUsedVehiclePurchase: true } as const satisfies Partial<MotorQuoteRequest>;
const USED_RSD_BLOCK =
  "The risk start date is only fixed at CreateProposal, which this read-only runner must never call on a shared sandbox. HDFC's Used Car business type is now reachable (MotorQuoteRequest.isUsedVehiclePurchase) and every other row of this sheet is fired for real — this condition alone has no CalculatePremium-visible half to judge.";

const USED_CAR: Scenario[] = [
  {
    sheet: "used-car", no: 1, transactionType: "Used", policyTerm: "1+1",
    condition: "Create policy without any add on cover",
    expected: "Policy should be issue with all valid details and break-in inspection mandatory. NCB% not application",
    vehicle: V.swift, req: { ...USED_BASE, registrationDate: yearsAgo(3) },
    assert: positive("Total_Premium"),
  },
  {
    sheet: "used-car", no: 2, transactionType: "Used", policyTerm: "1+1",
    condition: "Create policy with all add on cover",
    expected: "Policy should be issue with all valid details and break-in inspection mandatory. NCB% not application",
    vehicle: V.swift, req: { ...USED_BASE, registrationDate: yearsAgo(3), ...ADDONS_ALL },
    assert: positive("Vehicle_Base_ZD_Premium", "Vehicle_Base_RTI_Premium", "Vehicle_Base_COC_Premium"),
  },
  {
    sheet: "used-car", no: 3, transactionType: "Used", policyTerm: "1+1",
    condition: "Verify the vehicle age validation", expected: "Vehicle age should be > 15 years",
    vehicle: V.swift, req: { ...USED_BASE, registrationDate: yearsAgo(16) },
    expectRejection: { test: /age|decline|not\s+eligible|IDV/i, describe: "a 16-year-old used car must not be quoted either" },
    inputDeviation: "registrationDate 16 years back — the condition is itself about age.",
  },
  {
    sheet: "used-car", no: 4, transactionType: "Used", policyTerm: "1+1",
    condition: "Verify the RSD of the policy",
    expected: "RSD should be same as transaction or break-in inspection validity",
    vehicle: V.swift,
    staticVerdict: { verdict: "BLOCKED", reason: USED_RSD_BLOCK },
  },
  {
    sheet: "used-car", no: 5, transactionType: "Used", policyTerm: "1+1",
    condition: "Verify the add on cover age validation", expected: "Add on cover valid up to 5 years.",
    vehicle: V.swift, req: { ...USED_BASE, registrationDate: yearsAgo(6), ...ADDONS_ALL },
    expectRejection: { test: /5 years|decline|not\s+eligible|age/i, describe: "add-ons must be declined on a 6-year-old used car" },
    inputDeviation: "registrationDate 6 years back — the condition is itself about age.",
  },
  {
    sheet: "used-car", no: 6, transactionType: "Used", policyTerm: "1+1",
    condition: "Verify the MERCEDES-BENZ. Make validation",
    expected: "ZD cover mandatory for MERCEDES-BENZ. Make",
    vehicle: V.mercedes, req: { ...USED_BASE, registrationDate: yearsAgo(1) },
    assert: positive("Vehicle_Base_ZD_Premium"),
    notes: "Independently blocked a second time by HDFC's own data: every Mercedes-Benz code tried on UAT answers 'Please provide Vehicle IDV' / a bare BUSINESS EXCEPTION — the make is missing from HDFC's UAT IDV master, so the ZD-mandatory rule cannot be reached whatever the business type.",
  },
  {
    sheet: "used-car", no: 7, transactionType: "Used", policyTerm: "0+1",
    condition: "SAOD — Create policy without any add on cover",
    expected: "Policy should be issue with all valid details and break-in inspection mandatory. NCB% not application",
    vehicle: V.swift, req: { ...USED_BASE, selectedPolicy: "standAloneOD", registrationDate: yearsAgo(3), ...PREV_TP },
    assert: both(positive("Basic_OD_Premium"), zero("Basic_TP_Premium")),
  },
  {
    sheet: "used-car", no: 8, transactionType: "Used", policyTerm: "0+1",
    condition: "SAOD — Create policy with all add on cover",
    expected: "Policy should be issue with all valid details and break-in inspection mandatory. NCB% not application",
    vehicle: V.swift, req: { ...USED_BASE, selectedPolicy: "standAloneOD", registrationDate: yearsAgo(3), ...PREV_TP, ...ADDONS_ALL },
    assert: positive("Vehicle_Base_ZD_Premium", "Vehicle_Base_RTI_Premium", "Vehicle_Base_COC_Premium"),
  },
  {
    sheet: "used-car", no: 9, transactionType: "Used", policyTerm: "0+1",
    condition: "Liability — Create policy without any add on cover",
    expected: "Policy should be issue with all valid details and RSD should be T+1 day of the transaction. NCB% not application",
    vehicle: V.swift, req: { ...USED_BASE, selectedPolicy: "thirdParty", registrationDate: yearsAgo(3) },
    assert: both(positive("Basic_TP_Premium"), zero("Basic_OD_Premium")),
  },
  {
    sheet: "used-car", no: 10, transactionType: "Used", policyTerm: "0+1",
    condition: "Liability — Create policy with all add on cover",
    expected: "Policy should be issue with all valid details and RSD should be T+1 day of the transaction. NCB% not application",
    vehicle: V.swift, req: { ...USED_BASE, selectedPolicy: "thirdParty", registrationDate: yearsAgo(3), ...ADDONS_ALL },
    assert: both(positive("Basic_TP_Premium"), zero("Basic_OD_Premium", ...OD_ADDON_PREMIUM_FIELDS)),
    notes: LIABILITY_ADDON_CONFLICT,
  },
  {
    sheet: "used-car", no: 11, transactionType: "Used", policyTerm: "0+1",
    condition: "SAOD — Verify the RSD of the policy",
    expected: "RSD should be same as transaction or break-in inspection validity",
    vehicle: V.swift,
    staticVerdict: { verdict: "BLOCKED", reason: USED_RSD_BLOCK },
  },
  {
    sheet: "used-car", no: 12, transactionType: "Used", policyTerm: "0+1",
    condition: "SAOD — Verify the MERCEDES-BENZ. Make validation",
    expected: "ZD cover mandatory for MERCEDES-BENZ. Make",
    vehicle: V.mercedes, req: { ...USED_BASE, selectedPolicy: "standAloneOD", registrationDate: yearsAgo(1), ...PREV_TP },
    assert: positive("Vehicle_Base_ZD_Premium"),
    notes: "As row 6, also stopped by the missing Mercedes-Benz IDV master on UAT.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Sheet: Long Team (152 conditions = 38 × four policy terms)
// ═══════════════════════════════════════════════════════════════════════════════
type LongTerm = "3+3" | "2+3" | "3+0" | "2+0";

/**
 * Term → the canonical request that expresses it, or the precise reason it cannot
 * be expressed. Derived from the kit's data dictionary (PrivateCarDataDictionary.xlsx,
 * "03 CalculatePremium Request" row 40) plus live probing on 2026-08-07.
 */
const LONG_TERM_SETUP: Record<
  LongTerm,
  { req: Partial<MotorQuoteRequest>; blocked?: string; gate: string; noTpLeg?: true }
> = {
  "3+3": {
    req: { ...NEW_BUSINESS, selectedPolicy: "comprehensive", tenureYears: 3 },
    gate: "POLICY_TENURE=3 with BusinessType 'New Vehicle' — the TP leg is the statutory 3 years.",
  },
  "2+3": {
    req: { ...NEW_BUSINESS, selectedPolicy: "comprehensive", tenureYears: 2 },
    gate: "POLICY_TENURE=2 with BusinessType 'New Vehicle'.",
  },
  // Both standalone-OD terms below were BLOCKED until 2026-08-10, on the finding
  // that a multi-year OD is driven by Policy_Details.PolicyEndDate rather than
  // POLICY_TENURE and that our templates emitted no such key. That finding was
  // correct and the mapper now emits it (mapper/policy-details.ts,
  // multiYearOdEndDate), so these rows are live again rather than pre-judged.
  //
  // What the fix does NOT do is invent a term HDFC will not write. Sweeping the
  // end date across three years on UAT showed one multi-year standalone-OD band
  // — 731 to 1095 days after inception — with a refusal on either side of it.
  // A three-year term (start + 3y − 1d) lands inside it; a two-year term
  // (start + 2y − 1d) lands in the hole beneath it and is refused. HDFC's own
  // "SA_OD / 3 years" sample lands inside the same band, 1094 days out.
  "3+0": {
    req: { ...NEW_BUSINESS, selectedPolicy: "standAloneOD", tenureYears: 3 },
    gate: "POLICY_TYPE 'OD Only' with PolicyEndDate at start + 3 years − 1 day; POLICY_TENURE is inert on this product.",
    noTpLeg: true,
  },
  "2+0": {
    req: { ...NEW_BUSINESS, selectedPolicy: "standAloneOD", tenureYears: 2 },
    gate: "POLICY_TYPE 'OD Only' with PolicyEndDate at start + 2 years − 1 day; POLICY_TENURE is inert on this product.",
    noTpLeg: true,
  },
};

/** The 38 conditions HDFC repeats verbatim under each of the four terms. */
interface LongCondition {
  condition: string;
  req?: Partial<MotorQuoteRequest>;
  assert?: Scenario["assert"];
  blocked?: string;
  notes?: string;
  vehicle?: Vehicle;
  inputDeviation?: string;
  /**
   * Replacement for a condition that assumes a third-party leg, used under the
   * "+0" (standalone OD) terms. The sheet is a Cartesian product — the same 38
   * conditions repeated under all four terms — so seven of them ask for a TP or
   * CPA premium on a policy that by definition has neither. Asserting the
   * component is ABSENT is the faithful reading of those rows, and it is a real
   * check: it proves the standalone OD really is own-damage only rather than a
   * package quote wearing an OD label.
   */
  whenNoTpLeg?: { assert: Scenario["assert"]; notes: string };
}

/**
 * A standalone OD carries no third-party premium: the TP cover sits on the
 * separate, still-running TP policy this OD is written alongside.
 */
const NO_TP_LEG = {
  assert: both(zero("Basic_TP_Premium"), positive("Basic_OD_Premium")),
  notes:
    "The condition asks for a third-party premium under a standalone-OD term, which cannot have one — the TP cover is on the separate long-term TP policy. Verified as HDFC returning Basic_TP_Premium=0 with a positive own-damage premium.",
} as const;

/**
 * Rows 33–38 of each term: HDFC's six named plan types.
 *
 * WHAT A PLAN ACTUALLY IS — settled by three pieces of vendor evidence that
 * agree exactly, so this is not an interpretation:
 *
 *  1. `PrivateCarMasterData.xls` sheet "PlanTypes" lists each plan as a NAME, a
 *     set of "Mandatory add on cover" rows and a validity band.
 *  2. Live `GetCalculateIDV` returns `addonPlansToCoversMapping`: the same plans
 *     as `coverGroup` codes with `isMandatory` and a per-vehicle `isEligibile`.
 *     The codes decode against the CalculatePremium response's own rate fields on
 *     the SAME vehicle — on a 1-year Swift, G0034's computedRate 0.004 is
 *     `Vehicle_Base_ZD_Premium_Rate`, G0023's 0.0011 is the NCB rate, G0014's
 *     0.0014 the engine-gearbox rate, G0007's 0.001 the consumables rate, G0009
 *     is `EA_premium` ₹50 and G0011 is `EAW_premium` ₹499 — and every plan's
 *     decoded cover list then matches its PlanTypes row.
 *  3. The plan NAME is inert. Live, `PlanType` sent as Gold / Silver / Diamond /
 *     Platinum / Titanium / Menu Card Approach and an invented "NONSENSE-XYZ"
 *     all returned the identical gross ₹8,354.
 *
 * So a plan is a NAMED BUNDLE OF MANDATORY ADD-ON COVERS — merchandising, not a
 * rating input — and it is expressible today: pick the plan through the
 * `providerAddonCodes` passthrough (a plan name is HDFC branding, not an
 * insurance concept, so it does not belong in the canonical contract) and the
 * mapper turns on the covers the plan makes mandatory. The BLOCKED reason these
 * rows used to carry — "the New Business template has no PlanType key" — was
 * true but beside the point: the key is inert, so its absence costs nothing.
 *
 * Each row asserts the thing that actually matters to a customer: every cover
 * the plan promises is on the policy AND charged for.
 */
const PLAN_ROWS: { plan: string; covers?: { flag: keyof MotorQuoteRequest; field: string }[]; blocked?: string; notes?: string }[] = [
  {
    plan: "Gold",
    blocked:
      'HDFC\'s "Gold Plan" cannot be described. It is absent from the master workbook\'s own PlanTypes sheet (which lists Silver, Platinum, Titanium, Diamond, Essential ZD and Essential EGP), it comes back isEligibile:false in addonPlansToCoversMapping on every vehicle probed on UAT — a 1-year-old and a 6-year-old Swift — and while its first mandatory cover group decodes to Zero Depreciation, the second (N161521G0020) matches no cover in any source we hold: its computedRate appears in no *_Premium_Rate field on the response. Selling a customer a plan containing a cover nobody can name is worse than not selling it, so Gold is deliberately absent from the plan catalogue and a request naming it is ignored. This one needs HDFC to say what N161521G0020 is.',
  },
  {
    plan: "Silver",
    covers: [{ flag: "zeroDep", field: "Vehicle_Base_ZD_Premium" }],
  },
  {
    plan: "Diamond",
    covers: [
      { flag: "zeroDep", field: "Vehicle_Base_ZD_Premium" },
      { flag: "consumables", field: "Vehicle_Base_COC_Premium" },
    ],
  },
  {
    plan: "Platinum",
    covers: [
      { flag: "zeroDep", field: "Vehicle_Base_ZD_Premium" },
      { flag: "ncbProtection", field: "Vehicle_Base_NCB_Premium" },
      { flag: "engineProtect", field: "Vehicle_Base_ENG_Premium" },
    ],
  },
  {
    plan: "Titanium",
    covers: [
      { flag: "zeroDep", field: "Vehicle_Base_ZD_Premium" },
      { flag: "ncbProtection", field: "Vehicle_Base_NCB_Premium" },
      { flag: "engineProtect", field: "Vehicle_Base_ENG_Premium" },
      { flag: "consumables", field: "Vehicle_Base_COC_Premium" },
    ],
  },
  {
    plan: "Menu Card Approach",
    covers: [],
    notes:
      '"Menu Card Approach" is the pack\'s name for the ABSENCE of a plan — the customer picks covers one at a time, which is what this integration does by default. So the honest test is the converse of the bundled plans: naming it must add nothing. This row selects Zero Dep alone alongside it and asserts that Zero Dep is the only add-on charged — no bundle silently attached itself.',
  },
];

const PLAN_CONDITIONS: LongCondition[] = PLAN_ROWS.map(({ plan, covers, blocked, notes }) => {
  const condition = `…premium for Plan type ${plan} with multiplier factor`;
  if (blocked) return { condition, blocked };
  const bundled = covers ?? [];
  return {
    condition,
    req: {
      providerAddonCodes: [`${plan} Plan`],
      // Menu Card is the à-la-carte case: one cover asked for by name.
      ...(bundled.length === 0 ? { zeroDep: true } : {}),
    },
    assert:
      bundled.length === 0
        ? both(
            positive("Vehicle_Base_ZD_Premium"),
            zero("Vehicle_Base_NCB_Premium", "Vehicle_Base_ENG_Premium", "Vehicle_Base_COC_Premium"),
          )
        : both(
            positive(...bundled.map((c) => c.field)),
            // Nothing outside the bundle may be charged: a plan adds covers, it
            // does not quietly buy the whole catalogue.
            zero(
              ...["Vehicle_Base_ZD_Premium", "Vehicle_Base_NCB_Premium", "Vehicle_Base_ENG_Premium", "Vehicle_Base_COC_Premium", "Vehicle_Base_RTI_Premium", "Vehicle_Base_TySec_Premium"].filter(
                (f) => !bundled.some((c) => c.field === f),
              ),
            ),
          ),
    notes:
      notes ??
      `The plan is selected through providerAddonCodes ("${plan} Plan") and expands to the covers HDFC's own PlanTypes sheet marks mandatory for it — ${bundled
        .map((c) => c.flag)
        .join(", ")} — cross-checked against the live addonPlansToCoversMapping cover groups. The assertion is that every cover the plan promises is actually charged, and that nothing outside it is.`,
  };
});

const LONG_CONDITIONS: LongCondition[] = [
  { condition: "Verify Private Car policy.", assert: positive("Total_Premium") },
  {
    condition: "Verfy the previous policy end date validation for policy term.",
    req: { previousPolicyExpiryDate: isoOffset(30), isPreviousPolicyExpired: false, previousPolicyNumber: "PREVPOL0002" },
    assert: positive("Total_Premium"),
    notes: "A previous policy still running 30 days out. mapper/canonical.ts applyRolloverDateSanity() shifts the new start to the day after it expires, so HDFC's 'previous policy must have expired' rule is honoured.",
    inputDeviation: "previous policy expiry set 30 days in the future.",
  },
  { condition: "Create policy New Business policy and verify the Total IDV.", assert: positive("IDV") },
  { condition: "Create policy New Business policy and verify the OD Rate", assert: present("Basic_OD_Rate") },
  { condition: "Create policy New Business policy and verify the OD multiplier factor", assert: present("Basic_OD_Rate", "Tariff_Rate_Per") },
  { condition: "Create policy New Business policy and verify the TP premium for fuel type Petrol", assert: positive("Basic_TP_Premium"), vehicle: V.swift, whenNoTpLeg: NO_TP_LEG },
  { condition: "Create policy New Business policy and verify the TP premium for fuel type Desiel", assert: positive("Basic_TP_Premium"), vehicle: V.rapid, whenNoTpLeg: NO_TP_LEG },
  { condition: "Create policy New Business policy and verify the TP premium for fuel type Hybrid", assert: positive("Basic_TP_Premium"), vehicle: V.hycrossHybrid, whenNoTpLeg: NO_TP_LEG },
  { condition: "Create policy New Business policy and verify the TP premium for fuel type CNG", assert: positive("Basic_TP_Premium"), vehicle: V.niosCng, whenNoTpLeg: NO_TP_LEG },
  { condition: "Create policy New Business policy and verify the TP premium for fuel type LPG", assert: positive("Basic_TP_Premium"), vehicle: V.santroLpg, whenNoTpLeg: NO_TP_LEG },
  { condition: "Create policy New Business policy and verify the TP premium for fuel type Electric", assert: positive("Basic_TP_Premium"), vehicle: V.nexonEv, whenNoTpLeg: NO_TP_LEG },
  {
    condition: "Create policy New Business policy and verify the IDV of CNG",
    req: { bifuelKitType: "CNG", bifuelKitSI: 60_000 },
    assert: positive("BiFuel_Kit_OD_Premium"),
    notes: "External CNG kit declared on a petrol car (BiFuelType=CNG, BiFuel_Kit_Value=60000), which is how HDFC carries a retro-fitted kit's IDV.",
  },
  {
    condition: "Create policy New Business policy and verify the IDV of LPG",
    req: { bifuelKitType: "LPG", bifuelKitSI: 40_000 },
    assert: positive("BiFuel_Kit_OD_Premium"),
  },
  {
    condition: "Create policy New Business policy and verify the IDV of Electrical Acc.",
    req: { electricalAccessoriesSI: 20_000 },
    assert: positive("Electical_Acc_Premium"),
  },
  {
    condition: "Create policy New Business policy and verify the IDV of Non-Electrical Acc.",
    req: { nonElectricalAccessoriesSI: 10_000 },
    assert: positive("NonElectical_Acc_Premium"),
  },
  {
    condition: "Create policy New Business policy and verify the CPA premium",
    req: { paOwner: true },
    assert: positive("PAOwnerDriver_Premium"),
    whenNoTpLeg: {
      assert: both(zero("PAOwnerDriver_Premium"), positive("Basic_OD_Premium")),
      notes:
        "Compulsory PA cover for the owner-driver rides on the liability policy, so a standalone OD cannot carry it. HDFC agrees: the same request that prices CPA on a package policy returns PAOwnerDriver_Premium=0 under an OD-only term.",
    },
  },
  { condition: "Create policy New Business policy and verify the Liability covers premium", assert: positive("Basic_TP_Premium"), whenNoTpLeg: NO_TP_LEG },
  { condition: "Create policy New Business policy and verify the Other loading calculation", assert: present("OtherLoading_Premium") },
  { condition: "Create policy New Business policy and verify the Other Discount calculation", assert: present("Other_Discount", "OtherDiscount_Premium") },
  {
    condition: "Create policy New Business policy and verify the ADD ON Cover multiplier factor",
    req: { zeroDep: true, rti: true, consumables: true, engineProtect: true, tyreProtect: true, ncbProtection: true },
    assert: present(
      "Vehicle_Base_ZD_Premium_Rate", "Vehicle_Base_RTI_Premium_Rate", "Vehicle_Base_COC_Premium_Rate",
      "Vehicle_Base_ENG_Premium_Rate", "Vehicle_Base_TySec_Premium_Rate", "Vehicle_Base_NCB_Premium_Rate",
    ),
  },
  {
    condition: "…premium for Zero Depreciation - Claim ADD ON Cover with multiplier factor",
    req: { zeroDep: true },
    assert: both(positive("Vehicle_Base_ZD_Premium"), present("Vehicle_Base_ZD_Premium_Rate")),
  },
  {
    condition: "…premium for NCB Protection ADD ON Cover with multiplier factor",
    req: { ncbProtection: true },
    assert: both(positive("Vehicle_Base_NCB_Premium"), present("Vehicle_Base_NCB_Premium_Rate")),
  },
  {
    condition: "…premium for Engine and GearBox Protector ADD ON Cover with multiplier factor",
    req: { engineProtect: true },
    assert: both(positive("Vehicle_Base_ENG_Premium"), present("Vehicle_Base_ENG_Premium_Rate")),
  },
  {
    condition: "…premium for Loss of Use or Down time protection ADD ON Cover with multiplier factor",
    req: { garageCash: true },
    assert: both(positive("Loss_of_Use_Premium"), present("Loss_of_Use_Premium_Rate")),
    notes:
      "IsLossofUseDownTimeProt_Cover was hardcoded to 0 in all three templates, so the cover could never be bought. It now follows the canonical garageCash flag — HDFC's 'Loss of Use or Down Time Protection' and the market's 'Garage Cash' are the same benefit, a payout while the vehicle is off the road being repaired, so the existing canonical key is reused rather than an HDFC-shaped one invented. HDFC's own New Business proposal sample ships the flag on.",
  },
  {
    condition: "…premium for Cost of Consumables ADD ON Cover with multiplier factor",
    req: { consumables: true },
    assert: both(positive("Vehicle_Base_COC_Premium"), present("Vehicle_Base_COC_Premium_Rate")),
  },
  {
    condition: "…premium for Return to Invoice ADD ON Cover with multiplier factor",
    req: { rti: true },
    assert: both(positive("Vehicle_Base_RTI_Premium"), present("Vehicle_Base_RTI_Premium_Rate")),
  },
  {
    condition: "…premium for Emergency Assistance ADD ON Cover with multiplier factor",
    req: { rsa: true },
    assert: positive("EA_premium"),
  },
  {
    condition: "…premium for Emergency Assistance Wider ADD ON Cover with multiplier factor",
    req: { rsaWorldwide: true },
    assert: positive("EAW_premium"),
    notes:
      "IsEAW_Cover was hardcoded false. It now follows a new canonical add-on key, rsaWorldwide — a wider/worldwide roadside-assistance tier is a genuinely provider-agnostic concept, and HDFC treats it as a cover in its own right rather than an upgrade of IsEA_Cover: live on UAT a quote with both on returns EA_premium 50 AND EAW_premium 499. The key is optional and default-off, so FG, ICICI and ITGI are untouched.",
  },
  {
    condition: "…premium for EMI Protector Plus ADD ON Cover with multiplier factor",
    req: { emiProtect: true, emiAmount: 15_000 },
    assert: both(positive("EMI_PROTECTOR_PREMIUM"), present("EMI_PROTECTOR_PREMIUM_Rate")),
    notes:
      "Previously recorded as unrated in HDFC's sandbox. That was wrong, and finding out why is the whole of this row: HDFC refuses the payload for a MISSING INPUT, not a missing rate. The cover needs three things together — NoOfEmi, a non-zero EMIAmount, and EMIPlanType — and 'EMI Protector Plus - Add on system rate is not available' is what it says when any of them is absent. Proven live by adding them one at a time: with NoOfEmi 3 + EMIAmount 15000 it still refuses; the byte-identical payload with EMIPlanType 'A' added prices at EMI_PROTECTOR_PREMIUM 600 (rate 0.04 × 15000). Plan 'B' rates at 8%, 'C' has no rate, and NoOfEmi 6 has no rate. The canonical contract gained emiProtect + emiAmount; the cover is dropped rather than requested when no amount is supplied, because a zero amount is the refusal above.",
    inputDeviation: "EMI amount ₹15,000 — the cover is rated on it, so a request without one cannot buy it.",
  },
  {
    condition: "…premium for Higher Protection and Removal Costs ADD ON Cover with multiplier factor",
    req: { providerAddonCodes: ["HIGH_PROTECTION"] },
    assert: positive("HighProtection_Premium"),
    notes:
      "IsHighProtection_Cover is now expressible, through the providerAddonCodes passthrough rather than a canonical flag: no other vendor we integrate sells 'Higher Protection and Removal Costs', and putting an option nobody can price on the compare card would be worse than leaving it off. HDFC's sandbox genuinely cannot rate it. Earlier probing blamed the refusal on a null HigherTowingLimit; sweeping the limit on a Roll Over (null / 1 / 2 / 3 / 25000 / 50000) returns 'Higher Protection and Removal Costs - Add on system rate is not available' at every single value, so the limit is not the missing input and the rate row is simply absent. On New Business the same request comes back as the generic 'Exception while Call Blaze!' instead — HDFC states the reason on one business type and swallows it on the other, but it is the same missing rate either way. That is why no towing limit is sent: no value is more truthful than none.",
  },
  {
    condition: "…premium for Tyre Secure For Private Car ADD ON Cover with multiplier factor",
    req: { tyreProtect: true },
    assert: both(positive("Vehicle_Base_TySec_Premium"), present("Vehicle_Base_TySec_Premium_Rate")),
  },
  {
    condition: "…premium for Loss of Personal Belongings cover ADD ON Cover with multiplier factor",
    req: { lossOfBelongings: true },
    assert: positive("LossOfPersonalBelongings_Premium"),
    notes: "The cover is rated ON LossOfPersonalBelonging_SI, which mapper/canonical.ts hardcoded to 0 — so the flag went out and HDFC charged nothing, leaving the customer with a cover worth nothing. The canonical contract now carries an optional lossOfBelongingsSI, and where a caller names none HDFC's own figure is sent: the only request in its Postman collection that turns the cover on sends LossOfPersonalBelonging_SI: 50000. This row deliberately sets no SI, so it proves the default.",
  },
  ...PLAN_CONDITIONS,
];

function longTermScenarios(): Scenario[] {
  const out: Scenario[] = [];
  let no = 0;
  for (const term of ["3+3", "2+3", "3+0", "2+0"] as LongTerm[]) {
    const setup = LONG_TERM_SETUP[term];
    for (const [i, c] of LONG_CONDITIONS.entries()) {
      no += 1;
      const blocked = setup.blocked ?? c.blocked;
      // A "+0" term has no third-party leg, so the seven conditions that ask for
      // one are re-read rather than failed — see LongCondition.whenNoTpLeg.
      const swap = setup.noTpLeg ? c.whenNoTpLeg : undefined;
      out.push({
        sheet: "long-term",
        no,
        transactionType: "New Business",
        policyTerm: term,
        condition: c.condition,
        vehicle: c.vehicle ?? V.swift,
        req: { ...setup.req, ...c.req },
        assert: swap?.assert ?? c.assert,
        staticVerdict: blocked ? { verdict: "BLOCKED", reason: blocked } : undefined,
        // For a term our templates cannot express, fire only the term probe: one
        // response is enough to show what HDFC does with the nearest request we
        // CAN build, and 37 repeats of it would be noise on a shared sandbox.
        // No term is in that state today — both standalone-OD terms became
        // expressible on 2026-08-10 — but the machinery stays for the next one.
        probeAnyway: Boolean(setup.blocked) && i === 0,
        // Condition 0 ("Verify Private Car policy.") is the plainest request of
        // the term, so a refusal there is about the TERM; later conditions vary
        // the model or the cover and their failures are about those instead.
        termProbe: i === 0,
        notes: swap ? [swap.notes, c.notes].filter(Boolean).join(" ") : c.notes,
        inputDeviation: c.inputDeviation,
      });
    }
  }
  return out;
}

const ALL_SCENARIOS: Record<SheetKey, Scenario[]> = {
  "new-rollover": NEW_AND_ROLLOVER,
  "long-term": longTermScenarios(),
  "used-car": USED_CAR,
  "break-in": BREAK_IN,
};

// ─── Execution ─────────────────────────────────────────────────────────────────
/**
 * ProviderError renders as "HDFC <step> failed: <HDFC's own words>". The whole
 * string is kept: HDFC's text is verbatim inside it and the step tells a reader
 * whether the vendor gave up at GetCalculateIDV or at CalculatePremium — which
 * is the difference between "no IDV for this model" and "this cover was refused".
 */
function errMessage(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).trim();
}
function isRateLimited(e: unknown): boolean {
  return /\[429\]|\b429\b/.test(e instanceof Error ? e.message : String(e));
}
function classifyVendorData(message: string): string | undefined {
  return VENDOR_DATA_PATTERNS.find((p) => p.test.test(message))?.why;
}

async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimited(e) || i >= attempts) throw e;
      const waitMs = 5000 * i;
      console.log(`      (HTTP 429 from HDFC — backing off ${waitMs / 1000}s, attempt ${i}/${attempts - 1})`);
      await sleep(waitMs);
    }
  }
}

async function main(): Promise<void> {
  if (REGEN_ONLY) {
    const saved = JSON.parse(readFileSync(RESULTS_JSON, "utf8")) as { results: RowResult[] };
    writeMarkdown(saved.results, saved as unknown as { generatedAt: string });
    console.log(`Regenerated ${OUT_MD} from ${RESULTS_JSON} (${saved.results.length} rows, no live calls)`);
    return;
  }

  const sheets: SheetKey[] =
    SHEET_FILTER === "all" ? ["new-rollover", "break-in", "used-car", "long-term"] : [SHEET_FILTER];
  const queue = sheets
    .flatMap((s) => ALL_SCENARIOS[s])
    .filter((s) => !ROWS_FILTER || ROWS_FILTER.includes(s.no));

  console.log(
    `HDFC UAT scenario run: sheets=${sheets.join(",")} rows=${ROWS_FILTER?.join(",") ?? "all"} ` +
      `rps=${RPS} dryRun=${DRY_RUN}\n${queue.length} conditions queued.\n`,
  );

  const provider = DRY_RUN
    ? undefined
    : new HdfcProvider({ config: loadHdfcConfig(), codeResolver: passthroughCodeResolver });

  const results: RowResult[] = [];
  /** Identical canonical requests ask HDFC the same question — ask it once. */
  const cache = new Map<string, { row: string; result: Partial<RowResult>; error?: string }>();
  /**
   * When a whole policy term is refused by HDFC, the remaining conditions of that
   * term cannot be exercised — record the term's verbatim refusal against each of
   * them rather than firing 37 more identical rejections at a shared sandbox.
   */
  const termGate = new Map<string, { message: string; why: string }>();

  for (const s of queue) {
    const tag = `[${s.sheet} #${s.no}${s.policyTerm !== "—" ? ` ${s.policyTerm}` : ""}]`;
    console.log(`${tag} ${s.condition.slice(0, 96)}`);

    const row: RowResult = {
      ...s,
      verdict: "FAIL",
      reason: "",
      request: s.req ? buildRequest(s) : undefined,
    };
    delete (row as Partial<Scenario>).req;

    if (s.staticVerdict) {
      row.verdict = s.staticVerdict.verdict;
      row.reason = s.staticVerdict.reason;
      if (provider && row.request && s.probeAnyway) {
        try {
          const q = await withRateLimitRetry(() =>
            provider.getQuote(row.request!, { requestId: `hdfc-uat-${s.sheet}-${s.no}-probe` }),
          );
          row.grossPremium = q.grossPremium;
          row.odPremium = q.basicOdPremium;
          row.tpPremium = q.thirdPartyPremium;
          row.idv = q.idvValue;
          row.respPvtCar = ((q._rawResponse as Record<string, unknown> | undefined)?.Resp_PvtCar ?? {}) as Resp;
        } catch (e) {
          row.vendorMessage = errMessage(e);
        }
        await sleep(1000 / RPS);
      }
      console.log(
        `   → ${row.verdict}: ${row.reason.slice(0, 120)}…` +
          (row.grossPremium !== undefined ? `
      (probed anyway: gross ₹${row.grossPremium})` : "") +
          (row.vendorMessage ? `
      (probed anyway — HDFC: ${row.vendorMessage.slice(0, 150)})` : ""),
      );
      results.push(row);
      continue;
    }

    if (!provider || !row.request) {
      row.verdict = "BLOCKED";
      row.reason = DRY_RUN ? "dry run — no live call made" : "no request builder for this row";
      console.log(`   → dry-run: ${JSON.stringify({ policy: row.request?.selectedPolicy, tenure: row.request?.tenureYears, model: row.request?.modelId, reg: row.request?.registrationDate })}`);
      results.push(row);
      continue;
    }

    const gateKey = `${s.sheet}|${s.policyTerm}`;
    const gated = termGate.get(gateKey);
    if (gated) {
      row.verdict = "VENDOR_DATA";
      row.vendorMessage = gated.message;
      row.reason = `Policy term ${s.policyTerm} is refused outright by HDFC UAT (${gated.why}), so this condition could not be exercised. Term gate established by the first row of this term.`;
      console.log(`   → VENDOR_DATA (term gate): ${gated.message.slice(0, 110)}`);
      results.push(row);
      continue;
    }

    const key = JSON.stringify(row.request);
    const hit = cache.get(key);
    let raw: Resp | undefined;
    let quote: CanonicalQuoteResult | undefined;
    let error: string | undefined;

    if (hit) {
      row.sharedWithRow = hit.row;
      raw = hit.result.respPvtCar;
      quote = hit.result.grossPremium !== undefined ? ({ grossPremium: hit.result.grossPremium } as CanonicalQuoteResult) : undefined;
      error = hit.error;
      Object.assign(row, {
        grossPremium: hit.result.grossPremium,
        odPremium: hit.result.odPremium,
        tpPremium: hit.result.tpPremium,
        idv: hit.result.idv,
        respPvtCar: hit.result.respPvtCar,
      });
      console.log(`   (identical payload to ${hit.row} — reusing that response)`);
    } else {
      try {
        const q = await withRateLimitRetry(() =>
          provider.getQuote(row.request!, { requestId: `hdfc-uat-${s.sheet}-${s.no}` }),
        );
        quote = q;
        raw = ((q._rawResponse as Record<string, unknown> | undefined)?.Resp_PvtCar ?? {}) as Resp;
        row.grossPremium = q.grossPremium;
        row.odPremium = q.basicOdPremium;
        row.tpPremium = q.thirdPartyPremium;
        row.idv = q.idvValue;
        row.respPvtCar = raw;
      } catch (e) {
        error = errMessage(e);
      }
      cache.set(key, {
        row: `${s.sheet} #${s.no}`,
        result: { grossPremium: row.grossPremium, odPremium: row.odPremium, tpPremium: row.tpPremium, idv: row.idv, respPvtCar: row.respPvtCar },
        error,
      });
      await sleep(1000 / RPS);
    }

    // ── Verdict ────────────────────────────────────────────────────────────────
    if (error) {
      row.vendorMessage = error;
      const vendorWhy = classifyVendorData(error);
      if (s.expectRejection?.test.test(error)) {
        row.verdict = "PASS";
        row.reason = `HDFC refused it, as the condition requires (${s.expectRejection.describe}).`;
      } else if (vendorWhy) {
        row.verdict = "VENDOR_DATA";
        row.reason = vendorWhy;
      } else if (s.expectRejection) {
        row.verdict = "PASS";
        row.reason = `HDFC refused it (${s.expectRejection.describe}), though its message does not name the rule.`;
      } else {
        row.verdict = "FAIL";
        row.reason = "HDFC rejected our payload.";
      }
      // Only the term probe may gate: see Scenario.termProbe.
      if (row.verdict === "VENDOR_DATA" && s.termProbe && !termGate.has(gateKey)) {
        termGate.set(gateKey, { message: error, why: vendorWhy ?? "vendor refusal" });
      }
    } else if (s.expectRejection) {
      row.verdict = "FAIL";
      row.reason =
        `HDFC quoted it instead of refusing (${s.expectRejection.describe}) — gross ₹${row.grossPremium}. ` +
        "The rule is not enforced server-side, so it is ours to enforce.";
    } else if (s.assert) {
      const a = s.assert(raw ?? {}, quote!);
      row.verdict = a.ok ? "PASS" : "FAIL";
      row.reason = a.detail;
    } else {
      row.verdict = "PASS";
      row.reason = `priced: gross ₹${row.grossPremium}`;
    }

    console.log(
      `   → ${row.verdict}: ${row.reason.slice(0, 150)}` +
        (row.vendorMessage ? `\n      HDFC: ${row.vendorMessage.slice(0, 200)}` : ""),
    );
    results.push(row);
  }

  // ── Persist ───────────────────────────────────────────────────────────────────
  const key = (r: { sheet: string; no: number }) => `${r.sheet}-${r.no}`;
  let merged = results;
  try {
    const prior = (JSON.parse(readFileSync(RESULTS_JSON, "utf8")) as { results: RowResult[] }).results;
    const byKey = new Map(prior.map((r) => [key(r), r]));
    for (const r of results) byKey.set(key(r), r);
    merged = [...byKey.values()];
  } catch {
    // first run — nothing to merge
  }
  const meta = { generatedAt: new Date().toISOString() };
  writeFileSync(RESULTS_JSON, JSON.stringify({ ...meta, results: merged }, null, 2));
  console.log(`\nWrote ${RESULTS_JSON} (${merged.length} rows)`);
  writeMarkdown(merged, meta);
  console.log(`Wrote ${OUT_MD}`);

  const tally = countBy(merged);
  console.log(
    `\n═══ ${merged.length} conditions — ` +
      (["PASS", "FAIL", "VENDOR_DATA", "BLOCKED", "MANUAL"] as Verdict[])
        .map((v) => `${v} ${tally[v]}`)
        .join(" · ") +
      " ═══",
  );
}

// ─── Markdown report ───────────────────────────────────────────────────────────
const VERDICTS: Verdict[] = ["PASS", "FAIL", "VENDOR_DATA", "BLOCKED", "MANUAL"];
const SHEET_TITLE: Record<SheetKey, string> = {
  "new-rollover": "New and Rollover",
  "long-term": "Long Team",
  "used-car": "Used Car",
  "break-in": "Break In",
};

function countBy(rows: RowResult[]): Record<Verdict, number> {
  const out = { PASS: 0, FAIL: 0, VENDOR_DATA: 0, BLOCKED: 0, MANUAL: 0 };
  for (const r of rows) out[r.verdict] += 1;
  return out;
}
/** Markdown table cells cannot carry a raw pipe or newline. */
const cell = (s: string | undefined): string =>
  (s ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
const money = (v: number | undefined): string => (v === undefined ? "—" : `₹${v.toLocaleString("en-IN")}`);

function writeMarkdown(rows: RowResult[], meta: { generatedAt: string }): void {
  const total = countBy(rows);
  const L: string[] = [];

  L.push("# HDFC ERGO — UAT certification pack results");
  L.push("");
  L.push(
    `Generated ${meta.generatedAt} by \`npm run hdfc:scenarios\` (\`scripts/hdfc-uat-scenarios.ts\`). ` +
      "Every row was fired at **live HDFC UAT** through the production provider " +
      "(`HdfcProvider.getQuote` → Authenticate, GetCalculateIDV, CalculatePremium). " +
      "**No proposal or payment call is ever made** — this is a shared sandbox and binding policies in it is not ours to do.",
  );
  L.push("");
  L.push(
    "Source pack: `PVTcarTestScenarios.xls` in the HDFC API KIT, sheets " +
      "*New and Rollover* (36), *Long Team* (152), *Used Car* (12) and *Break In* (5).",
  );
  L.push("");
  L.push("## Verdicts");
  L.push("");
  L.push("| Verdict | Meaning |");
  L.push("| --- | --- |");
  L.push("| **PASS** | The call succeeded and the condition's expectation held — including the cases where the condition demands a refusal and HDFC refused. |");
  L.push("| **FAIL** | Our defect. Either HDFC rejected something we sent, or HDFC silently accepted something this condition forbids, which means the rule is ours to enforce and today we do not. |");
  L.push("| **VENDOR_DATA** | HDFC's sandbox could not price it: no IDV for the model, no rate row in an R-master, a Blaze rules-engine crash, or a term its own data dictionary documents but its rules engine refuses. Not our code. |");
  L.push("| **BLOCKED** | Our integration cannot express the condition. Every such row names the missing field or code path. |");
  L.push("| **MANUAL** | A UI/manual condition with no API surface. |");
  L.push("");

  L.push("## Totals");
  L.push("");
  L.push(`| Sheet | Conditions | ${VERDICTS.join(" | ")} |`);
  L.push(`| --- | ---: | ${VERDICTS.map(() => "---:").join(" | ")} |`);
  for (const sheet of ["new-rollover", "long-term", "used-car", "break-in"] as SheetKey[]) {
    const subset = rows.filter((r) => r.sheet === sheet);
    if (subset.length === 0) continue;
    const t = countBy(subset);
    L.push(`| ${SHEET_TITLE[sheet]} | ${subset.length} | ${VERDICTS.map((v) => t[v]).join(" | ")} |`);
  }
  L.push(`| **All sheets** | **${rows.length}** | ${VERDICTS.map((v) => `**${total[v]}**`).join(" | ")} |`);
  L.push("");
  const executed = rows.filter((r) => r.grossPremium !== undefined || r.vendorMessage).length;
  L.push(
    `${executed} of ${rows.length} conditions produced a live HDFC response; the rest are BLOCKED or MANUAL rows ` +
      "that were never sent (each states why).",
  );
  L.push("");

  // Failures first — they are the actionable part.
  const failures = rows.filter((r) => r.verdict === "FAIL");
  L.push("## Failures — our defects");
  L.push("");
  if (failures.length === 0) {
    L.push("_None._");
  } else {
    L.push("| Sheet | # | Term | Condition | What went wrong | HDFC's verbatim message |");
    L.push("| --- | ---: | --- | --- | --- | --- |");
    for (const r of failures) {
      L.push(
        `| ${SHEET_TITLE[r.sheet]} | ${r.no} | ${cell(r.policyTerm)} | ${cell(r.condition)} | ${cell(r.reason)} | ${r.vendorMessage ? `\`${cell(r.vendorMessage)}\`` : "— (HTTP 200, assertion failed on the response)"} |`,
      );
    }
  }
  L.push("");

  // Everything else that is not a pass, so no non-PASS row lacks HDFC's own words.
  const otherNonPass = rows.filter((r) => r.verdict !== "PASS" && r.verdict !== "FAIL");
  L.push("## Not passed for other reasons");
  L.push("");
  L.push("| Sheet | # | Term | Condition | Verdict | Reason | HDFC's verbatim message |");
  L.push("| --- | ---: | --- | --- | --- | --- | --- |");
  for (const r of otherNonPass) {
    L.push(
      `| ${SHEET_TITLE[r.sheet]} | ${r.no} | ${cell(r.policyTerm)} | ${cell(r.condition)} | ${r.verdict} | ${cell(r.reason)} | ${r.vendorMessage ? `\`${cell(r.vendorMessage)}\`` : "—"} |`,
    );
  }
  L.push("");

  // Per-sheet detail.
  for (const sheet of ["new-rollover", "break-in", "used-car", "long-term"] as SheetKey[]) {
    const subset = rows.filter((r) => r.sheet === sheet).sort((a, b) => a.no - b.no);
    if (subset.length === 0) continue;
    const t = countBy(subset);
    L.push(`## Sheet: ${SHEET_TITLE[sheet]}`);
    L.push("");
    L.push(VERDICTS.map((v) => `${v} ${t[v]}`).join(" · "));
    L.push("");
    L.push("| # | Transaction | Term | Condition | Verdict | Gross | Evidence / reason |");
    L.push("| ---: | --- | --- | --- | --- | ---: | --- |");
    for (const r of subset) {
      const evidence = [
        cell(r.reason),
        r.vendorMessage ? `HDFC: \`${cell(r.vendorMessage)}\`` : "",
        r.inputDeviation ? `_Input varied: ${cell(r.inputDeviation)}_` : "",
        r.notes ? `_${cell(r.notes)}_` : "",
        r.sharedWithRow ? `_Same payload as ${cell(r.sharedWithRow)}; that response reused._` : "",
      ]
        .filter(Boolean)
        .join(" ");
      L.push(
        `| ${r.no} | ${cell(r.transactionType)} | ${cell(r.policyTerm)} | ${cell(r.condition)} | ${r.verdict} | ${money(r.grossPremium)} | ${evidence} |`,
      );
    }
    L.push("");
  }

  L.push("## How to reproduce");
  L.push("");
  L.push("```bash");
  L.push("cd tf-api");
  L.push("npm run hdfc:scenarios                      # the whole pack");
  L.push("npm run hdfc:scenarios -- --sheet=break-in  # one sheet");
  L.push("npm run hdfc:scenarios -- --rows=28,29      # single conditions");
  L.push("npm run hdfc:scenarios -- --rps=0.25        # slower, if HDFC 429s");
  L.push("npm run hdfc:scenarios -- --regen           # rebuild this file, no live calls");
  L.push("```");
  L.push("");
  L.push(
    "Raw per-row request and response bodies are written to `scripts/_hdfc-uat-scenario-results.json` " +
      "(gitignored by `scripts/_*`).",
  );
  L.push("");

  writeFileSync(OUT_MD, L.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

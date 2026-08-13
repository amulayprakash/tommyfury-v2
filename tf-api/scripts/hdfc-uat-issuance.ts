/**
 * HDFC ERGO — LIVE UAT ISSUANCE RUNNER.
 *
 * Unlike scripts/hdfc-uat-scenarios.ts, which is read-only, this script BINDS
 * REAL POLICIES on HDFC's shared UAT sandbox. Every phase is opt-in and nothing
 * runs without an explicit flag.
 *
 *   npm run hdfc:issue -- --phase=proposal --yes-i-will-create-proposals
 *   npm run hdfc:issue -- --phase=issue --yes-i-will-bind-policies [--only=1]
 *
 * It drives the PRODUCTION provider (HdfcProvider.getFullQuote / issuePolicy),
 * so what it proves is exactly what the /hdfc route will do. Payload defects are
 * fixed in src/providers/hdfc/ test-first, never patched here.
 *
 * Writes docs/hdfc-uat-issuance-results.md and scripts/_hdfc-issuance-raw.json.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadHdfcConfig } from "@/providers/hdfc/config.ts";
import { HdfcProvider } from "@/providers/hdfc/hdfc.provider.ts";
import { passthroughCodeResolver } from "@/providers/hdfc/db-code-resolver.ts";
import type { MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { PolicyIssuanceResult } from "@/contracts/policy.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RAW_JSON = `${import.meta.dirname}/_hdfc-issuance-raw.json`;
const OUT_MD = `${import.meta.dirname}/../docs/hdfc-uat-issuance-results.md`;

// ─── Argv parsing & consent gate ───────────────────────────────────────────────
//
// Everything below this banner is PURE: it decides, from argv alone, whether this
// run may proceed. Nothing here exits, reads a file or touches the network, so
// src/providers/hdfc/__tests__/issuance-runner-consent.test.ts can import and
// exercise the gate directly. The module's entrypoint block at the bottom of the
// file is the only thing that calls process.exit.

/** `--k=v` → v (v may be the empty string, which stays distinct from absent). */
function arg(argv: string[], k: string): string | undefined {
  const prefix = `--${k}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
}

const has = (argv: string[], k: string) => argv.includes(`--${k}`);

/** The only two phases this runner knows how to drive. */
export const ISSUANCE_PHASES = ["proposal", "issue"] as const;
export type IssuancePhase = (typeof ISSUANCE_PHASES)[number];

/** Deliberately slow: this is a shared vendor sandbox, not our own. */
const DEFAULT_RPS = 0.5;

/** A refusal: the reason the run may not proceed, ready to print. */
export interface RunRefusal {
  error: string;
}

/** An accepted run: the validated options main() needs. */
export interface RunPlan {
  phase: IssuancePhase;
  only?: number;
  rps: number;
}

/**
 * `--phase` → a known phase, or a refusal.
 *
 * Matched EXACTLY against the allowlist. `--phase=ISSUE`, `--phase=` and
 * `--phase=bind` used to fall past both consent gates into `issuePolicy()`,
 * because the gates tested for the two good spellings and the runner's only
 * branch was `if (PHASE === "proposal")`. An unknown phase is now a hard stop.
 */
export function parsePhase(argv: string[]): IssuancePhase | RunRefusal {
  const raw = arg(argv, "phase") ?? "proposal";
  const phase = ISSUANCE_PHASES.find((p) => p === raw);
  if (!phase) {
    return {
      error:
        `Refusing to run. --phase=${raw} is not a phase this runner knows.\n` +
        `Valid phases are: ${ISSUANCE_PHASES.join(", ")} (exact spelling, lower case).`,
    };
  }
  return phase;
}

/**
 * The consent gate. THIS GUARDS REAL POLICY BINDING on HDFC's shared UAT sandbox,
 * so it MUST FAIL CLOSED.
 *
 * The binding flag is the DEFAULT requirement and only the one phase known not to
 * bind — "proposal" — is granted the cheaper flag. Written the other way round
 * (`if (phase === "issue") require the binding flag`), a phase added later, or a
 * typo that slipped past validation, would inherit the unguarded path and bind
 * policies with no consent at all. That is precisely the bug this replaces.
 */
export function consentError(phase: string, argv: string[]): string | undefined {
  if (phase === "proposal") {
    if (has(argv, "yes-i-will-create-proposals")) return undefined;
    return (
      "Refusing to run. --phase=proposal creates REAL proposals on HDFC's shared UAT\n" +
      "sandbox. Re-run with --yes-i-will-create-proposals if that is what you want."
    );
  }
  if (has(argv, "yes-i-will-bind-policies")) return undefined;
  return (
    `Refusing to run. --phase=${phase} BINDS REAL POLICIES on HDFC's shared UAT\n` +
    "sandbox. Re-run with --yes-i-will-bind-policies if that is what you want."
  );
}

/**
 * `--only=N` → the single scenario to run, or a refusal.
 *
 * `Number("abc")` is NaN, which matched no scenario, emptied the queue and then
 * rewrote the committed evidence table with zero rows. A bad `--only` now stops
 * the run instead.
 */
export function parseOnly(argv: string[]): number | undefined | RunRefusal {
  const raw = arg(argv, "only");
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return { error: `Refusing to run. --only=${raw} is not a scenario number (expected 1..n).` };
  }
  return value;
}

/** Requests per second. A non-positive or non-finite value falls back to the default. */
export function parseRps(argv: string[]): number {
  const value = Number(arg(argv, "rps") ?? DEFAULT_RPS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RPS;
}

/** The whole startup decision: phase, consent, then options. */
export function planRun(argv: string[]): RunPlan | RunRefusal {
  const phase = parsePhase(argv);
  if (typeof phase !== "string") return phase;

  const consent = consentError(phase, argv);
  if (consent) return { error: consent };

  const only = parseOnly(argv);
  if (only !== undefined && typeof only !== "number") return only;

  return { phase, ...(only === undefined ? {} : { only }), rps: parseRps(argv) };
}

// ─── Dates & vehicle ───────────────────────────────────────────────────────────
const todayIso = () => new Date().toISOString().slice(0, 10);
function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const yearsAgo = (y: number) => isoOffset(-365 * y);

/** The Swift that every passing row of the quoting pack is built on. */
const SWIFT = {
  makeId: "12798", makeName: "MARUTI", modelId: "12798", modelName: "SWIFT ZXI",
  fuelType: "petrol" as const, rtoCode: "10406",
};

const ADDONS_OFF = {
  zeroDep: false, engineProtect: false, rsa: false, tyreProtect: false, rimProtect: false,
  rti: false, consumables: false, paOwner: true, paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false, keyProtect: false, garageCash: false,
  lossOfBelongings: false, batteryProtect: false, drivingAccessories: false,
  ncbProtection: false,
} as const;

const ADDONS_ALL = {
  ...ADDONS_OFF,
  zeroDep: true, engineProtect: true, rsa: true, tyreProtect: true, rti: true,
  consumables: true, ncbProtection: true, paUnnamedPassenger: true,
  legalLiabilityPaidDriver: true, lossOfBelongings: true, unnamedPaSumInsured: 200_000,
} as const;

/**
 * The proposer identity every scenario shares. Fictional, and deliberately so:
 * a shared sandbox is not a place to put a real person's PAN or address.
 */
const PROPOSER = {
  proposer: {
    firstName: "Test", lastName: "User", dob: "1990-01-01",
    gender: "M", mobile: "9999999999", email: "uat@example.com",
  },
  // Field names are AddressSchema's, not the vendor's: addressLine1/2, not
  // line1/2. buildRequest's `as MotorFullQuoteRequest` is an identity cast that
  // does NOT deep-check these, so a wrong key here would only surface as an
  // opaque HDFC rejection at CreateProposal.
  address: {
    addressLine1: "1 Test Street", addressLine2: "Andheri East", city: "Mumbai",
    state: "Maharashtra", pincode: "400069",
  },
  vehicle: {
    engineNumber: "ENG1234567890123",
    chassisNumber: "MA3EWDE1S00123456", // 17 chars — pack row 32's rule
    financeType: "none" as const,
  },
  nomineeName: "Test Nominee",
  nomineeRelation: "spouse",
  nomineeAge: 30,
} as const;

/**
 * A rollover sold BEFORE the outgoing policy lapses — which is how a renewal is
 * actually bought, and what these five scenarios are meant to certify.
 *
 * The previous policy is deliberately still running. Quoting tolerated a lapsed
 * one, but CreateProposal does not: a policy that expired yesterday is a
 * break-in, and HDFC answers "Break-in ID required" (live, 2026-08-13) because a
 * lapsed vehicle must be inspected before it can be covered again. Scenario 6
 * carries the break-in case on purpose; the rest must not be break-ins by
 * accident. mapper/canonical.ts applyRolloverDateSanity() starts the new policy
 * the day after this expiry, so there is no gap in cover.
 */
const ROLLOVER = {
  businessType: "rollover" as const,
  registrationNumber: "MH01QQ7878",
  registrationDate: yearsAgo(1),
  previousPolicyExpiryDate: isoOffset(7),
  isPreviousPolicyExpired: false,
  previousPolicyNumber: "PREVPOL0001",
  ncbPercent: 20,
};

const NEW_BUSINESS = {
  businessType: "new" as const,
  vehicleType: "newVehicle" as const,
  registrationDate: todayIso(),
  isPreviousPolicyExpired: false,
  ncbPercent: 0,
};

/**
 * The still-running third-party policy a standalone OD is written alongside.
 *
 * `previousInsurerId` is here, not in ROLLOVER, because only the SA_OD row needs
 * it and the four rows that already pass must not be perturbed. It matters
 * because the canonical contract has no separate TP-insurer field, so
 * mapper/policy-details.ts falls the TP insurer back to the previous insurer;
 * with neither supplied, PreviousPolicy_TPINSURER went out null and HDFC refused
 * the proposal with "Valid TP policy is required to book SAOD Policy." — the
 * data dictionary marks all four PreviousPolicy_TP* fields mandatory when
 * Req_PvtCar.POLICY_TYPE is "OD Only", and HDFC's own SA_OD proposal samples
 * fill TPINSURER with an insurer shortname.
 *
 * The value is a real shortname from the kit's Insurance_Company master (the
 * same one HDFC's SA_OD samples use); the runner resolves codes through
 * passthroughCodeResolver, so it reaches the payload verbatim.
 */
const PREV_TP = {
  previousInsurerId: "TATAAIG",
  previousTpPolicyNumber: "TPPOL0001",
  previousTpStartDate: yearsAgo(1),
  previousTpExpiryDate: isoOffset(700),
};

// ─── The six ───────────────────────────────────────────────────────────────────
interface Scenario {
  no: number;
  label: string;
  proves: string;
  req: Partial<MotorFullQuoteRequest>;
}

const SCENARIOS: Scenario[] = [
  { no: 1, label: "Roll Over 1+1 comprehensive, no add-ons", proves: "the baseline package policy",
    req: { ...ROLLOVER, selectedPolicy: "comprehensive", tenureYears: 1, ...ADDONS_OFF } },
  { no: 2, label: "Roll Over 1+1 comprehensive, all covers", proves: "add-ons survive to issuance",
    req: { ...ROLLOVER, selectedPolicy: "comprehensive", tenureYears: 1, ...ADDONS_ALL } },
  { no: 3, label: "New Business 1+3 comprehensive", proves: "the statutory 3-year TP leg",
    req: { ...NEW_BUSINESS, selectedPolicy: "comprehensive", tenureYears: 1, ...ADDONS_OFF } },
  { no: 4, label: "Standalone OD 0+1", proves: "the OD-only product",
    req: { ...ROLLOVER, selectedPolicy: "standAloneOD", tenureYears: 1, ...PREV_TP, ...ADDONS_OFF } },
  { no: 5, label: "Liability 0+1 (TP only)", proves: "the liability product",
    req: { ...ROLLOVER, selectedPolicy: "thirdParty", tenureYears: 1, ...ADDONS_OFF } },
  { no: 6, label: "Roll Over 1+1 with a >24h break-in", proves: "inspection routing at proposal time",
    req: { ...ROLLOVER, selectedPolicy: "comprehensive", tenureYears: 1,
           // Cover really has lapsed here — this is the one scenario that SHOULD
           // be a break-in, so it overrides the baseline's still-running policy.
           previousPolicyExpiryDate: isoOffset(-3), isPreviousPolicyExpired: true,
           ...ADDONS_OFF } },
];

/**
 * The Pehchaan id proved in Phase A. Phase A found UAT verifies headlessly, so
 * this is normally left unset and the runner fetches an id per scenario. It
 * exists for the case where an id must be supplied from outside.
 */
const KYC_ID = process.env.HDFC_UAT_KYC_ID;

/** Pehchaan returns dd/MM/yyyy; the canonical proposer wants ISO. */
function toIsoDob(d: string | undefined): string | undefined {
  const m = d?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

/**
 * The proposer, reconciled against the Pehchaan record.
 *
 * Phase A (2026-08-13) found HDFC's UAT e-KYC returns an identity from a fixed
 * pool rather than one matching the PAN submitted — the same PAN produced
 * "Rahul Automation" and "Anmol Arora" on consecutive calls. Since the KYC id we
 * send as Customer_Pehchaan_id is HDFC's OWN record, the proposal's name and DOB
 * are taken from that record wherever it supplies them, so the two cannot
 * disagree. Mobile and email always come back empty from Pehchaan, so those keep
 * the fictional values; the address does too, because normalizePehchaan flattens
 * it to a single string with no city/pincode to map.
 *
 * Whether HDFC actually validates Customer_Pehchaan_id against Customer_Details
 * is an open question recorded in docs/hdfc-integration-notes.md. This makes them
 * agree either way, which costs nothing if the validation does not exist.
 */
function proposerFrom(kyc: { name?: string; dob?: string }): MotorFullQuoteRequest["proposer"] {
  const [first, ...rest] = (kyc.name ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    ...PROPOSER.proposer,
    ...(first ? { firstName: first } : {}),
    ...(rest.length ? { lastName: rest.join(" ") } : {}),
    ...(toIsoDob(kyc.dob) ? { dob: toIsoDob(kyc.dob)! } : {}),
  };
}

function buildRequest(s: Scenario, kyc: { name?: string; dob?: string }): MotorFullQuoteRequest {
  return {
    vehicleType: "fourWheeler",
    claimInPreviousPolicy: false,
    ...SWIFT,
    ...PROPOSER,
    proposer: proposerFrom(kyc),
    ...s.req,
    quoteId: `HDFCUAT${s.no}${Date.now()}`,
  } as MotorFullQuoteRequest;
}

// ─── Results ───────────────────────────────────────────────────────────────────
interface RowResult {
  no: number;
  label: string;
  proves: string;
  step: "kyc" | "proposal" | "payment" | "certificate" | "done";
  ok: boolean;
  kycId?: string;
  proposalNumber?: string;
  transactionId?: string;
  grossPremium?: number;
  policyNumber?: string;
  certificateBytes?: number;
  vendorMessage?: string;
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).trim();

async function main({ phase: PHASE, only: ONLY, rps: RPS }: RunPlan) {
  const provider = new HdfcProvider({
    config: loadHdfcConfig(),
    codeResolver: passthroughCodeResolver,
  });
  const queue = ONLY ? SCENARIOS.filter((s) => s.no === ONLY) : SCENARIOS;
  console.log(
    `HDFC LIVE ISSUANCE — phase=${PHASE} scenarios=${queue.map((s) => s.no).join(",")} ` +
      `kycId=${KYC_ID ? "from env" : "per-scenario lookup"}\n`,
  );

  const results: RowResult[] = [];

  for (const s of queue) {
    console.log(`[#${s.no}] ${s.label}`);
    const row: RowResult = { no: s.no, label: s.label, proves: s.proves, step: "kyc", ok: false };
    const ctx = { requestId: `hdfc-issue-${s.no}` };

    // ── KYC ────────────────────────────────────────────────────────────────────
    let kycId = KYC_ID;
    /** Name and DOB as HDFC's own KYC record has them — see proposerFrom. */
    let kycIdentity: { name?: string; dob?: string } = {};
    if (!kycId) {
      try {
        const kyc = await provider.completeCkyc(
          { panNumber: "ABCPD1234E", dob: "1990-01-01", mobile: "9999999999",
            fullName: "TEST USER", transactionId: `KYC${s.no}${Date.now()}`,
            policyType: "motor" },
          ctx,
        );
        if (!kyc.isKycSuccess || !kyc.kycId) {
          row.vendorMessage = kyc.requiresRedirect
            ? `Pehchaan wants the hosted journey: ${kyc.redirectUrl}. Complete it once and set HDFC_UAT_KYC_ID.`
            : (kyc.displayMessage ?? "Pehchaan did not verify");
          console.log(`   → KYC not verified: ${row.vendorMessage}`);
          results.push(row);
          continue;
        }
        kycId = kyc.kycId;
        kycIdentity = { name: kyc.name, dob: kyc.dob };
        console.log(`   → kyc ${kycId} (${kyc.name ?? "no name"}, dob ${kyc.dob ?? "—"})`);
      } catch (e) {
        row.vendorMessage = errMessage(e);
        console.log(`   → KYC FAILED: ${row.vendorMessage}`);
        results.push(row);
        continue;
      }
    }
    row.kycId = kycId;

    // ── Proposal ───────────────────────────────────────────────────────────────
    row.step = "proposal";
    const req = { ...buildRequest(s, kycIdentity), kycRefId: kycId, ckyc: kycId };
    let proposalNumber: string | undefined;
    let grossPremium: number | undefined;
    try {
      const full = await provider.getFullQuote(req, ctx);
      // contractDetails is a z.record(string, unknown()) in the canonical contract
      // (it carries different keys per vendor); HdfcProvider.getFullQuote always
      // populates proposalNumber/transactionId as strings (hdfc.provider.ts), so
      // this narrows what the contract can't express generically.
      proposalNumber = full.contractDetails?.proposalNumber as string | undefined;
      grossPremium = full.grossPremium;
      row.proposalNumber = proposalNumber;
      row.transactionId = full.contractDetails?.transactionId as string | undefined;
      row.grossPremium = grossPremium;
      console.log(`   → proposal ${proposalNumber}, gross ₹${grossPremium}`);
    } catch (e) {
      row.vendorMessage = errMessage(e);
      console.log(`   → PROPOSAL FAILED: ${row.vendorMessage}`);
      results.push(row);
      await sleep(1000 / RPS);
      continue;
    }

    if (PHASE === "proposal") {
      row.ok = true;
      row.step = "done";
      results.push(row);
      await sleep(1000 / RPS);
      continue;
    }

    // getFullQuote throws when HDFC returns no proposal number, so this is a
    // type guard rather than a branch that can realistically be taken.
    if (!proposalNumber || grossPremium === undefined) {
      row.vendorMessage = "no proposal number or premium to pay against";
      results.push(row);
      continue;
    }

    // ── Payment → policy ───────────────────────────────────────────────────────
    row.step = "payment";
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const paymentDate = `${dd}/${mm}/${now.getFullYear()}`;
    const tranRef = `UAT${s.no}${Date.now()}`;

    let issued: PolicyIssuanceResult | undefined;
    try {
      issued = await provider.issuePolicy(
        {
          quoteNo: proposalNumber,
          clientId: req.quoteId,
          transactionId: row.transactionId ?? req.quoteId,
          vehicleCategory: "fourWheeler",
          receipt: {
            uniqueTranKey: tranRef,
            transactionDate: `${paymentDate} 12:00:00`,
            receiptType: "IVR",
            // HDFC re-rates at issuance: the amount must equal the proposal's premium.
            amount: grossPremium,
            tranRefNo: tranRef,
            tranRefNoDate: paymentDate,
            pgType: "BIZDIRECT",
          },
        },
        ctx,
      );
      row.policyNumber = issued.policyNumber;
      row.step = issued.policyNumber ? "certificate" : "payment";
      row.ok = issued.status === "ISSUED";
      console.log(`   → ${issued.status} policy ${issued.policyNumber ?? "—"}`);
      if (!issued.policyNumber) row.vendorMessage = issued.message;
    } catch (e) {
      row.vendorMessage = errMessage(e);
      console.log(`   → ISSUANCE FAILED: ${row.vendorMessage}`);
    }

    if (row.ok) row.step = "done";
    results.push(row);
    await sleep(1000 / RPS);
  }

  writeFileSync(RAW_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  writeMarkdown(results);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${results.length} scenarios — ${passed} ok, ${results.length - passed} not ═══`);
}

function cell(s: string | undefined): string {
  return (s ?? "—").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function writeMarkdown(rows: RowResult[]): void {
  const L: string[] = [];
  L.push("# HDFC ERGO — live UAT issuance evidence");
  L.push("");
  L.push(
    `Generated ${new Date().toISOString()} by \`npm run hdfc:issue\` ` +
      "(`scripts/hdfc-uat-issuance.ts`). Every row below was fired at **live HDFC UAT** " +
      "through the production provider, and every policy number is a **real bound UAT policy**.",
  );
  L.push("");
  L.push("| # | Scenario | Proves | Reached | Proposal no. | Gross | Policy no. | HDFC's message |");
  L.push("| ---: | --- | --- | --- | --- | ---: | --- | --- |");
  for (const r of rows) {
    L.push(
      `| ${r.no} | ${cell(r.label)} | ${cell(r.proves)} | ${r.step} | ${cell(r.proposalNumber)} | ` +
        `${r.grossPremium ? `₹${r.grossPremium.toLocaleString("en-IN")}` : "—"} | ` +
        `${cell(r.policyNumber)} | ${r.vendorMessage ? `\`${cell(r.vendorMessage)}\`` : "—"} |`,
    );
  }
  L.push("");
  writeFileSync(OUT_MD, L.join("\n"));
}

// ─── Entrypoint ────────────────────────────────────────────────────────────────
//
// Only runs when this file IS the process entrypoint, so importing it (from the
// consent tests) can never start a live run. The guard uses pathToFileURL rather
// than a hand-built `file://` string: on Windows the hand-built form is missing
// the drive letter's leading slash and never matches — see import-hdfc-master.ts.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const plan = planRun(process.argv.slice(2));
  if ("error" in plan) {
    console.error(plan.error);
    process.exit(1);
  }
  main(plan).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

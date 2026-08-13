# HDFC UAT Issuance Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove HDFC ERGO's full issuance path works on live UAT — Pehchaan e-KYC → CreateProposal → SubmitPaymentDetails → GetPolicyDocument — and bind six real UAT policies as certification evidence.

**Architecture:** A single new read-write script, `tf-api/scripts/hdfc-uat-issuance.ts`, drives the *production provider* (`HdfcProvider.completeCkyc` / `getFullQuote` / `issuePolicy`) rather than reimplementing the calls, so what it proves is what the `/hdfc` route will do. It runs in staged phases, each gated behind an explicit flag, so nothing binds a policy until the cheaper phases have passed. Any payload defect it uncovers is fixed test-first in `src/providers/hdfc/`, never patched inside the script.

**Tech Stack:** TypeScript (ESM, `.ts` import extensions, `@/*` → `src/*`), tsx, vitest, zod contracts, existing `HdfcProvider`.

---

## Context for the implementer

Read these before starting:

- `docs/superpowers/specs/2026-08-13-hdfc-uat-route-design.md` — the approved spec. This plan is its Plan 1 of 2. Plan 2 (the `/hdfc` frontend journey) is written after this one lands, because the proposal form's required fields should be shaped by what HDFC actually rejects live.
- `tf-api/docs/hdfc-uat-scenario-results.md` — the 205-condition quoting pack. All six scenarios below already price today.
- `tf-api/scripts/hdfc-uat-scenarios.ts` — the existing **read-only** runner. It is the model for CLI shape, rate limiting and evidence output. **Do not modify it in this plan.** It must stay read-only.

**This plan binds real policies on a shared vendor sandbox.** That is authorized (2026-08-13). It is still not something to do casually: every phase is opt-in, and Phase D issues exactly six.

### What is already true (do not rebuild)

- `HdfcProvider` implements `KycCapableProvider` and `IssuanceProvider`; `createProposal`, `submitPaymentDetails` and `getPolicyDocument` are written and unit-tested (`src/providers/hdfc/__tests__/issuance.test.ts`) but **have never been fired live**.
- `getFullQuote(req)` throws `KYC_INCOMPLETE` unless `req.kycRefId` or `req.ckyc` is set.
- `issuePolicy(req)` takes `quoteNo` = HDFC's Proposal_Number, plus `clientId`, `transactionId` and a `receipt`.
- HDFC has **no payment gateway**. `submitpaymentdetails` records a payment already collected.
- `hdfcCompleteCkyc` returns either a verified KYC (`kyc_id` present) or `{requiresRedirect: true, redirectUrl}` for the hosted journey.

### The one genuine unknown

Whether Pehchaan will verify a PAN **directly** (headless, so the script completes unattended) or **always** return a hosted-journey redirect (so a human must complete it once in a browser and hand the `kycId` back). Phase A answers this before anything else is built. Both branches are specified.

---

## File structure

| File | Responsibility |
| --- | --- |
| Create `tf-api/scripts/hdfc-uat-issuance.ts` | The staged live runner. Phases, opt-in flags, evidence capture. |
| Create `tf-api/scripts/_hdfc-kyc-probe.ts` | Throwaway Phase-A probe. Gitignored by `scripts/_*`. |
| Create `tf-api/docs/hdfc-uat-issuance-results.md` | Generated evidence: proposal numbers, policy numbers, certificates. |
| Modify `tf-api/package.json` | Add the `hdfc:issue` script. |
| Modify `tf-api/.env.example` | Document `HDFC_KYC_RETURN_URL`'s expected value. |
| Modify `tf-api/src/providers/hdfc/**` | Only if Phase B/C uncovers a payload defect — test-first. |

---

## Phase A — Prove Pehchaan e-KYC live (read-only, binds nothing)

### Task 1: Probe whether Pehchaan verifies headlessly

**Files:**
- Create: `tf-api/scripts/_hdfc-kyc-probe.ts`

- [ ] **Step 1: Write the probe**

```ts
/**
 * THROWAWAY. Does HDFC Pehchaan verify a PAN headlessly, or does it always hand
 * back a hosted-journey redirect? Everything downstream depends on the answer:
 * getFullQuote refuses to build a proposal without a Pehchaan id.
 *
 *   npx tsx --env-file=.env scripts/_hdfc-kyc-probe.ts
 *
 * Read-only. Calls only Pehchaan's token + kyc-verified lookup.
 */
import { loadHdfcConfig } from "@/providers/hdfc/config.ts";
import { hdfcCompleteCkyc } from "@/providers/hdfc/ckyc.ts";
import type { CkycRequest } from "@/contracts/kyc.ts";

const config = loadHdfcConfig();

/**
 * HDFC's kit ships no test identity, so these are the shapes to try in order of
 * how unattended they would make the run. Replace PAN/DOB/mobile with whatever
 * HDFC supplies for UAT if these are rejected.
 */
const CASES: { label: string; req: CkycRequest }[] = [
  {
    label: "PAN lookup",
    req: {
      panNumber: "ABCPD1234E",
      dob: "1990-01-01",
      mobile: "9999999999",
      fullName: "TEST USER",
      transactionId: `KYCPROBE${Date.now()}`,
    } as CkycRequest,
  },
  {
    label: "PAN lookup, no optional fields",
    req: { panNumber: "ABCPD1234E", transactionId: `KYCPROBE${Date.now()}` } as CkycRequest,
  },
];

async function main() {
  console.log(`Pehchaan base: ${config.kyc.baseUrl}`);
  console.log(`api_key set: ${config.kyc.apiKey ? "yes" : "NO — set HDFC_KYC_API_KEY"}`);
  console.log(`return_url: ${config.kyc.returnUrl || "<empty>"}\n`);

  for (const c of CASES) {
    try {
      const r = await hdfcCompleteCkyc(config, c.req);
      console.log(`### ${c.label}`);
      console.log(
        `  isKycSuccess=${r.isKycSuccess} kycId=${r.kycId ?? "—"} ` +
          `requiresRedirect=${r.requiresRedirect ?? false}`,
      );
      if (r.redirectUrl) console.log(`  redirectUrl=${r.redirectUrl}`);
      if (r.displayMessage) console.log(`  message=${r.displayMessage}`);
      console.log(`  raw=${JSON.stringify(r._rawResponse).slice(0, 600)}\n`);
    } catch (e) {
      console.log(`### ${c.label}\n  FAILED: ${(e as Error).message}\n`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run it**

Run: `cd tf-api && npx tsx --env-file=.env scripts/_hdfc-kyc-probe.ts`

Three possible outcomes. Record which one happened — the rest of the plan branches on it:

- **(a) `isKycSuccess=true` with a `kycId`.** Best case: the runner is fully unattended. Continue to Task 2, branch (a).
- **(b) `requiresRedirect=true` with a `redirectUrl`.** Expected case. The hosted journey must be completed once by a human in a browser; it returns to `HDFC_KYC_RETURN_URL` with `?kycId=…`. Continue to Task 2, branch (b).
- **(c) An auth or transport failure** (`api_key is not configured`, 401, 403, DNS/TCP failure). **STOP.** This is the vendor-unreachable case: report it with the verbatim message and the evidence, and do not work around it. Per standing guidance, do not proceed to Phase B against a broken e-KYC service.

- [ ] **Step 3: Record the finding**

Append the outcome, verbatim, to `tf-api/docs/hdfc-integration-notes.md` under a new `## Pehchaan e-KYC — live behaviour (2026-08-13)` heading. Include the exact request parameters and Pehchaan's raw response. This is the first live evidence anyone has of this service.

- [ ] **Step 4: Commit**

```bash
git add tf-api/docs/hdfc-integration-notes.md
git commit -m "docs(hdfc): record Pehchaan e-KYC's first live UAT behaviour"
```

---

### Task 2: Set the KYC return URL

**Files:**
- Modify: `tf-api/.env.example:49`
- Modify: `tf-api/.env` (local only, not committed)

`HDFC_KYC_RETURN_URL` already exists in `src/config/env.ts:73` (`z.string().default("")`) and flows to `config.kyc.returnUrl`, which `toPehchaanParams` sends as `redirect_url`. Only the value and its documentation are missing.

- [ ] **Step 1: Document it in `.env.example`**

Replace line 49 (`HDFC_KYC_RETURN_URL=`) with:

```
# Absolute URL Pehchaan returns the browser to after its hosted journey. It
# arrives with ?kycId=<id>, which the client feeds back as CkycRequest.ckycNumber
# to complete the lookup. Must be reachable by the customer's browser, and
# HDFC may need it allowlisted. Local dev: http://localhost:8080/hdfc/kyc/return
HDFC_KYC_RETURN_URL=
```

- [ ] **Step 2: Set the local value**

In `tf-api/.env`, set `HDFC_KYC_RETURN_URL=http://localhost:8080/hdfc/kyc/return`.

- [ ] **Step 3: Verify it reaches Pehchaan**

Run: `cd tf-api && npx tsx --env-file=.env scripts/_hdfc-kyc-probe.ts`
Expected: the header line now prints `return_url: http://localhost:8080/hdfc/kyc/return`.

- **Branch (a)** (headless verification worked): nothing more is needed here.
- **Branch (b)** (redirect): open the printed `redirectUrl` in a browser, complete the journey, and capture the `kycId` from the return URL. Save it in `tf-api/.env` as `HDFC_UAT_KYC_ID=<id>` — the runner reads it in Phase B so the rest of the plan is unattended. If HDFC rejects `localhost` as a redirect target, note that verbatim and raise it as a vendor confirmation; it does not block Phase B, which can reuse a `kycId` obtained any way.

- [ ] **Step 4: Commit**

```bash
git add tf-api/.env.example
git commit -m "docs(hdfc): document HDFC_KYC_RETURN_URL's expected value"
```

---

## Phase B — Prove CreateProposal live (one proposal, no policy bound)

### Task 3: Build the runner, phase-gated, proposal only

**Files:**
- Create: `tf-api/scripts/hdfc-uat-issuance.ts`
- Modify: `tf-api/package.json`

- [ ] **Step 1: Write the runner**

```ts
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
import { loadHdfcConfig } from "@/providers/hdfc/config.ts";
import { HdfcProvider } from "@/providers/hdfc/hdfc.provider.ts";
import { passthroughCodeResolver } from "@/providers/hdfc/db-code-resolver.ts";
import type { MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { PolicyIssuanceResult } from "@/contracts/policy.ts";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.includes(`--${k}`);

const PHASE = arg("phase") ?? "proposal";
const ONLY = arg("only") ? Number(arg("only")) : undefined;
const RPS = Number(arg("rps") ?? 0.5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RAW_JSON = `${import.meta.dirname}/_hdfc-issuance-raw.json`;
const OUT_MD = `${import.meta.dirname}/../docs/hdfc-uat-issuance-results.md`;

// ─── Consent gates ─────────────────────────────────────────────────────────────
if (PHASE === "proposal" && !has("yes-i-will-create-proposals")) {
  console.error(
    "Refusing to run. --phase=proposal creates REAL proposals on HDFC's shared UAT\n" +
      "sandbox. Re-run with --yes-i-will-create-proposals if that is what you want.",
  );
  process.exit(1);
}
if (PHASE === "issue" && !has("yes-i-will-bind-policies")) {
  console.error(
    "Refusing to run. --phase=issue BINDS REAL POLICIES on HDFC's shared UAT\n" +
      "sandbox. Re-run with --yes-i-will-bind-policies if that is what you want.",
  );
  process.exit(1);
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
    // ProposerSchema.gender is z.enum(["M","F","O"]) — not "male".
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

const ROLLOVER = {
  businessType: "rollover" as const,
  registrationNumber: "MH01QQ7878",
  registrationDate: yearsAgo(1),
  previousPolicyExpiryDate: isoOffset(-1),
  isPreviousPolicyExpired: true,
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

const PREV_TP = {
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
           previousPolicyExpiryDate: isoOffset(-3), ...ADDONS_OFF } },
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
function proposerFrom(kyc: { name?: string; dob?: string }): typeof PROPOSER.proposer {
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

async function main() {
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
            fullName: "TEST USER", transactionId: `KYC${s.no}${Date.now()}` },
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
      proposalNumber = full.contractDetails?.proposalNumber;
      grossPremium = full.grossPremium;
      row.proposalNumber = proposalNumber;
      row.transactionId = full.contractDetails?.transactionId;
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

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the npm script**

In `tf-api/package.json`, after the `"hdfc:scenarios"` line (line 34), add:

```json
    "hdfc:issue": "tsx --env-file=.env scripts/hdfc-uat-issuance.ts",
```

- [ ] **Step 3: Verify the consent gate refuses without the flag**

Run: `cd tf-api && npm run hdfc:issue -- --phase=proposal`
Expected: exits non-zero, printing `Refusing to run. --phase=proposal creates REAL proposals…`. **No network call is made.**

- [ ] **Step 4: Verify it typechecks**

Run: `cd tf-api && npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add tf-api/scripts/hdfc-uat-issuance.ts tf-api/package.json
git commit -m "feat(hdfc): add the live UAT issuance runner, gated behind explicit consent"
```

---

### Task 4: Fire one proposal and fix whatever HDFC rejects

**Files:**
- Modify (only if defects found): `tf-api/src/providers/hdfc/mapper/*.ts`
- Modify (only if defects found): `tf-api/src/providers/hdfc/__tests__/*.test.ts`

- [ ] **Step 1: Run scenario 1 only**

Run: `cd tf-api && npm run hdfc:issue -- --phase=proposal --only=1 --yes-i-will-create-proposals`
Expected on success: `→ proposal <number>, gross ₹<amount>`.

- [ ] **Step 2: If HDFC rejects the proposal, fix it test-first**

Do **not** patch the script. The rejection is a mapper defect and the `/hdfc` route would hit it too. For each rejection:

1. Read HDFC's verbatim message; it names the field far more often than not.
2. Check the field against `PrivateCarDataDictionary.xlsx` sheet `04 CreateProposal Request` and against the matching sample in `src/providers/hdfc/fixtures/collection/*-proposal.json`.
3. Add a failing unit test in the relevant existing suite — `__tests__/policy-details.test.ts` for a `Policy_Details` field, `__tests__/req-pvtcar.test.ts` for a `Req_PvtCar` field, `__tests__/customer.test.ts`-equivalent assertions in `__tests__/plans-and-covers.test.ts` for `Customer_Details`.
4. Run it and watch it fail: `npx vitest run src/providers/hdfc/__tests__/<file> -v`.
5. Fix the mapper minimally.
6. Run the whole HDFC suite: `npx vitest run src/providers/hdfc` — expect all green (270 tests before this plan).
7. **Re-run the read-only quoting pack** to prove the fix did not regress quoting: `npm run hdfc:scenarios -- --sheet=new-rollover`. Expect `FAIL 0`.
8. Re-run Step 1.

**Key-set warning:** `Policy_Details` and `Req_PvtCar` key sets are asserted field-for-field against the vendor's own collection fixtures, and HDFC's Blaze engine rejects payloads carrying keys its sample for that business type does not send. Changing a **value** is safe; **adding or removing a key** is not, and any such change must be justified by the vendor's own proposal sample, not by guesswork.

- [ ] **Step 3: Commit each fix separately**

```bash
git add tf-api/src/providers/hdfc
git commit -m "fix(hdfc): <the specific field HDFC rejected at CreateProposal>"
```

- [ ] **Step 4: Run all six proposals**

Run: `cd tf-api && npm run hdfc:issue -- --phase=proposal --yes-i-will-create-proposals`
Expected: six proposal numbers. Any scenario still failing is either a fresh mapper defect (repeat Step 2) or a vendor gap (record it verbatim and move on).

- [ ] **Step 5: Commit the evidence**

```bash
git add tf-api/docs/hdfc-uat-issuance-results.md
git commit -m "docs(hdfc): record the first live CreateProposal evidence on UAT"
```

---

## Phase C — Bind one real policy

### Task 5: Issue scenario 1 end to end

- [ ] **Step 1: Fire it**

Run: `cd tf-api && npm run hdfc:issue -- --phase=issue --only=1 --yes-i-will-bind-policies`
Expected: `→ ISSUED policy <number>`.

- [ ] **Step 2: Handle the two non-ISSUED outcomes**

- **`IN_PROGRESS`** — HDFC accepted the payment but returned no policy number. This is a real provider state, already handled in `recordPaymentAndIssue`. Record HDFC's message; do not retry blindly, because the payment is already recorded and a retry risks a duplicate.
- **A rejection at `submitPaymentDetails`** — most likely the amount. HDFC re-rates at issuance, so `PAYMENT_AMOUNT` must equal the proposal's premium exactly. Confirm the runner passed `grossPremium` from the same proposal, then fix test-first as in Task 4 Step 2.

- [ ] **Step 3: Verify the certificate**

Confirm the run reported a policy number and that `getPolicyDocument` returned content. If the document comes back empty, record it: a policy with no certificate is a vendor confirmation to raise, not a silent pass.

- [ ] **Step 4: Commit**

```bash
git add tf-api/docs/hdfc-uat-issuance-results.md
git commit -m "docs(hdfc): first real policy bound on HDFC UAT"
```

---

## Phase D — Bind the remaining five and publish the evidence

### Task 6: Issue all six

- [ ] **Step 1: Run the full set**

Run: `cd tf-api && npm run hdfc:issue -- --phase=issue --yes-i-will-bind-policies`
Expected: six rows, each reaching `done` with a policy number.

- [ ] **Step 2: Fix or record each failure**

Scenarios 4 (standalone OD), 5 (liability) and 6 (break-in) are the likeliest to differ, because each takes a different `Policy_Details` template or triggers inspection routing. Apply Task 4 Step 2's test-first loop to anything that is ours; record anything that is HDFC's, verbatim.

- [ ] **Step 3: Verify nothing regressed**

Run these three and confirm each:

```bash
cd tf-api
npx vitest run src/providers/hdfc     # expect all green
npm run typecheck                     # expect clean
npm run hdfc:scenarios                # expect FAIL 0 across 205 conditions
```

- [ ] **Step 4: Commit**

```bash
git add tf-api/docs/hdfc-uat-issuance-results.md
git commit -m "docs(hdfc): six real UAT policies bound end to end"
```

---

### Task 7: Write the vendor blocker list

**Files:**
- Create: `tf-api/docs/hdfc-vendor-blockers.md`

This is Deliverable 4 of the spec: the consolidated list to send HDFC, covering the 99 pack conditions we cannot pass.

- [ ] **Step 1: Write it**

One section per blocker, each stating the condition(s) affected, HDFC's verbatim message, what we proved about it, and what we need from HDFC. Source the evidence from `docs/hdfc-uat-scenario-results.md` and the `VENDOR_DATA_PATTERNS` comments in `scripts/hdfc-uat-scenarios.ts`. The blockers, with their current row counts:

1. **2OD-3TP term refused** (38 rows) — documented in their own data dictionary under PRODUCT_CODE 2311, refused by their rules engine by both available routes. Include the term-probe table.
2. **2-year standalone OD refused** (38 rows) — no band exists between 366 and 730 days.
3. **Used Car channel entitlement** (10 rows) — `Channel Not Authorized to consume given method`, isolated to `BusinessType_Mandatary` alone.
4. **Missing UAT IDV master rows** — every Mercedes-Benz code, and all three hybrid codes.
5. **Blaze rules-engine crashes** — Higher Protection and Removal Costs, on 2 rows.
6. **The Gold plan's unnamed cover** `N161521G0020` — decodes against no source we hold.
7. **The financier master** — HDFC wants a numeric `FinancierCode`; we hold only names, with no canonical financier master to cross-walk from.
8. Anything Phases A–D added, especially any Pehchaan e-KYC finding.

- [ ] **Step 2: Commit**

```bash
git add tf-api/docs/hdfc-vendor-blockers.md
git commit -m "docs(hdfc): consolidate the vendor blockers for HDFC sign-off"
```

---

## Done when

- Six real HDFC UAT policy numbers exist in `docs/hdfc-uat-issuance-results.md`, or every scenario that did not reach one carries HDFC's verbatim reason.
- `npx vitest run src/providers/hdfc` is green.
- `npm run typecheck` and `npm run lint` are clean.
- `npm run hdfc:scenarios` still reports `FAIL 0` across all 205 conditions.
- `docs/hdfc-vendor-blockers.md` exists and is ready to send.

Plan 2 (the `/hdfc` frontend journey) is written once this lands, informed by whatever `CreateProposal` actually demanded.

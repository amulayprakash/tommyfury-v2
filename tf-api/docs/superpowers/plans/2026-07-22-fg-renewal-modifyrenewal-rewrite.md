# FG Renewal → Generali Central `Renewal/1.0.0/RenewalModify` Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 2-op JSON-request/XML-response FG motor-renewal adapter with the new **full-JSON, 3-op** Generali Central `Renewal/1.0.0/RenewalModify` flow (ModifyRenewalQuote → ModifyRenewalProposal → ModifyRenewalPolicyIssuance).

**Architecture:** The renewal adapter is a single provider file (`src/providers/fg/renewal.ts`) that owns its own transport + mappers + normalizers, isolated behind the canonical `renewal.ts` contract. This rewrite keeps the per-product WSO2 token pattern (cache key `fg-renewal:default`, same OAuth2 password grant) but **sends the token in an `Internal-Key` header instead of `Authorization: Bearer`**, swaps the XML response parsing for JSON, adds a **third op** (the "modify" proposal step), and re-shapes the two canonical renewal contracts plus adds a new proposal contract. FG's response keys carry load-bearing misspellings that are preserved verbatim. All money/IDV values arrive as comma-grouped decimal strings and are normalized to whole-rupee integers.

**Tech Stack:** TypeScript (ESM, `.ts` import extensions, `@/*` → `src/*` alias), Node `fetch`, zod contracts, Vitest (fixtures via `resolveJsonModule` JSON imports + `vi.stubGlobal("fetch", …)`), `@asteasolutions/zod-to-openapi` generation.

> **⚠ Cross-plan coordination (read before executing — see `docs/superpowers/plans/2026-07-22-fg-migration-execution-order.md`):** this plan is one of several FG-rebranding migrations that touch shared files. Two consequences:
> - **Execution order:** run this renewal plan **AFTER** the motor JSON migration and the payment (v1.41) plan. It edits `src/contracts/renewal.ts` and regenerates `openapi.json`; the CKYC touch-ups plan also edits contracts. To avoid regenerating with another plan's contract edits only half-applied, treat this plan's Task 5 Step 8 (`npm run openapi:gen`) as **not final** — the **final** `npm run openapi:gen` (tf-api) **and** `npm run gen:api` (tf-web) should be run **ONCE, after both this and the CKYC plan (`2026-07-22-fg-ckyc-touchups.md`) have landed**, not per-plan.
> - **Line numbers drift:** every `src/config/env.ts`, `src/providers/fg/config.ts`, and `src/providers/fg/fg.provider.ts` edit in this plan cites line numbers that **shift as the earlier plans land**. Apply those edits by **matching the QUOTED BLOCK TEXT**, not the stated line numbers.

---

## Background & key facts (read before starting)

- **Intel source:** `tf-api/docs/fg-rebranding-notes.md` §5 (renewal), §1 (auth/hosts), §9 (creds). This plan encodes those findings; when in doubt, that doc + the kit samples are authoritative.
- **Kit samples (real request/response bodies used as fixtures):** `dock boyz/FG API Kit/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor KIT - JSON/Renewal With Modification Rebranding/` — `Auth Token API.txt`, `Renewal Modify Get Quote.txt`, `Renewal Modify Proposal.txt`, `Renewal Modify Policy Issuance.txt`, and `GCI Motor Modify Renewal Document updated.docx` (the docx contains every success/fail response body — already transcribed into the fixtures in Task 2, no need to re-open it).
- **Endpoints (POST, JSON)** on `uat-internal-apigw.generalicentralinsurance.com:8243`:
  - `…/Renewal/1.0.0/RenewalModify/ModifyRenewalQuote`
  - `…/Renewal/1.0.0/RenewalModify/ModifyRenewalProposal`
  - `…/Renewal/1.0.0/RenewalModify/ModifyRenewalPolicyIssuance`
- **Headers on all three:** `Content-Type: application/json`, `accept: */*`, **`Internal-Key: <token>`** (NOT `Authorization: Bearer` — the docx text says "Bearer Token" but every actual curl uses `Internal-Key`; encode `Internal-Key` and confirm with FG). A `Cookie: sess_map=…` appears in two samples — treat as optional/omittable (do not send it), confirm with FG.
- **Token:** separate WSO2 product `GCMotorRenewalAPI`, context `/Renewal/1.0.0`, its own subscription. Token is a standard OAuth2 **password grant** (identical to the existing `fgProductTokenFetcher` / `oauth2PasswordFetcher`). **No change to `auth.ts` or `token-manager.ts` is required** — the token is fetched exactly as today and cached under `fg-renewal:default`; only the *header it is placed in* on the business calls changes (Internal-Key), and that lives in the adapter's transport helper.
- **Linkage keys threading the flow:** `policyNo` (expiring policy) → Quote returns `OldPolicyDetails.ProposalNo` (which equals `"00"` + previous policy number, e.g. policy `VD731720` → proposal `00VD731720`) and `PolicyHolderDeatils.ClientID`; Proposal echoes `PreviousPolicyNo` + `ProposalNo` + `ClientCode` and returns the bound `ClientID`/`AgentCode`; Issuance sends `PolicyNo` + `ClientID` + `ProposalNo` + `AgentCode` + `BranchCode` + `Receipt` and returns the new `policyNumber`. **No fresh quotation/proposal id is minted** — the previous-policy-derived `ProposalNo` is the through-line.
- **Load-bearing misspellings (preserve verbatim, never "correct"):** in responses `PolicyHolderDeatils`, `ExipryDate`, `ChassiNo`, `ENgineNo`, `VehicaleIDV`, `NCBPercntage`, `RegistrationNO`; in the proposal request `ExipryDate`. IDV response field on the vehicle block is `VehicleIDV` (correctly spelled there) but `VehicaleIDV` inside the premium blocks — both spellings occur; read each exactly as it appears.
- **Numbers:** money/IDV arrive as comma-grouped strings (`"256,500"`, `"7468.80"`) in the Quote response and as plain JS floats (`6595.71`) in the Proposal response. Strip thousands separators and round to **whole rupees** (the canonical money convention is INR integers). This deliberately contrasts with FG's paise-precision decimals.
- **Business rules (documented, mostly enforced upstream/by FG, not necessarily in this adapter):** claims impact (1 claim = remove NCB; 2 = remove NCB + discount; 3 = reject online renewal); break-in ≤90 days retains NCB but requires inspection; break-in >90 days loses NCB and requires inspection; market renewal is blocked; per FG UW there is "No IDV Variation" (contradicts the usual ±30% clamp — confirm). These are captured as `contractDetails`/`isInspectionRequired` signals and open confirmations, not hard-coded gates in this task.
- **What is being replaced:** the current adapter is 2-op (`GetQuote`/`CreatePolicy`), JSON-request/**XML-response**, at `motorRenewal/1.0.0/TCS-Renewal/API/MotorRenewal` on the **legacy `futuregenerali.in` host**. All of it goes.

---

## File Structure

**Modified:**
- `tf-api/src/config/env.ts` — repoint `FG_RENEWAL_BASE_URL` default to the new host/path (`…/Renewal/1.0.0/RenewalModify`); update the surrounding comment.
- `tf-api/src/providers/fg/config.ts` — update the `renewal` `FgProductAuth` doc comment (structure unchanged).
- `tf-api/src/contracts/renewal.ts` — **rewrite:** keep `RenewalQuoteRequest`, **re-shape** `RenewalCreatePolicyRequest`, **add** `RenewalProposalRequest`.
- `tf-api/src/providers/fg/renewal.ts` — **full rewrite:** JSON transport (Internal-Key), 3 mapper+normalizer pairs, 3 exported functions.
- `tf-api/src/providers/fg/__tests__/renewal.test.ts` — **rewrite** against JSON fixtures.
- `tf-api/src/providers/fg/fg.provider.ts` — update `renewalQuote` call site; add `renewalProposal` method.
- `tf-api/src/providers/insurance-provider.ts` — add `renewalProposal` to `RenewalProvider`; extend `supportsRenewal` guard.
- `tf-api/src/services/renewal.service.ts` — add `renewalProposal` service function.
- `tf-api/src/controllers/renewal.controller.ts` — add `handleRenewalProposal`.
- `tf-api/src/routes/v1/quotes.routes.ts` — add `POST /:provider/motor/renewal/proposal`.
- `tf-api/scripts/gen-openapi.ts` — register `RenewalProposalRequest` + add the proposal path; regenerate `openapi/openapi.json`.

**Created:**
- `tf-api/src/providers/fg/fixtures/renewal-quote.response.json`
- `tf-api/src/providers/fg/fixtures/renewal-quote.breakin.response.json`
- `tf-api/src/providers/fg/fixtures/renewal-quote.fail.response.json`
- `tf-api/src/providers/fg/fixtures/renewal-proposal.response.json`
- `tf-api/src/providers/fg/fixtures/renewal-proposal.fail.response.json`
- `tf-api/src/providers/fg/fixtures/renewal-issuance.response.json`
- `tf-api/src/providers/fg/fixtures/renewal-issuance.fail.response.json`
- `tf-api/src/services/__tests__/renewal.service.test.ts`

**Note on `passthroughCodeResolver`:** the FG renewal flow does **not** resolve master codes — FG returns the full expiring-policy snapshot keyed off the policy number, so there is no canonical-ID → vendor-code translation step here. `passthroughCodeResolver` (a motor-quote concept) is therefore N/A for renewal. The "no live vendor calls / use JSON fixtures" rule still applies: every test stubs `fetch` with a recorded fixture body.

---

## Task 1: Repoint renewal env + config to `Renewal/1.0.0/RenewalModify`

**Files:**
- Modify: `tf-api/src/config/env.ts:71-76`
- Modify: `tf-api/src/providers/fg/config.ts:86-87,122-126`

- [ ] **Step 1: Update the `FG_RENEWAL_BASE_URL` default + comment in `env.ts`**

Replace the current block (lines 71-76):

```ts
  // ── FG Motor Renewal (motorRenewal/1.0.0) — JSON product on legacy host ──
  FG_RENEWAL_BASE_URL: z
    .string()
    .default("https://uat-internal-apigw.futuregenerali.in:8243/motorRenewal/1.0.0/TCS-Renewal/API/MotorRenewal"),
  FG_RENEWAL_TOKEN_URL: z.string().optional(),
  FG_RENEWAL_CLIENT_BASIC: z.string().optional(),
```

with:

```ts
  // ── FG Motor Renewal (Renewal/1.0.0/RenewalModify) — full-JSON 3-op product ──
  // Rebranded Generali Central gateway. Base is the RenewalModify context; the
  // adapter appends /ModifyRenewalQuote, /ModifyRenewalProposal,
  // /ModifyRenewalPolicyIssuance. Separate WSO2 product `GCMotorRenewalAPI`
  // (own subscription/token, password grant). PROD URL is not in the kit yet —
  // confirm with FG before go-live.
  //
  // ⚠ FG_RENEWAL_CLIENT_BASIC MUST be populated with the `GCMotorRenewalAPI`
  // subscription's consumer Basic (UAT value in fg-rebranding-notes.md §9) — it
  // is a DIFFERENT WSO2 product from motor. config.ts resolves the renewal creds
  // as `env.FG_RENEWAL_CLIENT_BASIC ?? env.FG_CLIENT_BASIC` and
  // `env.FG_RENEWAL_TOKEN_URL ?? env.FG_TOKEN_URL`, so if FG_RENEWAL_CLIENT_BASIC
  // is left unset the renewal token is silently minted against the MOTOR
  // subscription and every RenewalModify call 401/403s. Set FG_RENEWAL_TOKEN_URL
  // too if the renewal token host differs from the motor token host.
  FG_RENEWAL_BASE_URL: z
    .string()
    .default("https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify"),
  FG_RENEWAL_TOKEN_URL: z.string().optional(),
  FG_RENEWAL_CLIENT_BASIC: z.string().optional(),
```

- [ ] **Step 2: Update the `renewal` config doc comment in `config.ts`**

Change line 86-87 from:

```ts
  /** Motor renewal product (motorRenewal/1.0.0). */
  renewal: FgProductAuth;
```

to:

```ts
  /** Motor renewal product (Renewal/1.0.0/RenewalModify — full-JSON 3-op). */
  renewal: FgProductAuth;
```

(The `renewal:` block inside `loadFgConfig()` at lines 122-126 needs **no structural change** — `baseUrl`/`tokenUrl`/`clientBasic` still come from the same env vars. The token is still a password grant; only the header it is used in changes, and that lives in the adapter.)

> **⚠ Credential note (not a code change here — a deployment prerequisite):** both `FG_RENEWAL_TOKEN_URL` and `FG_RENEWAL_CLIENT_BASIC` are **optional** in `env.ts`, and `config.ts` falls back to the motor product's values (`env.FG_RENEWAL_CLIENT_BASIC ?? env.FG_CLIENT_BASIC`, `env.FG_RENEWAL_TOKEN_URL ?? env.FG_TOKEN_URL`). Renewal is a **separate WSO2 product (`GCMotorRenewalAPI`) with its OWN subscription/consumer key** (distinct Renewal UAT Basic in intel §9). Therefore `FG_RENEWAL_CLIENT_BASIC` **MUST** be set to the `GCMotorRenewalAPI` subscription Basic (and `FG_RENEWAL_TOKEN_URL` too if the renewal token host differs) — the silent fallback to the motor Basic mints a wrong-product token and every RenewalModify call 401/403s. This repo ships `.env` only (no `.env.example`), so the requirement is documented in the `env.ts` doc block edited above; ensure the deployed `.env` carries the renewal Basic before UAT.

- [ ] **Step 3: Typecheck**

Run: `cd tf-api && npx tsc --noEmit`
Expected: PASS (config/env are type-only edits; the adapter is rewritten in Task 3 and still compiles against unchanged types at this point).

- [ ] **Step 4: Commit**

```bash
cd tf-api
git add src/config/env.ts src/providers/fg/config.ts
git commit -m "chore(fg-renewal): repoint renewal product to Renewal/1.0.0/RenewalModify (GC host)"
```

---

## Task 2: Add real JSON fixtures from the kit

**Files:**
- Create: `tf-api/src/providers/fg/fixtures/renewal-quote.response.json`
- Create: `tf-api/src/providers/fg/fixtures/renewal-quote.breakin.response.json`
- Create: `tf-api/src/providers/fg/fixtures/renewal-quote.fail.response.json`
- Create: `tf-api/src/providers/fg/fixtures/renewal-proposal.response.json`
- Create: `tf-api/src/providers/fg/fixtures/renewal-proposal.fail.response.json`
- Create: `tf-api/src/providers/fg/fixtures/renewal-issuance.response.json`
- Create: `tf-api/src/providers/fg/fixtures/renewal-issuance.fail.response.json`

These are the verbatim response bodies from `GCI Motor Modify Renewal Document updated.docx` (Data Dictionary tables). Preserve the misspelled keys exactly.

> **⚠ Provenance / verify-before-trust:** these RESPONSE-body fixtures were **transcribed from the binary `GCI Motor Modify Renewal Document updated.docx`** (not a machine-readable `.txt`). The **request** curls were verified against the kit `.txt` files, but the responses were hand-transcribed. Before trusting them, the implementer should **diff each response fixture against the docx Data Dictionary tables** — paying particular attention to the load-bearing misspelled-key set (`PolicyHolderDeatils` / `ExipryDate` / `VehicaleIDV` / `NCBPercntage` / `RegistrationNO`), which a transcription pass can silently "correct" — and fix any drift before relying on the fixtures in Task 3.

- [ ] **Step 1: Create `renewal-quote.response.json` (ModifyRenewalQuote success)**

```json
{
  "Status": "Success",
  "UID": "60005682276951575996",
  "FinalPremium": "7468.80",
  "ServiceTax": "988.52",
  "PolicyHolderDeatils": {
    "ClientID": "72782626",
    "CKYCStatus": "",
    "FirstName": "PRAKASH",
    "LastName": "KUMAR",
    "DOB": "02/01/1981",
    "PermanentAddress": {
      "Address1": "PANDAUL",
      "Address2": "MADHUBANI",
      "Address3": "MADHUBANI",
      "Pincode": "847234",
      "City": "MADHUBANI",
      "State": "BIHAR",
      "MobileNo": null,
      "EmailID": null
    },
    "CKYCAddress": {
      "Address1": null,
      "Address2": null,
      "Address3": null,
      "Pincode": null,
      "City": null,
      "State": null,
      "MobileNo": null,
      "EmailID": null
    }
  },
  "VehicleDetails": {
    "RegistrationNO": "BR-07-AL-4168",
    "RegistrationDate": "14/01/2020",
    "ENgineNo": "F8DN6287045",
    "ChassiNo": "MA3EUA61S00F35293",
    "VehicleIDV": "256,500"
  },
  "OldPolicyDetails": {
    "AgentCode": "60046470",
    "Branch": "2J",
    "PolicyNo": "VD731720",
    "ProposalNo": "00VD731720",
    "ProductCode": "FPV",
    "CoverCode": "CO",
    "ExipryDate": "30/12/2025"
  },
  "ODPremium": {
    "GrossPremium": "3017.77",
    "BasicIDVOD": "8184.92",
    "TotalAddon": "1667.26",
    "NCB": "1104.97",
    "NCBPercntage": null,
    "IMT10": null,
    "LoadingDiscount": "5729.44",
    "IMT23": null,
    "CNG": null,
    "DiscountPercentage": "70",
    "VehicaleIDV": "256,500",
    "ElectricalAccessoriesValues": "",
    "NonElectricalAccessoriesValues": "",
    "AddonPrice": [
      { "Price": 1667.26, "AddOn": "FPVSTZDP" }
    ]
  },
  "TPPremium": {
    "GrossPremium": "2474",
    "BasicIDVTP": "2094",
    "CPA": "330",
    "IMT15": null,
    "IMT16": null,
    "IMT28": "50",
    "IMT29": null,
    "PAPD": null,
    "CNG": null,
    "IMT20": null
  }
}
```

- [ ] **Step 2: Create `renewal-quote.breakin.response.json` (Quote success flagged as break-in)**

Note: `Status` is still `"Success"` and `ErrorCode` is `"0"` — this is NOT a hard failure; `ErrorDescription` flags that inspection is required. Also carries `PreviousPolicyNCB`/`EligiblePolicyNCB` and a `TPPolicyDetails` block.

```json
{
  "Status": "Success",
  "UID": "06484976770475495974",
  "FinalPremium": "8426.08",
  "ServiceTax": "1115.22",
  "ErrorCode": "0",
  "ErrorDescription": "This is Break-in case go for inspection30/12/2025",
  "PolicyHolderDeatils": {
    "ClientID": "75919748",
    "CKYCStatus": "Verified",
    "FirstName": "RAZEENA",
    "LastName": "NISAR",
    "DOB": "03/03/1976",
    "PermanentAddress": {
      "Address1": "KANKAN CHIRA",
      "Address2": "KALATH WARD AVALUKUNNU P O",
      "Address3": "ARYAD SOUTH",
      "Pincode": "688006",
      "City": "ALAPPUZHA",
      "State": "KERALA",
      "MobileNo": "9946686855",
      "EmailID": "BRIGHTINSURANCE007@GMAIL.COM"
    },
    "CKYCAddress": {
      "Address1": null,
      "Address2": null,
      "Address3": null,
      "Pincode": null,
      "City": null,
      "State": null,
      "MobileNo": null,
      "EmailID": null
    }
  },
  "VehicleDetails": {
    "RegistrationNO": "KL-04-AQ-0721",
    "RegistrationDate": "10/02/2020",
    "ENgineNo": "BBYWKJ43431",
    "ChassiNo": "MD2A95AY5KWJ47517",
    "VehicleIDV": "114,000"
  },
  "OldPolicyDetails": {
    "AgentCode": "60064625",
    "Branch": "39",
    "PolicyNo": "VD735683",
    "ProposalNo": "00VD735683",
    "ProductCode": "FCV",
    "CoverCode": "CO",
    "ExipryDate": "30/12/2025",
    "TPPolicyDetails": {
      "TPInsuranceCompanyName": "",
      "TPPolicyExpiryDate": "",
      "TPPolicyInceptionDate": "",
      "TPPolicyNumber": ""
    }
  },
  "ODPremium": {
    "PreviousPolicyNCB": "35",
    "EligiblePolicyNCB": "45",
    "GrossPremium": "372.64",
    "BasicIDVOD": "1472.88",
    "TotalAddon": "0",
    "NCB": "304.88",
    "IMT10": null,
    "LoadingDiscount": "883.73",
    "IMT23": "88.37",
    "CNG": null,
    "DiscountPercentage": "-60",
    "VehicaleIDV": "114,000",
    "ElectricalAccessoriesSumInsured": "0",
    "NonElectricalAccessoriesSumInsured": "0",
    "ElectronicsFittings": null,
    "NonExtraElectronicsFittings": null,
    "CNGLPGKitIDV": null,
    "AddonPrice": null
  },
  "TPPremium": {
    "GrossPremium": "5823",
    "BasicIDVTP": "5773",
    "CPA": null,
    "IMT15": null,
    "IMT16": null,
    "IMT28": "50",
    "IMT29": null,
    "PAPD": null,
    "CNG": null,
    "IMT20": null
  }
}
```

- [ ] **Step 3: Create `renewal-quote.fail.response.json` (bad policy number)**

```json
{
  "UID": "64169184889290159463",
  "QuotationNo": "VD930104",
  "Status": "Fail",
  "ErrorCode": "Failed",
  "ErrorDescription": "Error During Fetch Policy Details : Please pass correct policy number"
}
```

- [ ] **Step 4: Create `renewal-proposal.response.json` (ModifyRenewalProposal success)**

Note: proposal success has **no** `Status` field; numbers are plain floats (not comma strings).

```json
{
  "UID": "29575830657852659579",
  "PreviousPolicyNo": "VD731720",
  "ProposalNo": "00VD731720",
  "ClientID": "72782626",
  "AgentCode": "60084677",
  "TotalPremium": 6595.71,
  "gst": 1187.23,
  "ODPremium": {
    "GrossPremium": 4501.71,
    "BasicIDVOD": 8184.92,
    "TotalAddon": 0.0,
    "NCB": 3683.21,
    "NCBPercntage": 0.0,
    "IMT10": 0.0,
    "LoadingDiscount": 0.0,
    "IMT23": 0.0,
    "CNG": 0.0,
    "DiscountPercentage": 0.0,
    "VehicaleIDV": 0.0,
    "ElectricalAccessoriesValues": 0.0,
    "NonElectricalAccessoriesValues": 0.0,
    "AddonPrice": []
  },
  "TPPremium": {
    "GrossPremium": 2094.0,
    "BasicIDVTP": 2094.0,
    "CPA": 0.0,
    "IMT15": 0.0,
    "IMT16": 0.0,
    "IMT28": 0.0,
    "IMT29": 0.0,
    "PAPD": 0.0,
    "CNG": 0.0,
    "IMT20": 0.0
  }
}
```

- [ ] **Step 5: Create `renewal-proposal.fail.response.json`**

```json
{
  "UID": "64169184889290159463",
  "QuotationNo": "VD929472",
  "Status": "Fail",
  "ErrorCode": "Failed",
  "ErrorDescription": "Error During Fetch Policy Details : Please pass correct policy number"
}
```

- [ ] **Step 6: Create `renewal-issuance.response.json` (ModifyRenewalPolicyIssuance success)**

Note: success uses **lowercase** `status`/`policyNumber`/`proposalNumber`/`errorCode`/`errorDescription` (plus mixed-case `PreviousPolicyNumber`).

```json
{
  "UID": "17169757720337586358",
  "policyNumber": "132/02/11/1226/MTP/2410000963",
  "PreviousPolicyNumber": "VD731720",
  "proposalNumber": "00VD731720",
  "status": "Success",
  "errorCode": null,
  "errorDescription": null
}
```

- [ ] **Step 7: Create `renewal-issuance.fail.response.json`**

Note: failure uses **uppercase** `Status`/`ErrorCode`/`ErrorDescription`.

```json
{
  "UID": "40704357704718295425",
  "QuotationNo": "00VD735113",
  "Status": "Fail",
  "ErrorCode": "Failed",
  "ErrorDescription": "Error During Receipt Creation: 91957057I0002934 duplicate found E048Duplicate found"
}
```

- [ ] **Step 8: Commit**

```bash
cd tf-api
git add src/providers/fg/fixtures/renewal-quote.response.json \
        src/providers/fg/fixtures/renewal-quote.breakin.response.json \
        src/providers/fg/fixtures/renewal-quote.fail.response.json \
        src/providers/fg/fixtures/renewal-proposal.response.json \
        src/providers/fg/fixtures/renewal-proposal.fail.response.json \
        src/providers/fg/fixtures/renewal-issuance.response.json \
        src/providers/fg/fixtures/renewal-issuance.fail.response.json
git commit -m "test(fg-renewal): add RenewalModify JSON fixtures from GC kit"
```

---

## Task 3: Rewrite the renewal contract + adapter (transport + 3 ops)

The canonical contract and the single-file adapter are inseparable (the adapter consumes the re-shaped types), so they land together. TDD is done at the module level: write the full spec-test first (red), then the contract + adapter (green). The two preserved export names (`fgRenewalQuote`, `fgRenewalCreatePolicy`) plus the new `fgRenewalProposal` keep `fg.provider.ts` compiling with only a one-line call-site edit (Step 5).

**Files:**
- Modify: `tf-api/src/contracts/renewal.ts` (rewrite)
- Modify: `tf-api/src/providers/fg/renewal.ts` (rewrite)
- Modify: `tf-api/src/providers/fg/__tests__/renewal.test.ts` (rewrite)
- Modify: `tf-api/src/providers/fg/fg.provider.ts:340-347` (one call-site edit)

- [ ] **Step 1: Write the failing test file `src/providers/fg/__tests__/renewal.test.ts`**

Replace the entire file with:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fgRenewalQuote,
  fgRenewalProposal,
  fgRenewalCreatePolicy,
} from "../renewal.ts";
import type { FgConfig } from "../config.ts";
import {
  RenewalQuoteRequestSchema,
  RenewalProposalRequestSchema,
  RenewalCreatePolicyRequestSchema,
} from "@/contracts/renewal.ts";
import quoteFixture from "../fixtures/renewal-quote.response.json";
import breakinFixture from "../fixtures/renewal-quote.breakin.response.json";
import quoteFailFixture from "../fixtures/renewal-quote.fail.response.json";
import proposalFixture from "../fixtures/renewal-proposal.response.json";
import proposalFailFixture from "../fixtures/renewal-proposal.fail.response.json";
import issuanceFixture from "../fixtures/renewal-issuance.response.json";
import issuanceFailFixture from "../fixtures/renewal-issuance.fail.response.json";

const config = {
  vendorCode: "Webagg",
  renewal: {
    baseUrl: "https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify",
  },
} as unknown as FgConfig;

/** Captures the fetch args so the test can assert URL + Internal-Key header. */
function mockFetch(body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function mockFetchStatus(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("renewal contracts", () => {
  it("accepts a ModifyRenewalQuote request", () => {
    const parsed = RenewalQuoteRequestSchema.parse({ policyNo: "VD731720" });
    expect(parsed.policyNo).toBe("VD731720");
  });

  it("accepts a ModifyRenewalProposal request (echo + modify delta)", () => {
    const parsed = RenewalProposalRequestSchema.parse({
      productCode: "FPV",
      previousPolicyNo: "VD932796",
      proposalNo: "00VD932796",
      clientCode: "76583956",
      startDate: "2025-03-31",
      expiryDate: "2026-03-30",
      agentCode: "60081262",
      branch: "12",
      coverCode: "CO",
      vehicleIdv: 603000,
      discountPercentage: -80,
      addonCodes: ["STZDP"],
      idvOfCngOrLpg: 15000,
    });
    expect(parsed.vehicleIdv).toBe(603000);
    expect(parsed.discountPercentage).toBe(-80);
  });

  it("accepts a ModifyRenewalPolicyIssuance request", () => {
    const parsed = RenewalCreatePolicyRequestSchema.parse({
      policyNo: "VD731720",
      clientId: "72782626",
      proposalNo: "00VD731720",
      agentCode: "60084677",
      branchCode: "2J",
      receipt: {
        uniqueTranKey: "TD89984789",
        transactionDate: "01/12/2025",
        receiptType: "IVR",
        amount: 7783,
        tranRefNo: "24709987121",
        tranRefNoDate: "01/12/2025",
        pgType: "PAYU",
      },
    });
    expect(parsed.clientId).toBe("72782626");
  });
});

describe("fgRenewalQuote", () => {
  it("prices the expiring policy from the snapshot and derives linkage keys", async () => {
    const { fn, calls } = mockFetch(quoteFixture);
    vi.stubGlobal("fetch", fn);

    const q = await fgRenewalQuote(config, { policyNo: "VD731720" }, "tok", { requestId: "r1" });

    // Endpoint + Internal-Key header (NOT Authorization: Bearer).
    expect(calls[0]?.url).toBe(
      "https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify/ModifyRenewalQuote",
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Internal-Key"]).toBe("tok");
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");

    // Linkage: quoteNo == ProposalNo == "00" + policy no.
    expect(q.quoteNo).toBe("00VD731720");
    expect(q.transactionId).toBe("00VD731720");
    expect(q.providerSlug).toBe("fg");
    expect(q.policyType).toBe("comprehensive"); // CoverCode CO
    expect(q.vehicleCategory).toBe("fourWheeler"); // ProductCode FPV
    // Comma-grouped decimal strings → whole-rupee ints.
    expect(q.idvValue).toBe(256500); // "256,500"
    expect(q.grossPremium).toBe(7469); // "7468.80"
    expect(q.serviceTaxAmount).toBe(989); // "988.52"
    expect(q.basicOdPremium).toBe(3018); // "3017.77"
    expect(q.thirdPartyPremium).toBe(2474); // "2474"
    expect(q.totalAddonPremium).toBe(1667); // "1667.26"
    expect(q.netPremium).toBe(6480); // gross - tax
    expect(q.isInspectionRequired).toBe(false);
    expect(q.contractDetails?.clientCode).toBe("72782626");
    expect(q.contractDetails?.proposalNo).toBe("00VD731720");
    expect(q.contractDetails?.agentCode).toBe("60046470");
    expect(q.contractDetails?.branch).toBe("2J");
  });

  it("flags a break-in Success as inspection-required (ErrorCode 0)", async () => {
    const { fn } = mockFetch(breakinFixture);
    vi.stubGlobal("fetch", fn);
    const q = await fgRenewalQuote(config, { policyNo: "VD735683" }, "tok", { requestId: "r2" });
    expect(q.isInspectionRequired).toBe(true);
    expect(q.vehicleCategory).toBe("commercial"); // FCV
    expect(q.contractDetails?.previousPolicyNCB).toBe("35");
    expect(q.contractDetails?.eligiblePolicyNCB).toBe("45");
  });

  it("throws a classified ProviderError on a Fail response", async () => {
    const { fn } = mockFetch(quoteFailFixture);
    vi.stubGlobal("fetch", fn);
    await expect(
      fgRenewalQuote(config, { policyNo: "BAD" }, "tok", { requestId: "r3" }),
    ).rejects.toThrow(/Please pass correct policy number/);
  });

  it("wraps a non-2xx HTTP response as a ProviderError", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(401, { message: "unauthorized" }));
    await expect(
      fgRenewalQuote(config, { policyNo: "VD731720" }, "tok", { requestId: "r4" }),
    ).rejects.toMatchObject({ upstreamStatus: 401 });
  });
});

describe("fgRenewalProposal", () => {
  it("builds the modify payload (preserving misspellings) and prices the bound proposal", async () => {
    const { fn, calls } = mockFetch(proposalFixture);
    vi.stubGlobal("fetch", fn);

    const result = await fgRenewalProposal(
      config,
      {
        productCode: "FPV",
        previousPolicyNo: "VD731720",
        proposalNo: "00VD731720",
        clientCode: "72782626",
        startDate: "2025-03-31",
        expiryDate: "2026-03-30",
        ckycNo: "987654545678",
        ckycRefNo: "3456890878765",
        agentCode: "60081262",
        branch: "12",
        coverCode: "CO",
        vehicleIdv: 603000,
        discountPercentage: -80,
        addonCodes: ["STZDP"],
        idvOfCngOrLpg: 15000,
        inspectionNo: "132702032026",
        inspectionDate: "2026-03-02",
      },
      "tok",
      { requestId: "r5" },
    );

    expect(calls[0]?.url).toBe(
      "https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify/ModifyRenewalProposal",
    );
    const sent = JSON.parse((calls[0]?.init.body as string) ?? "{}");
    // Load-bearing misspelling + FG date format in the request.
    expect(sent.PolicyDetails.ExipryDate).toBe("30/03/2026");
    expect(sent.PolicyDetails.StartDate).toBe("31/03/2025");
    expect(sent.PolicyDetails.CKYCNo).toBe("987654545678");
    expect(sent.ModifyDetails.VehicleIDV).toBe("603000");
    expect(sent.ModifyDetails.DiscountPercentage).toBe("-80");
    expect(sent.ModifyDetails.IDVOfCNGOrLPG).toBe("15000");
    expect(sent.ModifyDetails.AddonCode).toEqual([{ CoverCode: "STZDP" }]);
    expect(sent.InspectionNo).toBe("132702032026");
    expect(sent.InspectionDate).toBe("02/03/2026");

    // Bound premium (plain floats → whole rupees) + carried linkage.
    expect(result.quoteNo).toBe("00VD731720");
    // TotalPremium is NET; gross = net + gst. 6595.71 + 1187.23 = 7782.94 → 7783,
    // matching the issuance sample Receipt.Amount "7783" (the real payable).
    expect(result.grossPremium).toBe(7783);
    expect(result.serviceTaxAmount).toBe(1187); // gst 1187.23
    expect(result.netPremium).toBe(6596); // TotalPremium 6595.71
    expect(result.basicOdPremium).toBe(4502); // 4501.71
    expect(result.thirdPartyPremium).toBe(2094);
    expect(result.idvValue).toBe(603000);
    expect(result.contractDetails?.clientId).toBe("72782626");
    expect(result.contractDetails?.agentCode).toBe("60084677");
    expect(result.contractDetails?.branchCode).toBe("12");
  });

  it("omits CKYC keys when not provided", async () => {
    const { fn, calls } = mockFetch(proposalFixture);
    vi.stubGlobal("fetch", fn);
    await fgRenewalProposal(
      config,
      {
        productCode: "FPV",
        previousPolicyNo: "VD731720",
        proposalNo: "00VD731720",
        clientCode: "72782626",
        startDate: "2025-03-31",
        expiryDate: "2026-03-30",
        agentCode: "60081262",
        branch: "12",
        coverCode: "CO",
        vehicleIdv: 603000,
        discountPercentage: -80,
        addonCodes: [],
      },
      "tok",
      { requestId: "r6" },
    );
    const sent = JSON.parse((calls[0]?.init.body as string) ?? "{}");
    expect("CKYCNo" in sent.PolicyDetails).toBe(false);
    expect("IDVOfCNGOrLPG" in sent.ModifyDetails).toBe(false);
    expect(sent.InspectionNo).toBe("");
    expect(sent.InspectionDate).toBe("");
  });

  it("throws on a proposal Fail response", async () => {
    const { fn } = mockFetch(proposalFailFixture);
    vi.stubGlobal("fetch", fn);
    await expect(
      fgRenewalProposal(
        config,
        {
          productCode: "FPV",
          previousPolicyNo: "BAD",
          proposalNo: "00BAD",
          clientCode: "1",
          startDate: "2025-03-31",
          expiryDate: "2026-03-30",
          agentCode: "1",
          branch: "12",
          coverCode: "CO",
          vehicleIdv: 1,
          discountPercentage: 0,
          addonCodes: [],
        },
        "tok",
        { requestId: "r7" },
      ),
    ).rejects.toThrow(/Please pass correct policy number/);
  });
});

describe("fgRenewalCreatePolicy", () => {
  const req = {
    policyNo: "VD731720",
    clientId: "72782626",
    proposalNo: "00VD731720",
    agentCode: "60084677",
    branchCode: "2J",
    receipt: {
      uniqueTranKey: "TD89984789",
      transactionDate: "01/12/2025",
      receiptType: "IVR",
      amount: 7783,
      tranRefNo: "24709987121",
      tranRefNoDate: "01/12/2025",
      pgType: "PAYU",
    },
  };

  it("issues the renewal and returns the new policy number", async () => {
    const { fn, calls } = mockFetch(issuanceFixture);
    vi.stubGlobal("fetch", fn);
    const r = await fgRenewalCreatePolicy(config, req, "tok");

    expect(calls[0]?.url).toBe(
      "https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify/ModifyRenewalPolicyIssuance",
    );
    const sent = JSON.parse((calls[0]?.init.body as string) ?? "{}");
    expect(sent.PolicyNo).toBe("VD731720");
    expect(sent.VendorCode).toBe("Webagg");
    expect(sent.ClientID).toBe("72782626");
    expect(sent.ProposalNo).toBe("00VD731720");
    expect(sent.BranchCode).toBe("2J");
    expect(sent.Receipt.UniqueTranKey).toBe("TD89984789");
    expect(sent.Receipt.Amount).toBe("7783");
    expect(sent.Receipt.PaymentType).toBe("PAYU");
    expect(sent.Receipt.ReceiptType).toBe("IVR");

    expect(r.status).toBe("ISSUED");
    expect(r.policyNumber).toBe("132/02/11/1226/MTP/2410000963");
    expect(r.quoteNo).toBe("00VD731720");
    expect(r.clientId).toBe("72782626");
  });

  it("throws on an issuance Fail response (duplicate)", async () => {
    const { fn } = mockFetch(issuanceFailFixture);
    vi.stubGlobal("fetch", fn);
    await expect(fgRenewalCreatePolicy(config, req, "tok")).rejects.toThrow(/Duplicate found/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/renewal.test.ts`
Expected: FAIL — the new contract exports (`RenewalProposalRequestSchema`) and adapter exports (`fgRenewalProposal`) and re-shaped types do not exist yet (compile/import errors).

- [ ] **Step 3: Rewrite the canonical contract `src/contracts/renewal.ts`**

Replace the entire file with:

```ts
import { z } from "zod";
import { PaymentReceiptSchema } from "./policy.ts";

// ─── FG Motor Renewal (Renewal/1.0.0/RenewalModify) ───────────────────────────
// Full-JSON 3-op flow keyed off an existing GC/FG policy:
//   ModifyRenewalQuote(policyNo)            → expiring-policy snapshot + premium
//   ModifyRenewalProposal(echo + modify Δ)  → bound (re-rated) premium
//   ModifyRenewalPolicyIssuance(receipt)    → new policyNumber
// Linkage through-line: ProposalNo == "00" + previous policy number (no fresh id).

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Step 1 — ModifyRenewalQuote. `vendorCode` is supplied by provider config. */
export const RenewalQuoteRequestSchema = z.object({
  /** The customer's existing GC/FG policy number. */
  policyNo: z.string().min(1),
  /** Existing policy expiry (ISO); converted to FG DD/MM/YYYY. Optional. */
  expiryDate: IsoDate.optional(),
  registrationNo: z.string().optional(),
});
export type RenewalQuoteRequest = z.infer<typeof RenewalQuoteRequestSchema>;

/** Step 2 — ModifyRenewalProposal: echo the quote snapshot + a constrained
 *  modification delta. IDV/SI values are whole rupees (INR ints). */
export const RenewalProposalRequestSchema = z.object({
  // Echoed from the quote snapshot (OldPolicyDetails / PolicyHolderDeatils):
  productCode: z.string().min(1),
  previousPolicyNo: z.string().min(1),
  /** == "00" + previous policy no (OldPolicyDetails.ProposalNo). */
  proposalNo: z.string().min(1),
  /** PolicyHolderDeatils.ClientID → PolicyDetails.ClientCode. */
  clientCode: z.string().min(1),
  /** New-term policy start / end (ISO); converted to FG DD/MM/YYYY. */
  startDate: IsoDate,
  expiryDate: IsoDate,
  /** Inline CKYC when the policyholder's CKYC is unverified. */
  ckycNo: z.string().optional(),
  ckycRefNo: z.string().optional(),
  // Modification delta (ModifyDetails):
  agentCode: z.string().min(1),
  branch: z.string().min(1),
  coverCode: z.enum(["CO", "OD", "LO"]),
  /** Insured Declared Value in whole rupees. */
  vehicleIdv: z.number().int().nonnegative(),
  /** Discount %, negative as returned by the quote (echo as-is). */
  discountPercentage: z.number(),
  /** Add-on combo cover codes (e.g. "STZDP"). */
  addonCodes: z.array(z.string().min(1)).default([]),
  /** CNG/LPG kit sum insured in whole rupees. */
  idvOfCngOrLpg: z.number().int().nonnegative().optional(),
  electricalAccessoriesValues: z.string().optional(),
  nonElectricalAccessoriesValues: z.string().optional(),
  imt10: z.string().optional(),
  imt15: z.string().optional(),
  imt16: z.string().optional(),
  imt20: z.string().optional(),
  imt23: z.string().optional(),
  imt28: z.string().optional(),
  imt29: z.string().optional(),
  // Break-in linkage (only when the quote flagged a break-in):
  inspectionNo: z.string().optional(),
  inspectionDate: IsoDate.optional(),
});
export type RenewalProposalRequest = z.infer<typeof RenewalProposalRequestSchema>;

/** Step 3 — ModifyRenewalPolicyIssuance. `vendorCode` is supplied by config. */
export const RenewalCreatePolicyRequestSchema = z.object({
  policyNo: z.string().min(1),
  /** ClientID returned by the proposal (or quote snapshot). */
  clientId: z.string().min(1),
  /** == "00" + previous policy no. */
  proposalNo: z.string().min(1),
  agentCode: z.string().min(1),
  branchCode: z.string().min(1),
  registrationNo: z.string().optional(),
  receipt: PaymentReceiptSchema,
});
export type RenewalCreatePolicyRequest = z.infer<typeof RenewalCreatePolicyRequestSchema>;
```

- [ ] **Step 4: Rewrite the adapter `src/providers/fg/renewal.ts`**

Replace the entire file with:

```ts
import { ProviderError } from "@/errors/app-error.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { PolicyIssuanceResult } from "@/contracts/policy.ts";
import type {
  RenewalQuoteRequest,
  RenewalProposalRequest,
  RenewalCreatePolicyRequest,
} from "@/contracts/renewal.ts";
import { FG_SLUG, FG_DISPLAY_NAME } from "./config.ts";
import type { FgConfig } from "./config.ts";
import { toFgDate } from "./mapper.ts";
import { classifyFgError } from "./http.ts";

/**
 * FG (Generali Central) Motor RenewalModify — Renewal/1.0.0/RenewalModify.
 * Full JSON, three POST ops on the rebranded gateway:
 *   ModifyRenewalQuote          → fetch the expiring-policy snapshot + base premium
 *   ModifyRenewalProposal       → echo the snapshot + a constrained modify delta
 *   ModifyRenewalPolicyIssuance → bind the payment receipt → new policyNumber
 *
 * ⚠ AUTH HEADER: the token is a WSO2 password-grant token (fetched exactly like
 * every other FG product) but is sent in an `Internal-Key` header — NOT
 * `Authorization: Bearer`. The GCI docx prose says "Bearer Token"; every actual
 * curl uses `Internal-Key`. We follow the curls. CONFIRM with FG. A
 * `Cookie: sess_map` appears in some samples — treated as optional and omitted.
 *
 * ⚠ Load-bearing FG misspellings are preserved verbatim in the JSON keys we read
 * and write: PolicyHolderDeatils, ExipryDate, ChassiNo, ENgineNo, VehicaleIDV,
 * NCBPercntage, RegistrationNO. Do not "correct" them.
 *
 * Spec: GCI Motor Modify Renewal Document (+ kit CURLs).
 */

// ── value helpers ────────────────────────────────────────────────────────────

/**
 * FG money/IDV values arrive as comma-grouped decimal strings ("256,500",
 * "7468.80") on the Quote response and as plain floats on the Proposal response.
 * Strip separators and round to whole rupees — canonical money is INR integers.
 */
function rupees(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

// CoverCode → canonical policy type; ProductCode → canonical vehicle category.
const COVER_TO_POLICY: Record<string, string> = {
  CO: "comprehensive",
  OD: "standAloneOD",
  LO: "thirdParty",
};
function productToCategory(code: string): string {
  // FCV/FGV/FPC are commercial; FPV/FVO/F13 (and default) are four-wheeler.
  return code.startsWith("FC") || code === "FGV" || code === "FPC"
    ? "commercial"
    : "fourWheeler";
}

// ── transport ────────────────────────────────────────────────────────────────

/** POST JSON to a RenewalModify op with the token in an `Internal-Key` header. */
async function postJson(
  url: string,
  token: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "*/*",
      "Internal-Key": token,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new ProviderError(
      FG_SLUG,
      res.status,
      `FG renewal request failed [${res.status}]`,
      text.slice(0, 500),
    );
  }
  try {
    return obj(JSON.parse(text));
  } catch {
    throw new ProviderError(FG_SLUG, 200, "FG renewal returned non-JSON", text.slice(0, 500));
  }
}

/**
 * FG renewal signals failure via a `Status`/`status` of "Fail"/"Failed" plus an
 * `ErrorCode`/`ErrorDescription`. A *Success* carrying `ErrorCode: "0"` + a
 * Break-in `ErrorDescription` is NOT a failure (it flags the inspection
 * requirement) — Status stays "Success", so this guard lets it through.
 */
function assertRenewalSuccess(body: Record<string, unknown>, context: string): void {
  const status = (str(body.Status) ?? str(body.status) ?? "").toLowerCase();
  if (!status.startsWith("fail") && !status.startsWith("error")) return;
  const message =
    str(body.ErrorDescription) ??
    str(body.errorDescription) ??
    str(body.ErrorCode) ??
    str(body.errorCode) ??
    "unknown error";
  throw new ProviderError(
    FG_SLUG,
    200,
    `FG ${context} failed: ${message}`,
    body,
    classifyFgError(message),
  );
}

// ── ModifyRenewalQuote ───────────────────────────────────────────────────────

/** Prices an existing policy; returns the expiring-policy snapshot + base premium. */
export async function fgRenewalQuote(
  config: FgConfig,
  req: RenewalQuoteRequest,
  token: string,
  ctx: { requestId: string },
): Promise<CanonicalQuoteResult> {
  const body = {
    policyNo: req.policyNo,
    expiryDate: req.expiryDate ? toFgDate(req.expiryDate) : "",
    registrationNo: req.registrationNo ?? "",
    vendorCode: config.vendorCode,
  };
  const root = await postJson(`${config.renewal.baseUrl}/ModifyRenewalQuote`, token, body);
  assertRenewalSuccess(root, "renewal-quote");

  const old = obj(root.OldPolicyDetails);
  const holder = obj(root.PolicyHolderDeatils);
  const vehicle = obj(root.VehicleDetails);
  const od = obj(root.ODPremium);
  const tp = obj(root.TPPremium);

  const proposalNo = str(old.ProposalNo) ?? `00${req.policyNo}`;
  const coverCode = str(old.CoverCode) ?? "CO";
  const productCode = str(old.ProductCode) ?? "FPV";

  const grossPremium = rupees(root.FinalPremium);
  const serviceTaxAmount = rupees(root.ServiceTax);
  const basicOdPremium = rupees(od.GrossPremium);
  const thirdPartyPremium = rupees(tp.GrossPremium);
  const totalAddonPremium = rupees(od.TotalAddon);
  const idvValue = rupees(vehicle.VehicleIDV);
  const netPremium = Math.max(grossPremium - serviceTaxAmount, 0);

  // A Success with a Break-in ErrorDescription flags the inspection requirement.
  const errorDesc = str(root.ErrorDescription) ?? "";
  const isInspectionRequired = /break-?in/i.test(errorDesc);

  return {
    quoteNo: proposalNo,
    transactionId: proposalNo,
    requestId: ctx.requestId,
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    policyType: COVER_TO_POLICY[coverCode] ?? "comprehensive",
    vehicleCategory: productToCategory(productCode),
    idvValue,
    basicOdPremium,
    thirdPartyPremium,
    addonPremiums: {},
    discounts: {},
    totalAddonPremium,
    totalDiscount: 0,
    netPremium,
    serviceTaxPercent: 18,
    serviceTaxAmount,
    grossPremium,
    isInspectionRequired,
    contractDetails: {
      previousPolicyNo: str(old.PolicyNo) ?? req.policyNo,
      proposalNo,
      productCode,
      coverCode,
      agentCode: str(old.AgentCode),
      branch: str(old.Branch),
      clientCode: str(holder.ClientID),
      ckycStatus: str(holder.CKYCStatus),
      registrationNo: str(vehicle.RegistrationNO),
      expiryDate: str(old.ExipryDate),
      // Echo the quote's discount % verbatim (negative) for the proposal step.
      discountPercentage: str(od.DiscountPercentage),
      previousPolicyNCB: str(od.PreviousPolicyNCB),
      eligiblePolicyNCB: str(od.EligiblePolicyNCB),
    },
    _rawResponse: root,
  };
}

// ── ModifyRenewalProposal ────────────────────────────────────────────────────

/** Echoes the quote snapshot + applies the modification delta; returns the
 *  bound (re-rated) premium plus the ClientID/AgentCode needed for issuance. */
export async function fgRenewalProposal(
  config: FgConfig,
  req: RenewalProposalRequest,
  token: string,
  ctx: { requestId: string },
): Promise<CanonicalQuoteResult> {
  const payload = {
    ProductCode: req.productCode,
    PolicyDetails: {
      PreviousPolicyNo: req.previousPolicyNo,
      ProposalNo: req.proposalNo,
      StartDate: toFgDate(req.startDate),
      ExipryDate: toFgDate(req.expiryDate), // ← preserve misspelling
      ClientCode: req.clientCode,
      ...(req.ckycNo ? { CKYCNo: req.ckycNo } : {}),
      ...(req.ckycRefNo ? { CKYCRefNo: req.ckycRefNo } : {}),
    },
    ModifyDetails: {
      AgentCode: req.agentCode,
      Branch: req.branch,
      CoverCode: req.coverCode,
      VehicleIDV: String(req.vehicleIdv),
      DiscountPercentage: String(req.discountPercentage),
      ElectricalAccessoriesValues: req.electricalAccessoriesValues ?? "",
      NonElectricalAccessoriesValues: req.nonElectricalAccessoriesValues ?? "",
      IMT23: req.imt23 ?? "",
      IMT10: req.imt10 ?? "",
      IMT15: req.imt15 ?? "",
      IMT16: req.imt16 ?? "",
      IMT28: req.imt28 ?? "",
      IMT29: req.imt29 ?? "",
      IMT20: req.imt20 ?? "",
      ...(req.idvOfCngOrLpg !== undefined ? { IDVOfCNGOrLPG: String(req.idvOfCngOrLpg) } : {}),
      AddonCode: req.addonCodes.map((c) => ({ CoverCode: c })),
    },
    InspectionNo: req.inspectionNo ?? "",
    InspectionDate: req.inspectionDate ? toFgDate(req.inspectionDate) : "",
  };
  const root = await postJson(`${config.renewal.baseUrl}/ModifyRenewalProposal`, token, payload);
  assertRenewalSuccess(root, "renewal-proposal");

  const od = obj(root.ODPremium);
  const tp = obj(root.TPPremium);
  const proposalNo = str(root.ProposalNo) ?? req.proposalNo;

  // In ModifyRenewalProposal, `TotalPremium` is the NET (pre-tax) premium and
  // `gst` is added ON TOP (canonical grossPremium is tax-INCLUSIVE, matching the
  // Quote path where FinalPremium is gross). Corroboration: net 6595.71 + gst
  // 1187.23 = 7782.94 → gross 7783 == the ModifyRenewalPolicyIssuance sample
  // Receipt.Amount "7783" (the real payable). Do NOT invert these.
  const serviceTaxAmount = rupees(root.gst);
  const netPremium = rupees(root.TotalPremium);
  const grossPremium = netPremium + serviceTaxAmount;
  const basicOdPremium = rupees(od.GrossPremium);
  const thirdPartyPremium = rupees(tp.GrossPremium);
  const totalAddonPremium = rupees(od.TotalAddon);

  return {
    quoteNo: proposalNo,
    transactionId: proposalNo,
    requestId: ctx.requestId,
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    policyType: COVER_TO_POLICY[req.coverCode] ?? "comprehensive",
    vehicleCategory: productToCategory(req.productCode),
    idvValue: req.vehicleIdv,
    basicOdPremium,
    thirdPartyPremium,
    addonPremiums: {},
    discounts: {},
    totalAddonPremium,
    totalDiscount: 0,
    netPremium,
    serviceTaxPercent: 18,
    serviceTaxAmount,
    grossPremium,
    contractDetails: {
      previousPolicyNo: str(root.PreviousPolicyNo) ?? req.previousPolicyNo,
      proposalNo,
      clientId: str(root.ClientID) ?? req.clientCode,
      agentCode: str(root.AgentCode) ?? req.agentCode,
      branchCode: req.branch,
    },
    _rawResponse: root,
  };
}

// ── ModifyRenewalPolicyIssuance ──────────────────────────────────────────────

/** Issues the renewal with the collected payment receipt; returns the new policy. */
export async function fgRenewalCreatePolicy(
  config: FgConfig,
  req: RenewalCreatePolicyRequest,
  token: string,
): Promise<PolicyIssuanceResult> {
  const r = req.receipt;
  const payload = {
    PolicyNo: req.policyNo,
    VendorCode: config.vendorCode,
    ClientID: req.clientId,
    RegistrationNo: req.registrationNo ?? "",
    ProposalNo: req.proposalNo,
    AgentCode: req.agentCode,
    BranchCode: req.branchCode,
    Receipt: {
      UniqueTranKey: r.uniqueTranKey,
      CheckType: r.checkType ?? "",
      BSBCode: r.bsbCode ?? "",
      TransactionDate: r.transactionDate,
      ReceiptType: r.receiptType,
      Amount: String(r.amount),
      TranRefNo: r.tranRefNo,
      TranRefNoDate: r.tranRefNoDate,
      // Renewal issuance uses `PaymentType` (motor NB uses `PGType`).
      PaymentType: r.pgType ?? "",
    },
  };
  const root = await postJson(
    `${config.renewal.baseUrl}/ModifyRenewalPolicyIssuance`,
    token,
    payload,
  );
  assertRenewalSuccess(root, "renewal-issuance");

  const policyNumber = str(root.policyNumber) ?? str(root.PolicyNo);
  return {
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    status: policyNumber ? "ISSUED" : "IN_PROGRESS",
    policyNumber,
    quoteNo: str(root.proposalNumber) ?? req.proposalNo,
    clientId: req.clientId,
    _rawResponse: root,
  };
}
```

- [ ] **Step 5: Fix the `renewalQuote` call site in `fg.provider.ts`**

The rewritten `fgRenewalQuote` takes a `{ requestId }` ctx (vehicle category / policy type are now derived from the FG response, not passed). Update `fg.provider.ts` lines 340-348 from:

```ts
  async renewalQuote(req: RenewalQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult> {
    return this.withAuthRetry(this.renewalToken, (token) =>
      fgRenewalQuote(this.config, req, token, {
        requestId: ctx.requestId,
        vehicleCategory: "fourWheeler",
        policyType: "comprehensive",
      }),
    );
  }
```

to:

```ts
  async renewalQuote(req: RenewalQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult> {
    return this.withAuthRetry(this.renewalToken, (token) =>
      fgRenewalQuote(this.config, req, token, { requestId: ctx.requestId }),
    );
  }
```

(`renewalCreatePolicy` at lines 350-357 needs no change — `fgRenewalCreatePolicy(config, req, token)` signature is preserved; `req` now carries the re-shaped fields, forwarded as-is.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/renewal.test.ts`
Expected: PASS (all `describe` blocks green).

- [ ] **Step 7: Typecheck**

Run: `cd tf-api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd tf-api
git add src/contracts/renewal.ts src/providers/fg/renewal.ts \
        src/providers/fg/__tests__/renewal.test.ts src/providers/fg/fg.provider.ts
git commit -m "feat(fg-renewal): rewrite adapter to Renewal/1.0.0/RenewalModify 3-op JSON flow"
```

---

## Task 4: Wire the third op (`renewalProposal`) into the provider + interface

**Files:**
- Modify: `tf-api/src/providers/insurance-provider.ts:71-79,127-133`
- Modify: `tf-api/src/providers/fg/fg.provider.ts` (imports + new method)
- Modify: `tf-api/src/providers/fg/__tests__/renewal.test.ts` (add a provider-level test)

- [ ] **Step 1: Add the failing provider-level test**

Append this `describe` block to the end of `src/providers/fg/__tests__/renewal.test.ts` (and add `import { FgProvider } from "../fg.provider.ts";` to the existing import block at the top):

```ts
describe("FgProvider renewal wiring (3 ops)", () => {
  const provider = new FgProvider({
    config,
    renewalTokenProvider: async () => "tok",
  });

  it("dispatches renewalProposal through the provider", async () => {
    const { fn, calls } = mockFetch(proposalFixture);
    vi.stubGlobal("fetch", fn);
    const result = await provider.renewalProposal(
      {
        productCode: "FPV",
        previousPolicyNo: "VD731720",
        proposalNo: "00VD731720",
        clientCode: "72782626",
        startDate: "2025-03-31",
        expiryDate: "2026-03-30",
        agentCode: "60081262",
        branch: "12",
        coverCode: "CO",
        vehicleIdv: 603000,
        discountPercentage: -80,
        addonCodes: ["STZDP"],
      },
      { requestId: "p1" },
    );
    expect(calls[0]?.url).toContain("/ModifyRenewalProposal");
    expect((calls[0]?.init.headers as Record<string, string>)["Internal-Key"]).toBe("tok");
    expect(result.quoteNo).toBe("00VD731720");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/renewal.test.ts`
Expected: FAIL — `provider.renewalProposal` does not exist / `RenewalProvider` has no `renewalProposal`.

- [ ] **Step 3: Extend the `RenewalProvider` interface + guard in `insurance-provider.ts`**

Add the `RenewalProposalRequest` import to the existing renewal contract import (near the other contract imports at the top of the file):

```ts
import type {
  RenewalQuoteRequest,
  RenewalProposalRequest,
  RenewalCreatePolicyRequest,
} from "@/contracts/renewal.ts";
```

Update the `RenewalProvider` interface (lines 71-79) to:

```ts
export interface RenewalProvider extends InsuranceProvider {
  /** Prices the renewal of an existing policy (keyed by PolicyNo). */
  renewalQuote(req: RenewalQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult>;
  /** Applies the modification delta to a fetched renewal → bound premium. */
  renewalProposal(req: RenewalProposalRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult>;
  /** Issues the renewal directly with the collected payment receipt. */
  renewalCreatePolicy(
    req: RenewalCreatePolicyRequest,
    ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult>;
}
```

Update the `supportsRenewal` guard (lines 127-133) to require all three methods:

```ts
export function supportsRenewal(p: InsuranceProvider): p is RenewalProvider {
  return (
    p.operations.has("renewal") &&
    typeof (p as RenewalProvider).renewalQuote === "function" &&
    typeof (p as RenewalProvider).renewalProposal === "function" &&
    typeof (p as RenewalProvider).renewalCreatePolicy === "function"
  );
}
```

- [ ] **Step 4: Add the `renewalProposal` method to `FgProvider`**

In `fg.provider.ts`, extend the renewal contract import (line 6-9) to include the new type + function:

```ts
import type {
  RenewalQuoteRequest,
  RenewalProposalRequest,
  RenewalCreatePolicyRequest,
} from "@/contracts/renewal.ts";
```

and the adapter import (line 42):

```ts
import { fgRenewalQuote, fgRenewalProposal, fgRenewalCreatePolicy } from "./renewal.ts";
```

Then add the method immediately after `renewalQuote` (after line 348):

```ts
  async renewalProposal(
    req: RenewalProposalRequest,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult> {
    return this.withAuthRetry(this.renewalToken, (token) =>
      fgRenewalProposal(this.config, req, token, { requestId: ctx.requestId }),
    );
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/renewal.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd tf-api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd tf-api
git add src/providers/insurance-provider.ts src/providers/fg/fg.provider.ts \
        src/providers/fg/__tests__/renewal.test.ts
git commit -m "feat(fg-renewal): add renewalProposal op to RenewalProvider + FG wiring"
```

---

## Task 5: Wire service + controller + route + OpenAPI for the proposal op

**Files:**
- Modify: `tf-api/src/services/renewal.service.ts`
- Modify: `tf-api/src/controllers/renewal.controller.ts`
- Modify: `tf-api/src/routes/v1/quotes.routes.ts`
- Modify: `tf-api/scripts/gen-openapi.ts`
- Create: `tf-api/src/services/__tests__/renewal.service.test.ts`

- [ ] **Step 1: Write the failing service test `src/services/__tests__/renewal.service.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { renewalProposal } from "@/services/renewal.service.ts";
import { registerProvider, clearRegistry } from "@/providers/provider-registry.ts";
import type { RenewalProvider } from "@/providers/insurance-provider.ts";
import type { RenewalProposalRequest } from "@/contracts/renewal.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";

const sampleReq: RenewalProposalRequest = {
  productCode: "FPV",
  previousPolicyNo: "VD731720",
  proposalNo: "00VD731720",
  clientCode: "72782626",
  startDate: "2025-03-31",
  expiryDate: "2026-03-30",
  agentCode: "60081262",
  branch: "12",
  coverCode: "CO",
  vehicleIdv: 603000,
  discountPercentage: -80,
  addonCodes: [],
};

function fakeRenewalProvider(): RenewalProvider {
  return {
    slug: "fake",
    displayName: "Fake",
    capabilities: new Set(),
    operations: new Set(["renewal"]),
    motorCapabilities: {},
    getQuote: async () => ({}) as CanonicalQuoteResult,
    getFullQuote: async () => ({}) as CanonicalQuoteResult,
    renewalQuote: async () => ({}) as CanonicalQuoteResult,
    renewalProposal: async (req) =>
      ({ quoteNo: req.proposalNo, providerSlug: "fake" }) as CanonicalQuoteResult,
    renewalCreatePolicy: async () => ({ providerSlug: "fake", status: "ISSUED" }),
  } as unknown as RenewalProvider;
}

afterEach(() => clearRegistry());

describe("renewal.service renewalProposal", () => {
  it("dispatches to the provider's renewalProposal", async () => {
    registerProvider(fakeRenewalProvider());
    const result = await renewalProposal("fake", sampleReq);
    expect(result.quoteNo).toBe("00VD731720");
  });

  it("rejects a provider that does not support renewal", async () => {
    await expect(renewalProposal("missing", sampleReq)).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tf-api && npx vitest run src/services/__tests__/renewal.service.test.ts`
Expected: FAIL — `renewalProposal` is not exported from the service.

- [ ] **Step 3: Add the `renewalProposal` service function**

In `src/services/renewal.service.ts`, extend the contract import (line 7):

```ts
import type {
  RenewalQuoteRequest,
  RenewalProposalRequest,
  RenewalCreatePolicyRequest,
} from "@/contracts/renewal.ts";
```

and add the function after `renewalQuote` (after line 23):

```ts
export async function renewalProposal(
  providerSlug: string,
  req: RenewalProposalRequest,
): Promise<CanonicalQuoteResult> {
  return renewalProvider(providerSlug).renewalProposal(req, { requestId: randomUUID() });
}
```

- [ ] **Step 4: Run to verify the service test passes**

Run: `cd tf-api && npx vitest run src/services/__tests__/renewal.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the controller handler**

In `src/controllers/renewal.controller.ts`, extend the service import (line 2):

```ts
import { renewalQuote, renewalProposal, renewalCreatePolicy } from "@/services/renewal.service.ts";
```

and add the handler after `handleRenewalQuote` (after line 20):

```ts
export async function handleRenewalProposal(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await renewalProposal(provider, req.body as never);
    res
      .status(200)
      .json(successEnvelope(result, req.requestId, result._rawResponse, env.ENABLE_DEBUG_PAYLOAD));
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 6: Add the route**

In `src/routes/v1/quotes.routes.ts`, extend the contract import (lines 4-7):

```ts
import {
  RenewalQuoteRequestSchema,
  RenewalProposalRequestSchema,
  RenewalCreatePolicyRequestSchema,
} from "@/contracts/renewal.ts";
```

extend the controller import (line 13):

```ts
import {
  handleRenewalQuote,
  handleRenewalProposal,
  handleRenewalCreate,
} from "@/controllers/renewal.controller.ts";
```

and insert the proposal route between the renewal quote and create routes (after line 67, the `renewal/quote` route, before `renewal/create`):

```ts
router.post(
  "/:provider/motor/renewal/proposal",
  validate(RenewalProposalRequestSchema),
  handleRenewalProposal,
);
```

Also update the section comment on line 62 from `// Renewal of an existing policy (FG: separate motorRenewal JSON API)` to `// Renewal of an existing policy (FG: Renewal/1.0.0/RenewalModify — 3 ops)`.

- [ ] **Step 7: Register the schema + path in `gen-openapi.ts`**

Extend the renewal import (lines 37-39):

```ts
const { RenewalQuoteRequestSchema, RenewalProposalRequestSchema, RenewalCreatePolicyRequestSchema } =
  await import("@/contracts/renewal.ts");
```

Add the registration after line 66 (`registry.register("RenewalQuoteRequest", …)`):

```ts
registry.register("RenewalProposalRequest", RenewalProposalRequestSchema);
```

Add the path registration between the existing renewal-quote and renewal-create `registerPath` calls (after line 241):

```ts
registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/motor/renewal/proposal",
  summary: "Renewal proposal — apply the modification delta and bind the premium (FG RenewalModify)",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: RenewalProposalRequestSchema } } },
  },
  responses: {
    200: { description: "Renewal proposal (bound premium)", content: { "application/json": { schema: CanonicalQuoteResultSchema } } },
  },
});
```

Also update the existing renewal-quote path summary (line 233) from `"Renewal quote — price an existing policy (FG motorRenewal)"` to `"Renewal quote — fetch the expiring-policy snapshot (FG RenewalModify)"`.

- [ ] **Step 8: Regenerate the OpenAPI document**

Run: `cd tf-api && npm run openapi:gen`
Expected: PASS; `openapi/openapi.json` updates (new `RenewalProposalRequest` schema + `/motor/renewal/proposal` path; `RenewalCreatePolicyRequest` schema reflects the re-shaped fields).

- [ ] **Step 9: Typecheck**

Run: `cd tf-api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
cd tf-api
git add src/services/renewal.service.ts src/services/__tests__/renewal.service.test.ts \
        src/controllers/renewal.controller.ts src/routes/v1/quotes.routes.ts \
        scripts/gen-openapi.ts openapi/openapi.json
git commit -m "feat(fg-renewal): expose renewal/proposal route + service/controller + OpenAPI"
```

---

## Task 6: Final verification (whole suite green + typecheck)

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd tf-api && npm test`
Expected: PASS. (Suites touching repositories need the `tf_api_test` MySQL DB up — start it with `npm run db:up` first if it is not already running. The renewal + renewal.service suites are pure/fixture-driven and do not need the DB.)

- [ ] **Step 2: Typecheck the whole project**

Run: `cd tf-api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Lint the touched files**

Run: `cd tf-api && npm run lint`
Expected: PASS (no new errors in the touched files).

- [ ] **Step 4: Final commit (if lint auto-fixed anything; otherwise skip)**

```bash
cd tf-api
git add -A
git commit -m "chore(fg-renewal): lint + final verification for RenewalModify rewrite"
```

---

## Out of scope / follow-on

- **Payment receipt** fed into `ModifyRenewalPolicyIssuance` (`Receipt.UniqueTranKey` ← PG `WS_P_ID`, `Receipt.TranRefNo` ← PG `PGID`, `Amount` in whole rupees, `PaymentType`/`ReceiptType:"IVR"`) is produced by the **payment plan** (Web-Aggregator v1.41). This plan consumes a `PaymentReceipt` shaped by the existing `PaymentReceiptSchema`; it does not build or reconcile the receipt.
- **CKYC number / ref number** for `PolicyDetails.CKYCNo` / `CKYCRefNo` (used only when the policyholder's CKYC is unverified — `PolicyHolderDeatils.CKYCStatus` blank) come from the **CKYC plan** (`GCKYC/3.0.0`). This plan just passes them through as optional proposal fields.
- **Break-in inspection number** (`InspectionNo` / `InspectionDate`) originates from the LiveChek inspection flow, which is **out of scope for the web-aggregator/broker portal** per the partner agreement. The adapter surfaces `isInspectionRequired` from the quote and accepts inspection fields on the proposal, but does not run inspection.
- **tf-web regeneration:** after this plan lands, run `npm run gen:api` in `tf-web` to refresh the generated bindings from the updated `openapi/openapi.json` (the frontend renewal UI wiring is a separate frontend task, not covered here).
- **Business-rule enforcement** (claims-impact NCB/discount removal, market-renewal block, IDV-variation policy) is applied by FG server-side and/or upstream; this adapter surfaces the signals (NCB fields, break-in flag) but does not re-implement the rules.

## Open confirmations for FG/GCI (renewal)

1. **`Internal-Key` vs `Authorization: Bearer`** — the docx prose says "Bearer Token"; every actual curl uses `Internal-Key`. Encoded as `Internal-Key`; confirm this is correct for all three ops.
2. **`Cookie: sess_map`** — appears in the ModifyRenewalQuote / ModifyRenewalPolicyIssuance samples. Encoded as omitted; confirm it is not required (sticky-session only).
3. **Production URLs** — the three `Renewal/1.0.0/RenewalModify/*` endpoints have blank prod URLs in the kit (UAT only). Confirm prod host + whether the `-internal-` gateway is externally reachable / needs IP whitelisting.
4. **Token TTL vs per-request** — the docx says "An Access Token must be generated for each unique request"; we keep the cached per-product token (`fg-renewal:default`) with the existing 401 → refresh-and-retry. Confirm caching is acceptable.
5. **`VendorCode`** — samples mix `Webagg` (quote) and `BAJAJ` (issuance). We send `config.vendorCode` (`Webagg` default) uniformly. Confirm the correct production VendorCode + AgentCode/BranchCode.
6. **IDV number format in requests** — request samples send comma-grouped IDV (`"603,000"`, `"475,629"`); we send plain digit strings (`"603000"`). Confirm FG accepts un-grouped digits (or whether grouping is required).
7. **IDV-variation rule** — the docx Q&A says "No IDV Variation as per UW team", which contradicts the usual ±30% clamp. Confirm whether any IDV min/max applies at renewal.
8. **DiscountPercentage sign** — Q&A says the fetch shows it negative and it must be echoed as-is; yet the first quote fixture shows a positive `"70"`. Confirm the canonical sign convention passed to `ModifyRenewalProposal`.
9. **Error envelope** — encoded: `Status`/`status` "Fail"/"Failed" + `ErrorCode`/`ErrorDescription` (case varies per op: uppercase on quote/issuance-fail, lowercase on issuance-success). Confirm no other failure shapes exist.
10. **Cover conversion mapping (`ModifyDetails.CoverCode`)** — intel §5 lists cover conversion as **CO / SAOD / SATP**, but the canonical `coverCode` enum is `[CO, OD, LO]`. The mapping **SAOD → OD** and **SATP → LO** is *implied, not stated* in the kit. Confirm that FG's `ModifyDetails.CoverCode` accepts `LO` for a third-party (SATP) conversion (and `OD` for standalone-OD), or supply the exact codes FG expects at renewal.

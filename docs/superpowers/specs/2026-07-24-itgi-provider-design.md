# ITGI (IFFCO-Tokio) Motor Provider — Design Spec

**Date:** 2026-07-24
**Status:** Approved for planning
**Source research:** `tf-api/docs/itgi-integration-notes.md` (consolidated vendor kit notes)

---

## 1. Goal

Add IFFCO-Tokio General Insurance (`itgi`) as the third motor provider in `tf-api`, behind the existing
`InsuranceProvider` adapter abstraction, covering the **full policy lifecycle** and **all supported policy paths**.

### Scope (decided)

- **Full lifecycle:** quote → CKYC → proposal → payment → policy → status → certificate.
- **All policy paths:** comprehensive, standalone TP (act-only), single-year OD renewal, new vehicle
  (bundled long-term), and break-in (as a cross-cutting modifier).
- **Lines:** private car (`fourWheeler`) + two-wheeler (`twoWheeler`) + `newVehicle`. **Commercial/CVI excluded**
  (the vendor kit ships no CVI master data).
- **RTO resolution: strict.** No seeded or derived RTO rows. Quotes fail closed until ITGI supplies the real master.

### Explicitly out of scope

CVI/commercial; production endpoints; CKYC `/kyc/update`; break-in *completion* (blocked — unknown whether ITGI's
inspection approval is email-only or has a callback); the vendor's ITGI-hosted-PG redirect mode (we use Partner-PG);
**and all `tf-web` frontend wiring** (compare page + the live `Vehicle_Second.js` journey) — that is a separate
follow-up spec, since this one delivers only the `tf-api` provider adapter.

### Success criteria

1. `ItgiProvider` registers and appears in the `compare.service.ts` fan-out when `ITGI_ENABLED=true`.
2. Every lifecycle method is implemented and unit-tested against fixtures derived from real vendor samples.
3. `npm run typecheck`, `npm run lint`, and `npm test` all pass in `tf-api`.
4. A missing ITGI RTO mapping degrades gracefully (ITGI omitted from comparison) — never a vendor 5xx to the user.
5. No vendor credentials in code or DB; all via env, provider off by default.

**Non-goal / known limitation:** without `partnerCode` + IP whitelisting from ITGI, *nothing is live-verifiable*.
This work delivers a structurally complete, fixture-tested adapter — "works against ITGI UAT" remains unproven
until credentials land. This is accepted deliberately.

---

## 2. Vendor shape (essential facts)

- **Hybrid transport.** Motor quote/proposal/payment/status are **SOAP/XML**; CKYC and policy-download are
  **REST/JSON**. Policy download additionally uses **HTTP Basic auth** — the only call that does.
- **No OAuth/token.** SOAP auth is `partnerCode`/`partnerBranch`/`externalServiceConsumer` **in the request body**;
  CKYC REST has no auth header at all (presumed IP-whitelisting). **→ No `TokenManager` for ITGI.**
- **Two SOAP namespace families:**
  - IDV + Premium → `http://premiumwrapper.motor.itgi.com`
  - Proposal/Payment/Status → ops `http://util.ptnr.itgi.com` (`util:`), data `http://wrapper.data.ptnr.itgi.com` (`wrap:`)
- **SOAP transport:** SOAP 1.1, `style=document`, **empty `SOAPAction`**, empty `<soapenv:Header/>`.
- **Vendor misspells its own tags** — must be reproduced verbatim: `engineCpacity`, `regictrationCity`,
  `totalPremimAfterDiscLoad`, `erorMessage`.
- **Dates** `MM/DD/YYYY` and `MM/DD/YYYY HH:mm:ss`. **Money in rupees** (whole rupees per repo convention).
- **Success sentinel:** `SUCCESSFULLY_SUBMITTED_IN_P400` / `SUCCESSFULLY_UPDATED_IN_P400`;
  break-in returns `PAYMENT_ACCEPTED_BREAK_IN`.
- **State chain:** we mint `uniqueQuoteId` (12–20 chars) → proposal returns `orderNo` + `traceNo` →
  payment returns `policyNumber` → status/certificate keyed by `uniqueQuoteId` / `policyNo`.

---

## 3. Architecture

Chosen approach: **mirror FG's file layout, plus a `policy-types/` folder for per-path payload deltas.**
Rationale: the complexity concentrates in payload construction, not transport, so decomposition belongs there.
Transport stays a single module because both wire formats are thin.

```
tf-api/src/providers/itgi/
  config.ts              env → typed config + capability constants (no auth.ts, no token manager)
  http.ts                soapPost() + jsonPost() (+ Basic-auth variant); retry/timeout
  mapper.ts              base payload builders (idv / premium / proposal / payment / status / download)
  policy-types/
    index.ts             selects the delta module from canonical request
    comprehensive.ts     zcover=CO,  ITGI PolicyType=CP
    standalone-tp.ts     zcover=AC,  PolicyType=TP, IDV Basic sumInsured=1, restricted cover set
    od-renewal.ts        PolicyType=OD + TpPolicyNo/TpInceptionDate/TpExpiryDate/TpInsurerName
    new-vehicle.ts       PolicyType=BP, NewVehiclePremiumWebserviceVA, year-wise premium blocks
    break-in.ts          modifier: inception=date+3, breakInofMorethan90days, inspection tags
  normalizer.ts          vendor XML/JSON → canonical (incl. dual autocoverage-block selection)
  ckyc.ts                REST: /kyc/fetch → /kyc/fetch-validate-otp → /kyc/create
  proposal.ts            validateProposalRequest
  payment.ts             updatePaymentDetails
  policy-status.ts       getPolicyStatus
  certificate.ts         /policy/download (Basic auth)
  inspection.ts          break-in create + status
  renewal.ts             OD-renewal lifecycle
  db-code-resolver.ts    canonical IDs → ITGI codes (source='itgi')
  errors.ts              assertItgiSuccess, ItgiUnmappedRtoError, fault classification
  itgi.provider.ts       the class
  index.ts               registerItgiProvider()
  fixtures/              real vendor req/res pairs from the kit
  __tests__/
```

### 3.1 Capability surface

`ItgiProvider implements InsuranceProvider, KycCapableProvider, IssuanceProvider, RenewalProvider,
InspectionProvider, PolicyStatusProvider, CertificateProvider`.

- `slug = "itgi"`, `displayName = "IFFCO-Tokio"`
- `capabilities: Set<VehicleCategory> = { fourWheeler, twoWheeler, newVehicle }`
- `operations: Set<ProviderOperation> = { quote, proposal, ckyc, ovd, issuance, renewal, inspection, policyStatus, coi }`
  (**no `retrieveQuote`** — ITGI has no retrieve-quote-by-id, same as FG)
- `motorCapabilities`: per-category plan types + add-on sets (see §3.5)

### 3.2 Method → vendor call mapping

| Interface method | ITGI call(s) | Notes |
|---|---|---|
| `getQuote` | `getVehicleIdv` → `getMotorPremium` | IDV is called for **every** in-scope path, new vehicle included (the kit's only IDV exception is CVI Taxi, which is out of scope) |
| `getFullQuote` | `getMotorPremium` → `validateProposalRequest` | **creates the proposal**; returns `orderNo`/`traceNo` |
| `issuePolicy` | `updatePaymentDetails` | binds payment to prior proposal → `policyNumber` |
| `completeCkyc` | `/kyc/fetch`, then `/kyc/fetch-validate-otp` + re-`fetch` if `OTPPending` | yields `itgiUniqueReferenceId` (IURN) |
| `initiateOvd` | `/kyc/create` with base64 documents | returns IURN (`SUCCESS` or `EXISTING RECORD`) |
| `renewalQuote` / `renewalProposal` / `renewalCreatePolicy` | OD-renewal variants | `PolicyType=OD` + running TP policy details |
| `createInspection` / `getInspectionStatus` | break-in proposal tags; `getPolicyStatus` polling | completion blocked (see §7) |
| `getPolicyStatus` | `getPolicyStatus` | keyed by `uniqueQuoteId` |
| `getCertificate` | `POST /policy/download` | Basic auth; staging returns placeholder PDF |

### 3.3 Canonical → ITGI path mapping

Canonical `PolicyType` is `comprehensive | thirdParty | standAloneOD`; new vehicle is a **`VehicleCategory`**,
and break-in is a **modifier**, not a type:

| Canonical | ITGI | Module |
|---|---|---|
| `comprehensive` | `zcover=CO`, `PolicyType=CP` | `comprehensive.ts` |
| `thirdParty` | `zcover=AC`, `PolicyType=TP`, IDV Basic SI=1 | `standalone-tp.ts` |
| `standAloneOD` | `PolicyType=OD` + TP policy details | `od-renewal.ts` |
| category `newVehicle` | `PolicyType=BP` + `newVehicleFlag=Y`, separate endpoint | `new-vehicle.ts` |
| break-in detected (prev-policy expiry) | inception=date+3, `breakInofMorethan90days` Y/N, inspection tags | `break-in.ts` (composes onto the above) |

### 3.4 Transport (`http.ts`)

- `soapPost(url, xml, { requestId })` — sets `SOAPAction: ""`, `Content-Type: text/xml; charset=utf-8`,
  empty header element; returns parsed body. Handles both namespace families (caller supplies the envelope).
- `jsonPost(url, body, { basicAuth?, requestId })` — CKYC + policy download.
- Timeouts + bounded retry for transient faults, mirroring FG's transport; every call logged with `requestId`.

### 3.5 Coverages & add-ons

ITGI keys coverages by **exact name string**, not a code. Canonical add-ons map by name + OD/TP side.
Base covers use `odPremium`/`tpPremium`; **add-ons return a single combined `coveragePremium`**.
`sumInsured` carries either a numeric limit or the literal `Y` for opt-in flag covers.

Notable allowed-value constraints to enforce: NCB ∈ {20,25,35,45,50}; Voluntary Excess PCP {2500,5000,7500,15000} /
TWP {500,750,1000,1500,3000}; TPPD PCP 750000 / TWP 100000; Helmet TWP only (SI ≤ 50000); Tyre cover only ≤4y.
**RIM / Tyre Protection / Engine Gear Box Protection are valid for BOTH car and two-wheeler** (per the updated kit).

### 3.6 Normalization

`getMotorPremium` returns **one or two** `getMotorPremiumReturn` blocks — `autocoverage=false` (base) and
`autocoverage=true` (base + bundled add-ons incl. default Depreciation Waiver). The normalizer **selects the block
matching the customer's elected add-ons**, then maps per-cover premiums plus totals (`totalODPremium`,
`totalTPPremium`, `totalPremimAfterDiscLoad`, `discountLoading`, `discountLoadingAmt`, `serviceTax`,
`premiumPayable`) into the canonical breakdown. New-vehicle responses are year-wise and are folded into the
long-term canonical shape.

### 3.7 Code resolution & masters

`db-code-resolver.ts` translates canonical IDs → ITGI codes, all rows `source='itgi'`:

| Canonical | ITGI key | Source |
|---|---|---|
| MMV | `MAKE` variant code (5–6 char, e.g. `CBLTL`) | MAKE sheet, 16,679 rows |
| Coverage / add-on | exact coverage **name** | `PCP_TWP_Coverages.xls` |
| Previous insurer | name (fuzzy/normalized match) | 45-row list |
| Financier | 8-digit zero-padded string code | 95,403-row master |
| **RTO** | **`rtoCity` token — NOT SEEDED** | ⚠ absent from kit |

**RTO is strict (decided).** The resolver reads `ProviderRtoCode(source='itgi', line)` only. A miss throws
`ItgiUnmappedRtoError`; `compare.service.ts` already isolates provider failures via `Promise.allSettled`, so ITGI
is simply omitted from the comparison. No derived/guessed rows are written to the shared master tables (which are
production data). When ITGI delivers the master, `import-itgi-master.ts` backfills it — **no code change needed**.

`scripts/import-itgi-master.ts`: idempotent, source-tagged upserts (never wipes other providers' codes), importing
MMV / coverages / insurers / financiers / not-declined-TP-makes. Fuel values normalized on import
(`BATTERY`≡`Electric`, `HYBRID`≡`Hybrid Electric`). **Does not write RTO rows.**

### 3.8 Persistence

The `uniqueQuoteId` → `orderNo`/`traceNo` → `policyNumber` chain is stored on the existing proposal/policy records
so `issuePolicy`, status polling, and certificate retrieval can recover it without re-quoting. Reuses the current
repository layer.

**Decision: no Prisma migration.** The coverage/add-on name mapping is a **static map in code** (`config.ts`), not a
DB table — the vocabulary is a small fixed set (~27 exact strings) that changes only when the vendor revises its kit,
so a migration would add ceremony without benefit. MMV/financier/insurer codes reuse the existing `Provider*Code`
tables. If planning uncovers a field with nowhere to live on the current records, that is raised as a plan-time
question rather than silently adding a migration.

### 3.9 Config & registration

`env.ts` (zod, fail-fast) + `.env.example`: `ITGI_ENABLED` (default `false`), partner code/branch/sub-branch,
per-service endpoint base, policy-download Basic-auth user/pass. **Credentials env-only — never DB or code.**
`registerItgiProvider()` called from `app.ts` alongside FG/ICICI.

---

## 4. Error handling

- `assertItgiSuccess(root, context)` mirroring `assertFgSuccess` — checks `error`, `errorMessage`, **and
  `erorMessage`** (vendor typo), plus the `statusMessage` sentinel.
- Vendor faults classified into: **validation** (surface a clear field-level message), **transient**
  (retry, then the friendly retry message already used for FG), and **declined** (no-quote, not an error).
- `ItgiUnmappedRtoError` / `ItgiUnmappedMmvError` → treated as `no_quote`, so one unmapped code never breaks the
  comparison page.
- CKYC statuses surfaced faithfully: `OTPPending`, `OTPValidation-Failed`, `EXISTING RECORD`, document errors.

---

## 5. Testing strategy (TDD — tests first)

Per repo convention, **no live vendor calls**. The kit provides genuine request/response pairs, which become fixtures
(notably a real curl + live dual-`autocoverage` response for the TWP add-on case).

| Area | What is asserted |
|---|---|
| `mapper` | exact tag names/order incl. misspellings (`engineCpacity`, `regictrationCity`); 4-way registration-number split; `MM/DD/YYYY` formatting; composite `makeCode` = `{TYPE}-{MAKE}-{year}` |
| `policy-types` | each module's delta — `zcover`/`PolicyType`, TP SI=1, OD TP-policy fields, `newVehicleFlag`, break-in date+3 |
| `normalizer` | correct `autocoverage` block selected; per-cover OD/TP vs add-on `coveragePremium`; totals; rupee integers |
| `ckyc` | fetch → OTPPending → validate → re-fetch; create returning `SUCCESS` vs `EXISTING RECORD`; doc-rule failures |
| `proposal`/`payment` | `orderNo`/`traceNo` carried into payment; `policyNumber` + `P400` sentinel parsed |
| `db-code-resolver` | MMV/coverage resolution; **unmapped RTO throws and yields `no_quote`** |
| `errors` | typo'd `erorMessage` detected; transient vs validation vs declined classification |

Test DB (`tf_api_test`) required only for resolver/repository suites, as today.

---

## 6. Implementation order (for the plan)

1. `config.ts` + env wiring + capability constants (provider registers, off by default)
2. `errors.ts` + `http.ts` (transport primitives)
3. `db-code-resolver.ts` + `scripts/import-itgi-master.ts` (strict RTO)
4. `mapper.ts` + `policy-types/*` (quote path first: IDV + premium)
5. `normalizer.ts` (incl. dual-block selection)
6. `ckyc.ts`
7. `proposal.ts` → `payment.ts` (the issuance chain)
8. `policy-status.ts`, `certificate.ts`, `inspection.ts`, `renewal.ts`
9. `itgi.provider.ts` + `index.ts` + `app.ts` registration
10. OpenAPI regen only if a contract changed; then `gen:api` in tf-web
11. tf-web wiring (compare + the live `Vehicle_Second.js` page) — **separate follow-up, not this spec**

---

## 7. Known blockers (tracked, not resolved by this work)

Cannot be closed by code; needed from ITGI before anything runs live:

1. **Our `partnerCode` / `partnerBranch` / `partnerSubBranch`** (PCP + TWP) — the SOAP auth. Blocker.
2. **IP whitelisting** of our public IP. Blocker.
3. **CKYC auth method** confirmation. Blocker for issuance.
4. **RTO master** (or confirmation that `rtoCity` accepts plain city names — one sample sends `DELHI`, another
   `CHHDHAMT`). Blocker for any real quote, by design of the strict choice.
5. Basic-auth creds for policy download; UAT test data + a CKYC-resolvable test identity; PG authorization field
   semantics; error-code catalogue; whether break-in approval is email-only.

Full list and context: `tf-api/docs/itgi-integration-notes.md` §8.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Nothing live-verifiable until credentials arrive | Fixture-driven TDD from real vendor samples; provider off by default |
| Vendor tag misspellings silently "fixed" by a well-meaning edit | Explicit tests asserting the exact misspelled tag names |
| Strict RTO ⇒ zero quotes at runtime | Deliberate; fails closed as `no_quote`, never a 5xx; backfill needs no code change |
| Guessed master rows polluting production tables | Strict resolver + source-tagged idempotent upserts; no derived RTO rows |
| Dual `autocoverage` blocks mis-selected ⇒ wrong premium | Dedicated normalizer tests using the real captured response |
| Break-in cannot complete (email-only approval?) | Implement create/status; completion explicitly out of scope pending ITGI |

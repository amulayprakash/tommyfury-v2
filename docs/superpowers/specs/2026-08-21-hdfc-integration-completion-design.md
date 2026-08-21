# HDFC ERGO — completing the integration

**Date:** 2026-08-21
**Status:** approved, ready for implementation planning
**Predecessors:**
[2026-08-07-hdfc-ergo-provider-design.md](2026-08-07-hdfc-ergo-provider-design.md),
[2026-08-13-hdfc-uat-route-design.md](2026-08-13-hdfc-uat-route-design.md)

## Goal

Leave no condition in HDFC's certification pack failing for a reason of ours,
evidence every remaining one against HDFC, and wire the three kits HDFC has not
yet shipped to a seam so they go live the day credentials arrive.

## Where we start

HDFC ERGO has been live on our UAT since 2026-08-07 as the fourth motor provider
(Private Car only, behind `HDFC_ENABLED`). All eight HEI operations are
implemented, Pehchaan e-KYC is wired, and five real UAT policies were bound end
to end on 2026-08-13. `tf-api` carries 319 HDFC unit tests across 16 files;
`tf-web` carries 35 across 5. All green at the time of writing.

The certification pack is `PVTcarTestScenarios.xls` — 205 conditions across four
sheets. `npm run hdfc:scenarios` fires every one of them read-only at live UAT
through the production provider. The most recent run (2026-08-19T12:22:18.863Z,
`scripts/_hdfc-uat-scenario-results.json`):

| Sheet | Conditions | PASS | FAIL | VENDOR_DATA | BLOCKED | MANUAL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| New and Rollover | 36 | 27 | 2 | 0 | 5 | 2 |
| Long Team | 152 | 70 | 0 | 78 | 4 | 0 |
| Used Car | 12 | 0 | 0 | 10 | 2 | 0 |
| Break In | 5 | 3 | 2 | 0 | 0 | 0 |
| **All** | **205** | **100** | **4** | **88** | **11** | **2** |

This is a regression against the 2026-08-13 run recorded in
[hdfc-uat-scenario-results.md](../../../tf-api/docs/hdfc-uat-scenario-results.md),
which had 104 PASS and **zero** FAIL.

## What the kit re-read turned up

The whole `HDFC API KIT` was re-read on 2026-08-21. Three findings are not
recorded anywhere in our docs.

### 1. A live regression: `Registration_No` is now mandatory at premium time

HDFC UAT began rejecting `Policy_Details.Registration_No: null` on
CalculatePremium with *"Vehicle Registration number is mandatory"*. This is what
broke New Business (`new-rollover` #1, term 1+3) and Roll Over (#7, term 1+1) —
two of the four FAILs. Both were PASS on 2026-08-13, so the vendor changed
behaviour between the two runs.

A fix is already sitting uncommitted in the working tree
(`src/providers/hdfc/mapper/policy-details.ts`), introducing
`premiumRegistrationNo()` — the dashed plate when there is one, the literal
`"New"` when there is not — with a docblock claiming a live sweep proved null
fails while both the plate and `"New"` price identically. That claim is the
fix's whole justification and has not been re-verified since.

The other two FAILs (`break-in` #1 and #2) are bare `HDFC request failed [500]`
with no envelope — undiagnosed.

### 2. The PPT answers the break-in blocker

`Channel_Integration_Details.pptx` — never mined before — states that
`BreakIN_ID` comes from a **separate Break-In Kit**, with its own credentials,
requested from sales. It names the request tags exactly:

    "BreakIN_ID": "",                  // mandatory for break-in cases
    "BreakInStatus": "Recommended",    // mandatory for break-in cases
    "BreakinInspectionDate": "",       // dd/mm/yyyy, mandatory for break-in cases

and the response tag `BreakIN_Premium`. It also states seven rules:

1. Break-in loading is charged only past a 45-day break; otherwise it is 0.
2. If the previous policy lacked Zero Dep or RTI and those covers are opted in
   the rollover, inspection is required at booking.
3. Self-inspection waives the break-in loading.
4. The registration number must match the one the break-in ID was created on.
5. A break-in ID may only be sent once its status is `Recommended`.
6. Inspection (survey) date and status come from the break-in system.
7. A break-in ID is valid for 7 days.

**A naming discrepancy to settle, not guess at.** The PPT's third tag is
`BreakinInspectionDate` (a date). HDFC's own Postman collection sends
`BreakInInspectionFlag`. We will emit the key the collection proves and raise the
date question in the blocker pack.

### 3. HDFC does have a payment gateway, and a POSP booking path

The PPT documents an **HDFC ERGO Payment Gateway** in two parts: a Checksum
`.asmx` service, then a Make-Payment HTML POST whose fields must match the
checksum request byte for byte. The response's `TransactionNo` goes into the
proposal as `INSTRUMENT_NUMBER` (or `transactionNumber` for Optima Restore). The
gateway's own document was a kit-email attachment we do not hold.

[hdfc-integration-notes.md](../../../tf-api/docs/hdfc-integration-notes.md) §4
currently asserts the opposite — *"HDFC ships no hosted payment gateway"* — and
must be corrected.

The PPT also documents **POSP booking**: a `VC_Unique_Code` mapped through a
sales-supplied spreadsheet, sent as `POSP_CODE` in the proposal, null for
non-POS.

### 4. Two KYC gaps and a compliance rule

The KYC kit specifies four endpoints. We implement two:

| Endpoint | Purpose | Built? |
| --- | --- | --- |
| `GET /tgt/generate-token` | `api_key` → 10-minute JWT | yes |
| `GET /primary/kyc-verified` | fetch/create individual KYC | yes |
| `GET /primary/kyc-status/:kycId` | poll by KYC id | no |
| `GET /primary/kyc-status/transaction-id/:txnId` | poll by transaction id | no |
| `GET /partner/corporate/kyc` | **the entire corporate kit** | no |

The corporate kit is fully specified — three input pairs (PAN+DOI preferred,
CIN+DOI, CKYC+DOI), a mandatory `ent_type` from a ten-value enum, plus
`redirect_url` and `txn_id` — and ships working UAT test identities.

The PPT also imposes a rule we currently break: *"Partner has to show customer
details in their application from KYC response and not allow for any
modification. For any change in customer details partner has to redirect user to
KYC portal."* Our `/hdfc` proposal page lets the tester edit them freely.

## Scope

Two boundaries were set explicitly before this design was written.

**The frontend stays in the `/hdfc` harness.** HDFC is not promoted into the
live customer wizard in this piece of work. The FG/ICICI journey is untouched.

**The two under-specified kits get a seam, not a guess.** Break-In and the
payment gateway are built as real code paths behind config flags, with the
single unknown vendor call isolated in one adapter that swaps for the real
endpoint when the kit arrives. We will not infer the checksum contract or the
break-in ID-creation API from the PPT.

## Architecture

Nothing structural moves. Every workstream fits the existing provider-adapter
layering (`routes → controllers → services → providers + repositories`).

| Piece | Lands in | Why |
| --- | --- | --- |
| `Registration_No` regression | `mapper/policy-details.ts` | Fix already started there |
| Break-in tags | `mapper/req-pvtcar.ts` | Keys already exist as hardcoded `null` |
| Break-in ID creation | new `hdfc/breakin.ts` | Separate host + credentials, like Pehchaan |
| Corporate e-KYC, status polls | `hdfc/ckyc.ts` | Same token, same transport, three new routes |
| Payment gateway | new `hdfc/payment.ts` | Behind the canonical `PaymentReceipt` seam |
| Financier + alias cross-walks | `scripts/import-hdfc-master.ts`, new master tables | Mirrors `InsurerMaster` + `ProviderInsurerCode` |
| Proposal-time conditions | `scripts/hdfc-uat-issuance.ts` | It already binds behind consent gates |
| New harness inputs | `tf-web/src/features/hdfc-uat/` | Isolated, deletable |

### The break-in keys already exist

`mapper/req-pvtcar.ts` emits `POSP_CODE`, `BreakIN_ID`, `BreakInStatus` and
`BreakInInspectionFlag` as hardcoded `null` on **all three** business-type
templates (lines 31–38, 148–155, 232–239), matching HDFC's own collection
fixtures. Populating them therefore changes values only — the key-order
assertions in `__tests__/req-pvtcar.test.ts` and `__tests__/policy-details.test.ts`
do not move. This is the reason break-in is a low-risk change despite touching
the most heavily fixture-locked file in the provider.

### `BreakinAdapter` — the one new abstraction

An interface with a single method:

    createInspection(req) -> { breakInId, status, inspectionDate }

Two implementations: `StubBreakinAdapter`, which returns a tester-supplied ID and
status so the whole downstream path is exercisable today; and the real HTTP
adapter, written when the kit lands. Mapper, proposal path and harness talk to
the interface only, so the kit's arrival is a one-file change plus config.

Selected by `HDFC_BREAKIN_ENABLED`, defaulting to `false`, in the same style as
`HDFC_ENABLED`. Credentials are env-only, per the project's standing rule.

### `FinancierMaster` and `ProviderFinancierCode`

HDFC wants a numeric `FinancierCode` from its own `GENMST_FINANCIER` master
(65k rows in `PrivateCarMasterData.xls`); the canonical request carries only a
financier *name*. There is no canonical financier master to hang a cross-walk
off, which is why the field has always been sent as `null`.

Two new tables mirroring the proven insurer pattern exactly — a canonical
`FinancierMaster` and a source-tagged `ProviderFinancierCode` keyed
`@@unique([providerSlug, financierId])`. Populated by the existing
`db:import:hdfc` run, idempotent and upsert-only like every other import.

## Workstreams

Eight, ordered so each is independently shippable and the vendor-facing ones
start early enough to leave HDFC time to respond.

### A — Fix the four live failures

Finish and verify the `Registration_No` fix. Its docblock asserts a live sweep
(null fails, plate and `"New"` price identically to the rupee); that sweep is
re-run before the fix is trusted, because the whole justification rests on it.

Diagnose the two break-in `500`s properly rather than writing them off as vendor
noise. A bare 500 with no envelope is the exact shape `carriesHdfcEnvelope()` was
written to fail closed on, so the first question is whether we are sending
something malformed on the break-in path.

*Closes 4 conditions.*

### B — Finish Pehchaan

Build `/primary/kyc-status/:kycId`, `/primary/kyc-status/transaction-id/:txnId`
and the corporate kit at `/partner/corporate/kyc`. All three are fully specified
and immediately testable against live UAT with the kit's own test identities.

Note the standing caveat from 2026-08-13: UAT appears to return identities from a
fixed pool rather than verifying the PAN submitted, and `mobile`/`email` come
back empty. Tests assert our normalization, not HDFC's identity data.

*Enables the 3 corporate conditions, jointly with D.*

### C — Break-In seam

Canonical contract gains break-in inputs. Mapper populates the three existing
`null` keys on both quote and proposal. Normalizer reads `BreakIN_Premium`.
`BreakinAdapter` isolates ID creation. The seven PPT rules become ours to
enforce — notably the 45-day loading threshold, the 7-day ID validity, and the
plate-match requirement, all of which are cheap to check before we call HDFC and
expensive to discover afterwards.

*Unlocks roughly 11 conditions once the kit lands; stub-provable now.*

### D — A proposal-capable certification pass

`scripts/hdfc-uat-issuance.ts` already binds real policies behind consent gates.
Extend it to the conditions observable only at `CreateProposal`: chassis
17-digit, risk start date, corporate customer type, financier. Capture the two
MANUAL rows as UI evidence — `IdvControl` and the accessory sum-insured fields
are already built in the harness, so those close as evidence, not code.

**`scripts/hdfc-uat-scenarios.ts` stays read-only and is not changed.** It fires
at a shared sandbox; binding policies from a 205-row sweep is not ours to do.

Gold plan's 4 rows stay BLOCKED. Nobody — not HDFC's master workbook, not the
live cover-group response — can name cover `N161521G0020`, and selling a plan
containing an unnamed cover would be worse than not selling it.

*Closes 9 conditions (7 of 11 BLOCKED, both MANUAL).*

### E — Payment gateway seam

Checksum then Make-Payment, behind the existing canonical `PaymentReceipt` seam
so issuance itself is unchanged. The unknown contract sits in one adapter.
Correct §4 of the integration notes.

### F — Repair the master cross-walk

Three fixes in `scripts/import-hdfc-master.ts`:

- **Make aliases.** `MARUTI` → `MARUTI SUZUKI`, `TOYOTA KIRLOSKAR` → `TOYOTA`,
  the stray `MAHINDRA.`, and HDFC's self-duplicating `AUDI A4` / `AUDI A8`.
  Recovers roughly 85 of 767 unmatched make/model/fuel groups — and takes HDFC's
  own `UAT Test Model` sheet from **10 of 27 codes resolving to roughly 20**.
  (Of the 17 that do not resolve today: 12 sit in groups with no canonical match,
  and 10 of those 12 are precisely these spelling mismatches. The remaining 5 are
  1 code absent from HDFC's own `Model_Master` and 4 harmless trim-selection
  differences, neither of which an alias fixes.) That is the difference between
  certifying on HDFC's named test vehicles and
  certifying on a substitute (the harness currently uses a Hyundai Aura because
  no Maruti Swift row carries an HDFC code at all).
- **Insurer aliases.** Takes previous-insurer from 8 of 38 to most of 38, which
  is what makes a rollover proposal carry a real
  `PreviousPolicy_CorporateCustomerId_Mandatary` instead of `null`.
- **Financier master.** As described under Architecture.

*Supplies the `FinancierCode` that condition #20 needs — the condition itself is
counted under D, which is where it is observed. Closes blocker #8.*

### G — Extend the `/hdfc` harness

Break-in inputs (ID, status, inspection date), corporate customer type and its
KYC path, a financier picker backed by the new master, POSP code, and the
multi-year standalone-OD term.

Plus the compliance fix: customer details returned by KYC are rendered
**non-editable**, with an explicit "change these" affordance that routes back to
the KYC portal. This is a stated HDFC sign-off requirement we currently fail.

### H — Refresh the vendor pack

[hdfc-vendor-blockers.md](../../../tf-api/docs/hdfc-vendor-blockers.md) re-issued
with its existing 10 items re-evidenced against the current run, plus five new
ones: the `Registration_No` regression, a Break-In Kit request, a
payment-gateway document request, the `BreakInInspectionFlag` versus
`BreakinInspectionDate` naming question, and corporate-KYC confirmation.

## Where this lands

| | Now | After | After the Break-In Kit |
| --- | ---: | ---: | ---: |
| PASS | 100 | 113 | ~124 |
| FAIL (ours) | 4 | **0** | **0** |
| Attributable to HDFC | 99 | 92 | 81 |

**92 conditions cannot be made to pass by writing code**, and the plan does not
pretend otherwise. The 2OD-3TP term is refused by HDFC's own rules engine despite
their data dictionary documenting it under PRODUCT_CODE 2311; a two-year
standalone OD falls in a gap between two accepted bands; Used Car returns
*"Channel Not Authorized to consume given method"*; Mercedes-Benz and every
hybrid code tried have no row in the UAT IDV master. What this work does is drive
each one to a reproducible, evidenced refusal carrying HDFC's verbatim message —
which is what actually moves them, through workstream H.

## Testing

Test-driven throughout, against the existing fixture discipline.

- **Key-order assertions stay locked** to the collection fixtures. Break-in and
  POSP change values only, never key sets.
- **No golden fixture changes shape without a live UAT call proving it.** The
  response fixtures were invented once already, and every OD and TP premium read
  zero until that was caught. Captures, not guesses.
- **New vendor behaviour gets a real capture before a test asserts it.** This
  applies especially to the `Registration_No` sweep in workstream A and to
  corporate e-KYC in B.
- **Stubbed adapters are unit-tested end to end.** Break-In and the payment
  gateway must be provably correct up to the vendor boundary, so that when the
  kits arrive the only untested surface is the HTTP call itself.
- `npm test` in both projects stays green at every step. After any contract
  change: `npm run openapi:gen` in `tf-api`, then `npm run gen:api` in `tf-web`.

## Open questions for HDFC

Carried into workstream H. The existing ten from
[hdfc-vendor-blockers.md](../../../tf-api/docs/hdfc-vendor-blockers.md), plus:

11. Why did `Registration_No: null` stop being accepted at CalculatePremium
    between 13/08 and 19/08, and is `"New"` the correct value for a vehicle with
    no plate yet?
12. Please send the **Break-In Kit** and its credentials.
13. Please send the **HDFC ERGO Payment Gateway** document (checksum + make
    payment), which the channel PPT references as a kit-email attachment.
14. Is the third break-in tag `BreakInInspectionFlag` (per your Postman
    collection) or `BreakinInspectionDate` (per the channel PPT)? If the latter,
    what does the collection's flag mean?
15. Does `CreateProposal` validate `Customer_Pehchaan_id` against
    `Customer_Details`, and is a corporate proposal accepted with an individual
    Pehchaan id?

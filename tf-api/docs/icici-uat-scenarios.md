# ICICI UAT Certification Scenario Matrix — coverage detail

**Provider:** ICICI Lombard (`icici`) · 2-wheeler + 4-wheeler generic motor + commercial vehicle (PCV, exploratory)
**Environment:** UAT (`https://ilesbapigee.insurancearticlez.com`) · **Live-tested:** 2026-07-07, roster corrected + re-tested 2026-07-08, CV added 2026-07-08
**Deliverable for ICICI:** [`icici-uat-scenario-sheet.xlsx`](./icici-uat-scenario-sheet.xlsx) (their POS-header template, 3 tabs — one per line — + a Test Data tab)
**Runner:** [`scripts/icici-uat-scenarios.ts`](../scripts/icici-uat-scenarios.ts)

See also: [`icici-uat-condition-matrix.xlsx`](./icici-uat-condition-matrix.xlsx) — the
full 12-condition-per-line grid (Rollover / Breakin / Renewal / new × Third Party / Own
Damage / Comprehensive = 12 rows per line, 3 tabs) in ICICI's own category-grid
template. 2W/4W live-fired 2026-07-08 with **24/24 PASS** (18 correctly quoted, 6
correctly rejected as not-offered). CV live-fired the same day: **30/36 PASS · 1 FAIL ·
5 BLOCKED** — see [CV section](#commercial-vehicle-cv--exploratory-reduced-evidence)
below for what those mean. Quote-level only — see that sheet /
[`scripts/icici-uat-condition-matrix.ts`](../scripts/icici-uat-condition-matrix.ts) for
detail; it doesn't repeat the CKYC-blocked-proposal step since Open item 1 below already
establishes that limitation applies uniformly regardless of which condition.

This document is the working detail behind that sheet: exactly what was sent, what came
back, and what's still open. Novacred is a **broker** integration, so the sheet's POS
columns (Licence No / Certificate No / PAN No / Adhar No) are filled `NA – Broker
integration` rather than left blank.

---

## Result summary

**2W + 4W** — all 14 rows (7 scenarios × 2 lines) were fired live against ICICI UAT:

- **Quote (Save-Quote) succeeded on all 14 rows** — real `TransactionId`, real premium,
  correct `ProductCode` resolution for every business/plan/line combination.
- **Proposal reached ICICI on all 14 rows** and returned a real `PolicyReferenceId` —
  but every one was rejected with `ErrorCode 443 "KYC PENDING"` because the CKYC step
  ahead of it could not complete. See [Open item 1](#1-ckyc-needs-a-real-uat-test-identity-blocks-policyno-on-every-row).
  This is a KYC-identity limitation, not a request-format defect.
- **No payment was ever bound** — every proposal is submitted `isProposalOnly:true,
  amountCollected:0` per the agreed scope (ICICI's `/payment/initiate` is `501` on our
  side regardless; see `docs/full-flow-test-cases.md`).

So "Transaction Id" is fully populated for the ICICI sheet; "Policy Number" shows the
`PolicyReferenceId` with a note that it's blocked on CKYC, pending Open item 1.

**CV** — 6 of 7 rows quoted successfully; row 7 (add-ons on an 8-year-old vehicle)
was declined by ICICI's own rate-validation rules (a real underwriting rejection, not a
defect); all 6 successful proposals hit a **different** blocker than 2W/4W — a `401
Unauthorized` before even reaching CKYC/KYC-PENDING. See the CV section below.

---

## Test vehicles

**One vehicle only ever represents one business category.** A given vehicle's insurance
status — brand-new, an active rollover policy, a lapsed (break-in) policy, or a
same-insurer renewal — is a single real-world state; a test row for "New" and a test row
for "Rollover" must not point at the same underlying vehicle even with different plate
numbers, or the sheet reads as artificial. So New always gets a vehicle none of the
Rollover-family rows ever reuse. Reuse *within* the Rollover-family rows (rows 2,3,5,6 —
all genuinely `businessType:"rollover"`) is fine, since they're legitimately the same
category.

### 2W — real rows from ICICI's UAT MMV master (unchanged from `docs/icici-test-cases.md`)

| Role | Make (code) | Model (code) | RTO (code) |
|---|---|---|---|
| New (row 1) | TVS (39) | JUPITER (17877) | Mumbai (192) |
| Rollover — used rows 2, 6 | HERO (32) | SPLENDOR PLUS DRUM (21646) | Pune (634) |
| Rollover — used rows 4, 5 | BAJAJ (31) | PULSAR 150 (12637) | Thane (2029) |
| Rollover — used rows 3, 7 | BAJAJ (31) | PULSAR 180 (380) | Nashik (412) |

### 4W — **roster changed from `docs/icici-test-cases.md`** — see Open item 2

The V1–V4 roster documented there (Hyundai Creta, Maruti Swift VXI, Honda Amaze, Maruti
Baleno Sigma) all returned a clean, definitive `"Vehicle details not found."` when fired
live on 2026-07-07 — that roster was only ever exercised at the fixture/unit-test level
(its own header says so) and has drifted from ICICI's current UAT master. In its place we
sourced 4 codes independently confirmed live by probing ICICI's own delivered master
(`dock boyz/ICICI/UAT_MMV_Details`) at the known-good Audi V6 anchor's RTO (2125): every
Audi model tried priced fine, plus one Honda — mass-market economy models (Maruti Alto,
Hyundai i20) tried at the same RTO still returned "Vehicle details not found."

| Role | Make (code) | Model (code) | RTO (code) |
|---|---|---|---|
| New (row 1) | AUDI (13) | V6 (2046) | Dharampur, Gujarat (2125) |
| Rollover — used rows 2, 5 | HONDA (7) | CIVIC 1.8 MT (2457) | Dharampur, Gujarat (2125) |
| Rollover — used rows 3, 6 | AUDI (13) | AUDI Q7 (2908) | Dharampur, Gujarat (2125) |
| Rollover — used rows 4, 7 | AUDI (13) | A6 2.8 FSI (12197) | Dharampur, Gujarat (2125) |

None of these are typical mass-market demo cars, but all 4 are independently confirmed
live against current UAT data during this session — see Open item 2 if ICICI can confirm
current codes for popular economy/mid-segment models instead.

Registration numbers are synthetic, series-valid for the chosen RTO (ICICI's Save-Quote
treats `RegistrationNo` as informational, not a lookup key — the RTO **code** drives
pricing). Proposer/address test data reused from `docs/full-flow-test-cases.md` §D
(`Ravi Kumar`, PAN `ABCPK1234F`, DOB `1990-05-15`).

### CV — only one confirmed vehicle exists, see the CV section below

Unlike 2W/4W, ICICI has never delivered a CV master at all, so there's no roster to pick
from — only ICICI's own documented sample vehicle (Make 99 / Model 15425 / RTO 3501,
PCV). Full detail, including why it's used for every row and what that means for
coverage, is in [Commercial Vehicle (CV) — exploratory, reduced evidence](#commercial-vehicle-cv--exploratory-reduced-evidence).

---

## Scenario matrix — 2W (product line `tw`)

| # | Scenario | Txn Type | Vehicle | Reg No | Product Code | Gross Premium (UAT) | Transaction Id | Policy Number |
|---|---|---|---|---|---|---|---|---|
| 1 | Policy without Add-on covers | New Business | TVS Jupiter | *(brand-new)* | 10 | ₹5,632 | `epn_6hj43wjvSWw1VQwslU` | Ref only — CKYC blocked |
| 2 | Check the policy with add-on covers | Roll Over | Hero Splendor Plus Drum | MH12XY4321 | 13 | ₹1,374 | `epn_6hjw0x2pIXJyFKCyyg` | Ref only — CKYC blocked |
| 3 | No Break-In scenario | Roll Over | Bajaj Pulsar 180 | MH15JK7788 | 13 | ₹1,883 | `epn_6hjlLkLqNCF5tH1ost` | Ref only — CKYC blocked |
| 4 | With Claim as True | Roll Over | Bajaj Pulsar 150 | MH04UV2109 | 13 | ₹1,151 | `epn_6hjz7c9Y87P8mB655S` | Ref only — CKYC blocked |
| 5 | Without claim | Roll Over | Bajaj Pulsar 150 | MH01ZW8765 | 13 | ₹1,074 | `epn_6hjlfyIrpVWPphLpxq` | Ref only — CKYC blocked |
| 6 | Break-In scenario | Roll Over | Hero Splendor Plus Drum | MH12XY9876 | 13 | ₹1,081 | `epn_6hjt2FdU0WJUcb4VhD` | Ref only — CKYC blocked |
| 7 | Selection of Add-on Covers with vehicle age | Roll Over | Bajaj Pulsar 180 | MH15JK2018 | 13 | ₹1,883 | `epn_6hjD4bUrDCCs0xN4WA` | Ref only — CKYC blocked |

(Row 5 was re-run on Bajaj Pulsar 150 instead of TVS Jupiter — Jupiter is now reserved
exclusively for row 1/New, per the "one vehicle, one category" rule above.)

**Row detail:**
1. No previous policy, no add-ons, `RegistrationNo` sent empty (no plate at quote time).
2. `AddOns: [RSA, RTI, EP, LDBP, KP, TP, DA, CS]` + Voluntary Deductible `VD-2500`.
   **`zeroDep` intentionally excluded** — see [Open item 3](#3-zero-dep-declined-for-hero-splendor-plus-drum).
3. Previous policy ~20 days from expiry (not lapsed). `IsInspectionRequire` returned `false`, as expected.
4. `PreviousPolicyClaimed:true`, NCB reset to `0`.
5. `PreviousPolicyClaimed:false`, NCB carried at `20`.
6. Previous policy lapsed 45 days ago. `IsInspectionRequire` returned **`false`** —
   see [Open item 4](#4-break-in-inspection-trigger-differed-between-lines).
7. Vehicle registered 2018-06-01 (~8yr old), `AddOns: [ZD, EP, RTI]` — **all priced
   successfully**, ₹1,883 gross. No age cutoff observed up to 8 years on this vehicle.

## Scenario matrix — 4W (product line `fw`)

| # | Scenario | Txn Type | Vehicle | Reg No | Product Code | Gross Premium (UAT) | Transaction Id | Policy Number |
|---|---|---|---|---|---|---|---|---|
| 1 | Policy without Add-on covers | New Business | Audi V6 | *(brand-new)* | 20 | ₹110,467 | `epn_6hj26DoTFchBqquxPo` | Ref only — CKYC blocked |
| 2 | Check the policy with add-on covers | Roll Over | Honda Civic 1.8 MT | GJ07AB1234 | 21 | ₹25,602 | `epn_6hjHXcmH7oILJsYDHl` | Ref only — CKYC blocked |
| 3 | No Break-In scenario | Roll Over | Audi Q7 | GJ07AB2345 | 21 | ₹47,362 | `epn_6hj253bUGVzhjJApSS` | Ref only — CKYC blocked |
| 4 | With Claim as True | Roll Over | Audi A6 2.8 FSI | GJ07AB3456 | 21 | ₹48,828 | `epn_6hjwW7keDBoq11qJsj` | Ref only — CKYC blocked |
| 5 | Without claim | Roll Over | Honda Civic 1.8 MT | GJ07AB4567 | 21 | ₹15,732 | `epn_6hjaGKw13uPoQAmNKt` | Ref only — CKYC blocked |
| 6 | Break-In scenario | Roll Over | Audi Q7 | GJ07AB5678 | 21 | ₹47,804 | `epn_6hjh8XPxSbXSCGmIEE` | Ref only — CKYC blocked |
| 7 | Selection of Add-on Covers with vehicle age | Roll Over | Audi A6 2.8 FSI | GJ07AB2018 | 21 | ₹32,378 | `epn_6hjsFUd7SBbGpGAFVN` | Ref only — CKYC blocked |

**Row detail:** same pattern as 2W — Audi V6 is reserved exclusively for row 1/New; rows
2-7 rotate through the other 3 confirmed vehicles (Civic, Q7, A6), never reusing V6. Row
2's `AddOns: [ZD, RSA, EP, KP, GC, LOPB, CS, TP]` (all 8 ICICI-supported 4W covers) +
`VD-2500` on Honda Civic — **all priced successfully**, unlike the 2W Zero-Dep case. Row
6's previous policy lapsed 45 days ago and `IsInspectionRequire` returned **`true`** on
Audi Q7 — the expected break-in signal (contrast with 2W row 6, item 4 below — this is a
line-level difference, reproduced now on a second, different 4W vehicle). Row 7 (2018
reg, ~8yr, Audi A6) priced `[ZD, EP, TP]` at ₹32,378 with no rejection — zeroDep isn't
age-gated on this vehicle either, generalizing the row-7 finding beyond just Audi V6.

---

## Commercial Vehicle (CV) — exploratory, reduced evidence

CV is **not yet advertised** as a supported category in our own API
(`ICICI_CAPABILITIES` in `src/providers/icici/config.ts` intentionally excludes
`commercial`/`newCommercial` pending real master data) — the product-code and payload
logic exists and is tested here directly against the provider, ahead of turning it on
for real traffic. Treat this section as evidence that the CV code path works, not as a
certified customer-facing capability yet.

**Why reduced evidence, not a full 7-row demonstration like 2W/4W:** ICICI has never
delivered a CV make/model/RTO master CSV (`dock boyz/ICICI/` only has 2W/4W master
files). The one CV vehicle used below is ICICI's **own documented Save-Quote sample**
(`dock boyz/ICICI/cv_out.txt` §C — a real recorded example, not fabricated; its
`TransactionId` chains directly into their own Proposal sample too), re-confirmed live
2026-07-08: MakeCode `99` / ModelCode `15425` / RTOCode `3501` (Pune), PCV class,
ProductCode `41` (Roll Over Comprehensive). Since every row below reuses this vehicle,
every row is genuinely the **same** category (Roll Over) per the "one vehicle, one
category" rule — row 1 is relabeled Roll Over instead of New Business (no second
confirmed vehicle exists to test New without violating that rule).

| # | Scenario | Txn Type | Vehicle | Reg No | Product Code | Gross Premium (UAT) | Transaction Id | Policy Number |
|---|---|---|---|---|---|---|---|---|
| 1 | Policy without Add-on covers | Roll Over | ICICI Sample PCV | MH12CV0001 | 41 | ₹38,310 | `epn_6hjjES4zk56mHXrB0M` | See CV proposal note below |
| 2 | Check the policy with add-on covers | Roll Over | ICICI Sample PCV | MH12CV0002 | 41 | ₹53,953 | `epn_6hjBrFSDeJaB3Y68t9` | See CV proposal note below |
| 3 | No Break-In scenario | Roll Over | ICICI Sample PCV | MH12CV0003 | 41 | ₹38,310 | `epn_6hjhh1CV0uaeBzY8Mu` | See CV proposal note below |
| 4 | With Claim as True | Roll Over | ICICI Sample PCV | MH12CV0004 | 41 | ₹44,743 | `epn_6hjAK6yhelXgA53naV` | See CV proposal note below |
| 5 | Without claim | Roll Over | ICICI Sample PCV | MH12CV0005 | 41 | ₹38,310 | `epn_6hjvrFMTYk21NgY8ld` | See CV proposal note below |
| 6 | Break-In scenario | Roll Over | ICICI Sample PCV | MH12CV0006 | 41 | ₹38,751 | `epn_6hjFroQUyDbHH9I6CE` | See CV proposal note below |
| 7 | Selection of Add-on Covers with vehicle age | Roll Over | ICICI Sample PCV | MH12CV0007 | 41 | **Declined** | — | n/a |

**Row detail:**
1-5. `AddOns` per row: none / `[RSA, ZD, EP, RTI, CS, GC, LDBP]` + `VD-2500` (row 2,
   all 7 ICICI-supported CV covers — all priced) / none / claim=true,NCB→0 / claim=false,
   NCB=20 — same pattern as 2W/4W, just all on the one confirmed vehicle.
6. Previous policy lapsed 45 days ago → `IsInspectionRequire` returned **`true`** — a
   third independent confirmation of the break-in signal (see Open item 4), this time on
   CV.
7. Vehicle registered 2018-06-01 (~8yr) with `[ZD, EP, RTI]` requested → **declined**:
   `"The Loading or Discount on Basic OD Rate does not lie between the limits set in the
   Rate Validation Master, hence the policy is declined"` — a genuine ICICI underwriting
   rejection (rate-validation rule tripped by this age+addon combination), not a request
   defect. Contrast with 2W/4W row 7, where the same test passed cleanly.

**CV proposal note:** all 6 successful CV quotes hit `401 Unauthorized —
"Invalid Authorization Credentials to access an API - Authentication failure"` on the
**proposal** call specifically — reproducible on every attempt, using the same token
that had just priced the quote seconds earlier. This is a **different failure than the
2W/4W CKYC-PENDING (443)** — it never gets far enough to check KYC at all. Most likely
explanation: CV/commercial may be a separate product subscription on ICICI's side (like
FG's per-product WSO2 subscriptions) that our current UAT credentials aren't
provisioned for beyond Save-Quote. **Ask ICICI** to confirm whether CV proposal needs
separate credentials/scope from CV quote.

Two more things confirmed while sourcing this vehicle (see
`scripts/icici-uat-scenarios.ts` and `scripts/icici-uat-condition-matrix.ts` for detail):
the same vehicle requested as **GCV** instead of PCV returns `"Vehicle make not
found"` — CV codes look registered per exact product class, not shared across classes;
and **Third Party** (ProductCode 42) for this exact vehicle also returns `"Vehicle make
not found"` even though Comprehensive (41) prices fine — suggesting CV vehicle
provisioning may be per-**product-code**, not just per-class. Both are documented in the
condition-matrix CV tab.

---

## Open items to confirm with ICICI

### 1. CKYC needs a real UAT test identity — blocks PolicyNo on every row
Every CKYC call (`POST /generic/common/ckyc/generic/ckyc`) using synthetic test data —
our own PAN (`ABCPK1234F`) and ICICI's own documented sample Aadhaar
(`987654398765`, from their `KYC_Generic.pdf`) — returned `StatusCode 451`:
`"Failed: - Request failed, please retry with alternate KYC options."` /
`"Failed:No record found, please retry with alternate KYC options."` This looks like a
genuine registry lookup (real CKYC/Aadhaar database), not a request-validation error —
neither doc example nor a fabricated PAN resolves. **Ask ICICI**: does their UAT
environment provide dummy/pre-seeded PAN or Aadhaar identities for partner
certification testing, so a full proposal → `PolicyNo` can be demonstrated end-to-end
without using a real person's identity? Until then, every row's evidence stops at a
real `TransactionId` + `PolicyReferenceId`, with the proposal correctly rejected as
`KYC PENDING` rather than mis-issued.

(The response also carries a hosted `OVDLink` — ICICI's own fallback to the manual
document-upload flow, e.g.
`https://bancaassure.insurancearticlez.com/bancakrgapp/KycDocUpload/#/?id=...` — which
is the real-world path a customer takes when auto-KYC fails. Not exercised here since it
needs an actual ID document image.)

**Testing with a real identity (UAT only): `scripts/icici-uat-kyc-probe.ts`.** Since the
UAT CKYC lookup behaves like a real registry search, a real person's PAN (your own or a
consenting teammate's — the lookup returns their real name/address, so never a random
third party's) is expected to resolve where synthetic ones cannot. The probe chains
quote → KYC → proposal(₹0, proposal-only) → status in one command and masks identity
values in output:

```bash
npx tsx --env-file=.env scripts/icici-uat-kyc-probe.ts --pan=AAAAA9999A --dob=1990-05-15   # real-PAN CKYC
npx tsx --env-file=.env scripts/icici-uat-kyc-probe.ts --ovd --id-file=pan.jpg --addr-file=aadhaar.jpg --dob=... --name="..."  # OVD with real scans
```

Live-verified 2026-07-14: the probe reproduces the synthetic-PAN `451` and the proposal
`443 KYC PENDING`; OVD upload with a blank dummy image is auto-rejected in real time
(`"Kyc Failed.. Re-upload Documents"`, POI/POA both classified empty, `IsManualQc:false`)
— so ICICI runs automatic document recognition on UAT and a real document scan is
required. A failed CKYC prints the transaction's hosted `OVDLink`; after uploading a real
document there, resume the same transaction with
`--transaction-id=<epn_...> --tag=<tag> --skip-kyc` to fire the proposal.

### 2. 4W roster in `docs/icici-test-cases.md` has drifted from current UAT master
V1–V4 (Hyundai Creta 8/10184, Maruti Swift VXI 10/22193, Honda Amaze 7/21899, Maruti
Baleno Sigma 10/23078) all returned `"Vehicle details not found."` live on 2026-07-07 —
a clean HTTP-200 business rejection, not a gateway error. That roster was recorded from
ICICI's UAT MMV master CSV but was **never fired live** before now (its own doc header
says so). **Partially resolved for this sheet**: probing other rows from ICICI's own
delivered master (`dock boyz/ICICI/UAT_MMV_Details`) at RTO 2125 found 4 working
codes — every Audi model tried (V6, Q7, A6 2.8 FSI, RS4) priced fine, plus Honda Civic
1.8 MT — enough to give every business category its own distinct vehicle (see Test
vehicles above). But two more mass-market economy candidates tried the same way (Maruti
Alto VXI 10/22101, Hyundai i20 GL Asta 8/21713) also came back "not found," so UAT
coverage still looks concentrated in premium/Audi segment rather than economy models.
**Action for our side**: re-run `scripts/validate-icici-codes.ts --what=mmv --line=fw
--fallback` once the DB is up, to refresh `ProviderMmvCode` against current UAT and find
working replacements that are more representative of a typical retail customer vehicle.

### 3. Zero Dep declined for Hero Splendor Plus Drum
2W row 2's quote failed with `"Error in Calculate: UW Service Messages => UW status is
DECLINE Base Rate not found for ZeroDepreciation"` when `zeroDep` was requested for
this specific vehicle (fixed by dropping `zeroDep` from that row's add-on set — see the
`AddOns` list above). This is **not age-related** — the same `zeroDep` flag priced fine
on a Bajaj Pulsar 180 at both 2021 and 2018 registration dates (row 7). It looks like a
per-model rating-table gap in ICICI's UAT specifically for Hero Splendor Plus Drum.
**Ask ICICI** to confirm whether Zero Dep is genuinely unavailable for this model, or
whether the UAT rating table is missing a base rate that exists in production.

### 4. Break-in inspection trigger differed between lines
Both lines used an identical setup for row 6 (previous policy expired 45 days ago,
`PreviousPolicyExpiryDate` in the past). **4W returned `IsInspectionRequire:true`**
(the expected break-in signal). **2W returned `IsInspectionRequire:false`** — no
inspection flagged despite the same 45-day lapse. This was reproducible across two
separate runs. **Ask ICICI**: does the break-in/inspection threshold (days lapsed) or
policy differ between 2W and 4W? Our current code applies the same rule to both lines
(`src/providers/icici/icici.provider.ts` — inspection-required is read directly off
ICICI's own response, not computed locally, so this is purely ICICI-side behavior).

### 5. Transient gateway errors during the test window
Several calls hit an HTTP-200 response wrapping an upstream 502/503/504 HTML page in
`ErrorMessage` (e.g. `"<html><head><title>502 Bad Gateway</title>..."`) — most visibly
three consecutive failures (502 → 503 → 504) on the 4W anchor probe before it
eventually succeeded. `scripts/icici-uat-scenarios.ts` now retries on this pattern
specifically (see `withRetry`/`isTransientIciciError`), since these aren't caught by
the shared transport's normal 5xx-status retry (the outer HTTP status is 200; the 5xx
is nested one level down in the JSON body). Purely an infra note for ICICI, not
something on our side to fix.

### 6. Commercial Vehicle (CV): no master data, proposal 401, per-code vehicle provisioning
Three separate CV-specific gaps, all needing ICICI's input before CV can move past
exploratory testing:
- **No CV make/model/RTO master ever delivered** (`dock boyz/ICICI/` has only 2W/4W
  CSVs). We're testing against ICICI's own documented sample vehicle (see CV section
  above) rather than a real roster. **Ask ICICI** for the CV master CSV(s), the same way
  the 2W/4W ones were provided.
- **CV proposal returns `401 Unauthorized`** on every attempt, immediately after the
  same credentials successfully priced a quote seconds earlier — never reaches the
  CKYC/KYC-PENDING stage 2W/4W hit. **Ask ICICI** whether CV/commercial requires a
  separate product subscription or credential scope beyond quote.
- **CV vehicle provisioning looks narrower than 2W/4W**: the one confirmed vehicle
  (Make 99/Model 15425) prices under ProductCode 41 (PCV Comprehensive) but returns
  `"Vehicle make not found"` for ProductCode 42 (PCV Third Party, same make/model/RTO)
  and for GCV classification. **Ask ICICI** whether CV vehicles are provisioned per
  exact product code rather than per class/model — if so, testing the other 11 CV grid
  cells will need per-cell confirmation from ICICI, not just per-vehicle.

---

## Bugs fixed during this exercise

Both are the same root cause hitting two different fields: ICICI's proposal endpoint
binds several optional fields to **non-nullable** .NET value types server-side
(`System.DateTime`, `System.Int32`). Sending JSON `null` for an omitted optional field
doesn't leave that field empty — it 400s the **entire** proposal request, with the
`.NET` model binder's error cascading into a generic `"request field is required"` on
top of the real field-specific error. Both were fixed the same way: omit the key from
the payload entirely when the value is absent, instead of sending `null`.

**`OdometerCaptureDate`** — found via direct-provider testing 2026-07-07.
`src/providers/icici/mapper.ts`'s `buildProposalPayload` sent
`OdometerCaptureDate: req.odometerCaptureDate ?? null`:
```
"$.OdometerCaptureDate": ["The JSON value could not be converted to System.DateTime..."]
```
`tf-web`'s proposal flow never populates `odometerReading`/`odometerCaptureDate` at all
(only appears in generated OpenAPI type bindings, not in any page/form code), so every
real customer proposal to ICICI hit this exact 400 before the fix.

**`NomineeAge`** — found 2026-07-09 while verifying through the real backend (see
below); the direct-provider scripts never surfaced it because they always happened to
supply a nominee. Same file sent `NomineeAge: req.nomineeAge ?? null`:
```
"$.NomineeAge": ["The JSON value could not be converted to System.Int32..."]
```
`tf-web`'s proposal form lists nominee as **optional** (`docs/full-flow-test-cases.md`
§D: "Nominee (optional)"), so any real customer who skips that field hits this exact
400 too — this was a live, unnoticed bug identical in shape to the first one.

Neither had an existing test pinning the old (broken) behavior.

---

## Verified through the real backend, not just the ICICI provider directly

Everything above was captured by calling `IciciProvider` directly from a script
(`passthroughCodeResolver`, no DB) — deliberately, to isolate ICICI's own behavior from
our DB cross-walk's accuracy. That leaves an open question: does going through the
*real* stack (Express routes → services → `dbCodeResolver` → real DB cross-walk) change
anything? Re-verified live 2026-07-09 by firing the same 7 scenarios × 2 lines at
`POST /api/v1/icici/motor/quote` and `.../full-quote` on a locally running `npm run dev`
instance (DB up, FG+ICICI master already imported) instead of calling the provider
class in-process.

**Result: identical outcome.** All 13 of 14 rows quoted successfully (real
`TransactionId`, real premium, via the real DB → `dbCodeResolver` → ICICI path — the
14th, `FW #1`, is the DB cross-walk gap covered below) and every full-quote hit the same
`ErrorCode 443` block as the direct-provider run — confirming the CKYC blocker (Open
item 1) is genuinely ICICI-side, not an artifact of bypassing the DB. The `NomineeAge`
bug above was actually *found* during this pass (the HTTP test body happened to omit
nominee fields, unlike the direct-provider scripts) and confirmed fixed by re-running
afterward — every row below already reflects the fixed code.

### 2W (`tw`) — via `POST /api/v1/icici/motor/quote` + `.../full-quote`

| # | Scenario | Vehicle | Reg No | RTO | Gross Premium | Transaction Id | Policy Number |
|---|---|---|---|---|---|---|---|
| 1 | Policy without Add-on covers | TVS Jupiter | *(brand-new)* | MH01 | ₹5,632 | `epn_6hkqY7uauQIUwFy8aq` | Ref only — CKYC blocked |
| 2 | Check the policy with add-on covers | Hero Splendor Plus Drum | MH99BK0002 | MH12 | ₹1,387 | `epn_6hk7lThNcFtbbS9J3A` | Ref only — CKYC blocked |
| 3 | No Break-In scenario | Bajaj Pulsar 180 | MH99BK0003 | MH15 | ₹1,883 | `epn_6hk7fDSSyYtAI2Hmt0` | Ref only — CKYC blocked |
| 4 | With Claim as True | Hero Splendor Plus Drum | MH99BK0004 | MH04 | ₹1,154 | `epn_6hknlN4ezhPKlpLS74` | Ref only — CKYC blocked |
| 5 | Without claim | Hero Splendor Plus Drum | MH99BK0005 | MH12 | ₹1,081 | `epn_6hkygKNF3UteVW9Kn7` | Ref only — CKYC blocked |
| 6 | Break-In scenario | Bajaj Pulsar 150 | MH99BK0006 | MH12 | ₹1,077 | `epn_6hkV9TIcugwIjPc9db` | Ref only — CKYC blocked |
| 7 | Selection of Add-on Covers with vehicle age | Bajaj Pulsar 180 | MH99BK0007 | MH15 | ₹1,883 | `epn_6hkF8nJjL5s0lxmRl1` | Ref only — CKYC blocked |

### 4W (`fw`) — via `POST /api/v1/icici/motor/quote` + `.../full-quote`

| # | Scenario | Vehicle | Reg No | RTO | Gross Premium | Transaction Id | Policy Number |
|---|---|---|---|---|---|---|---|
| 1 | Policy without Add-on covers | Audi Q3 *(unverified DB candidate)* | *(brand-new)* | MH01 | — | — | **404** — `ICICI vehicle-code mapping for AUDI Q3 not found` (DB cross-walk gap, see below) |
| 2 | Check the policy with add-on covers | Audi Q7 | MH99BK0002 | MH12 | ₹48,466 | `epn_6hk5r7QDh6oMcQoHav` | Ref only — CKYC blocked |
| 3 | No Break-In scenario | Audi A6 2.8 FSI | MH99BK0003 | MH15 | ₹38,951 | `epn_6hkn2naDV8aWB1ea6F` | Ref only — CKYC blocked |
| 4 | With Claim as True | Audi Q7 | MH99BK0004 | MH04 | ₹60,043 | `epn_6hkY28Spmq6U6R587z` | Ref only — CKYC blocked |
| 5 | Without claim | Audi Q7 | MH99BK0005 | MH12 | ₹48,466 | `epn_6hkBosQyaMFo0hLgsA` | Ref only — CKYC blocked |
| 6 | Break-In scenario | Audi A6 2.8 FSI | MH99BK0006 | MH12 | ₹40,252 | `epn_6hkapLuWPwbC0X8Rz8` | Ref only — blocked (different error, see below) |
| 7 | Selection of Add-on Covers with vehicle age | Audi A6 2.8 FSI | MH99BK0007 | MH15 | ₹32,378 | `epn_6hkF3PPINahhF90oXc` | Ref only — CKYC blocked |

"Policy Number" reads exactly as it does on the direct-provider tables: the proposal's
`PolicyReferenceId` (== the `TransactionId` — ICICI echoes it back on a rejected
proposal, see the "why Policy Number = Transaction Id" discussion earlier in this
session) with `PolicyNo` itself `null`, since every proposal is blocked before ICICI
ever issues a real policy number.

Three findings beyond confirming the CKYC blocker:
- **Chassis number validation**: ICICI's proposal rejected a short synthetic chassis
  number for a New-business vehicle with `"Chassis Number should be minimum 17 digits
  for new vehicle"` — a real, sensible ICICI validation rule (worth matching in any
  frontend chassis-number field validation), not a defect. (Fixed in the test data
  before capturing the table above — TW #1's chassis number is 21 characters.)
- **DB cross-walk gap confirmed directly (FW #1)**: Audi V6 (the vehicle proven to work
  calling ICICI directly) has **no row at all** in `ProviderMmvCode` for ICICI — a real
  customer requesting this exact car through our actual app would get a 404 `NOT_FOUND`
  from our own resolver before ever reaching ICICI. A second candidate tried in its
  place (Audi Q3, shown above) hit the identical gap. Audi Q7 and Audi A6 2.8 FSI, by
  contrast, **are** in the DB cross-walk and priced correctly end-to-end all 6 rows they
  were used for. None of the DB's ICICI rows have ever been run through
  `validate-icici-codes.ts` (`verifiedAt` is null on all of them), so this DB's
  cross-walk coverage vs. accuracy is still largely unaudited — see Open item 2.
- **A second, distinct 443 error variant (FW #6)**: instead of `"KYC PENDING"`, this row
  returned `"Proposal creation failed. Have not received quote request with
  isMultiQuote = FALSE."` — still `ErrorCode 443`, still blocked before issuing a policy,
  but a different message. This row also needed several transient-gateway retries before
  succeeding, so the most likely explanation is a session/state hiccup on ICICI's side
  from repeated attempts against the same `TransactionId` during a rough patch for their
  UAT gateway (see Open item 5) rather than a new category of blocker — but it's
  reported here verbatim rather than folded into "KYC PENDING" since it wasn't verified
  as the identical root cause.

CV wasn't re-fired here since it never leaves our own service — `POST
/api/v1/icici/motor/commercial/quote` returned `422 PROVIDER_CAPABILITY_ERROR`
(`Provider "icici" does not support category "commercial"`), confirming ICICI's
capability gate rejects it before any network call, exactly as designed.

---

## Runbook

```bash
cd tf-api
# No DB/Prisma dependency — only ICICI_LOGIN/ICICI_PASSWORD (+ optional ICICI_AES_KEY)
# need to be set in .env. Uses real ICICI UAT codes directly (passthroughCodeResolver),
# not our DB cross-walk, so results don't depend on that cross-walk's accuracy.

npx tsx --env-file=.env scripts/icici-uat-scenarios.ts --dry-run          # payload + product-code sanity check, no network
npx tsx --env-file=.env scripts/icici-uat-scenarios.ts --line=all         # full live run, 2W + 4W + CV
npx tsx --env-file=.env scripts/icici-uat-scenarios.ts --line=fw --rows=6 # re-run a single row
npx tsx --env-file=.env scripts/icici-uat-scenarios.ts --regen            # rebuild the xlsx from the last saved run, no live calls
```

Flags: `--line=fw|tw|cv|both|all` (`both` = 2W+4W only, matching earlier runs; `all` also
includes CV; default `both`), `--dry-run`, `--rows=<csv of Sr.No>`, `--rps=<N>` (default
2), `--regen`. Writes `scripts/_icici-uat-scenario-results.json` (raw per-row
request/response) and regenerates `docs/icici-uat-scenario-sheet.xlsx`. **Note:** each
run only regenerates the xlsx from the lines it fired — use `--line=all` (not separate
`--line=fw` / `--line=tw` / `--line=cv` runs) to get one consolidated file with all tabs.

## Caveats carried into the ICICI-facing sheet

- Every proposal is `isProposalOnly:true, amountCollected:0` — payment is never bound.
  ICICI's hosted `PaymentLink` (when returned) and `/payment/initiate` (`501` on our
  side) are both out of scope for this exercise, matching `docs/full-flow-test-cases.md`.
- "Policy Number" reads as a `PolicyReferenceId` pending CKYC (Open item 1), not an
  issued `PolicyNo` — every row is genuinely blocked on the same external dependency,
  not a per-row defect. (CV rows never even reach that stage — see the CV proposal
  401 note, Open item 6.)
- POS header columns (Licence No / Certificate No / PAN No / Adhar No) are marked
  `NA – Broker integration` — Novacred is a broker integration, these fields don't apply.
- CV is exploratory: not yet advertised in `ICICI_CAPABILITIES`, tested against one
  ICICI-documented sample vehicle rather than a real roster, and every row is genuinely
  the same Roll Over/Comprehensive category (see the CV section) — don't read the CV
  tab as equivalent-strength evidence to the 2W/4W tabs.

# ICICI Lombard — Motor Insurance Test Cases

**Provider:** ICICI Lombard (`icici`) · generic 2W / 4W motor products
**Environment:** UAT · **Test date:** 2026-06-26 · **Owner:** QA team

## Test vehicle used

All automated cases were executed against the canonical fixture vehicle and the
recorded UAT quote response:

| Field | Value |
|---|---|
| Vehicle line | Four-wheeler (private car) — and the same combos re-run on the 2W line |
| MakeCode | `10` |
| ModelCode | `11846` (ICICI PASIA/model code) |
| RTOCode | `12621` (Kalyan, Maharashtra) |
| Registration date | 2021-06-01 |
| Returned IDV | ₹5,10,498 (min ₹4,56,761 / max ₹6,05,606) |
| Returned premium | ₹11,863 final (OD ₹6,637 + TP ₹3,416 + GST ₹1,810) |

> For UAT execution against live endpoints, the team should pick one real
> make/model/RTO per line from the ICICI UAT MMV master and record the actual
> MakeCode/ModelCode/RTOCode next to each row below.

---

## Test data — real vehicles & registration numbers

Vehicles below are **real rows from ICICI's UAT MMV master** (actual Make/Model/RTO
codes). Registration numbers are **sample inputs valid for the chosen RTO's state
series** — ICICI's Save-Quote treats `RegistrationNo` as optional (the **RTO code**
drives pricing), so reg numbers matter for proposal/issuance. Codes source:
`dock boyz/ICICI/UAT_MMV_Details/{make,rto}/*.csv`.

### Vehicle roster

| Tag | Category | Make (code) | Model (code) | Fuel | RTO (ICICI code) | Reg No |
|---|---|---|---|---|---|---|
| V1 | 4W | MARUTI (10) | SWIFT VXI (22193) | Petrol | Pune (9) | MH-12-AB-1234 |
| V2 | 4W | HYUNDAI (8) | CRETA (10184) | Petrol | Mumbai (8) | MH-01-CD-5678 |
| V3 | 4W | HONDA (7) | AMAZE 1.2 EX MT (21899) | Petrol | Thane (13) | MH-04-EF-9012 |
| V4 | 4W | MARUTI (10) | BALENO SIGMA (23078) | Petrol | Kalyan (597) | MH-05-GH-3456 |
| W1 | 2W | HERO (32) | SPLENDOR PLUS DRUM (21646) | Petrol | Pune (634) | MH-12-XY-4321 |
| W2 | 2W | TVS (39) | JUPITER (17877) | Petrol | Mumbai (192) | MH-01-ZW-8765 |
| W3 | 2W | BAJAJ (31) | PULSAR 150 (12637) | Petrol | Thane (2029) | MH-04-UV-2109 |
| W4 | 2W | BAJAJ (31) | PULSAR 180 (380) | Petrol | Nashik (412) | MH-15-JK-7788 |

### 4W — all 12 conditions (4 business × 3 plan)

`✅ PASS` = verified in code (product code + make/model/RTO + reg number on payload).
`⛔ N/A` = ICICI has no product for this combo → request is *correctly rejected*.

| # | Vehicle | Reg No | Business | Plan | ICICI Product Code | Result | Actual Premium (UAT) |
|---|---|---|---|---|---|---|---|
| 1 | V2 Hyundai Creta | MH-01-CD-5678 | new | Comprehensive | 20 | ✅ PASS | _____ |
| 2 | V2 Hyundai Creta | MH-01-CD-5678 | new | Own Damage | — | ⛔ N/A (rejected) | n/a |
| 3 | V2 Hyundai Creta | MH-01-CD-5678 | new | Third Party | — | ⛔ N/A (rejected) | n/a |
| 4 | V1 Maruti Swift | MH-12-AB-1234 | Rollover | Comprehensive | 21 | ✅ PASS | _____ |
| 5 | V1 Maruti Swift | MH-12-AB-1234 | Rollover | Own Damage | 22 | ✅ PASS | _____ |
| 6 | V1 Maruti Swift | MH-12-AB-1234 | Rollover | Third Party | 29 | ✅ PASS | _____ |
| 7 | V3 Honda Amaze | MH-04-EF-9012 | Breakin | Comprehensive | 21 (+inspection) | ✅ PASS | _____ |
| 8 | V3 Honda Amaze | MH-04-EF-9012 | Breakin | Own Damage | 22 (+inspection) | ✅ PASS | _____ |
| 9 | V3 Honda Amaze | MH-04-EF-9012 | Breakin | Third Party | 29 | ✅ PASS | _____ |
| 10 | V4 Maruti Baleno | MH-05-GH-3456 | Renewal | Comprehensive | 21 | ✅ PASS | _____ |
| 11 | V4 Maruti Baleno | MH-05-GH-3456 | Renewal | Own Damage | — | ⛔ N/A (rejected) | n/a |
| 12 | V4 Maruti Baleno | MH-05-GH-3456 | Renewal | Third Party | 29 | ✅ PASS | _____ |

### 2W — all 12 conditions (4 business × 3 plan)

| # | Vehicle | Reg No | Business | Plan | ICICI Product Code | Result | Actual Premium (UAT) |
|---|---|---|---|---|---|---|---|
| 1 | W2 TVS Jupiter | MH-01-ZW-8765 | new | Comprehensive | 10 | ✅ PASS | _____ |
| 2 | W2 TVS Jupiter | MH-01-ZW-8765 | new | Own Damage | — | ⛔ N/A (rejected) | n/a |
| 3 | W2 TVS Jupiter | MH-01-ZW-8765 | new | Third Party | — | ⛔ N/A (rejected) | n/a |
| 4 | W1 Hero Splendor | MH-12-XY-4321 | Rollover | Comprehensive | 13 | ✅ PASS | _____ |
| 5 | W1 Hero Splendor | MH-12-XY-4321 | Rollover | Own Damage | 16 | ✅ PASS | _____ |
| 6 | W1 Hero Splendor | MH-12-XY-4321 | Rollover | Third Party | 26 | ✅ PASS | _____ |
| 7 | W3 Bajaj Pulsar 150 | MH-04-UV-2109 | Breakin | Comprehensive | 13 (+inspection) | ✅ PASS | _____ |
| 8 | W3 Bajaj Pulsar 150 | MH-04-UV-2109 | Breakin | Own Damage | 16 (+inspection) | ✅ PASS | _____ |
| 9 | W3 Bajaj Pulsar 150 | MH-04-UV-2109 | Breakin | Third Party | 26 | ✅ PASS | _____ |
| 10 | W4 Bajaj Pulsar 180 | MH-15-JK-7788 | Renewal | Comprehensive | 13 | ✅ PASS | _____ |
| 11 | W4 Bajaj Pulsar 180 | MH-15-JK-7788 | Renewal | Own Damage | — | ⛔ N/A (rejected) | n/a |
| 12 | W4 Bajaj Pulsar 180 | MH-15-JK-7788 | Renewal | Third Party | 26 | ✅ PASS | _____ |

> **Why the 3 ⛔ rows per wheel?** ICICI's published Product Master (Generic 2W/4W
> PDFs) has no Brand-New-OD, Brand-New-TP, or standalone Renewal-OD product. A brand
> new vehicle is sold as a bundled/comprehensive policy; standalone OD only exists in
> the Roll-Over context. The system rejects these rather than mis-pricing them — that
> rejection *is* the expected pass for those rows. Keep them in the sheet so the team
> confirms the rejection.
>
> **Breakin** is not a separate product: it is a Roll-Over/Renewal whose vehicle has a
> policy gap, so the quote returns `IsInspectionRequire = true`. It uses the Roll-Over
> product codes; payment is gated to proposal-only until the inspection is approved
> (verified — see the break-in inspection-gate cases). Set up these vehicles with an
> **expired previous policy** to trigger the break-in path on UAT. (TP under break-in
> typically needs no inspection.)

### Add-on coverage (verified)

Driven on V1 (4W) and W1 (2W). All canonical add-ons map to ICICI vendor codes.

| Line | Vehicle | Add-ons exercised → ICICI codes | Result |
|---|---|---|---|
| 4W | V1 Maruti Swift (MH-12-AB-1234) | Zero-Dep `ZD`, RSA `RSA`, Engine `EP`, Key `KP`, Garage Cash `GC`, Loss-of-Belongings `LOPB`, Consumables `CS`, Tyre `TP`, Voluntary Deductible `VD-2500`; + PA (named/unnamed), Bi-fuel CNG kit, Anti-theft discount, PayU | ✅ PASS |
| 2W | W1 Hero Splendor (MH-12-XY-4321) | Zero-Dep `ZD`, RSA `RSA`, Return-to-Invoice `RTI`, Engine `EP`, Battery `LDBP`, Key `KP`, Tyre `TP`, Driving Accessories `DA`, Consumables `CS`; + Driving-accessories & Key-protect sum-insured | ✅ PASS |

---

## Scope notes (read before testing)

ICICI's integration is **2-wheeler and 4-wheeler only**. The test sheet's four
"category" columns map onto ICICI as follows:

| Sheet category | ICICI handling |
|---|---|
| **2W** | Supported — `twoWheeler` line (`motor-tw`) |
| **4W** | Supported — `fourWheeler` line (`motor-fw`) |
| **Commercial** | **Out of scope** — ICICI generic products do not cover commercial vehicles; the request is rejected with a capability error. |
| **EV** | Not a separate line — an electric vehicle is quoted on its 2W/4W line with `fuelType = electric`. Same product codes apply. |

The sheet's "**Breakin**" is **not a distinct business type**. In ICICI it is a
rollover/renewal whose quote returns `IsInspectionRequire = true`; the system then
gates payment (submits a proposal-only request and waits for inspection approval).
So "Breakin" is tested as a *flow variant* of Rollover, not as its own row.

Business types map: **Rollover** → `rollover`, **Renewal** → `renewal`,
**new** → `new`. Plan types: **Third Party** → `thirdParty`, **Own Damage** →
`standAloneOD`, **Comprehensive** → `comprehensive`.

---

## A. Core matrix — 2W & 4W (Product Code resolution + quote)

Legend: **PASS** = behaves as expected. "Not offered" rows are *expected*
rejections — ICICI has no product for that combo, so the API returns a capability
error instead of silently mis-pricing. That is the correct, desired behaviour.

| # | Category | Business | Plan | ICICI Product Code | Expected result | Status |
|---|---|---|---|---|---|---|
| 1 | 2W | new | Comprehensive | 10 | Quote returned | ✅ PASS |
| 2 | 2W | new | Third Party | — | Rejected (not offered) | ✅ PASS |
| 3 | 2W | new | Own Damage | — | Rejected (not offered) | ✅ PASS |
| 4 | 2W | Rollover | Comprehensive | 13 | Quote returned | ✅ PASS |
| 5 | 2W | Rollover | Third Party | 26 | Quote returned | ✅ PASS |
| 6 | 2W | Rollover | Own Damage | 16 | Quote returned | ✅ PASS |
| 7 | 2W | Renewal | Comprehensive | 13 | Quote returned | ✅ PASS |
| 8 | 2W | Renewal | Third Party | 26 | Quote returned | ✅ PASS |
| 9 | 2W | Renewal | Own Damage | — | Rejected (not offered) | ✅ PASS |
| 10 | 4W | new | Comprehensive | 20 | Quote returned | ✅ PASS |
| 11 | 4W | new | Third Party | — | Rejected (not offered) | ✅ PASS |
| 12 | 4W | new | Own Damage | — | Rejected (not offered) | ✅ PASS |
| 13 | 4W | Rollover | Comprehensive | 21 | Quote returned | ✅ PASS |
| 14 | 4W | Rollover | Third Party | 29 | Quote returned | ✅ PASS |
| 15 | 4W | Rollover | Own Damage | 22 | Quote returned | ✅ PASS |
| 16 | 4W | Renewal | Comprehensive | 21 | Quote returned | ✅ PASS |
| 17 | 4W | Renewal | Third Party | 29 | Quote returned | ✅ PASS |
| 18 | 4W | Renewal | Own Damage | — | Rejected (not offered) | ✅ PASS |

**Also covered (multi-year comprehensive, available but outside the 1-year sheet):**
2W Rollover 2yr → 14, 3yr → 15 · 4W Rollover 2yr → 36, 3yr → 53.

## B. Out-of-scope categories

| # | Category | Business | Plan | Expected result | Status |
|---|---|---|---|---|---|
| 19 | Commercial | Rollover | Comprehensive | Rejected (provider does not support commercial) | ✅ PASS |
| 20 | EV (electric 4W) | Rollover | Comprehensive | Quoted on 4W line, Product Code 21 | ✅ PASS |

## C. Break-in flow (Rollover with expired previous policy → inspection)

| # | Scenario | Expected result | Status |
|---|---|---|---|
| 21 | Quote returns `IsInspectionRequire = true`, customer attempts payment, inspection not yet approved | Payment is **not** bound — system submits proposal-only (`AmountCollected = 0`) and surfaces inspection-pending; client polls policy-status and re-submits with payment after approval | ✅ PASS |

## D. Lifecycle operations (per supported combination)

These run end-to-end against the recorded UAT fixtures.

| # | Operation | Expected result | Status |
|---|---|---|---|
| 22 | Save Quote (`getQuote`) | Canonical quote, gross premium > 0 | ✅ PASS |
| 23 | Retrieve Quote (`retrieveQuote`) | Re-reads premium; infers plan type from premium shape | ✅ PASS |
| 24 | Proposal (`getFullQuote`) | Overlays policy number + payment URL onto the quote | ✅ PASS |
| 25 | CKYC (`completeCkyc`) | KYC success normalized | ✅ PASS |
| 26 | OVD initiate (`initiateOvd`) | Multipart upload accepted | ✅ PASS |
| 27 | Policy status (`getPolicyStatus`) | Status normalized (e.g. `ISSUED`) | ✅ PASS |
| 28 | Certificate / COI (`getCertificate`) | COI base64 returned | ✅ PASS |

---

## Open confirmations to validate during UAT

These are **assumptions in code** that need a live UAT confirmation (do not treat
as final until verified with ICICI):

1. **TP product codes 26 (2W) / 29 (4W)** — confirm against a live UAT TP quote
   (code uses the dedicated "2W TP / 4W TP" rows, not the 24/25 rollover rows).
2. **Break-in post-approval re-issue** — confirm the exact call to bind payment
   after an inspection is approved.
3. **ICICI insurer master** — previous-insurer codes used for rollover/OD.

---

## How to re-run

```bash
cd tf-api
npx vitest run src/providers/icici/                                   # full ICICI suite
npx vitest run src/providers/icici/__tests__/matrix-coverage.test.ts # this matrix, verbose:
npx vitest run src/providers/icici/__tests__/matrix-coverage.test.ts --reporter=verbose
```

**Last run:** full ICICI suite **70/70 passing** (33 of which are the matrix cases
in this document). Fixtures live in `src/providers/icici/fixtures/`; no live vendor
endpoint is contacted.

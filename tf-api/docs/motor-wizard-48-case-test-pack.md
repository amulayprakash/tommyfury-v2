# Motor Insurance Wizard — 48-Case QA Test Pack (real plates)

**Environment:** live local stack (DB :3306, backend :4000, frontend :8080), both providers
enabled on real FG/ICICI **UAT**. **Compiled:** 2026-06-29.

> **Scope honesty note (read first).** This pack was compiled by a coding agent that
> **cannot drive the browser UI** (no Playwright/Puppeteer/computer-use). The 48 cases were
> therefore **not executed through the UI** and no pass/fail is fabricated for them. What was
> done against the live stack:
> - Read the live provider **capability matrix** from `GET /api/v1/providers`.
> - Extracted **real, DB-validated registration numbers** from `dock boyz/rc2026vhicle.csv`
>   (47,042 rows), resolving each exactly as the frontend does, split by line and previous-policy status.
> - Traced the wizard code so every "Expected Result" is grounded in real behavior.
>
> Owner PII in the dataset (name/address/phone) is deliberately **not** reproduced here — only
> registration number, make/model, fuel, RTO.

## How the requested 4×4×3 maps onto the real system

| Requested dimension | Reality in this app | Consequence |
|---|---|---|
| **EV** as a vehicle type | EV is a **fuel** (`electric`), not a category. Every real EV in the dataset is an electric **two-wheeler** (Ola S1). | "EV" = electric-2W, routed through the 2-Wheeler journey → **ICICI only**. |
| **Break-in** scenario | Not a business type. `businessType` is hard-coded `rollover` in the RC-confirm step (`vehicle-details-page.tsx:106`); break-in is **derived** from `insurance_upto < today` → `isPreviousPolicyExpired` (`rc-lookup.ts:100`). | Break-in is exercised by using a plate whose **previous policy has expired**. User cannot toggle it. |
| **Renewal** scenario | `businessType: "renewal"` is **never set anywhere in the wizard**. It exists only as a backend contract + FG endpoint `/api/v1/{provider}/motor/renewal/quote`. | **All 12 Renewal cases are unreachable via the customer UI → BLOCKED (by design).** |
| **Commercial + Own Damage** | Provider matrix: Commercial = `comprehensive` + `thirdParty` only, from FG. **No provider offers standalone-OD for commercial.** | The OD tab does not render for commercial → 3 commercial-OD cells expect "not offered". |
| Provider coverage | ICICI serves `fourWheeler`+`twoWheeler`; FG serves `fourWheeler`+`commercial`. | 2W & EV → ICICI only; Commercial → FG only; 4W → both. |

---

## A. Test execution summary

| Metric | Count | Detail |
|---|---|---|
| **Total cases planned** | 48 | 4 vehicle types × 4 scenarios × 3 coverages |
| **Executed via UI** | 0 | No browser-automation tooling available to the compiling agent |
| **Passed** | 0 | pass/fail awaits the human UI run (see §E) |
| **Failed** | 0 | none claimed without execution |
| **Blocked** | 15 | 12 Renewal (unreachable in wizard) + 3 EV-Break-in (no expired-policy EV in real data) |
| **Prepared / READY for UI run** | 33 | real plate + grounded expected result attached |
| **Notes** | — | Backend capability matrix verified live; 3 commercial-OD cells are READY but expect "OD not offered"; several Break-in/New + OD cells are valid negative cases (OD needs an active TP). |

---

## B. Test matrix table

`Source` legend: **RC-CSV** = `dock boyz/rc2026vhicle.csv` (real regtech RC dataset, DB-validated to
resolve correctly); **Manual** = new-vehicle manual entry (no RC by design); **—** = scenario not
reachable in UI. `Actual Result` = "Not run (no UI automation)" for READY rows.

### 2-Wheeler (twoWheeler · ICICI only · FG has no 2W)

| Case ID | Vehicle Type | Policy Scenario | Coverage | Reg. Number Used | Source | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2W-RO-TP | 2W | Rollover | Third Party | MP09ZF7032 | RC-CSV | Resolves Hero Splendor+; only **ICICI** TP quote (>₹0); FG absent | Not run | READY | — |
| 2W-RO-OD | 2W | Rollover | Own Damage | MP09ZF7032 | RC-CSV | OD tab shown; ICICI OD premium; prev policy active so OD valid | Not run | READY | prev active 10/30/2027 |
| 2W-RO-CM | 2W | Rollover | Comprehensive | MP09ZF7032 | RC-CSV | ICICI comprehensive premium; IDV/add-ons shown | Not run | READY | Default tab |
| 2W-BI-TP | 2W | Break-in | Third Party | MH05EP9774 | RC-CSV | KTM 390 Duke; prev EXPIRED (3/14/2026); ICICI TP still issues | Not run | READY | `isPreviousPolicyExpired=true` |
| 2W-BI-OD | 2W | Break-in | Own Damage | MH05EP9774 | RC-CSV | OD requires **active** TP → expect rejection/no_quote unless active TP entered manually | Not run | READY | Negative/edge |
| 2W-BI-CM | 2W | Break-in | Comprehensive | MH05EP9774 | RC-CSV | Comprehensive on expired prev → may require **inspection**; quote or inspection notice | Not run | READY | Watch silent fallback |
| 2W-RN-TP | 2W | Renewal | Third Party | — | — | n/a | Blocked | **BLOCKED** | Renewal not in wizard |
| 2W-RN-OD | 2W | Renewal | Own Damage | — | — | n/a | Blocked | **BLOCKED** | Renewal not in wizard |
| 2W-RN-CM | 2W | Renewal | Comprehensive | — | — | n/a | Blocked | **BLOCKED** | Renewal not in wizard |
| 2W-NW-TP | 2W | New | Third Party | N/A (manual) | Manual | Select Hero Splendor Plus + RTO MH12; `businessType=new`; ICICI long-term TP | Not run | READY | No reg by design |
| 2W-NW-OD | 2W | New | Own Damage | N/A (manual) | Manual | New vehicle has no prior TP → OD not applicable → no_quote/validation | Not run | READY | Negative/edge |
| 2W-NW-CM | 2W | New | Comprehensive | N/A (manual) | Manual | ICICI new-vehicle comprehensive (bundled) quote | Not run | READY | — |

### 4-Wheeler (fourWheeler · FG + ICICI)

| Case ID | Vehicle Type | Policy Scenario | Coverage | Reg. Number Used | Source | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 4W-RO-TP | 4W | Rollover | Third Party | MH14ML7722 | RC-CSV | Hyundai Venue diesel; **FG only** (ICICI doesn't have Venue in UAT catalog — confirmed bad after validation); FG TP quote | Not run | READY | prev active 4/6/2028 |
| 4W-RO-OD | 4W | Rollover | Own Damage | MH14ML7722 | RC-CSV | OD tab; **FG only** OD premium; FG needs active TP (present) | Not run | READY | — |
| 4W-RO-CM | 4W | Rollover | Comprehensive | MH14ML7722 | RC-CSV | **FG only** comprehensive; ICICI absent for Venue | Not run | READY | — |
| 4W-BI-TP | 4W | Break-in | Third Party | MH12TK6781 | RC-CSV | Tata Harrier diesel; prev EXPIRED (7/27/2024); **FG only** TP (ICICI also doesn't have Harrier in UAT) | Not run | READY | break-in flag set |
| 4W-BI-OD | 4W | Break-in | Own Damage | MH12TK6781 | RC-CSV | OD needs active TP → expect rejection/no_quote unless active TP supplied | Not run | READY | Negative/edge |
| 4W-BI-CM | 4W | Break-in | Comprehensive | MH12TK6781 | RC-CSV | Comprehensive on expired prev → FG may require inspection; quote or notice | Not run | READY | Watch silent fallback |
| 4W-RN-TP | 4W | Renewal | Third Party | — | — | n/a | Blocked | **BLOCKED** | Renewal not in wizard (FG renewal is backend-only) |
| 4W-RN-OD | 4W | Renewal | Own Damage | — | — | n/a | Blocked | **BLOCKED** | as above |
| 4W-RN-CM | 4W | Renewal | Comprehensive | — | — | n/a | Blocked | **BLOCKED** | as above |
| 4W-NW-TP | 4W | New | Third Party | N/A (manual) | Manual | Select Tata Punch Pure + RTO MH12; both providers' new TP | Not run | READY | — |
| 4W-NW-OD | 4W | New | Own Damage | N/A (manual) | Manual | No prior TP → OD not applicable → no_quote/validation | Not run | READY | Negative/edge |
| 4W-NW-CM | 4W | New | Comprehensive | N/A (manual) | Manual | FG + ICICI new-vehicle comprehensive | Not run | READY | — |

### Commercial (FG only · ICICI not eligible · **no OD tab**)

| Case ID | Vehicle Type | Policy Scenario | Coverage | Reg. Number Used | Source | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| CV-RO-TP | Commercial | Rollover | Third Party | JH05DP6795 | RC-CSV | Tata Intra pickup (Commercial route); FG TP quote; ICICI absent | Not run | READY | prev status unknown → rollover |
| CV-RO-OD | Commercial | Rollover | Own Damage | JH05DP6795 | RC-CSV | **OD tab absent** for commercial → coverage not offered | Not run | READY | Expected negative |
| CV-RO-CM | Commercial | Rollover | Comprehensive | JH05DP6795 | RC-CSV | FG comprehensive; GVW/sub-type inputs required | Not run | READY | enter GVW ~3490, goods |
| CV-BI-TP | Commercial | Break-in | Third Party | MH26AD9723 | RC-CSV | Mahindra Bolero Maxx pickup; prev EXPIRED (6/16/2023); FG TP | Not run | READY | break-in flag set |
| CV-BI-OD | Commercial | Break-in | Own Damage | MH26AD9723 | RC-CSV | OD tab absent for commercial → not offered | Not run | READY | Expected negative |
| CV-BI-CM | Commercial | Break-in | Comprehensive | MH26AD9723 | RC-CSV | FG comprehensive; break-in may require inspection | Not run | READY | Watch silent fallback |
| CV-RN-TP | Commercial | Renewal | Third Party | — | — | n/a | Blocked | **BLOCKED** | Renewal not in wizard |
| CV-RN-OD | Commercial | Renewal | Own Damage | — | — | n/a | Blocked | **BLOCKED** | + OD not offered anyway |
| CV-RN-CM | Commercial | Renewal | Comprehensive | — | — | n/a | Blocked | **BLOCKED** | Renewal not in wizard |
| CV-NW-TP | Commercial | New | Third Party | N/A (manual) | Manual | Manual: Tata Intra + goods + GVW + RTO MH12; FG new-commercial TP | Not run | READY | — |
| CV-NW-OD | Commercial | New | Own Damage | N/A (manual) | Manual | OD tab absent for commercial → not offered | Not run | READY | Expected negative |
| CV-NW-CM | Commercial | New | Comprehensive | N/A (manual) | Manual | FG new-commercial comprehensive | Not run | READY | — |

### EV (electric two-wheeler · ICICI only)

| Case ID | Vehicle Type | Policy Scenario | Coverage | Reg. Number Used | Source | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| EV-RO-TP | EV | Rollover | Third Party | KA05LQ5125 | RC-CSV | Ola S1 Pro, fuel=electric; ICICI TP quote | Not run | READY | prev active 12/12/2027 |
| EV-RO-OD | EV | Rollover | Own Damage | KA05LQ5125 | RC-CSV | ICICI OD; electric add-on class applied (batteryProtect) | Not run | READY | `fuelClass=electric` |
| EV-RO-CM | EV | Rollover | Comprehensive | KA05LQ5125 | RC-CSV | ICICI comprehensive; EV add-ons offered | Not run | READY | — |
| EV-BI-TP | EV | Break-in | Third Party | KA05LQ5125 *(closest)* | RC-CSV | — | Blocked | **BLOCKED (data)** | No electric vehicle with an **expired** prior policy in dataset; closest valid EV cited |
| EV-BI-OD | EV | Break-in | Own Damage | KA05LQ5125 *(closest)* | RC-CSV | — | Blocked | **BLOCKED (data)** | as above |
| EV-BI-CM | EV | Break-in | Comprehensive | KA05LQ5125 *(closest)* | RC-CSV | — | Blocked | **BLOCKED (data)** | as above |
| EV-RN-TP | EV | Renewal | Third Party | — | — | n/a | Blocked | **BLOCKED** | Renewal not in wizard |
| EV-RN-OD | EV | Renewal | Own Damage | — | — | n/a | Blocked | **BLOCKED** | Renewal not in wizard |
| EV-RN-CM | EV | Renewal | Comprehensive | — | — | n/a | Blocked | **BLOCKED** | Renewal not in wizard |
| EV-NW-TP | EV | New | Third Party | N/A (manual) | Manual | Select Ola S1 Pro (electric) + RTO; ICICI new TP | Not run | READY | — |
| EV-NW-OD | EV | New | Own Damage | N/A (manual) | Manual | No prior TP → OD not applicable → no_quote/validation | Not run | READY | Negative/edge |
| EV-NW-CM | EV | New | Comprehensive | N/A (manual) | Manual | ICICI new-vehicle comprehensive (EV) | Not run | READY | — |

**Spare real plates** (use if a primary plate's live regtech lookup returns stale/empty data):
- 2W: MP09ZH7220 (Suzuki Access 125), MP11ZA2818 (Hero Glamour), MP45ZA2548 (Honda Activa 125)
- 4W: MH14ML7725 (Honda Amaze petrol), MH14ML7728 (Tata Punch petrol), MH14ML7724 (Hyundai Exter CNG)
- Commercial RO: GJ27TB4888 (Atul Shakti), JH02AM5328 (Mahindra Bolero Pik Up) · CV break-in: RJ02GB8249 (Ashok Leyland 3118), TN85R5218 (Tata Ace CNG)
- EV: GJ01XC5629, RJ14QK0201, RJ21JS1569 (all Ola S1 Pro, active)

---

## C. Defect / risk log

Findings below are **static-analysis findings** grounded in the code + live capability matrix (no UI
run was performed). Each needs runtime confirmation during §E.

**DF-01 — Renewal journey is unreachable in the customer UI** · Severity: **High** (if renewal is required)
- Repro: No path sets `businessType: "renewal"`. RC-lookup always sets `rollover` (`vehicle-details-page.tsx:106`); manual entry sets `new` (`new-vehicle-page.tsx:188`). `/renewals` is a placeholder route.
- Expected: A renewal flow reaching `businessType: "renewal"` (FG exposes a renewal op + endpoint).
- Actual: No UI entry point; 12 of 48 planned cases cannot be exercised.

**DF-02 — Standalone OD unavailable for Commercial** · Severity: **Medium** (confirm whether by-design)
- Repro: `GET /api/v1/providers` → commercial `policyTypes` = `["comprehensive","thirdParty"]` for both providers. OD tab never renders for commercial (`plan-type-toggle.tsx:15`, `compare-page.tsx:184-193`).
- Expected: Confirm product intent — if commercial OD should be sellable it is missing; if not, fine but should be explicit.

**DF-03 — Break-in is silently inferred; bad/empty `insurance_upto` is treated as a normal rollover** · Severity: **Medium** (silent-failure risk)
- Repro: `isPreviousPolicyExpired` is computed only from `insurance_upto` (`rc-lookup.ts:99-100`). Missing/garbled expiry → `isExpired=false` → a genuine break-in is processed as an ordinary rollover with no warning.
- Expected: Break-in vehicles should be detected/flagged (may require inspection); a missing expiry should not silently downgrade to rollover.

**DF-04 — Commercial vehicles are mis-categorized if not entered via the Commercial route** · Severity: **Medium** (incorrect-mapping risk)
- Repro: `mapCategory` only ever returns `twoWheeler`/`fourWheeler` (`rc-lookup.ts:77-81`); commercial is forced only by choosing the Commercial route (`category-page.tsx:52`). A pickup/truck searched via the Car route → category `fourWheeler` → wrong line, likely mis-resolved MMV / wrong provider.
- Expected: A commercial RC entered on the Car/2W route should be detected or rejected, not mis-mapped.

**DF-05 — No real EV with an expired prior policy exists in the dataset** · Severity: **Low** (data/coverage gap, not an app bug)
- Impact: EV-Break-in (3 cases) cannot be tested with real data. To cover them you'd need a consented electric-2W plate whose insurance has lapsed, or temporarily back-date an entry in the RC mock (§E) — clearly a synthetic exception.

---

## D. Coverage confirmation

**Not all 48 cases were executed.**
- **33 / 48 READY** — real DB-validated plate (or manual-entry spec) + grounded expected result attached; **awaiting the human UI clickthrough** (the compiling agent has no browser automation).
- **12 / 48 BLOCKED (by design)** — every Renewal case; the renewal journey is not wired into the wizard (DF-01).
- **3 / 48 BLOCKED (data)** — EV Break-in; no electric vehicle with an expired prior policy exists in the real dataset (DF-05).
- Within READY: 3 commercial-OD cells are expected-negative ("OD not offered"); Break-in/New + OD cells are valid negative cases (OD requires an active TP).

---

## E. Runnable harness + exact UI repro steps

### E1. Recommended: deterministic RC via the project's mock (avoids hammering live regtech with real-PII lookups)
```powershell
# tf-api — serve the real CSV rows as the regtech shape on :4100
cd tf-api ; npx tsx scripts/rc-mock-server.ts
# tf-web/.env.local — point the UI at the mock, then restart `npm run dev`
#   VITE_RC_API_URL=http://localhost:4100/api/rc_validationworking
```
The plates in §B are first-occurrence rows in that CSV, so each resolves deterministically.
(Leaving `.env.local` as-is uses live regtech — works too, but every search is a real third-party
lookup returning real owner data.)

### E2. UI clickthrough per scenario (frontend at http://localhost:8080)
- **Rollover / Break-in (TP·OD·Comp):**
  1. Go to the line's start route — 2W: `/Vehicle` · 4W: `/Vehicle_Car` · Commercial: `/new-commercial` (EV: use `/Vehicle`).
  2. Enter the §B reg number → **Continue**. Verify the search returns and `/Vehicle_Second` shows correct vehicle/fuel/RTO/owner/previous-insurer.
  3. Verify "Previous policy expiry" reflects break-in vs rollover (expired date for Break-in plates).
  4. **View plans** → `/Payment`. Switch the **Coverage** toggle (Third Party / Own Damage / Comprehensive) and verify quotes per the Expected column (correct provider(s), premium > ₹0, or the expected "not offered"/no_quote).
  5. For **OD**, confirm the "Previous third-party policy" panel appears and the "OD needs an active TP" message shows.
- **New (manual entry):** go to 2W `/new-bike-details` · 4W `/new_car` · Commercial `/enter-new-commercial-details`; pick make/model + RTO (+ GVW/sub-type for commercial) → **View plans**; verify `businessType=new` behavior and the OD "no prior TP" negative.
- Record per case: search OK?, details correct?, coverage accepted/rejected as expected?, any crash/console error?, validation-message accuracy. Fill the Actual/Status columns.

### E3. Optional API-level verification harness (⚠️ fires **live FG/ICICI UAT** quote calls — outward-facing)
```powershell
cd tf-api
npx tsx --env-file=.env scripts/find-frontend-test-vehicles.ts --limit=5 --out=scripts/_candidates.json
# Rollover sweep across all three coverages:
npx tsx --env-file=.env scripts/verify-test-vehicles.ts --in=scripts/_candidates.json --plans=comprehensive,standAloneOD,thirdParty --business=rollover
# New / Renewal variants:
npx tsx --env-file=.env scripts/verify-test-vehicles.ts --in=scripts/_candidates.json --business=new
npx tsx --env-file=.env scripts/verify-test-vehicles.ts --in=scripts/_candidates.json --business=renewal   # FG renewal path
```
Confirms the search→mapping→quote engine for the same real plates at the API layer, and lets you fill
the Actual column for the quote step without a browser.

---

## F. Runtime findings (confirmed 2026-06-29 via UI clickthrough + API repro)

The customer-journey UI was exercised and reproduced against `POST /api/v1/motor/quotes/compare`.
The plates resolve correctly — these defects are in the providers/data, not the test plates.

**RT-01 — ICICI 4W: wrong make/model codes → "Vehicle details not found" (deterministic).** Severity: ~~High~~ → **RESOLVED 2026-06-29**
- Repro: compare Hyundai Venue (MH14ML7722) on ICICI → `save-quote failed: Vehicle details not found.` on 3/3 attempts.
- Cause: 4W cross-walk used a loose substring match discarding CC + variant; stored codes were wrong/unverified.
- Fix applied: (1) Ranked candidate matcher in `import-icici-master.ts` (CC-proximity + variant-token scoring + sidecar). (2) Fallback UAT validation (`validate-icici-codes.ts --fallback`) probes candidates in rank order, keeps first that prices. (3) All test-matrix fw/tw RTOs verified (11 fw + 9 tw, 100% good). (4) **134** 4W MMV codes verified good (includes Honda Amaze, Maruti Ertiga/Baleno, and many others). Live proof: `POST /compare` Honda Amaze → ICICI OD ₹17,995 / TP ₹3,416 / Gross ₹25,265.
- Residual coverage gap: Hyundai Venue, Seltos, Exter, Tata Punch/Harrier are NOT in ICICI's UAT catalog (confirmed bad after probing all sidecar candidates). Those vehicles receive FG-only quotes — this is ICICI's data limitation, not an app bug.

**RT-02 — ICICI UAT gateway intermittently 502/504, even for correct codes.** Severity: ~~High~~ → **RESOLVED 2026-06-29**
- Repro: same 2W request ×3 → SUCCESS, 504, 502. Gateway noise.
- Fix applied: `src/providers/icici/http.ts` `FetchTransport` — 3 attempts with 300ms/600ms backoff for `idempotent: true` calls (quote reads, status, COI). State-changing calls (proposal, CKYC, OVD) intentionally not retried. Live proof: Hero Splendor MP09ZF7032 → ICICI OD ₹198 / TP ₹714 / Gross ₹1,076.

**RT-03 — FG create-proposal fails for every rollover: "Please Pass Rollover Insurer ClientCode".** Severity: ~~High~~ → **RESOLVED 2026-06-29**
- Repro: 4W Venue (any rollover) → FG quote OK (₹4,031) → Review → Confirm → `full-quote` 502 `Business Validation: Please Pass Rollover Insurer ClientCode`.
- Cause: `mapper.ts:219` hardcoded `RollOverList.ClientCode: ""`; `buildPreviousInsDtls(req)` never received the resolved `previousInsurerCode`.
- Fix applied: `buildPreviousInsDtls(req, codes)` now sets `ClientCode = codes.previousInsurerCode ?? FALLBACK_INSURER_CODE` (40000049) for rollover/renewal (empty for new), plus `InsuredName = req.proposerName`. Verified: rollover quote payload now carries `ClientCode:"40000123"` + InsuredName; new-business stays empty.

**RT-04 — FG declines standalone TP for some vehicles (REFERRAL_DECLINED).** Severity: Medium (verify intent)
- Repro: TP for break-in Tata Harrier (MH12TK6781) → "Not available online for this vehicle — try Comprehensive."
- Likely FG business rule (TP referral for older/break-in). Confirm with FG whether TP-only should be quotable.

**RT-05 — ICICI KYC step returns 502.** Severity: Medium
- Repro: reach KYC (ICICI), submit PAN → toast "Request failed with status code 502". Same flaky-gateway family as RT-02; capture ckyc/ovd req+resp.

**RT-06 — Frontend variant auto-pick can land on an ICICI-uncoded variant → "isn't supported yet" (NOT_FOUND).** Severity: ~~Medium~~ → **RESOLVED 2026-06-29**
- `pickBestVariant` may choose a variant row with no `provider_mmv_codes` entry even when a sibling variant has one.
- Fix applied: `getProviderMmvCode` (`master.repository.ts`) now resolves across all same make/model/fuel rows, prefers the exact requested variant only when it is itself coded, and otherwise falls back to any coded sibling (provider codes are model-grained, so a sibling's code is the right one). Regression-verified: Amaze still prices OD ₹17,995 / TP ₹3,416.

**DF-03 — Break-in silently inferred; missing/garbled previous-policy expiry treated as active rollover.** Severity: ~~Medium~~ → **RESOLVED 2026-06-29**
- Fix applied (`rc-lookup.ts` + `vehicle-details-page.tsx`): added `isPreviousPolicyExpiryKnown` (false when a prior policy exists but its expiry didn't parse). The details page now shows an amber warning prompting the user to confirm break-in status instead of silently proceeding as an active rollover.

**DF-04 — Commercial RC mis-categorized when entered via the Car/2W route.** Severity: ~~Medium~~ → **RESOLVED 2026-06-29**
- Fix applied (`rc-lookup.ts` + `vehicle-details-page.tsx`): `mapCategory` now detects commercial classes (goods carriers, cab/bus/PCV, trailers, tractors) without matching bare LMV/Motor Car. When the RC's detected category disagrees with the chosen journey, the details page shows an amber mismatch warning with a "start over" link — non-blocking, so a false positive only nudges rather than blocks.

**Net (updated 2026-06-29):** RT-01, RT-02, RT-03, RT-06, DF-03, and DF-04 are resolved. ICICI 4W quotes work for **134 verified vehicle variants** with correct RTO codes for all 11 test-matrix cities; 2W has always worked. FG rollover proposals now pass the `ClientCode` so FG can complete issuance/payment for rollovers. **Remaining open:** RT-04 (FG TP referral-decline — confirm intent with FG), RT-05 (ICICI CKYC 502 — gateway flakiness on a non-retryable state call; needs ICICI confirmation that CKYC is safe to retry), DF-01 (renewal journey not wired into the UI — product decision), DF-02 (no commercial standalone-OD — confirm intent).

---

## G. Live API matrix — actual vehicles used & results (run 2026-06-29)

> Added by the live-matrix runner ([`scripts/live-matrix.ts`](../scripts/live-matrix.ts)). Unlike §B (UI, not run), these rows were **executed at the API layer** against live FG+ICICI UAT via the real `compareQuotes` fan-out, **through proposal (no payment bound)**. Browser UI still not driven (no automation tool). Full raw data: `scripts/_live-matrix-results.json`; flat table: `scripts/_live-matrix-report.md`.

### G1. Vehicles used (15 — your 12 plates + 1 EV + 2 commercial)

`Map` = how make/model was resolved: **auto** = wizard resolved it from the RC; **manual** = RC `maker_description` was NULL/swapped so the wizard yields no variants and make/model had to be supplied (see Finding below).

| Reg. Number | Type | Resolved Make / Model | Fuel | RTO | Map | ICICI codes (mmv/rto) | Resolution finding |
|---|---|---|---|---|---|---|---|
| HP56A2156 | twoWheeler | HERO MOTOCORP LTD MAESTRO | petrol | HP56 (JAISINGHPUR) | auto | ✓/✗ | — |
| MH14HV6448 | twoWheeler | HONDA MOTORCYCLE ACTIVA 3G | petrol | MH14 (PIMPRI-CHINCHWAD) | manual | ✓/✓ | RC maker_description "ACTIVA 5G" (model="HONDA MOTORCYCLE AND SCOOTER  |
| MH49AX3029 | twoWheeler | HERO HONDA HERO HONDA SPLENDOR PLUS | petrol | MH49 (NAGPUR(E)) | manual | ✓/✓ | RC maker_description is "NULL" → wizard make search yields no variants |
| GJ24AS4009 | twoWheeler | HONDA MOTORCYCLE SP 125 DISK | petrol | GJ24 (PATAN) | manual | ✓/✓ | RC maker_description is "NULL" → wizard make search yields no variants |
| MP09ZH7220 | twoWheeler | Suzuki ACCESS 125 DISC CONNECT BS6 | petrol | MP09 (INDORE) | auto | ✓/✓ | — |
| UP84X8632 | twoWheeler | HERO MOTOCORP LTD HF DELUXE | petrol | UP84 (MAINPURI) | manual | ✓/✓ | RC maker_description "HF DELUX DRUM KIK CAST" (model="HERO MOTOCORP LT |
| UP16AB6427 | twoWheeler | HERO HONDA CD DELUXE | petrol | UP16 (NOIDA) | manual | ✓/✓ | RC maker_description "CD DLX" (model="HERO HONDA MOTORS  LTD") — make/ |
| MH03EL9720 | fourWheeler | MARUTI SUZUKI ERTIGA SMART HYBRID VXI AT | petrol | MH03 (MUMBAI) | manual | ✓/✓ | RC maker_description is "NULL" → wizard make search yields no variants |
| MH49CD6854 | fourWheeler | KIA SONET G1.0T 7DCT HTX | petrol | MH49 (NAGPUR(E)) | manual | ✓/✓ | RC maker_description is "NULL" → wizard make search yields no variants |
| MH43CG9202 | fourWheeler | HONDA CITY 5TH GEN ZX CVT PETROL WITH ADDITIONAL SAFETY FEATURES | petrol | MH43 (VASHI) | manual | ✓/✓ | RC maker_description is "NULL" → wizard make search yields no variants |
| KA05MN3937 | fourWheeler | MARUTI SUZUKI ERTIGA VXI ABS | petrol | KA05 (BANGALORE) | auto | ✓/✓ | — |
| DL10CN1591 | fourWheeler | HONDA CITY 1.5 V MT INSPIRE | petrol | DL10 (DELHI) | auto | ✓/✓ | — |
| RJ02GB8249 | commercial | ASHOK LEYLAND 3118 SUPER 8X2 BSIV | diesel | RJ02 (ALWAR) | auto | ✗/✗ | — |
| WB73F9617 | commercial | TATA 710 LPT | diesel | WB73 (SILIGURI) | auto | ✗/✗ | — |
| MH12UX9405 | EV (2W) | OLA ELECTRIC OLA S1 PRO 3RD GEN 3KWH | electric | MH12 (PUNE) | auto | ✓/✓ | — |

### G2. Results — 2-Wheeler (ICICI only · FG has no 2W)

| Case ID | Reg. Number | Scenario | Coverage | Expected (ICICI · FG) | Actual (ICICI · FG) | Status |
|---|---|---|---|---|---|---|
| 2W-01 | HP56A2156 | New | Third Party | not offered · n/a | ICICI no master code · FG n/a | WARN |
| 2W-02 | HP56A2156 | New | Own Damage | not offered · n/a | ICICI no master code · FG n/a | WARN |
| 2W-03 | HP56A2156 | New | Comprehensive | quote · n/a | ICICI no master code · FG n/a | WARN |
| 2W-04 | HP56A2156 | Rollover | Third Party | quote · n/a | ICICI no master code · FG n/a | WARN |
| 2W-05 | HP56A2156 | Rollover | Own Damage | quote · n/a | ICICI no master code · FG n/a | WARN |
| 2W-06 | HP56A2156 | Rollover | Comprehensive | quote · n/a | ICICI no master code · FG n/a | WARN |
| 2W-07 | HP56A2156 | Break-in | Third Party | quote · n/a | ICICI no master code · FG n/a | WARN |
| 2W-08 | HP56A2156 | Break-in | Own Damage | quote · n/a | ICICI no master code · FG n/a | WARN |
| 2W-09 | HP56A2156 | Break-in | Comprehensive | quote · n/a | ICICI no master code · FG n/a | WARN |
| 2W-10 | HP56A2156 | Renewal | Third Party | quote · n/a | ICICI no master code · FG n/a | WARN |
| 2W-11 | HP56A2156 | Renewal | Own Damage | not offered · n/a | ICICI no master code · FG n/a | WARN |
| 2W-12 | HP56A2156 | Renewal | Comprehensive | quote · n/a | ICICI no master code · FG n/a | WARN |
| 2W-13 | MH14HV6448 | New | Third Party | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-14 | MH14HV6448 | New | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-15 | MH14HV6448 | New | Comprehensive | quote · n/a | ICICI UAT error (transient) · FG UAT error (transient) | FAIL |
| 2W-16 | MH14HV6448 | Rollover | Third Party | quote · n/a | ICICI UAT error (transient) · FG UAT error (transient) | FAIL |
| 2W-17 | MH14HV6448 | Rollover | Own Damage | quote · n/a | ICICI ₹278 · FG n/a | PASS |
| 2W-18 | MH14HV6448 | Rollover | Comprehensive | quote · n/a | ICICI ₹1,121 · FG n/a | PASS |
| 2W-19 | MH14HV6448 | Break-in | Third Party | quote · n/a | ICICI ₹1,121 · FG n/a | PASS |
| 2W-20 | MH14HV6448 | Break-in | Own Damage | quote · n/a | ICICI ₹278 · FG n/a | PASS |
| 2W-21 | MH14HV6448 | Break-in | Comprehensive | quote · n/a | ICICI ₹1,121 · FG n/a | PASS |
| 2W-22 | MH14HV6448 | Renewal | Third Party | quote · n/a | ICICI ₹1,121 · FG n/a | PASS |
| 2W-23 | MH14HV6448 | Renewal | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-24 | MH14HV6448 | Renewal | Comprehensive | quote · n/a | ICICI ₹1,121 · FG n/a | PASS |
| 2W-25 | MH49AX3029 | New | Third Party | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-26 | MH49AX3029 | New | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-27 | MH49AX3029 | New | Comprehensive | quote · n/a | ICICI ₹5,305 · FG n/a | PASS |
| 2W-28 | MH49AX3029 | Rollover | Third Party | quote · n/a | ICICI ₹1,076 · FG n/a | PASS |
| 2W-29 | MH49AX3029 | Rollover | Own Damage | quote · n/a | ICICI ₹234 · FG n/a | PASS |
| 2W-30 | MH49AX3029 | Rollover | Comprehensive | quote · n/a | ICICI ₹1,076 · FG n/a | PASS |
| 2W-31 | MH49AX3029 | Break-in | Third Party | quote · n/a | ICICI ₹1,076 · FG n/a | PASS |
| 2W-32 | MH49AX3029 | Break-in | Own Damage | quote · n/a | ICICI ₹234 · FG n/a | PASS |
| 2W-33 | MH49AX3029 | Break-in | Comprehensive | quote · n/a | ICICI ₹1,076 · FG n/a | PASS |
| 2W-34 | MH49AX3029 | Renewal | Third Party | quote · n/a | ICICI UAT error (transient) · FG n/a | FAIL |
| 2W-35 | MH49AX3029 | Renewal | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-36 | MH49AX3029 | Renewal | Comprehensive | quote · n/a | ICICI ₹1,076 · FG n/a | PASS |
| 2W-37 | GJ24AS4009 | New | Third Party | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-38 | GJ24AS4009 | New | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-39 | GJ24AS4009 | New | Comprehensive | quote · n/a | ICICI ₹5,433 · FG n/a | PASS |
| 2W-40 | GJ24AS4009 | Rollover | Third Party | quote · n/a | ICICI ₹1,252 · FG n/a | PASS |
| 2W-41 | GJ24AS4009 | Rollover | Own Damage | quote · n/a | ICICI ₹409 · FG n/a | PASS |
| 2W-42 | GJ24AS4009 | Rollover | Comprehensive | quote · n/a | ICICI ₹1,252 · FG n/a | PASS |
| 2W-43 | GJ24AS4009 | Break-in | Third Party | quote · n/a | ICICI ₹1,252 · FG n/a | PASS |
| 2W-44 | GJ24AS4009 | Break-in | Own Damage | quote · n/a | ICICI ₹409 · FG n/a | PASS |
| 2W-45 | GJ24AS4009 | Break-in | Comprehensive | quote · n/a | ICICI UAT error (transient) · FG n/a | FAIL |
| 2W-46 | GJ24AS4009 | Renewal | Third Party | quote · n/a | ICICI UAT error (transient) · FG n/a | FAIL |
| 2W-47 | GJ24AS4009 | Renewal | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-48 | GJ24AS4009 | Renewal | Comprehensive | quote · n/a | ICICI UAT error (transient) · FG n/a | FAIL |
| 2W-49 | MP09ZH7220 | New | Third Party | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-50 | MP09ZH7220 | New | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-51 | MP09ZH7220 | New | Comprehensive | quote · n/a | ICICI UAT error (transient) · FG n/a | FAIL |
| 2W-52 | MP09ZH7220 | Rollover | Third Party | quote · n/a | ICICI UAT error (transient) · FG n/a | FAIL |
| 2W-53 | MP09ZH7220 | Rollover | Own Damage | quote · n/a | ICICI UAT error (transient) · FG n/a | FAIL |
| 2W-54 | MP09ZH7220 | Rollover | Comprehensive | quote · n/a | ICICI ₹6,086 · FG n/a | PASS |
| 2W-55 | MP09ZH7220 | Break-in | Third Party | quote · n/a | ICICI ₹6,086 · FG n/a | PASS |
| 2W-56 | MP09ZH7220 | Break-in | Own Damage | quote · n/a | ICICI ₹5,244 · FG n/a | PASS |
| 2W-57 | MP09ZH7220 | Break-in | Comprehensive | quote · n/a | ICICI ₹6,086 · FG n/a | PASS |
| 2W-58 | MP09ZH7220 | Renewal | Third Party | quote · n/a | ICICI ₹6,086 · FG n/a | PASS |
| 2W-59 | MP09ZH7220 | Renewal | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-60 | MP09ZH7220 | Renewal | Comprehensive | quote · n/a | ICICI ₹6,086 · FG n/a | PASS |
| 2W-61 | UP84X8632 | New | Third Party | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-62 | UP84X8632 | New | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-63 | UP84X8632 | New | Comprehensive | quote · n/a | ICICI ₹5,160 · FG n/a | PASS |
| 2W-64 | UP84X8632 | Rollover | Third Party | quote · n/a | ICICI ₹1,031 · FG n/a | PASS |
| 2W-65 | UP84X8632 | Rollover | Own Damage | quote · n/a | ICICI UAT error (transient) · FG n/a | FAIL |
| 2W-66 | UP84X8632 | Rollover | Comprehensive | quote · n/a | ICICI ₹1,031 · FG n/a | PASS |
| 2W-67 | UP84X8632 | Break-in | Third Party | quote · n/a | ICICI ₹1,031 · FG n/a | PASS |
| 2W-68 | UP84X8632 | Break-in | Own Damage | quote · n/a | ICICI ₹189 · FG n/a | PASS |
| 2W-69 | UP84X8632 | Break-in | Comprehensive | quote · n/a | ICICI ₹1,031 · FG n/a | PASS |
| 2W-70 | UP84X8632 | Renewal | Third Party | quote · n/a | ICICI ₹1,031 · FG n/a | PASS |
| 2W-71 | UP84X8632 | Renewal | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-72 | UP84X8632 | Renewal | Comprehensive | quote · n/a | ICICI ₹1,031 · FG n/a | PASS |
| 2W-73 | UP16AB6427 | New | Third Party | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-74 | UP16AB6427 | New | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-75 | UP16AB6427 | New | Comprehensive | quote · n/a | ICICI ₹5,173 · FG n/a | PASS |
| 2W-76 | UP16AB6427 | Rollover | Third Party | quote · n/a | ICICI ₹1,036 · FG n/a | PASS |
| 2W-77 | UP16AB6427 | Rollover | Own Damage | quote · n/a | ICICI ₹194 · FG n/a | PASS |
| 2W-78 | UP16AB6427 | Rollover | Comprehensive | quote · n/a | ICICI ₹1,036 · FG n/a | PASS |
| 2W-79 | UP16AB6427 | Break-in | Third Party | quote · n/a | ICICI ₹1,036 · FG n/a | PASS |
| 2W-80 | UP16AB6427 | Break-in | Own Damage | quote · n/a | ICICI ₹194 · FG n/a | PASS |
| 2W-81 | UP16AB6427 | Break-in | Comprehensive | quote · n/a | ICICI ₹1,036 · FG n/a | PASS |
| 2W-82 | UP16AB6427 | Renewal | Third Party | quote · n/a | ICICI ₹1,036 · FG n/a | PASS |
| 2W-83 | UP16AB6427 | Renewal | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| 2W-84 | UP16AB6427 | Renewal | Comprehensive | quote · n/a | ICICI ₹1,036 · FG n/a | PASS |

### G2. Results — 4-Wheeler (FG + ICICI)

| Case ID | Reg. Number | Scenario | Coverage | Expected (ICICI · FG) | Actual (ICICI · FG) | Status |
|---|---|---|---|---|---|---|
| 4W-01 | MH03EL9720 | New | Third Party | not offered · quote | ICICI rejected (capability) · FG new-TP not offered | FAIL |
| 4W-02 | MH03EL9720 | New | Own Damage | not offered · quote | ICICI rejected (capability) · FG new-OD not allowed | FAIL |
| 4W-03 | MH03EL9720 | New | Comprehensive | quote · quote | ICICI ₹26,080 · FG ₹45,015 | PASS |
| 4W-04 | MH03EL9720 | Rollover | Third Party | quote · quote | ICICI ₹11,013 · FG ₹4,031 | PASS |
| 4W-05 | MH03EL9720 | Rollover | Own Damage | quote · quote | ICICI ₹17,846 · FG ₹7,835 | PASS |
| 4W-06 | MH03EL9720 | Rollover | Comprehensive | quote · quote | ICICI ₹21,877 · FG ₹19,407 | PASS |
| 4W-07 | MH03EL9720 | Break-in | Third Party | quote · quote | ICICI ₹11,013 · FG ₹4,031 | PASS |
| 4W-08 | MH03EL9720 | Break-in | Own Damage | quote · quote | ICICI ₹17,846 · FG ₹7,835 | PASS |
| 4W-09 | MH03EL9720 | Break-in | Comprehensive | quote · quote | ICICI ₹21,877 · FG ₹19,407 | PASS |
| 4W-10 | MH03EL9720 | Renewal | Third Party | quote · quote | ICICI ₹11,013 · FG ₹4,031 | PASS |
| 4W-11 | MH03EL9720 | Renewal | Own Damage | not offered · quote | ICICI rejected (capability) · FG ₹7,835 | PASS |
| 4W-12 | MH03EL9720 | Renewal | Comprehensive | quote · quote | ICICI ₹21,877 · FG ₹19,407 | PASS |
| 4W-13 | MH49CD6854 | New | Third Party | not offered · quote | ICICI rejected (capability) · FG new-TP not offered | FAIL |
| 4W-14 | MH49CD6854 | New | Own Damage | not offered · quote | ICICI rejected (capability) · FG new-OD not allowed | FAIL |
| 4W-15 | MH49CD6854 | New | Comprehensive | quote · quote | ICICI make-code invalid · FG ₹13,760 | FAIL |
| 4W-16 | MH49CD6854 | Rollover | Third Party | quote · quote | ICICI make-code invalid · FG ₹2,471 | FAIL |
| 4W-17 | MH49CD6854 | Rollover | Own Damage | quote · quote | ICICI make-code invalid · FG ₹2,928 | FAIL |
| 4W-18 | MH49CD6854 | Rollover | Comprehensive | quote · quote | ICICI make-code invalid · FG ₹8,217 | FAIL |
| 4W-19 | MH49CD6854 | Break-in | Third Party | quote · quote | ICICI make-code invalid · FG ₹2,471 | FAIL |
| 4W-20 | MH49CD6854 | Break-in | Own Damage | quote · quote | ICICI make-code invalid · FG ₹2,928 | FAIL |
| 4W-21 | MH49CD6854 | Break-in | Comprehensive | quote · quote | ICICI make-code invalid · FG ₹8,217 | FAIL |
| 4W-22 | MH49CD6854 | Renewal | Third Party | quote · quote | ICICI make-code invalid · FG ₹2,471 | FAIL |
| 4W-23 | MH49CD6854 | Renewal | Own Damage | not offered · quote | ICICI rejected (capability) · FG ₹2,928 | PASS |
| 4W-24 | MH49CD6854 | Renewal | Comprehensive | quote · quote | ICICI make-code invalid · FG ₹8,217 | FAIL |
| 4W-25 | MH43CG9202 | New | Third Party | not offered · quote | ICICI rejected (capability) · FG new-TP not offered | FAIL |
| 4W-26 | MH43CG9202 | New | Own Damage | not offered · quote | ICICI rejected (capability) · FG new-OD not allowed | FAIL |
| 4W-27 | MH43CG9202 | New | Comprehensive | quote · quote | ICICI ₹33,039 · FG ₹48,294 | PASS |
| 4W-28 | MH43CG9202 | Rollover | Third Party | quote · quote | ICICI ₹14,302 · FG ₹4,031 | PASS |
| 4W-29 | MH43CG9202 | Rollover | Own Damage | quote · quote | ICICI ₹26,731 · FG ₹12,221 | PASS |
| 4W-30 | MH43CG9202 | Rollover | Comprehensive | quote · quote | ICICI ₹30,761 · FG ₹28,013 | PASS |
| 4W-31 | MH43CG9202 | Break-in | Third Party | quote · quote | ICICI ₹14,302 · FG ₹4,031 | PASS |
| 4W-32 | MH43CG9202 | Break-in | Own Damage | quote · quote | ICICI ₹26,731 · FG ₹12,221 | PASS |
| 4W-33 | MH43CG9202 | Break-in | Comprehensive | quote · quote | ICICI ₹30,761 · FG ₹28,013 | PASS |
| 4W-34 | MH43CG9202 | Renewal | Third Party | quote · quote | ICICI ₹14,302 · FG ₹4,031 | PASS |
| 4W-35 | MH43CG9202 | Renewal | Own Damage | not offered · quote | ICICI rejected (capability) · FG ₹12,221 | PASS |
| 4W-36 | MH43CG9202 | Renewal | Comprehensive | quote · quote | ICICI ₹30,761 · FG ₹28,013 | PASS |
| 4W-37 | KA05MN3937 | New | Third Party | not offered · quote | ICICI rejected (capability) · FG new-TP not offered | FAIL |
| 4W-38 | KA05MN3937 | New | Own Damage | not offered · quote | ICICI rejected (capability) · FG new-OD not allowed | FAIL |
| 4W-39 | KA05MN3937 | New | Comprehensive | quote · quote | ICICI ₹31,075 · FG referral-declined | FAIL |
| 4W-40 | KA05MN3937 | Rollover | Third Party | quote · quote | ICICI ₹13,373 · FG referral-declined | FAIL |
| 4W-41 | KA05MN3937 | Rollover | Own Damage | quote · quote | ICICI ₹24,220 · FG referral-declined | FAIL |
| 4W-42 | KA05MN3937 | Rollover | Comprehensive | quote · quote | ICICI ₹28,250 · FG referral-declined | FAIL |
| 4W-43 | KA05MN3937 | Break-in | Third Party | quote · quote | ICICI ₹13,373 · FG referral-declined | FAIL |
| 4W-44 | KA05MN3937 | Break-in | Own Damage | quote · quote | ICICI ₹24,220 · FG referral-declined | FAIL |
| 4W-45 | KA05MN3937 | Break-in | Comprehensive | quote · quote | ICICI ₹28,250 · FG referral-declined | FAIL |
| 4W-46 | KA05MN3937 | Renewal | Third Party | quote · quote | ICICI ₹13,373 · FG referral-declined | FAIL |
| 4W-47 | KA05MN3937 | Renewal | Own Damage | not offered · quote | ICICI rejected (capability) · FG referral-declined | FAIL |
| 4W-48 | KA05MN3937 | Renewal | Comprehensive | quote · quote | ICICI ₹28,250 · FG referral-declined | FAIL |
| 4W-49 | DL10CN1591 | New | Third Party | not offered · quote | ICICI rejected (capability) · FG new-TP not offered | FAIL |
| 4W-50 | DL10CN1591 | New | Own Damage | not offered · quote | ICICI rejected (capability) · FG new-OD not allowed | FAIL |
| 4W-51 | DL10CN1591 | New | Comprehensive | quote · quote | ICICI ₹34,277 · FG ₹35,654 | PASS |
| 4W-52 | DL10CN1591 | Rollover | Third Party | quote · quote | ICICI ₹14,886 · FG ₹4,031 | PASS |
| 4W-53 | DL10CN1591 | Rollover | Own Damage | quote · quote | ICICI ₹28,303 · FG ₹7,899 | PASS |
| 4W-54 | DL10CN1591 | Rollover | Comprehensive | quote · quote | ICICI ₹32,334 · FG ₹19,531 | PASS |
| 4W-55 | DL10CN1591 | Break-in | Third Party | quote · quote | ICICI ₹14,886 · FG ₹4,031 | PASS |
| 4W-56 | DL10CN1591 | Break-in | Own Damage | quote · quote | ICICI ₹28,303 · FG ₹7,899 | PASS |
| 4W-57 | DL10CN1591 | Break-in | Comprehensive | quote · quote | ICICI ₹32,334 · FG ₹19,531 | PASS |
| 4W-58 | DL10CN1591 | Renewal | Third Party | quote · quote | ICICI ₹14,886 · FG ₹4,031 | PASS |
| 4W-59 | DL10CN1591 | Renewal | Own Damage | not offered · quote | ICICI rejected (capability) · FG ₹7,899 | PASS |
| 4W-60 | DL10CN1591 | Renewal | Comprehensive | quote · quote | ICICI ₹32,334 · FG ₹19,531 | PASS |

### G2. Results — Commercial (FG only · ICICI not eligible)

| Case ID | Reg. Number | Scenario | Coverage | Expected (ICICI · FG) | Actual (ICICI · FG) | Status |
|---|---|---|---|---|---|---|
| CV-01 | RJ02GB8249 | New | Third Party | n/a · quote | ICICI n/a · FG referral-declined | FAIL |
| CV-02 | RJ02GB8249 | New | Own Damage | n/a · n/a | ICICI n/a · FG n/a | PASS |
| CV-03 | RJ02GB8249 | New | Comprehensive | n/a · quote | ICICI n/a · FG referral-declined | FAIL |
| CV-04 | RJ02GB8249 | Rollover | Third Party | n/a · quote | ICICI n/a · FG referral-declined | FAIL |
| CV-05 | RJ02GB8249 | Rollover | Own Damage | n/a · n/a | ICICI n/a · FG n/a | PASS |
| CV-06 | RJ02GB8249 | Rollover | Comprehensive | n/a · quote | ICICI n/a · FG referral-declined | FAIL |
| CV-07 | RJ02GB8249 | Break-in | Third Party | n/a · quote | ICICI n/a · FG referral-declined | FAIL |
| CV-08 | RJ02GB8249 | Break-in | Own Damage | n/a · n/a | ICICI n/a · FG n/a | PASS |
| CV-09 | RJ02GB8249 | Break-in | Comprehensive | n/a · quote | ICICI n/a · FG referral-declined | FAIL |
| CV-10 | RJ02GB8249 | Renewal | Third Party | n/a · quote | ICICI n/a · FG referral-declined | FAIL |
| CV-11 | RJ02GB8249 | Renewal | Own Damage | n/a · n/a | ICICI n/a · FG n/a | PASS |
| CV-12 | RJ02GB8249 | Renewal | Comprehensive | n/a · quote | ICICI n/a · FG referral-declined | FAIL |
| CV-13 | WB73F9617 | New | Third Party | n/a · quote | ICICI n/a · FG ₹16,851 | PASS |
| CV-14 | WB73F9617 | New | Own Damage | n/a · n/a | ICICI n/a · FG n/a | PASS |
| CV-15 | WB73F9617 | New | Comprehensive | n/a · quote | ICICI n/a · FG ₹24,359 | PASS |
| CV-16 | WB73F9617 | Rollover | Third Party | n/a · quote | ICICI n/a · FG ₹16,851 | PASS |
| CV-17 | WB73F9617 | Rollover | Own Damage | n/a · n/a | ICICI n/a · FG n/a | PASS |
| CV-18 | WB73F9617 | Rollover | Comprehensive | n/a · quote | ICICI n/a · FG ₹20,407 | PASS |
| CV-19 | WB73F9617 | Break-in | Third Party | n/a · quote | ICICI n/a · FG ₹16,851 | PASS |
| CV-20 | WB73F9617 | Break-in | Own Damage | n/a · n/a | ICICI n/a · FG n/a | PASS |
| CV-21 | WB73F9617 | Break-in | Comprehensive | n/a · quote | ICICI n/a · FG ₹20,407 | PASS |
| CV-22 | WB73F9617 | Renewal | Third Party | n/a · quote | ICICI n/a · FG ₹16,851 | PASS |
| CV-23 | WB73F9617 | Renewal | Own Damage | n/a · n/a | ICICI n/a · FG n/a | PASS |
| CV-24 | WB73F9617 | Renewal | Comprehensive | n/a · quote | ICICI n/a · FG ₹20,407 | PASS |

### G2. Results — EV — electric two-wheeler (ICICI only)

| Case ID | Reg. Number | Scenario | Coverage | Expected (ICICI · FG) | Actual (ICICI · FG) | Status |
|---|---|---|---|---|---|---|
| EV-01 | MH12UX9405 | New | Third Party | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| EV-02 | MH12UX9405 | New | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| EV-03 | MH12UX9405 | New | Comprehensive | quote · n/a | ICICI ₹6,295 · FG n/a | PASS |
| EV-04 | MH12UX9405 | Rollover | Third Party | quote · n/a | ICICI ₹1,428 · FG n/a | PASS |
| EV-05 | MH12UX9405 | Rollover | Own Damage | quote · n/a | ICICI ₹793 · FG n/a | PASS |
| EV-06 | MH12UX9405 | Rollover | Comprehensive | quote · n/a | ICICI ₹1,428 · FG n/a | PASS |
| EV-07 | MH12UX9405 | Break-in | Third Party | quote · n/a | ICICI ₹1,428 · FG n/a | PASS |
| EV-08 | MH12UX9405 | Break-in | Own Damage | quote · n/a | ICICI ₹793 · FG n/a | PASS |
| EV-09 | MH12UX9405 | Break-in | Comprehensive | quote · n/a | ICICI ₹1,428 · FG n/a | PASS |
| EV-10 | MH12UX9405 | Renewal | Third Party | quote · n/a | ICICI ₹1,428 · FG n/a | PASS |
| EV-11 | MH12UX9405 | Renewal | Own Damage | not offered · n/a | ICICI rejected (capability) · FG n/a | PASS |
| EV-12 | MH12UX9405 | Renewal | Comprehensive | quote · n/a | ICICI ₹1,428 · FG n/a | PASS |

### G3. What the live run showed (deltas vs §B/§F)

- **Make/model resolution gap (new, High):** 8 of the 12 supplied plates do **not** auto-resolve — their RC `maker_description` is `NULL` (Splendor, SP125, Ertiga, Sonet, City) or has make/model **swapped** (Activa, HF Deluxe, CD Deluxe). The vehicle-details page has no make/model dropdown to correct this (variant dropdown is empty when search returns nothing), so these dead-end before a quote in the UI. Listed as `manual` in G1.
- **HP56A2156 (2W): 0 quotes** — ICICI has no 2W RTO code for series HP56 (`NO_MAP`), and FG has no 2W line.
- **MH49CD6854 Kia Sonet (4W): ICICI all fail `Vehicle make not found`** — the stored ICICI make-code mapping for this row is invalid (data bug; run `validate-icici-codes.ts`). FG quotes fine.
- **FG New-business rules confirmed live:** FG returns *new-TP not offered* and *new-OD not allowed* — these are correct vendor rules, surfaced as errors (consider a friendlier UI message).
- **FG `REFERRAL_DECLINED`:** KA05MN3937 (old Ertiga) and RJ02GB8249 (Ashok Leyland) declined on underwriting referral — legitimate vendor decision (relates to RT-04).
- **ICICI UAT auth/gateway flapped** (worked 16:03, `503` by 16:16) — scattered transient errors are vendor infra, not app bugs (relates to RT-02/RT-05).
- **Proposal (no payment):** FG `quote → proposal-only` succeeded (nothing bound). ICICI proposal not confirmable this session due to the UAT `503` auth outage (ICICI quoting itself succeeded 89×).
- **Renewal at API layer:** unlike the UI (§DF-01, unreachable), the API accepts `businessType=renewal` and ICICI/FG priced it where offered (ICICI renewal-OD correctly rejected).

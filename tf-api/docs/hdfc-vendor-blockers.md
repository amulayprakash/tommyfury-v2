# HDFC ERGO — consolidated vendor blockers

**From:** NovaCred / Tommy & Furry integration team
**Product:** Private Car, HEI API (UAT channel `SOURCE = NOVACRED`, `CHANNEL_ID = NOVA0001`)
**Date:** 13/08/2026

## Where the integration stands

HDFC ERGO is live on our UAT as a Private Car motor provider. We run HDFC's own
certification pack, `PVTcarTestScenarios.xls` (205 conditions across the sheets
*New and Rollover* 36, *Long Team* 152, *Used Car* 12 and *Break In* 5), against
live UAT through the production adapter. Current standing:

| Verdict | Count |
| --- | ---: |
| PASS | 104 |
| FAIL (our defect) | 0 |
| Could not be priced by UAT | 88 |
| Not expressible / not observable read-only | 11 |
| Manual / UI-only conditions | 2 |
| **Total** | **205** |

192 of the 205 conditions produced a live HDFC response. There are no open
defects on our side.

On 13/08/2026 we also bound **five real UAT policies end to end** — quote,
Pehchaan e-KYC, CreateProposal, SubmitPaymentDetails, GetPolicyDocument:

| Scenario | Proposal no. | Gross | Policy no. |
| --- | --- | ---: | --- |
| Roll Over 1+1 comprehensive, no add-ons | 202608130000197 | ₹5,715 | 2302201225648600000 |
| Roll Over 1+1 comprehensive, all covers | 202608130000199 | ₹14,162 | 2302201225648700000 |
| New Business 1+3 comprehensive | 202608130000205 | ₹22,714 | 2302201225648800000 |
| Standalone OD 0+1 | 202608130000207 | ₹1,300 | 2302201225648900000 |
| Liability 0+1 (TP only) | 202608130000212 | ₹4,414 | 2302201225649000000 |

The items below are the ones we cannot close from our side. Each states what we
observe, HDFC's verbatim message, how we isolated it, and what we need.

## Summary

| # | Blocker | Pack conditions blocked | What we need from HDFC |
| ---: | --- | ---: | --- |
| 1 | 2OD-3TP package term refused | 37 (of the 38-condition 2+3 block) | A working 2OD-3TP CalculatePremium payload, or confirmation the term is not sellable |
| 2 | Two-year standalone OD refused | 37 (of the 38-condition 2+0 block) | Whether a 2-year SAOD exists, and what end date expresses it |
| 3 | Used Car business type not authorized | 8 (10 of 12 Used Car conditions unreachable overall) | Entitle `NOVACRED` / `NOVA0001` for the Used Car product on UAT |
| 4 | Break-in proposals cannot be created | 0 at quote time; **all** break-in issuance | How an API channel obtains a `BreakIN_ID` |
| 5 | Missing UAT IDV master rows (Mercedes-Benz, hybrid) | 4 | Populate the UAT IDV master, or give us model codes that price |
| 6 | Rules-engine crash on Higher Protection and Removal Costs | 2 | Add the missing rate; fix the crash that masks the real error |
| 7 | Gold plan contains an unidentifiable cover | 4 | What cover is `N161521G0020`, and is Gold a live plan? |
| 8 | Financier master has no cross-walk | 1 | A name → `FinancierCode` lookup, or confirmation that null is acceptable |
| 9 | Pehchaan e-KYC returns identities unrelated to the PAN | 0 | Confirm UAT test-pool behaviour and the proposal/KYC consistency rule |
| 10 | Previous-insurer shortname master incomplete on our side | 0 | The authoritative `Insurance_Company` shortname list you accept |

---

## 1. The 2OD-3TP package term is refused by the rules engine

**What we observe.** A New Business package (`POLICY_TYPE: "OD Plus TP"`) with a
two-year own-damage leg and the statutory three-year third-party leg cannot be
priced. HDFC's own data dictionary documents the term:
`PrivateCarDataDictionary.xlsx`, sheet `03 CalculatePremium Request`, field 40
(`POLICY_TENURE`) states, verbatim, for `Product Code - 2311 (Comprehensive)`:

```
New Policy -  1OD – 3TP, 2OD - 3TP, 3OD - 3TP
```

**HDFC's verbatim message.**

`SA_OD Policy is only allowed for Short Term Policy period`

and, for non-year-based end dates, separately:

`Kindly pass valid policy start and end dates. Policy should be year-based.`

**What we proved.** On 13/08/2026, model `12798` (Maruti Swift ZXI), RTO `10406`,
policy starting 13/08/2026, we exhausted both routes the API gives for stating a
term on this product:

| Payload | HDFC UAT |
| --- | --- |
| `POLICY_TENURE = 1`, no end date | prices — OD ₹8,284, no IDV ladder |
| `POLICY_TENURE = 3`, no end date | prices — OD ₹12,300, `IdvYear1`–`IdvYear3` populated |
| `POLICY_TENURE = 2`, no end date | refused: `SA_OD Policy is only allowed for Short Term Policy period` |
| `POLICY_TENURE = 2`, `PolicyEndDate` 12/08/2028 (start + 2y − 1d) | refused, same message |
| `POLICY_TENURE = 2`, `PolicyEndDate` 12/08/2029 (start + 3y − 1d) | prices — but returns the THREE-year figures: OD ₹12,300 with `IdvYear3` populated |

So the one end date in that region HDFC accepts writes a 3+3 wearing a 2+3
label. We will not sell that: the customer did not choose a three-year term.
Every other end date is refused earlier with the year-based message, which also
shows the dates themselves are well formed. `CPA_Tenure` is not involved — the
refusal is identical with compulsory PA switched off, and we never send the
value 2 there (the dictionary allows 1 or 3 only).

**Newly found, 13/08/2026 — the kit ships no working example.** The collection
`Private Car_New.postman_collection` contains folders named `1 OD + 3 TP`,
`2 OD + 3 TP` and `3 OD + 3 TP`. Their three `03 CalculatePremium` request
bodies are **byte-identical** — same length, same SHA-1 — and every term-bearing
field is the same in all three: `POLICY_TENURE: 1`, `POLICY_TYPE: "OD Plus TP"`,
`PolicyStartDate: 25/04/2024`, and no `PolicyEndDate` key at all. The
`2 OD + 3 TP` folder's `04 CreateProposal` sample then carries a **one-year**
term (`PolicyStartDate` 12/03/2025 → `PolicyEndDate` 11/03/2026), as does the
`3 OD + 3 TP` one. The folders are relabelled copies; nothing in the kit
demonstrates a 2+3 policy.

**Conditions blocked.** 37 of the 152 *Long Team* conditions are refused with
this message. The 2+3 term block is 38 conditions in total; the 38th is the Gold
plan row, blocked separately by item 7.

**What we need.** A CalculatePremium payload that actually prices a 2OD-3TP
policy on UAT — or, if the term is not sellable on PRODUCT_CODE 2311, written
confirmation of that so we can remove it from the journey and from the
certification scope.

---

## 2. A two-year standalone OD falls in a gap between the accepted bands

**What we observe.** On the standalone-OD product `POLICY_TENURE` is inert — the
term is carried by `Policy_Details.PolicyEndDate`. A one-year OD prices and a
three-year OD prices, but a straight two-year term is refused.

**HDFC's verbatim message.**

`Policy Tenure is not Correct for Short-Term`

and, past the upper bound:

`Invalid Short Term Policy period`

**What we proved.** We swept `PolicyEndDate` one day at a time from +6 months to
+3 years (model `12798`, RTO `10406`, policy starting 10/08/2026):

| Span from inception | HDFC UAT |
| --- | --- |
| ≤ 365 days | prices as a one-year OD, no IDV ladder |
| 366–730 days | refused: `Policy Tenure is not Correct for Short-Term` |
| 731–1095 days | prices multi-year — `IdvYear1` and `IdvYear2` populated |
| ≥ 1096 days | refused: `Invalid Short Term Policy period` |

There is therefore exactly one multi-year standalone-OD band, and a two-year
term (start + 2 years − 1 day = 730 days) falls in the hole immediately beneath
it. The refusal tracks the end date alone: results were identical at
`POLICY_TENURE` 1, 2 and 3 for every end date tried.

**Conditions blocked.** 37 of the 152 *Long Team* conditions. The 2+0 term block
is 38 conditions; the 38th is again the Gold plan row (item 7).

**What we need.** Confirmation of whether a two-year SAOD is a supported product
and, if it is, what `PolicyEndDate` expresses it. If the gap is intentional we
will drop the term from the journey.

Two smaller observations from the same sweep, offered for information rather
than as blockers: `IdvYear3` comes back 0 even on HDFC's own three-year SA_OD
sample replayed verbatim, and the multi-year OD priced **below** the one-year OD
on the same vehicle on the same day (₹8,070 vs ₹9,775 gross), which is the wrong
direction for a longer term.

---

## 3. The Used Car business type is not authorized for our UAT channel

**What we observe.** Any request carrying
`Policy_Details.BusinessType_Mandatary: "Used Car"` is refused, whatever else it
contains.

**HDFC's verbatim message.**

`Channel Not Authorized to consume given method..Please contact administrator !`

**What we proved.** Isolated to that single field on live UAT (10/08/2026,
3-year-old Swift, model `12798`, RTO `10406`):

| Payload | HDFC UAT |
| --- | --- |
| Roll Over templates, untouched | prices, gross ₹6,242 |
| Roll Over templates, `BusinessType_Mandatary` → `"Used Car"` | refused |
| Used Car templates, `BusinessType_Mandatary` → `"Roll Over"` | prices, gross ₹12,863 |

Our Used Car payload is therefore structurally acceptable to HDFC — it is the
entitlement that is missing. Every other row of the same run authenticates and
prices on the same credentials. (The ₹12,863 vs ₹6,242 difference in the third
row is expected: the Used Car template nulls the previous-policy block, so no
NCB is granted, which is what your own pack states for a used car.)

**Conditions blocked.** 8 conditions carry this message. The *Used Car* sheet
has 12 conditions in total: 8 refused here, 2 more (the Mercedes-Benz rows)
refused by item 5, and 2 risk-start-date checks that are only observable at
CreateProposal. So 10 of 12 are unreachable on UAT today.

**What we need.** Please entitle our UAT channel (`SOURCE = NOVACRED`,
`CHANNEL_ID = NOVA0001`) for the Used Car product.

---

## 4. Break-in proposals cannot be created — no way to obtain a `BreakIN_ID`

**What we observe.** A rollover whose previous cover has lapsed quotes correctly
but cannot be turned into a proposal.

**HDFC's verbatim message.**

`Break-in ID required`

(observed live on 13/08/2026 at CreateProposal, scenario 6 of our issuance run:
`HDFC createProposal failed: Break-in ID required`)

**What we proved.** Quoting behaves exactly as your pack describes. The
`Break In` sheet of `PVTcarTestScenarios.xls` states, verbatim, for a break-in
over 24 hours: *"Proposal should be triggered for Inspection & Break-in loading
premium will be charged."* Live UAT does charge it — a rollover with a 45-day
lapse returns `BreakInLoadingPercent` 15 and `BreakIN_Premium` 220, and all five
*Break In* sheet conditions PASS at quote time, including the >90-day row where
the NCB is correctly voided.

The proposal step is where it stops. `PrivateCarDataDictionary.xlsx` documents
`Req_PvtCar.BreakIN_ID` (field 43, description *"Enter break-in Id"*), but
neither Postman collection contains an endpoint that would produce one. We
enumerated every request in both:

- `Private Car.postman_collection.json` — Comprehensive (New Business, Roll Over,
  Used Vehicle), Liability, Renewal.
- `Private Car_New.postman_collection` — Comprehensive (New Business 1/2/3 OD +
  3 TP and SA_OD, Roll Over OD Plus TP and SA_OD, Used Vehicle), Liability,
  Renewal.

Every folder contains only the standard sequence — `Authenticate`,
`GetCalculateIDV`, `CalculatePremium`, `CreateProposal`, `GetProposalDocument`,
`SubmitPaymentDetails`, `GetPolicyDocument` (plus `RenewalExtract` in the
Renewal folder). There is no request that creates a break-in case, uploads
inspection evidence, or returns a `BreakIN_ID`. We have accordingly not
implemented an inspection operation, on the reading that break-in is triggered
at HDFC's end.

**Conditions blocked.** No pack conditions — the *Break In* sheet is judged at
quote time and all 5 rows pass. What this blocks is **all break-in issuance**,
which is an ordinary and common customer situation (a lapsed policy being
renewed), not an edge case.

**What we need.** One of:

1. How an API channel obtains a `BreakIN_ID` — which endpoint, which host,
   which credentials.
2. Whether an inspection/break-in API exists outside this kit that we should be
   integrated against.
3. Whether `Req_PvtCar.BreakinWaiver` is the intended path for an aggregator
   channel and, if so, under what authority we may set it. We currently send
   `false` on every payload and will not change that without your instruction.

---

## 5. UAT IDV master has no rows for Mercedes-Benz or hybrid vehicles

**What we observe.** `GetCalculateIDV` returns no IDV for these vehicles, so
nothing downstream can be priced.

**HDFC's verbatim messages.**

`Please provide Vehicle IDV`

and, from `getcalculateidv`, a body with no further detail:

`BUSINESS EXCEPTION`

(the full body is `{"StatusCode":400,"Error":"BUSINESS EXCEPTION"}`)

**What we proved.** Every Mercedes-Benz model code we tried on UAT returns one
of the two: `50904`, `53431`, `39500`, `41334`, `42914`, `48556`, `45164`,
`47999`. All three hybrid codes tried behave the same way: `48622`, `53024`,
`47921`. No other fuel type reproduces the bare `BUSINESS EXCEPTION` at the IDV
step, so we read it as absent master data rather than a malformed payload. (Separately, the same message appears from around 11 years of vehicle
age on a model that otherwise prices, which is consistent with an IDV table that
simply stops.)

This matters because your own pack requires those vehicles:
`PVTcarTestScenarios.xls`, *Used Car* rows 6 and 12, expected result
*"ZD cover mandatory for MERCEDES-BENZ. Make"*; and the *Long Team* sheet has
"verify the TP premium for fuel type Hybrid" at every term.

**Conditions blocked.** 4 conditions directly (2 Mercedes-Benz, 2 hybrid). Two
further hybrid rows sit inside the 2+3 and 2+0 term blocks and are blocked by
items 1 and 2 first.

**What we need.** Either populate the UAT IDV master for Mercedes-Benz and
hybrid models, or supply specific model codes that do return an IDV on UAT so
these conditions can be certified.

---

## 6. Higher Protection and Removal Costs: missing rate, and a rules-engine crash that hides it

**What we observe.** The cover `IsHighProtection_Cover` cannot be priced on UAT,
and the two business types report the same underlying problem differently.

**HDFC's verbatim messages.** On New Business:

`Exception while Call Blaze! After parsing a value an unexpected character was encountered: m. Path 'error[0].stackTrace', line 1, position 26472.`

(the same crash at position 25368 on the 3+0 term). On Roll Over, the same
request instead returns:

`Higher Protection and Removal Costs - Add on system rate is not available`

**What we proved.** We swept `HigherTowingLimit` on a Roll Over across
`null`, `1`, `2`, `3`, `25000` and `50000`. Every value returns the
"Add on system rate is not available" message, so the towing limit is not the
missing input — the rate row is simply absent. We reached this by elimination
after an earlier hypothesis blamed a null limit; that hypothesis was wrong. On
New Business the identical request returns the truncated-stack-trace crash
instead, which tells the caller nothing.

For contrast, EMI Protector Plus produced a superficially similar
"Add on system rate is not available" message and turned out to be **our**
under-specified payload: the cover needs `NoOfEmi`, a non-zero `EMIAmount` and
`EMIPlanType` together, and prices once all three are present. We checked
Higher Protection the same way and found no equivalent missing input.

**Conditions blocked.** 2 conditions. Two further rows of the same kind sit
inside the 2+3 and 2+0 term blocks.

**What we need.** Two things: the missing rate row for
"Higher Protection and Removal Costs" in the UAT masters, and a fix for the
`Exception while Call Blaze!` response on New Business, which masks the real
error and would mask any other error arising in the same place. Until the cover
prices we leave it off the compare card rather than offering an option nobody
can price.

---

## 7. The Gold plan contains a cover we cannot identify

**What we observe.** `PlanType` "Gold" appears in your certification pack but we
can find no description of what it contains, and we have therefore not put it in
our plan catalogue.

**What we proved.** Three independent checks, all negative:

1. **Absent from your master workbook.** `PrivateCarMasterData.xls`, sheet
   `PlanTypes`, lists exactly six plans: Silver Plan, Platinum plan, Titanium
   plan, Diamond plan, Essential ZD plan, Essential EGP plan. Gold is not among
   them.
2. **Never eligible on the wire.** `GetCalculateIDV` →
   `CalculatedIDV.addonPlansToCoversMapping` returns `isEligibile: false` for
   Gold on every vehicle we probed (a 1-year-old and a 6-year-old Swift), on both
   the plan and the product cover-group lists. `isEligibile` is meaningful
   elsewhere — the two "Essential" plans correctly flip from `false` to `true`
   between those two vehicles, matching the master's Validity column.
3. **One of its covers decodes to nothing.** We decode cover groups by matching
   each group's `computedRate` against the `*_Premium_Rate` fields of a
   CalculatePremium response on the same vehicle. Every other group resolves
   (e.g. `N161521G0034` → `Vehicle_Base_ZD_Premium_Rate` = Zero Depreciation;
   `N161521G0023` → NCB Protection; `N161521G0014` → Engine & GearBox).
   Gold's first mandatory group is Zero Depreciation. Its second,
   `N161521G0020`, matches nothing: its `computedRate` (0.001) appears in no
   `*_Premium_Rate` field on the response, and the code appears in no other
   source we hold.

We will not sell a plan containing a cover nobody can name, so Gold is
deliberately absent from our catalogue and a request naming it is ignored.

**Conditions blocked.** 4 conditions (the "Plan type Gold" row at each of the
four terms).

**What we need.** What cover is `N161521G0020`, and is Gold a live plan on this
product? If it is, we also need to understand why `isEligibile` is false on every
vehicle we can price.

---

## 8. Financier master has no cross-walk from a financier name

**What we observe.** We send `Policy_Details.FinancierCode` as `null` on every
proposal, including for hypothecated vehicles.

**Why.** `PrivateCarDataDictionary.xlsx` (field 36) specifies FinancierCode as a
`double` and says: *"Mandatary incase if financier details are available. Refer
Master Data Sheet "GENMST_FINANCIER". Data Column "NUM_FINANCIER_CD"."* That
sheet holds roughly 65,000 rows keyed on `TXT_FINANCIER_NAME` /
`NUM_FINANCIER_CD`. A canonical quote request in our system carries only the
financier's **name**. Unlike insurers — where an industry shortname gives us
something to join on — there is no shared identifier between a free-text
financier name and your numeric code, and fuzzy name matching across 65,000 bank
and NBFC names would produce silent wrong answers on a policy document. We send
null rather than guess. `BranchName` likewise has no source on our side.

Note this is an honest description of a gap on our side as much as a request:
the hypothecation is currently invisible on the HDFC policy.

**Conditions blocked.** 1 condition (*New and Rollover* row 20, "Financier
detail's should be sent if selected"). We have since closed the `AgreementType`
half of that row — hypothecation vs lease now comes through correctly.

**What we need.** Either a name → `FinancierCode` lookup endpoint (or an
authoritative alias list we can import), or written confirmation that a null
`FinancierCode` is acceptable on a hypothecated vehicle, in which case we will
record the gap and move on.

---

## 9. Pehchaan e-KYC returns identities unrelated to the PAN submitted

**What we observe.** Our first live Pehchaan calls were made on 13/08/2026
against `https://ekyc-uat.hdfcergo.com/e-kyc`, endpoint
`/primary/kyc-verified`. Two useful findings, one good and one that needs
confirmation.

**The good one: verification is headless.** Both calls returned a verified KYC
directly — `iskycVerified: 1`, `status: "approved"`, a real `kyc_id` — with no
`redirection_link` in either response. A server-side flow can therefore complete
e-KYC unattended, without sending the customer through the hosted Pehchaan
journey. Our redirect-handling branch consequently remains unexercised and
unproven.

**The one that needs confirmation.** The same PAN, `ABCPD1234E`, returned two
different identities on two consecutive calls:

| Call | Request | Response |
| --- | --- | --- |
| 1 | panNumber + dob + mobile + fullName + txn id | `kycId` `DUT8DKQABF`, status `approved`, name `"Rahul Automation"`, pan `"UQSPF3870N"` |
| 2 | panNumber + txn id only | `kycId` `338D8R5Y8H`, status `approved`, name `"Anmol Arora"`, pan `"ABCPD1234E"` |

The two records also differ in date of birth and address, and call 1's response
carried a **different PAN** from the one submitted. `mobile` and `email` came
back empty in both responses, even though call 1 supplied a mobile number.

The only conclusion the evidence supports is that UAT appears to return an
identity from a fixed test pool rather than verifying the specific PAN
submitted. We are stating that as an inference, not a fact about your system,
and we have made no assumption about production behaviour.

**Conditions blocked.** None in the pack; this is an issuance-path question.

**What we need.**

1. Confirmation that this is UAT test-pool behaviour and that production
   verifies the actual PAN submitted.
2. Confirmation of whether `CreateProposal` validates `Customer_Pehchaan_id`
   against the `Customer_Details` block. Because the Pehchaan record carries its
   own name, date of birth and address, we currently build the proposal's name
   and DOB **from the KYC record** so the two cannot disagree. If HDFC does not
   validate the pair, or overwrites one from the other, we would like to know so
   the customer-facing data is the customer's own.

---

## 10. Previous-insurer shortnames — we map 8 of your 38

**What we observe.** Our cross-walk from canonical insurer to HDFC's
`Insurance_Company` shortname currently resolves only 8 of the 38 rows in
`PrivateCarMasterData.xls`. Where it does not resolve, we send `null` rather
than an invented value, because an unrecognised code is rejected outright
(*"No Data found for given previous insured code"* for a generic `"OTHERS"`).

**Why it is more than cosmetic.** A standalone OD proposal **requires** a
previous TP insurer. Proven live on 13/08/2026: with `previousInsurerId` unset,
`PreviousPolicy_TPINSURER` went out null and HDFC refused the proposal with

`Valid TP policy is required to book SAOD Policy.`

Supplying the shortname `TATAAIG` — taken verbatim from your own
`Insurance_Company` sheet — let the same proposal through, and it became bound
UAT policy `2302201225648900000` (row 4 of the issuance table above). Your data
dictionary marks all four `PreviousPolicy_TP*` fields mandatory when
`Req_PvtCar.POLICY_TYPE` is `"OD Only"`. So for the 30 insurers we have not
mapped, a real standalone-OD sale would fail at proposal.

**To be clear about ownership:** completing this cross-walk is our work, not
yours, and we have already identified the main causes (make/name spelling
differences such as `"MARUTI"` vs `"MARUTI SUZUKI"` on the vehicle side, and
duplicate rows on the insurer side — your sheet lists HDFC ERGO, Edelweiss,
Raheja QBE, Tata AIG and Universal Sompo twice each).

**Conditions blocked.** None in the pack; this is a live-sale risk on the
standalone-OD product.

**What we need.** The authoritative, current list of `Insurance_Company`
shortnames your API accepts in `PreviousPolicy_TPINSURER` and
`PreviousPolicy_CorporateCustomerId_Mandatary` — ideally with the duplicates
resolved — so we can complete the mapping against something official rather than
inferring it from the workbook.

---

## Sources

Everything above is reproducible from this repository:

| Evidence | Where |
| --- | --- |
| 205-condition pack results, per row, with verbatim messages | `tf-api/docs/hdfc-uat-scenario-results.md` (`npm run hdfc:scenarios`) |
| Live issuance run and policy numbers | `tf-api/docs/hdfc-uat-issuance-results.md` (`npm run hdfc:issue`) |
| Isolation probes and integration behaviour notes | `tf-api/docs/hdfc-integration-notes.md` |
| Scenario definitions and per-limitation reasoning | `tf-api/scripts/hdfc-uat-scenarios.ts` |

Vendor artefacts referenced: `PVTcarTestScenarios.xls`,
`PrivateCarDataDictionary.xlsx`, `PrivateCarMasterData.xls`,
`Private Car.postman_collection.json`, `Private Car_New.postman_collection`.

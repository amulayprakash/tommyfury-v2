# HDFC ERGO — consolidated vendor blockers

**From:** NovaCred / Tommy & Furry integration team
**Product:** Private Car, HEI API (UAT channel `SOURCE = NOVACRED`, `CHANNEL_ID = NOVA0001`)
**Date:** 13/08/2026 (last updated 21/08/2026)

## Where the integration stands

HDFC ERGO is live on our UAT as a Private Car motor provider. We run HDFC's own
certification pack, `PVTcarTestScenarios.xls` (205 conditions across the sheets
*New and Rollover* 36, *Long Team* 152, *Used Car* 12 and *Break In* 5), against
live UAT through the production adapter.

> ### Current standing, 21/08/2026
>
> **PASS 96 · FAIL (our defect) 0 · could not be priced by UAT 96 · not
> expressible read-only 11 · manual 2.** Eight conditions moved out of PASS
> between 13/08 and 21/08, every one of them because UAT's own behaviour changed
> — see items 11 and 12. **There are still no open defects on our side.** The
> full before/after table is a few paragraphs below.

**Standing as measured 13/08/2026** — the baseline the numbered items below were
written against, kept so the deltas can be read. It is NOT the current standing:

| Verdict | Count (13/08/2026) |
| --- | ---: |
| PASS | 104 |
| FAIL (our defect) | 0 |
| Could not be priced by UAT | 88 |
| Not expressible / not observable read-only | 11 |
| Manual / UI-only conditions | 2 |
| **Total** | **205** |

On that date 192 of the 205 conditions produced a live HDFC response, and there
were no open defects on our side.

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

**Update, 21/08/2026 — four UAT behaviour changes since this table was measured,
all now isolated.** The counts above are the 13/08/2026 standing. Between roughly
17/08 and 21/08, UAT began refusing `Policy_Details.Registration_No: null` at
CalculatePremium (we have adapted; see the observation after item 12); behind it,
began refusing `POLICY_TENURE = 1` on New Business, withdrawing the ordinary 1+3
new-car term (**item 11**); stopped computing any break-in loading premium
(**item 12**); and stopped enforcing the 25%-of-sum-insured accessory cap, which
we have taken over ourselves (the last is not a blocker — see the observation
after item 12).

Re-running the *New and Rollover* and *Break In* sheets on 21/08 moves the table
above as follows. The other two sheets have not been re-measured since 19/08 and
are carried forward unchanged.

| Verdict | 13/08/2026 | 21/08/2026 |
| --- | ---: | ---: |
| PASS | 104 | 96 |
| FAIL (our defect) | 0 | 0 |
| Could not be priced by UAT | 88 | 96 |
| Not expressible / not observable read-only | 11 | 11 |
| Manual / UI-only conditions | 2 | 2 |
| **Total** | **205** | **205** |

Every one of the eight conditions that moved from PASS is accounted for by items
11 and 12 above: three by the withdrawn 1+3 term, five by the withdrawn break-in
loading. **There are still no open defects on our side.**

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
| **11** | **`POLICY_TENURE = 1` refused on New Business — the ordinary 1+3 new-car term** | **3** (the whole New Business 1+3 block; every new-car sale in practice) | **A payload that prices a 1OD-3TP New Business car today, or confirmation the term is withdrawn** |
| **12** | **Break-in loading premium is no longer computed at any lapse window** | **5** (Break In rows 2–4, New and Rollover rows 9 and 12) | **Confirmation of whether break-in loading is switched off on UAT, and which of your two documents states the real threshold** |

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
premium will be charged."* Live UAT **did** charge it when this was written — a
rollover with a 45-day lapse returned `BreakInLoadingPercent` 15 and
`BreakIN_Premium` 220, and all five *Break In* sheet conditions passed at quote
time, including the >90-day row where the NCB is correctly voided. As of
21/08/2026 it no longer charges any loading at any lapse window; that is
**item 12**, and it does not change what this item asks for.

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
hosted-journey link in either response. A server-side flow can therefore
complete e-KYC unattended, without sending the customer through the hosted
Pehchaan journey.

**Correction, 21/08/2026 — the redirect path IS proven, and the defect was
ours.** This paragraph originally continued "our redirect-handling branch
consequently remains unexercised and unproven", and named the field
`redirection_link`. Both statements were wrong and are withdrawn. Running the
corporate endpoint `/partner/corporate/kyc` against your kit's own negative test
entity (`ent_pan=BMZPA6536P&doi=29/01/1996`) returned `iskycVerified: 0`,
`kyc_id: null` and a hosted-journey URL under the key **`redirect_link`** — the
spelling both Pehchaan kits use in all nine of their negative samples (six in
*1.2*, three in *1.2.1*). `redirection_link` and `redirectionLink` appear
**zero** times in either document. Our reader was keyed on a spelling Pehchaan
never emits, so the branch could not have fired at all; it is fixed and the
redirect path is now exercised end to end on live UAT. Nothing is asked of you
here — it is recorded because the earlier wording in your copy of this document
was incorrect.

**New evidence on this item, 21/08/2026 — the CORPORATE endpoint does not show
the behaviour below.** The same probe's two positive cases
(`ent_cin=U74999DL2021PTC388965&doi=26/10/2021` and
`ent_pan=AADCC2489H&doi=20/11/2007`, both from your kit's own "Test data on
UAT") each echoed the submitted identifier and DOI back verbatim, and case 2
returned the kit's own documented `ckycNumber` `80047842325885` for the PAN we
sent. Two runs 24 seconds apart returned identical `kyc_id`, `name` and
`ckycNumber`. So whatever produces the individual endpoint's behaviour below
appears to be specific to `/primary/kyc-verified`. Two caveats we will not hide:
case 1's name came back "AEROTRUST AVIATION PVT LTD" where the kit documents
"ADANI POWER (JHARKHAND) LIMITED" (your kit's case-1 sample is internally
inconsistent — its CURL uses a different CIN — so the likeliest reading is a
pasted sample, not a substituted entity), and both corporate cases returned
empty `mobile` and `email` exactly as the individual ones did.

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

## 11. `POLICY_TENURE = 1` is refused on New Business — the ordinary 1+3 new-car term cannot be priced

**Raised 21/08/2026. This is a regression: the same payloads priced on
13/08/2026, and one of them was bound as a real UAT policy.**

**What we observe.** A New Business package
(`BusinessType_Mandatary: "New Vehicle"`, `POLICY_TYPE: "OD Plus TP"`) sent with
`POLICY_TENURE = 1` — a one-year own-damage leg beside the statutory three-year
third-party leg — is refused outright at CalculatePremium. The identical payload
at `POLICY_TENURE = 3` prices normally.

This is 1+3: the standard term on a new private car in the Indian market, the
term your own certification pack specifies for *New and Rollover* rows 1, 2 and
3, and the term every `Req_PvtCar` sample in **both** Postman collections sends.
Items 1 and 2 above block exotic terms (2+3, 2+0) that no aggregator sells in
volume. This one blocks the common case, which makes it materially more serious:
as it stands we cannot quote HDFC on a new car at all.

**HDFC's verbatim message.**

`Policy period cannot be less than 3 years`

returned as `{"StatusCode":0,"Message":"Policy period cannot be less than 3
years","Error":"Policy period cannot be less than 3 years","Warning":" Zero
Premium calculated for opted cover : Basic - OD | Risk : Vehicle Base Value !!!
Zero Premium calculated for opted cover : Basic - TP | Risk : Vehicle Base Value
…"}`.

**What we proved.** On 21/08/2026, against live UAT, model `12798` (Maruti Swift
ZXI), RTO `10406`, policy starting 21/08/2026, IDV pinned at ₹6,64,050 so all six
calls quote the same sum insured. Each row varies **one** input from
certification row *New and Rollover* #1:

| `POLICY_TENURE` | Add-ons | Delivery/registration date | `CPA_Tenure` | HDFC UAT |
| ---: | --- | --- | ---: | --- |
| 1 | off | 21/08/2026 (today) | 1 | refused — row #1 verbatim |
| 1 | **all** | 21/08/2026 | 1 | refused — row #2 verbatim |
| 1 | off | 13/08/2026 | 1 | refused |
| 1 | off | 13/05/2026 (−100 days) | 1 | refused — row #3 shape |
| 1 | off | 21/08/2026 | **3** | refused |
| **3** | off | 21/08/2026 | 1 | **prices** — gross ₹27,453 |

All five refusals carry the same message. So the cause is not the add-on set
(row #2 fails with every cover switched on), not vehicle age (three different
delivery dates all refuse), and not `CPA_Tenure` (patching it 1 → 3 changes
nothing). `POLICY_TENURE` is the only input whose value changes the outcome.

**Why we are sure it is new.** These three rows PASSED on 13/08/2026 at these
exact shapes — row 1 gross ₹22,714, row 2 ₹35,782, row 3 ₹21,685 — and the 1+3
New Business scenario was bound end to end that day as UAT policy
`2302201225648800000` (proposal `202608130000205`, gross ₹22,714), listed in the
issuance table at the top of this document. Nothing changed on our side between
those runs in how the term is expressed.

**Why the 19/08 run did not surface it.** Your API validates
`Policy_Details.Registration_No` **before** the policy term, so while that field
was null the run stopped at the plate message and never reached the term wall.
See the observation below.

**We are not routing around it.** Sending `POLICY_TENURE = 3` would price a
three-year own-damage leg the customer never asked for, and we will not sell a
term nobody chose — the same position we took on the 2+3 rows in item 1. These
rows are therefore recorded unpriced.

**Conditions blocked.** 3 of the 36 *New and Rollover* conditions (rows 1, 2 and
3 — the whole New Business 1+3 block). The commercial impact is larger than that
count suggests: it is every new private car sale.

**What we need.** Either a CalculatePremium payload that prices a 1OD-3TP New
Business private car on UAT today, or written confirmation that the term has been
withdrawn on `PRODUCT_CODE 2311` and what replaces it. If this was an
unannounced rules change, we would also like to know whether it is intended to
reach production.

---

## 12. Break-in loading premium is no longer computed at any lapse window

**What we observe.** `Resp_PvtCar.BreakInLoadingPercent` and
`Resp_PvtCar.BreakIN_Premium` come back **0 on every rollover we can construct**,
however long the cover has been lapsed. There is no error — the quote prices
normally, it simply carries no break-in loading.

**What it used to do.** The same shapes returned a loading eight days earlier:

| Lapse at inception | 10/08 and 13/08/2026 | 21/08/2026 |
| --- | --- | --- |
| 3 days | `BreakInLoadingPercent` 15, `BreakIN_Premium` ₹220 | 0 / 0 |
| 60 days | 15, ₹220 | 0 / 0 |
| 120 days | 15, ₹1,000 | 0 / 0 |

**What we proved,** on live UAT on 21/08/2026 with a Maruti Swift ZXI (`12798`)
at RTO `10406`, sweeping the previous policy's expiry one window at a time and
changing nothing else:

| Lapse (days) | 1 | 3 | 30 | 44 | 45 | 46 | 60 | 90 | 120 | 200 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `BreakInLoadingPercent` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `BreakIN_Premium` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Current_NCB_Per` | 25 | 25 | 25 | 25 | 25 | 25 | 25 | 0 | 0 | 0 |

So the threshold has not moved — the loading is absent everywhere.

**The premium moved by exactly the loading, and by nothing else.** This is the
clearest evidence, because it needs no assumption about payloads at all — it is
your own two responses, subtracted:

| Row | 13/08 gross | 21/08 gross | Difference | Reconciles to |
| --- | ---: | ---: | ---: | --- |
| *Break In* #4, 120-day lapse | ₹15,342 | ₹14,162 | ₹1,180 | 1,000 × 1.18 GST — the withdrawn loading exactly (NCB already 0 on both dates) |
| *Break In* #3, 60-day lapse | ₹5,909 | ₹5,715 | ₹194 | 220 × 0.75 (25% NCB) × 1.18 GST — likewise exact |

The 13/08 column is our certification run of that date, recorded in this
repository at commit `a098827` (`docs/hdfc-uat-scenario-results.md`, *Break In*
rows 3 and 4); the 21/08 column is the sweep above.

Both differences reconcile to the withdrawn loading alone, to the rupee. That
residual of zero is the whole of the argument, and we would rather state its
limit than overstate it: the 13/08 run recorded each row's gross and its
break-in fields, not the complete `Resp_PvtCar`, so "nothing else moved" is an
inference from the residual and not a field-by-field comparison. On that
residual, a change to how a break-in is DETECTED could produce this; a change to
how anything is rated could not. The loading is simply not being computed.

**On our own payload — what we can and cannot rule out.** The only change to our
CalculatePremium payload in this window was `Registration_No` (see the
observation below). We cannot rule it out completely, and we would rather say so
than overstate: the pre-change value was `null`, and since UAT now refuses `null`
outright the exact payload that used to earn the loading is no longer
reproducible. What we can state is that **no payload we are able to send produces
a loading.** Holding a 60-day break fixed and varying that field alone, the two
reachable values — the dashed plate `"MH-01-QQ-7878"` and the literal `"New"` —
returned **byte-identical** responses: IDV ₹5,59,200, OD ₹1,469, TP ₹3,416, gross
₹5,715, loading 0 / 0.

**The lapse itself still reaches your rules engine.** In those very same responses
the NCB is granted at 25% up to 60 days and voided from 90 (own-damage premium
₹1,469 → ₹8,261). `Policy_Details.PreviousPolicy_PolicyEndDate` is therefore being
read and rated on; only the break-in loading is missing from it.

**A contradiction in your own documentation, which we would also like settled.**
`Channel_Integration_Details.pptx`, slide *"Private Car Break-In"*, states:

```
1) Break-in premium will be calculated only if there is a break-in of more than
45 days, other wise break-in loading premium will be calculate as 0.
```

`PVTcarTestScenarios.xls`, sheet *Break In* row 2, states the opposite: a break-in
of **more than 24 hours** should attract a loading and an inspection. Live UAT
sided with the test pack for as long as it charged the loading at all — a 3-day
lapse returned 15% / ₹220 on both 10/08 and 13/08. We have left our test asserting
the pack's reading rather than the deck's, because flipping it would turn the row
green for the wrong reason while the loading is silent everywhere.

**Conditions blocked.** 5 — *Break In* rows 2, 3 and 4, and *New and Rollover*
rows 9 and 12. The commercial impact is that every lapsed-cover renewal is being
quoted without the loading you intend to charge, so an HDFC quote a customer
accepts today would be re-rated at issuance.

**There is a second, customer-facing consequence, and it is live now.** Our
adapter derives the canonical "this proposal needs an inspection" flag from your
own numbers — `isInspectionRequired` is set when `BreakIN_Premium` is greater
than zero, because that is the only break-in signal `CalculatePremium` returns.
With the loading at 0 the flag is false, so **a genuine break-in HDFC quote now
reaches our compare page indistinguishable from a clean one**: the customer is
shown no inspection requirement, and nothing warns them that the price will move.
We have not papered over this by inferring the break-in from our own lapse
arithmetic instead — that would invent an inspection requirement you have not
asserted, on a proposal we cannot create anyway (item 4). It is recorded here
because it is a real exposure that lasts as long as the loading is absent.

**What we need.**

1. Whether break-in loading is deliberately switched off on UAT, and when it
   returns.
2. Which of the two documents above states the real threshold — more than
   45 days, or more than 24 hours.
3. Whether the loading also depends on the break-in tags your channel deck
   describes (`BreakIN_ID`, `BreakInStatus`, `BreakinInspectionDate`). We cannot
   send those — see item 4 — and we did not send them on 13/08 either, when the
   loading was charged; but if the rating now requires them, item 4 becomes
   blocking at quote time and not only at proposal time.

---

## Observation — the 25% accessory cap is no longer enforced, and we have taken it over

Not a blocker: we have adapted, and it is recorded only because it is a fourth
undocumented change in the same few days.

**What changed.** *New and Rollover* row 25 asks for ₹2,00,000 of electrical plus
₹2,00,000 of non-electrical accessories on a Swift whose IDV is ₹5,59,200 — four
lakh of accessories against a cap of ₹1,39,800. On 13/08/2026 you refused it:

`Total optional covers SI should not be more than 25% of Vehicle Base Value!`

On 21/08/2026 the identical request prices, at gross ₹13,258 — IDV ₹5,59,200,
`Electical_Acc_Premium` ₹8,000, `NonElectical_Acc_Premium` ₹525, net ₹11,236.
Re-fired and captured on 21/08/2026 to make sure the figure is a response and
not a memory (`scripts/_hdfc-row25-recapture-2026-08-21T08-06-20-700Z.json`).

**What we have done.** Our adapter now enforces the rule itself and refuses such
a request before CalculatePremium is called, reading "the vehicle SI" as
`Policy_Details.Vehicle_IDV` — the vehicle's base value alone, on your own
wording above.

**How far the cap is unenforced, and one question it leaves open.** We swept the
accessory fields on 21/08/2026 against a Maruti Alto LXI (`12763`) at RTO
`10406`, IDV ₹3,04,000, so the 25% ceiling is ₹76,000
(`scripts/_hdfc-accessory-cap-probe.json`). UAT priced **every** breach we sent,
on both legs:

| Field | ₹72,960 (24%) | ₹79,040 (26%) | ₹1,52,000 (50%) | ₹3,64,800 (120%) |
| --- | --- | --- | --- | --- |
| `BiFuel_Kit_Value` | priced | priced | priced | priced |
| `ElecticalAccessoryIDV` | priced | priced | priced | priced |

Both legs are rated — the kit at a flat 4% of its declared value
(`BiFuel_Kit_OD_Premium` ₹1,216 on ₹30,400, ₹14,592 on ₹3,64,800) — so the values
reach the rating engine; nothing is being ignored, it simply is not capped.

That leaves us unable to settle **whether the LPG-CNG kit belongs inside the 25%
total.** Your test pack names it (*"Total of Accessories(Electrical/Non
Electrical/LPG-CNG KIT)"*), but the only live refusal we ever saw was raised by an
electrical + non-electrical breach and its wording — *"Total optional covers SI"*
— does not enumerate the kit. With UAT refusing nothing today, its behaviour
cannot arbitrate. **We have followed your pack and counted the kit**, which is the
stricter reading; the consequence is that a retro-fitted CNG kit worth more than a
quarter of a small car's IDV now gets no HDFC quote from us.

**One exclusion we did make, on evidence.** On a `TP Only` policy the kit value is
inert: at 26% and at 50% of the IDV the response was identical to the rupee —
gross ₹2,925, `BiFuel_Kit_OD_Premium` 0, `BiFuel_Kit_TP_Premium` a flat ₹60 either
way. Capping an own-damage sum insured on a policy with no own-damage section
would deny a customer a policy over a number you do not rate, so the kit is left
out of the total there. (The electrical and non-electrical IDVs need no such
exclusion — we already force both to 0 on a liability policy.)

**What we would like.**

1. Confirmation that the 25% cap is still an underwriting rule, in which case the
   UAT change is a regression.
2. Whether the denominator is the vehicle's base value or the value including
   accessories. We have assumed the base value, on your *"Vehicle Base Value"*
   wording.
3. **Whether the LPG-CNG kit counts towards the 25%.** If it does not, tell us and
   we will stop counting it — today we are declining ordinary bi-fuel small cars
   that you may well be happy to write.

---

## Observation — `Registration_No` at CalculatePremium changed in the same window

Not a blocker: we have already adapted. It is recorded because it is a second
undocumented change to UAT behaviour inside the same few days, and because it is
what hid item 11 from our 19/08 run.

**What changed.** `Policy_Details.Registration_No: null` used to be accepted at
CalculatePremium on every business type — it is what your own collection's
premium sample sends, and it is what we sent from the start, because supplying a
real plate at premium time once made the schema demand the
`registrationNumberSection*` fields. Since approximately 17/08/2026 the null is
refused:

`Vehicle Registration number is mandatory`

**What we proved,** on live UAT on 21/08/2026 by varying that one field and
holding the rest of the payload constant (IDV pinned, only `TransactionID`
otherwise differing):

| `Registration_No` | Roll Over — Nexon EV `42774`, IDV ₹12,44,800 | New Business 3+3 — Swift ZXI `12798`, IDV ₹6,64,050 |
| --- | --- | --- |
| `null` | refused: `Vehicle Registration number is mandatory` | refused, same message |
| `"MH-01-QQ-7878"` | prices — OD ₹2,861, TP ₹6,712, gross ₹15,977 | prices — OD ₹12,300, TP ₹10,640, gross ₹27,453 |
| `"New"` | prices — **identical to the rupee** | prices — **identical to the rupee** |

So the field is now validated but still not rated. We have changed our mapper to
send the dashed plate where the vehicle has one and the literal `"New"` where it
does not — `"New"` being what your own GetCalculateIDV sample sends and what
CreateProposal already accepted as a fallback.

**What we would like.** Confirmation that `"New"` is the correct value for a
vehicle with no plate yet, and that this change is intentional and will be
reflected in the data dictionary. More generally: a note to integration partners
when CalculatePremium validation changes, since both this and item 11 landed
without one and between them took our New Business journey down.

---

## Sources

The artifacts marked † below are raw probe output. They are deliberately
not committed — `scripts/_*` is gitignored, because these are large regenerable
captures rather than source — so they will NOT be present in a fresh clone of
the repository. **They are available on request and we will attach them to any
reply on the item they support;** the script that produces each one is committed
and named beside it, so any of them can also be re-earned by running it. Every
other row of the table is committed and reproducible from the repository as it
stands:

| Evidence | Where |
| --- | --- |
| 205-condition pack results, per row, with verbatim messages | `tf-api/docs/hdfc-uat-scenario-results.md` (`npm run hdfc:scenarios`) |
| Live issuance run and policy numbers | `tf-api/docs/hdfc-uat-issuance-results.md` (`npm run hdfc:issue`) |
| Isolation probes and integration behaviour notes | `tf-api/docs/hdfc-integration-notes.md` |
| Scenario definitions and per-limitation reasoning | `tf-api/scripts/hdfc-uat-scenarios.ts` |
| Item 11 and the `Registration_No` observation — 12 calls, each with the full CalculatePremium payload sent and the verbatim response | † `tf-api/scripts/_hdfc-regno-sweep.json` (probe: `scripts/_hdfc-regno-sweep.ts`) |
| The accessory cap's composition — 12 calls sweeping the kit and the electrical IDV across the 25% ceiling on both a package and a liability policy | † `tf-api/scripts/_hdfc-accessory-cap-probe.json` (probe: `scripts/_hdfc-accessory-cap-probe.ts`) |
| The accessory cap no longer being enforced on *New and Rollover* row 25 itself — the ₹4,00,000 declaration on the ₹5,59,200 Swift, re-fired on 21/08/2026, payload sent and full response | † `tf-api/scripts/_hdfc-row25-recapture-2026-08-21T08-06-20-700Z.json` (probe: `scripts/_hdfc-row25-recapture.ts`) |
| Item 12 — 12 calls (the plate-vs-`"New"` pair at a fixed 60-day break, then the ten-window lapse sweep), each with the full CalculatePremium payload sent and the verbatim response | † `tf-api/scripts/_hdfc-breakin-sweep.json` (probe: `scripts/_hdfc-breakin-sweep.ts`) |
| Item 12's 13/08/2026 baseline grosses (*Break In* rows 3 and 4, ₹5,909 and ₹15,342) | committed in this repository at git commit `a098827`, `tf-api/docs/hdfc-uat-scenario-results.md` |
| Item 9 — the corporate Pehchaan probe, three cases including the `redirect_link` negative, run twice | † `tf-api/scripts/_hdfc-corporate-kyc-probe-2026-08-21T07-44-06-909Z.json` and `…T07-44-30-325Z.json` (probe: `scripts/_hdfc-corporate-kyc-probe.ts`) |

Vendor artefacts referenced: `PVTcarTestScenarios.xls`,
`Channel_Integration_Details.pptx`, `PrivateCarDataDictionary.xlsx`, `PrivateCarMasterData.xls`,
`Private Car.postman_collection.json`, `Private Car_New.postman_collection`.

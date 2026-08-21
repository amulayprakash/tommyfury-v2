# HDFC ERGO — integration notes

Provider: `src/providers/hdfc/`. Design spec:
`docs/superpowers/specs/2026-08-07-hdfc-ergo-provider-design.md`.
Frozen predecessor: `docs/reference/hdfc-ergo-standalone/`.

HDFC is fully wired — quote, proposal, Pehchaan CKYC, issuance, renewal and
COI — behind `HDFC_ENABLED` (default `false`). 367 unit tests under
`src/providers/hdfc/__tests__/`, fixture-driven
against JSON extracted from HDFC's own Postman collection and, for the response
side, against real captures from live UAT.

**Credentials arrived 2026-08-07 and the integration is live on UAT.**
`npm run hdfc:probe` returns a real quote; `npm run hdfc:scenarios` runs HDFC's
own 205-condition certification pack against the live vendor and writes
`docs/hdfc-uat-scenario-results.md`. Pehchaan e-KYC is wired but has not yet
been exercised live.

## 1. Shape

HEI motor service, JSON over HTTPS. Eight operations; only the `PRODUCT_CODE`
header changes per product. Private Car is `2311`.

    authenticate            GET
    getcalculateidv         POST
    calculatepremium        POST
    createproposal          POST
    getproposaldocument     POST
    submitpaymentdetails    POST
    getpolicydocument       POST
    getpolicydataforrenewal POST

Pehchaan e-KYC is a separate service: own host, `api_key` → ~10-minute JWT.

## 2. Vendor rules that cost UAT cycles to learn

1. `TRANSACTIONID` must be present and unique on the Authenticate header.
2. GetCalculateIDV always sends `Registration_No: "New"` and no
   `registrationNumberSection*` fields.
3. CreateProposal needs the real plate in dash format (`MH-01-QQ-7878`).
4. Always price with HDFC's recommended IDV — deviation is rejected with
   "IDV Deviation not allowed".
5. A rollover's previous policy must expire strictly before the new start date.
6. `PreviousPolicy_CorporateCustomerId_Mandatary` must be a code from HDFC's own
   insurer master; "OTHERS" fails with "No Data found for given previous insured
   code". Supplied by `ProviderInsurerCode(hdfc)`.
7. CalculatePremium sends `null` for the previous insurer and policy number;
   only CreateProposal sends the real values.
8. `YearOfManufacture` must be a bare 4-digit year.
9. Claim status is `"YES"` / `"NO"`, all caps.
10. Each business type has a DIFFERENT `Req_PvtCar` / `Policy_Details` field set.
    Key order is asserted against collection fixtures in
    `src/providers/hdfc/__tests__/req-pvtcar.test.ts` and
    `__tests__/policy-details.test.ts`.
11. Two keys are emitted CONDITIONALLY, on top of those fixed sets, each because
    a payload that needs it is refused without it: `Policy_Details.PolicyEndDate`
    on a multi-year standalone OD, and `Req_PvtCar.EMIPlanType` on New Business
    when the EMI Protector cover is bought. Neither ships on a payload that does
    not need it, so every proven request keeps its proven shape.
12. **A successful CreateProposal answers `StatusCode: 0`.** Not 1, not 200 —
    zero, with `Message: "Proposal Generated"` and a real `ProposalNumber`.
    CalculatePremium on the same connection answers `200` /
    `"Premium Calculated"`, so the success code is **per endpoint** and the kit's
    own collection sample (`fixtures/responses/proposal.json`, `StatusCode: "1"`)
    does not match live UAT. Proven 21/08/2026 on proposals 202608210000216 and
    …219.

    Until it was fixed, `assertHdfcSuccess` reported this as
    *"HDFC createProposal failed: status 0"* — a **false negative on a write**.
    HDFC had already created the proposal; the exception threw the number away
    before the code that reads it, and every retry created another. `http.ts`
    now treats a returned proposal or policy number as proof the write landed,
    outranking an unrecognised status code, rather than widening
    `isHdfcSuccess` to accept `0` everywhere (where it does mean failure).

13. **`Message` is HDFC's other diagnostic channel, and the kit documents it
    inconsistently.** The `03 CalculatePremium Response` and `04 CreateProposal
    Response` sheets list only `StatusCode` / `Error` / `Warning` — but `07
    GetPolicyDocument`'s response sheet *does* list `Message` (row 7,
    *"It Describle the Message"*), and the wire carries it on every endpoint, on
    success and failure alike. A failure populating only `Message` used to
    surface as a bare `status <n>`; `normalizeHdfcResponse` now reads it, after
    `Error`.

    **Do not trust a response sheet's field list to be complete.** Three
    separate bugs this month came from believing one: `Message` here,
    `redirect_link` in Pehchaan, and `PDF_BYTES` below.

14. **GetPolicyDocument answers in `Resp_Policy_Document.PDF_BYTES`.** Not
    `Req_Policy_Document.Document`, which is what `normalizeCertificate` read
    until 21/08/2026 — the REQUEST container plus a field name that exists
    nowhere in the kit. Both came from
    `fixtures/responses/policy-document.json`, which was **invented rather than
    captured**, so the whole path tested green against a fiction while a real
    issued policy returned an empty `coiBase64`.

    The kit is unambiguous (`PrivateCarDataDictionary.xlsx`, "07
    GetPolicyDocument"): request carries `Policy_Number` in
    `Req_Policy_Document`; response carries `PDF_BYTES` in
    `Resp_Policy_Document`. HDFC uses the same Req_/Resp_ split for
    `Req_PvtCar` / `Resp_PvtCar`, so reading the request container back was
    always wrong. The response carries **no policy number** — that comes from
    SubmitPaymentDetails. Fixture replaced with the documented shape, verified
    live against policy 2302201225707100000.

15. Several covers are rated ON a sum insured we must send, and HDFC does not say
    so — it either charges ₹0 (Loss of Personal Belongings) or refuses the whole
    payload with an unrelated-sounding message (EMI Protector's "add on system
    rate is not available"). Treat a newly-enabled cover priced at ₹0 as a bug.

## 3. Master cross-walk

`npm run db:import:hdfc` reads `PrivateCarMasterData.xls` and writes only
`Provider*Code` rows for slug `hdfc` (`ProviderMmvCode`, `ProviderRtoCode`,
`ProviderInsurerCode`). No canonical master rows are created — a vehicle or RTO
HDFC has that our master lacks is simply unquotable by HDFC. The import is
idempotent and partition-scoped (upsert-only), so re-running it is always safe.

Counts from the real import run against the live dev master data (2026-08-07):

| Sheet | Rows | Cross-walked | Unmatched |
|---|---|---|---|
| Model_Master | 10,826 (10,817 parsed; 9 rejects are three-wheelers) | 5,450 canonical rows | 767 HDFC make/model/fuel groups |
| RTO Master | 1,583 (all parse) | 1,432 | 21 |
| Insurance_Company | 38 | 8 | 29 |

Unmatched detail: `scripts/_hdfc-unmatched.json` (gitignored — regenerated on
every import run).

Two things worth knowing before treating those numbers as fixed:

- **RTO's 1,432 + 21 doesn't add to 1,583.** 130 sheet rows are genuine
  duplicate (state, RTO-number) pairs — e.g. a city rename recorded twice under
  the same code — and collapse by design, since the schema allows only one HDFC
  code per canonical RTO (`@@unique([providerSlug, rtoId, line])`). Not a bug:
  1,432 + 21 + 130 = 1,583.
- **Insurance_Company's 8 + 29 doesn't quite add to 38 either**, for the same
  reason: the sheet lists a few insurers twice verbatim (HDFC ERGO's own row,
  Edelweiss, Raheja QBE, Tata AIG, Universal Sompo all appear twice), and the
  one-code-per-canonical-insurer dedup collapses a pair of those.

**The single largest vehicle gap is a make-name spelling mismatch**: HDFC's
sheet spells the make `"MARUTI"` where our canonical master uses
`"MARUTI SUZUKI"`. That mismatch alone accounts for about 85 of the 767
unmatched groups (~11%) — every Maruti model in the sheet, from the 800 to the
Swift, fails to cross-walk purely because the make string doesn't match. A
small make-alias map (`"MARUTI" → "MARUTI SUZUKI"`, and similarly for a couple
of other insurers below) would recover this in one pass without touching the
matching algorithm.

### The insurer gap matters more than its size suggests

Only 8 of HDFC's 38 previous-insurer codes are mapped. That sounds like a minor
footnote next to 5,450 vehicles, but it isn't: HDFC rejects
`PreviousPolicy_CorporateCustomerId_Mandatary` values it doesn't recognise — a
generic `"OTHERS"` fails outright with *"No Data found for given previous
insured code"* (rule 6 above) — so with 30 of 38 insurers unmapped, most
rollover proposals for a customer switching from an unmapped previous insurer
will simply send `null` there instead of the real code. That's the correct,
safe behaviour (§7 explains why sending anything invented is worse), but it
means the previous-insurer field is effectively blank far more often than it
should be. Improving this cross-walk — even just adding aliases for the large
insurers (ICICI Lombard, Bajaj Allianz, National, New India, United India,
Reliance, TATA AIG, Royal Sundaram all already have plausible canonical
counterparts) — is the highest-value follow-up to this import, because it's the
field the whole "stop hard-coding ICICILOMBARD" correction in §7 depends on to
actually carry a real value on UAT.

### UAT test vehicles: read the 10/27 headline carefully

The import's final check asserts that HDFC's own UAT scenario sheet
(`PVTcarTestScenarios.xls`, "UAT Test Model") resolves through the cross-walk:
**10 of 27 codes resolve.** Taken at face value that looks alarming, but the
real breakdown is more specific than "17 broken vehicles":

- **1 code (`17800`) doesn't exist anywhere in HDFC's own current
  `Model_Master`.** Not a cross-walk failure — the scenario sheet and the
  master workbook have simply drifted apart on HDFC's side.
- **4 codes sit in make/model/fuel groups that DID cross-walk** (Jaguar XF,
  Honda Civic, Renault Pulse, Ford Endeavour, verified directly against the
  DB). `ProviderMmvCode`'s `@@unique([providerSlug, mmvId])` allows only one
  HDFC code per canonical vehicle, so where HDFC's sheet lists several variant
  codes under one canonical row, `pickBestVariant` keeps exactly one of them —
  not necessarily the specific code the scenario sheet happens to reference.
  The vehicle prices fine; it just prices under a sibling trim's code.
- **The remaining 12 codes sit in groups with no canonical match at all**, and
  most of those trace back to the same kind of naming mismatch called out
  above — five are the `"MARUTI"` vs `"MARUTI SUZUKI"` gap (800, Esteem, Alto,
  two different Swift codes), two are `"TOYOTA KIRLOSKAR"` vs our canonical
  `"TOYOTA"`, two are HDFC's own model field self-duplicating the make
  (`"AUDI A4"` / `"AUDI A8"` under make `"AUDI"`), one is a stray trailing dot
  on the make (`"MAHINDRA."`), and two (a Mahindra REVA and the Tata Nexon EV
  used in `scripts/hdfc-uat-probe.ts`) appear to be genuine gaps rather than
  spelling issues.

So the honest summary is: one HDFC-side data error, four resolver
trim-selection differences (harmless), and twelve real cross-walk gaps — of
which most would close alongside the make-alias fix already justified in §3.
**Recommend UAT testing look up the code our resolver actually assigns for the
canonical vehicle under test** (e.g. via `npm run db:studio` on
`ProviderMmvCode` filtered to `providerSlug = "hdfc"`) rather than assuming the
scenario sheet's literal `VEHICLEMODELCODE` values resolve as-is.

## 4. Payment

HDFC ships no hosted payment gateway. `submitpaymentdetails` records money
collected elsewhere, so `initiatePayment` remains FG-only and HDFC issuance
consumes the canonical `PaymentReceipt`.

## 5. Not supported (and why)

| Operation | Reason |
|---|---|
| `retrieveQuote` | No get-quote-by-id endpoint — premium is recomputed every call |
| `policyStatus` | Nothing in the kit |
| `inspection` | Break-in is triggered automatically at HDFC's end (`PVTcarTestScenarios.xls`: "Proposal should be triggered for Inspection"), same as ITGI — there is nothing to call |
| `ovd` | The Pehchaan kit has no document-upload API; documents are captured inside HDFC's own hosted journey |
| Two-wheeler | No collection, product code or master data in the kit |
| Commercial | No collection, product code or master data in the kit |

## 6. Known functional limitations

These are real, present-day gaps in what a live HDFC quote/proposal can carry —
not bugs, but places where the canonical contract has no source for a field
HDFC wants, so the port sends the same "nothing" value the frozen original did.

- **Renewals re-rate with no optional covers.** The standalone module read
  roughly 40 add-on flags off a `req.addons` bag that the renewal path has no
  equivalent of — the canonical `RenewalProposalRequest` carries only
  `addonCodes`, which are FG *combo* codes (e.g. `"STZDP"`) HDFC publishes no
  cross-walk for. `mapper/renewal.ts` therefore ships every cover as
  `0`/`null`/`false`, matching HDFC's own renewal sample byte-for-byte, but it
  means a renewed policy loses whatever optional covers the expiring policy
  had. Fixing this means threading the renewal extract's `Resp_RE.Is*_Cover`
  flags (returned by step 02, `getpolicydataforrenewal`) through to the
  premium/proposal calls — a separate, scoped change.
- **Financed vehicles do not record hypothecation.** HDFC wants a numeric
  `FinancierCode` from its own `GENMST_FINANCIER` master; the canonical request
  only carries the financier's *name* (`MotorFullQuoteRequest.financierName`),
  and `BranchName` has no canonical source at all. Both fields are emitted as
  `null` — which is exactly what the original standalone integration sent too,
  so this is a pre-existing gap rather than a regression, but it means a
  financed vehicle's loan/lease is invisible to the HDFC policy until a
  financier-code cross-walk exists.
- **`buildCustomerDetails` hardcodes eight address sub-fields to `""`**
  (`Customer_Perm_Apartment`, `_Street`, `_CityDistrictCode`, `_StateCode` and
  their `Mailing` twins) because `HdfcCustomer` has no source for them. With a
  fully-populated customer these eight blanks are the only remaining
  differences against HDFC's own proposal fixture.
- ~~**Used Car is not reachable** from the canonical request.~~ FIXED
  2026-08-10 — `MotorQuoteRequest.isUsedVehiclePurchase` now selects it (see
  "Used Car" at the end of this file). What remains: its `fibertank` addon has
  no canonical source and always resolves to `false`, and HDFC UAT refuses the
  business type for our channel.
- **A financed vehicle records the agreement type but not the financier.**
  `AgreementType` now follows the canonical `VehicleIdentitySchema.financeType`
  (hypothecation / lease). `FinancierCode` still cannot: HDFC wants a numeric
  code from its own `GENMST_FINANCIER` master (65k rows in
  `PrivateCarMasterData.xls`) while the canonical request carries only a
  financier NAME, and unlike insurers — which have `InsurerMaster` +
  `ProviderInsurerCode` — there is no canonical financier master to hang a
  `Provider*Code` cross-walk off. Closing this needs a canonical financier
  master first; a guessed code is worse than a null. `BranchName` likewise has
  no canonical source.
- **A REJECTED Pehchaan verification cannot reach a customer.** `ckyc.ts`
  implements both Pehchaan status endpoints — `hdfcKycStatusByKycId` (kit doc
  1.3) and `hdfcKycStatusByTxnId` (kit doc 1.4) — and both are unit-tested, but
  they are **provider-level only**: nothing calls them. There is no route, no
  controller path, no entry in `HDFC_OPERATIONS`, and no canonical capability
  that reaches them. That matters because of what those endpoints are for. The
  fetch endpoint `/primary/kyc-verified` (and its corporate twin) answers either
  "verified" or "go to the hosted journey"; it does not report a verification
  that was **rejected**. Polling by `kyc_id` or `txn_id` is the documented way to
  learn that, so today a rejection is not observable end to end at all — a
  customer sent through the hosted journey who is then rejected has no path back
  into our flow that says so. Wiring it is a scoped change of its own (a status
  route plus a `kycStatus` operation), deliberately not made here; until it
  exists, treat the rejection path as implemented at the provider and unproven
  above it.
- **TP-only shape mismatch, unverified.** HDFC's own
  `fixtures/collection/liability-premium.json` carries a 28-key
  rollover-shaped `Policy_Details` block (financier fields, full previous-policy
  block, the `PreviousPolicy_Is*_Cover` trailer) while declaring
  `BusinessType_Mandatary: "New Vehicle"` — one field short of the 29-key
  Roll Over template (it omits `PreviousPolicyBusinessType`). None of our three
  business-type templates produces that exact combination: in practice a
  TP-only quote on an already-registered vehicle resolves through
  `resolveBusinessType` to Roll Over, which is the closer of the two shapes —
  but this specific combination has not been checked against live UAT. Flagged
  again in §9.

## 7. Deviations from the frozen original, worth recording

- **`kmsYouExpectToDrive` was restored** to the Roll Over `Req_PvtCar` template.
  The standalone module's `reqPvtCar_Rollover` omitted this key — its own New
  Business template sends it, and HDFC's Roll Over CalculatePremium sample in
  the collection carries it too, so the omission reads as a dropped field, not
  an intentional per-business-type difference. It has been added back
  (`src/providers/hdfc/mapper/req-pvtcar.ts`), which is a genuine behavioural
  change versus what the original module actually sent on UAT — worth a
  dedicated Roll Over smoke call to confirm HDFC still accepts the payload with
  it present.
- **The premium-time previous-insurer leak was closed.** The original
  implementation passed a *supplied* previous-insurer code through at
  CalculatePremium time as well as at CreateProposal time. Per rule 7 above,
  HDFC's CalculatePremium sample always sends `null` there, and any real code —
  even `"OTHERS"` — fails with *"No Data found for given previous insured
  code"*. Left uncorrected, this would have broken the very first live rollover
  quote for a customer whose previous insurer resolved to anything at all.
  `policy-details.ts` now gates the previous-insurer/policy-number fields
  behind `forProposal`, and — the more visible change — no longer falls back to
  the standalone module's hard-coded `'ICICILOMBARD'` / `'NA'` literals when
  nothing resolves; it sends `null` instead of asserting something false.
- **The renewal flow now genuinely calls GetCalculateIDV.** The standalone
  module's `renewalQuote` docblock reads "RenewalExtract → GetCalculateIDV →
  CalculatePremium", but its implementation never actually calls the IDV
  endpoint — it just reads `Vehicle_IDV` straight off the extract response and
  goes to CalculatePremium. HDFC's own Postman collection *does* include a
  GetCalculateIDV step for renewal (Renewal/03), so the port implements it for
  real (`HdfcProvider.renewalIdv`, called from `renewalQuote`), skipping the
  call only when the extract carries neither a model nor an RTO code to key it
  by.

## 8. Bugs found and fixed during the port

- `toHdfcDate` shifted date-only input back a day on any host running behind
  UTC (`new Date("2024-03-19")` parses as UTC midnight; local getters then read
  it back as the 18th). Fixed by reordering the ISO string directly instead of
  routing date-only input through `Date` at all.
- `applyRolloverDateSanity` had the same class of bug one level up: it advanced
  the rollover start date using local-time `setDate`/`getDate`, which can shift
  the resulting UTC calendar day across a DST boundary. Now advances using
  `Date.UTC(...)` arithmetic.
- The default transport (`FetchTransport`) originally passed *any* object body
  through as a successful response on a non-2xx status. A gateway fault such as
  `{"fault":{"message":"Invalid credentials"}}` — which carries no field
  `assertHdfcSuccess` can judge — would have been read as success and
  normalized to a ₹0 premium reported to the caller as a real quote.
  `carriesHdfcEnvelope()` now gates that path: only a body that actually looks
  like an HDFC status/error envelope is passed through on failure; anything
  else fails closed.
- `previousTpPolicyNumber` was dropped from the canonical→HDFC mapping while
  its two sibling dates (`previousTpStartDate`/`previousTpExpiryDate`) were
  wired — leaving HDFC unable to identify which TP policy the dates it did
  receive were supposed to belong to. Restored in `mapper/canonical.ts`.
- `scripts/import-hdfc-master.ts`'s Windows run-guard never fired. The
  hand-built comparison (`import.meta.url === \`file://${process.argv[1]}\``)
  produces a two-slash URL (`file://C:/...`) while Node's real
  `import.meta.url` for a Windows drive-letter path has three
  (`file:///C:/...`) — so the guard was always false and `main()` silently
  never ran (no console output, no DB writes). Fixed by comparing against
  `pathToFileURL(process.argv[1]).href` instead of building the string by hand.
- The `providers` table had no `hdfc` row. `Quote.providerSlug` is a foreign
  key onto `Provider.slug`, so every HDFC quote would have failed to persist
  with a foreign-key violation despite pricing correctly. Seeded in
  `prisma/seed.ts`. **`itgi` has the exact same latent problem** — no seed row
  either — and will hit the same failure the moment ITGI quoting is exercised
  end-to-end; worth fixing alongside whenever ITGI reaches this stage.

## 9. Open confirmations for HDFC

1. Real `HDFC_CREDENTIAL`, `HDFC_SOURCE`, `HDFC_CHANNEL_ID` for UAT and prod.
2. `HDFC_KYC_API_KEY` from the KYC kit email.
3. Actual token TTL — the kit does not state it; 1500 s is a guess.
4. Whether payment must be collected through an HDFC-nominated PG, or any PG's
   receipt is acceptable.
5. Two-wheeler and commercial product codes, collections and master data.
6. Production base URLs for both HEI and Pehchaan.
7. Whether `Private Car_New.postman_collection` (SA_OD, 1+3 / 2+3 / 3+3
   multi-year) supersedes `Private Car.postman_collection.json`, which this port
   is based on. Partly answered 2026-08-10: its SA_OD folders are now the
   authority for the standalone-OD term (see the last section of this file), but
   its `Policy_Details` key sets differ wholesale from the older collection's and
   the older ones are what UAT is proven against, so the port still follows those.
   Its "1 OD + 3 TP" / "2 OD + 3 TP" / "3 OD + 3 TP" folders carry **byte-identical
   CalculatePremium bodies** (all `POLICY_TENURE: 1`), so they say nothing about
   how a multi-year package policy is expressed.
8. Whether HDFC accepts a Roll Over payload carrying `kmsYouExpectToDrive` —
   restored in §7 but never proven live.
9. Whether a TP-only quote genuinely needs the 28-key rollover-shaped
   `Policy_Details` that `liability-premium.json` shows (§6), or whether the
   Roll Over shape our resolver currently produces for it is close enough.

Raised 2026-08-10 while closing the pack's BLOCKED rows:

16. **Please enable the Used Car product for our UAT channel.**
    `BusinessType_Mandatary: "Used Car"` is refused with *"Channel Not Authorized
    to consume given method..Please contact administrator !"*, isolated to that
    field alone — see "Used Car" at the end of this file.
17. **What is cover group `N161521G0020`, and why is "Gold Plan" never
    eligible?** It is Gold's second mandatory cover and the only group in
    `addonPlansToCoversMapping` that decodes to no cover on the response.
18. **What separates EMI Protector plan types "A" and "B"?** They rate at 4% and
    8% of the instalment; "C" and `NoOfEmi: 6` have no rate at all. Nothing in
    the kit documents the field.
19. **Is "Higher Protection and Removal Costs" meant to be sellable?** No
    `HigherTowingLimit` value gets it rated on UAT.

Raised by the certification-pack run (2026-08-07):

10. **A 2-year OD term is refused.** `POLICY_TENURE: 2` on a New Vehicle
    comprehensive fails with `SA_OD Policy is only allowed for Short Term Policy
    period`, even though HDFC's own data dictionary
    (`PrivateCarDataDictionary.xlsx`, "03 CalculatePremium Request" row 40)
    documents `2OD - 3TP` under PRODUCT_CODE 2311. 1+3 and 3+3 both work. This
    blocks 38 of the 152 "Long Team" conditions.
11. ~~**How a multi-year standalone OD should be requested.**~~ ANSWERED and
    implemented 2026-08-10 — the term is carried by
    `Policy_Details.PolicyEndDate` and `POLICY_TENURE` is inert on this product.
    3+0 now runs live; see "Multi-year standalone OD" at the end of this file.
    What remains open from it:
    - **There is no 2-year standalone-OD band.** An end date 366–730 days out is
      refused with `Policy Tenure is not Correct for Short-Term`; 731–1095 days
      prices; 1096+ is refused with `Invalid Short Term Policy period`. Is the
      two-year gap intentional, or a UAT rate-table hole?
    - **`IdvYear3` is never populated**, not even by HDFC's own three-year SA_OD
      sample replayed verbatim. Is the third-year IDV meant to come back?
    - **The multi-year OD prices below the one-year OD** (₹8,070 vs ₹9,775 gross,
      same vehicle, same day). Wrong direction for a longer term.
12. **Is the RTI ceiling 3 years or 5?** The scenario sheet says "RTI cover is
    valid up to 3 year's for all product", but UAT prices RTI on a 4-year-old
    car and only declines it at 5, in the same message as the other add-ons.
13. **Is the anti-theft discount live or not?** The sheet says "Anti Theft
    Discount not applicable for all motor product", yet `AntiTheftDiscFlag: true`
    earns an `AntiTheftDisc_Premium` discount on UAT.
14. ~~**Is `PlanType` inert?**~~ ANSWERED 2026-08-10 — yes, and it does not
    matter, because a plan is a bundle of covers rather than a rating input. See
    "Plan types" at the end of this file. What remains open from it:
    - **What is cover group `N161521G0020`?** It is the second of "Gold Plan"'s
      two mandatory covers and the only group in `addonPlansToCoversMapping`
      that decodes to nothing: its `computedRate` matches no `*_Premium_Rate`
      field on the response, and Gold is absent from the master workbook's own
      `PlanTypes` sheet. Gold is therefore not offered.
    - **Why is Gold Plan never eligible?** `isEligibile: false` on every vehicle
      probed (1-year-old and 6-year-old Swift), on both the plan and the product
      cover-group lists.
15. **Is `Effectivedrivinglicense: true` really the CPA opt-OUT?** The data
    dictionary says `CPA_Tenure` applies when "Effectivedrivinglicense tag should
    be false", and UAT agrees: with it `true` (what our mapper always sends)
    `PAOwnerDriver_Premium` comes back 0 however `CPA_Tenure` is set; flipping it
    to `false` charges ₹325. If that reading is right, compulsory PA is never
    actually bought today — see §6.

## Live UAT probe — VERIFIED WORKING (2026-08-07)

`npm run hdfc:probe` (`scripts/hdfc-uat-probe.ts`) runs authenticate → IDV →
premium read-only against a UAT test vehicle. Credentials arrived and it now
returns a real quote:

```
IDV            1244800 (band 1182560–1556000)
OD premium     2861
TP premium     6712
Net premium    16326
GST            2939
Gross premium  19265
```

Authentication, the token cache, both payload builders and the normalizer are
confirmed working end to end against the live vendor.

### What the live run corrected

**The response fixtures were invented, and most field names were wrong.** OD and
TP premiums read 0 on every quote until this was found. On the wire HDFC sends:

| We had guessed | HDFC actually sends |
|---|---|
| `Total_OD_Premium` | `Basic_OD_Premium` |
| `Total_TP_Premium` | `Basic_TP_Premium` |
| `ZeroDept_Premium` | `Vehicle_Base_ZD_Premium` |
| `TyreSecure_Premium` | `Vehicle_Base_TySec_Premium` |
| `NCBProtection_Premium` | `Vehicle_Base_NCB_Premium` |
| `COC_Premium` | `Vehicle_Base_COC_Premium` |
| `EA_Premium` | `EA_premium` (lowercase p) |
| `NCB_Discount` | `NCBBonusDisc_Premium` |
| `NCB_Percentage` | `Current_NCB_Per` |

`fixtures/responses/premium.json` and `idv.json` are now **real captures**, and
the tests assert the real numbers. `Resp_PvtCar` carries 108 fields.

### EV rules HDFC enforces (both were fatal before)

- **`EGP Add on cover not applicable for electric vehicles`** — engine-gearbox
  cover is rejected outright for an EV. The mapper now drops it when the fuel
  type is electric.
- **`This cover cannot be opted unless addon "Battery, Charger & Accessories
  Cover" is selected.`** — the battery zero-dep rider depends on the
  battery/charger cover. The mapper now offers the rider only when the customer
  also selected `batteryProtect`, rather than forcing on a paid cover they did
  not choose.
- EVs price **three** separate covers (`ElectricMotorCover_Premium`,
  `ZeroDepClaimForBattery_Premium`, `BatteryChargerAccessory_Premium`); the
  canonical contract has one `batteryProtect` slot, so they are summed.

### Vehicle age and model coverage — CORRECTED 2026-08-07

An earlier revision of this section claimed UAT prices only at "roughly one year
old or newer", that anything older throws `Exception while Call Blaze!`, and that
only six model codes work at all. **Running HDFC's own certification pack
disproved all three claims** (see the next section). What is actually true:

- **Model coverage is wide, not sparse.** 28 of the 33 codes tried — every code
  in the `UAT Test Model` sheet plus the Postman collection's own samples — price
  fine as a ~1-year-old Roll Over at RTO 10406. That includes `17532`, the code
  previously written off. The five that do not are `31199` (Ford Endeavour,
  `Rate is not defined in the R2 Master`), `17800` (absent from HDFC's own
  `Model_Master`), `50740`, and the two Mercedes-Benz codes.
- **Age is a real underwriting ladder, not a Blaze crash.** On `12798` at RTO
  10406 HDFC answers, in order:

  | Vehicle age | HDFC's behaviour |
  |---|---|
  | 1–4 years | prices, all add-ons available |
  | from 5 years | `<>Upto 5 years / COSG Corp role - 10 years = Decline Cover not eligible for selected vehicle age \| <> Upto 3 years = decline Cover not eligible for selected vehicle age` — add-ons declined by age |
  | from ~11 years | `Please provide Vehicle IDV` — the IDV master stops here |
  | 16 years | `Maximum Vehicle Age limitation` — the 15-year rule, enforced explicitly |

  So a rollover of a three-year-old car — the ordinary production case the old
  note worried about — works. Only the add-on ceiling bites earlier than the
  sheet states (see §9.12).
- **Missing IDV, not a crash, is the common failure.** Where a model genuinely
  has no UAT data, HDFC answers either `Please provide Vehicle IDV` or a bare
  `{"StatusCode":400,"Error":"BUSINESS EXCEPTION"}` from `getcalculateidv`. The
  whole **Mercedes-Benz** make behaves this way (8 codes tried, all refused), as
  does every **HYBRID** code tried (`48622`, `53024`, `47921`).

### Certification pack — 205 conditions run live (last full run 2026-08-21)

`npm run hdfc:scenarios` (`scripts/hdfc-uat-scenarios.ts`) encodes every
condition of HDFC's `PVTcarTestScenarios.xls` and fires it read-only at UAT
through the production provider. Results, per-row and verbatim, live in
[`hdfc-uat-scenario-results.md`](./hdfc-uat-scenario-results.md).

**Four UAT rating behaviours changed between 13/08 and 21/08/2026** and the lists
below are stated as of the later date: `Registration_No: null` is now refused at
CalculatePremium, `POLICY_TENURE = 1` is now refused on New Business, break-in
loading is no longer computed at any lapse window, and the accessory cap is no
longer enforced. All four are isolated and raised in
[`hdfc-vendor-blockers.md`](./hdfc-vendor-blockers.md) (items 11 and 12 and the
two observations after them); the probes are `scripts/_hdfc-regno-sweep.ts` and
`scripts/_hdfc-breakin-sweep.ts`. Only the last of the four was ours to absorb.

Rules HDFC **enforces server-side**, so we need not: the 15-year vehicle-age
ceiling; add-ons declined by vehicle age; NCB voided by a declared claim; NCB
voided by a >90-day break; NCB never granted on a liability policy; CPA never
charged on a standalone-OD policy; a 3-year CPA tenure only on a new vehicle;
the NCB ladder itself (it computes the next slab from
`PreviousPolicy_NCBPercentage`).

Rules HDFC **silently accepts**, so they are ours to enforce:

- the RTI ≤3-year ceiling (HDFC prices RTI at 4 years) — the cover is dropped
  in `mapper/canonical.ts`;
- "anti-theft discount not applicable" (HDFC grants one) — `AntiTheftDiscFlag`
  is hardcoded false there too;
- own-damage add-ons on a `TP Only` policy (HDFC bills a zero-dep premium
  against a zero own-damage premium) — every OD cover, accessory IDV and the
  voluntary excess is forced off for that policy type;
- **the 25%-of-sum-insured accessory cap, since 21/08/2026.** This one used to
  belong to the list above: asked for ₹4,00,000 of accessories on a ₹5,59,200
  Swift, HDFC refused the whole payload — *"Total optional covers SI should not
  be more than 25% of Vehicle Base Value!"* — on 13/08/2026, and prices the
  identical request (gross ₹13,258) on 21/08 — re-captured and persisted at
  `scripts/_hdfc-row25-recapture-2026-08-21T08-06-20-700Z.json` (IDV ₹5,59,200,
  ceiling ₹1,39,800, `Electical_Acc_Premium` 8000, `NonElectical_Acc_Premium`
  525, `Total_Premium` 13258). `mapper/canonical.ts`
  `assertAccessorySiWithinCap()` now enforces it, and it is the one
  ours-to-enforce rule that **refuses** rather than silently dropping: an
  accessory sum insured is a value the customer declared and expects to be
  insured for, so clamping it to the cap would quote materially less cover than
  was asked for without saying so. The denominator is the vehicle's **base**
  value — `Policy_Details.Vehicle_IDV`, not the vehicle plus its accessories —
  on HDFC's own wording, "Vehicle Base Value", which is also the stricter
  reading. The check runs in `hdfc.provider.ts` between GetCalculateIDV and
  CalculatePremium, because HDFC's recommended IDV is the first moment there is
  a vehicle sum insured to measure against (a `MotorQuoteRequest` usually
  carries none, and HDFC rejects any deviation from its recommendation anyway).

  **The bi-fuel/LPG-CNG kit counts, except on a liability-only policy.** Two
  things about this entry rest on different footings, and the difference matters:

  - *That the kit counts at all is the PACK's word, not HDFC's behaviour.* On
    21/08/2026 UAT priced a kit-only breach at 10/24/26/30/50/120 % of IDV, and
    priced an **electrical** accessory breach at 120 % too — the very leg the
    13/08 refusal came from. HDFC is refusing no accessory breach of any kind
    today, so live behaviour cannot arbitrate; if it could, it would argue for
    dropping the whole cap rather than just the kit. Pack row 25's wording is
    the only evidence, and it names the kit explicitly:
    *"Total of Accessories(Electrical/Non Electrical/LPG-CNG KIT) cannot be
    greater than 25% of the vehicle SI"*.
  - *That it is excluded on `TP Only` is PROVEN.* On a liability-only policy the
    kit value is inert: 26 % and 50 % of IDV return an identical response to the
    rupee (gross ₹2,925), `BiFuel_Kit_OD_Premium` 0 and `BiFuel_Kit_TP_Premium` a
    flat ₹60 either way. Capping an own-damage sum insured where there is no
    own-damage section, over a figure HDFC does not rate, would decline a policy
    for no reason. `odAmount()` already forces the electrical and non-electrical
    IDVs off for that policy type; the kit now follows. Standalone OD keeps the
    kit in the numerator — it does have an own-damage section.

  Evidence: `scripts/_hdfc-accessory-cap-probe.{ts,json,log}` (gitignored).

  **Known consequence, raised with HDFC.** Because the kit counts on a
  comprehensive policy, an ordinary CNG retrofit can now lose its HDFC quote: a
  ₹60,000 kit breaches 25 % below roughly ₹2,40,000 IDV. The cheapest car in
  HDFC's own pack values at ₹3,04,000, so this is narrower than it first looks,
  but it is real and it is question 3 under blocker item 12 — *we may be
  declining ordinary bi-fuel small cars HDFC would be happy to write.*

### Multi-year standalone OD — the term is a date, not a tenure (2026-08-10)

`Req_PvtCar.POLICY_TENURE` is **inert** on the standalone-OD product. Proven by
sweeping the payload on live UAT (model 12798, RTO 10406, policy starting
10/08/2026): with no `Policy_Details.PolicyEndDate`, an `OD Only` quote priced
identically at `POLICY_TENURE` 1, 2 and 3 — gross ₹9,775, `IdvYear1/2/3` all 0 —
and adding a `PolicyEndDate` changed the answer identically at all three tenure
values. HDFC's own SA_OD samples agree: all four send `POLICY_TENURE: 1` and
differ only in `PolicyEndDate`.

Those samples are **not** in `Private Car.postman_collection.json`, the older of
the kit's two collections and the one the golden fixtures came from — it has no
SA_OD folder at all. They are in `Private Car_New.postman_collection` (no `.json`
suffix), extracted to `fixtures/collection/saod-*.json` by
`scripts/extract-hdfc-collection.ts`.

The accepted term bands, mapped one day at a time from +6 months to +3 years:

| span from inception | HDFC UAT |
| --- | --- |
| ≤ 365 days | one-year OD, no IDV ladder |
| 366–730 days | refused: *"Policy Tenure is not Correct for Short-Term"* |
| 731–1095 days | multi-year OD — `IdvYear1` and `IdvYear2` populated, `IdvYear3` 0 |
| ≥ 1096 days | refused: *"Invalid Short Term Policy period"* |

So HDFC UAT writes exactly ONE multi-year standalone-OD product, and prices the
whole 731–1095 band at a single premium. Consequences:

- **3+0 works.** `PolicyEndDate` at start + 3 years − 1 day lands at 1094–1095
  days, inside the band. HDFC's own *"SA_OD / 3 years"* sample lands there too
  (03/07/2025 → 01/07/2028 = 1094 days) — it deliberately stops short of the
  third anniversary, because 1096 days is refused.
- **2+0 does not.** A straight two-year term (start + 2 years − 1 day = 730 days)
  falls in the hole beneath the band and is refused outright. Nothing in the
  payload fixes that; it is a vendor gap, classified VENDOR_DATA in the pack.
- **`IdvYear3` is always 0**, even for HDFC's own three-year sample replayed
  verbatim (which returns `IdvYear1: 1182591`, `IdvYear2: 995866`, `IdvYear3: 0`).
  Ours is faithful to theirs.

Open question for HDFC: the multi-year OD prices **below** the one-year OD on
UAT (₹8,070 vs ₹9,775 gross for the same vehicle), which is the wrong direction
for a longer term. Recorded in §9.

## Plan types — a bundle of covers, not a rating input (2026-08-10)

HDFC's six named plans (Silver / Gold / Diamond / Platinum / Titanium, plus the
"Menu Card Approach") are **merchandising**: each names a set of add-on covers it
makes mandatory. `Req_PvtCar.PlanType` is inert — live on UAT, "Gold", "Silver",
"Diamond", "Platinum", "Titanium", "Menu Card Approach" and an invented
"NONSENSE-XYZ" all returned the identical gross ₹8,354 — because the premium
comes from the individual `Is*_Cover` flags.

Three sources agree on which covers each plan carries, and they agree exactly:

1. `PrivateCarMasterData.xls`, sheet **PlanTypes** — plan name, "Mandatory add on
   cover" rows, and a validity band.
2. Live `GetCalculateIDV` → `CalculatedIDV.addonPlansToCoversMapping` — the same
   plans as `coverGroup` codes with `isMandatory` and a per-vehicle
   `isEligibile`.
3. The CalculatePremium response on the **same vehicle**, which decodes the
   groups: each group's `computedRate` is one of the `*_Premium_Rate` fields.

Decoded on a 1-year-old Swift (model 12798, RTO 10406, IDV ₹559,200):

| coverGroup | computedRate | matches | = cover |
|---|---|---|---|
| N161521G0034 | 0.004 | `Vehicle_Base_ZD_Premium_Rate` | Zero Depreciation |
| N161521G0023 | 0.0011 | `Vehicle_Base_NCB_Premium_Rate` | NCB Protection |
| N161521G0014 | 0.0014 | `Vehicle_Base_ENG_Premium_Rate` | Engine & GearBox |
| N161521G0007 | 0.001 | `Vehicle_Base_COC_Premium_Rate` | Cost of Consumables |
| N161521G0033 | 0.0025 | `Vehicle_Base_TySec_Premium_Rate` | Tyre Secure |
| N161521G0009 | 50 | `EA_premium` = 50 | Emergency Assistance |
| N161521G0011 | 499 | `EAW_premium` = 499 | Emergency Assistance Wider |
| N161521G0036 | 0 | — | Loss of Personal Belongings |
| **N161521G0020** | 0.001 | **nothing** | **unknown — see §9.14** |

Which yields the catalogue in `config.ts` `HDFC_PLANS`, matching the PlanTypes
sheet row for row: Silver = ZD; Platinum = ZD + NCB + EGP; Titanium = ZD + NCB +
EGP + COC; Diamond = ZD + COC; Essential ZD = ZD + EA + EAW + LOPB; Essential EGP
= ZD + EGP + EA + EAW + LOPB.

**`isEligibile` is real.** On a 1-year-old Swift the two "Essential" plans come
back `false` and the other four `true`; on a 6-year-old Swift the Essentials flip
to `true` — matching the master's own Validity column ("upto 5 years" vs "5 to 10
years with NCB %").

**Gold is not offered.** It is absent from the PlanTypes sheet, `isEligibile:
false` on every vehicle probed, and its second cover group (`N161521G0020`) is
the one entry that decodes to nothing. Selling a plan containing a cover nobody
can name would be worse than not selling it.

A plan is chosen through `MotorQuoteRequest.providerAddonCodes` — the existing
vendor passthrough — e.g. `["Titanium Plan"]`, matched case- and
spacing-insensitively. The mapper expands it to the canonical cover flags and
names it in `PlanType` on the Roll Over template (the only one whose sample
carries the key). "Menu Card Approach" is the pack's name for the ABSENCE of a
plan and correctly adds nothing.

## Four covers that were hardcoded off (2026-08-10)

| Req_PvtCar flag | Canonical route | Live UAT |
|---|---|---|
| `IsEAW_Cover` | new add-on key `rsaWorldwide` | prices — `EAW_premium` ₹499 (1y rollover), ₹720 (3+3 new) |
| `IsLossofUseDownTimeProt_Cover` | existing `garageCash` | prices — `Loss_of_Use_Premium` ₹559 at rate 0.001 |
| `IsEMIProtector_Cover` | new `emiProtect` + `emiAmount` | prices — `EMI_PROTECTOR_PREMIUM` ₹600 at rate 0.04 |
| `IsHighProtection_Cover` | `providerAddonCodes: ["HIGH_PROTECTION"]` | **unrated on UAT** |

- **EAW is a cover in its own right**, not an upgrade of `IsEA_Cover`: a quote
  with both on returns `EA_premium: 50` AND `EAW_premium: 499`. HDFC's own New
  Business premium sample ships `IsEAW_Cover: 1`.
- **"Loss of Use or Down Time Protection" is Garage Cash** — the same benefit
  (a payout while the vehicle is off the road) under the other market name — so
  the existing canonical key is reused rather than a new one invented. HDFC's own
  New Business proposal sample ships the flag on. The earlier note that "HDFC has
  no garageCash" was wrong.
- **EMI Protector was NOT unrated — it was under-specified by us.** The earlier
  conclusion ("add-on system rate is not available, so it is unrated in the
  sandbox too") came from sending the flag alone. The cover needs *three* things
  together and HDFC gives the same message when any is missing:

  | payload | UAT |
  |---|---|
  | `IsEMIProtector_Cover: 1` only | refused |
  | `+ NoOfEmi: 3, EMIAmount: 15000` | refused |
  | `+ EMIPlanType: "A"` | **₹600** (rate 0.04 × 15,000) |
  | `EMIPlanType: "B"` | ₹1,200 (rate 0.08) |
  | `EMIPlanType: "C"` | refused |
  | `NoOfEmi: 6` | refused |
  | `EMIAmount: 0` | refused |

  `EMIPlanType` is **not in HDFC's New Business sample**, so it is emitted on
  that template only when the cover is bought — the same conditional-key
  discipline as `Policy_Details.PolicyEndDate`, and proven necessary: New
  Business with the cover on and the key absent is refused, and the identical
  payload with `EMIPlanType: "A"` prices. The Used Car template carries no EMI
  keys at all, so the cover is not offered there.

  Because the cover is rated ON the amount, a zero amount buys nothing *and*
  takes the whole payload down — so the mapper drops the cover when the caller
  named no `emiAmount` rather than sending a request HDFC will refuse. There is
  no vendor sample to default from: HDFC's collection never turns it on.
- **Higher Protection and Removal Costs has no rate on UAT.** Sweeping
  `HigherTowingLimit` (null / 1 / 2 / 3 / 25000 / 50000) on a Roll Over returns
  "Higher Protection and Removal Costs - Add on system rate is not available"
  every time, so the limit is not the missing input. On New Business the same
  request comes back as the generic "Exception while Call Blaze!" instead. It
  stays on the `providerAddonCodes` passthrough rather than gaining a canonical
  flag: no other vendor we integrate sells it, and an option nobody can price
  does not belong on the compare card.

Also fixed while reading real responses: the normalizer read
`Vehicle_Base_EGP_Premium` for the engine-gearbox cover. The wire carries
`Vehicle_Base_ENG_Premium`, so that premium never reached the compare card even
when the customer had been charged for it.

## Used Car — reachable now, refused by HDFC's channel entitlement (2026-08-10)

`MotorQuoteRequest.isUsedVehiclePurchase` (optional, absent = no) selects
`HDFC_BUSINESS_TYPE.used`, so `reqPvtCarUsed` / `policyDetailsUsed` are live code
rather than unreachable templates.

It is deliberately a **separate flag, not a fourth `BusinessType` member**:
`businessType` is required and FG, ICICI and ITGI all branch on it directly
(ICICI passes it into its own product resolver), so widening that union would
change what three other vendors are sent for a value they have no concept of.
Folding it back in is the tidier end state once every provider grows a
used-vehicle path.

**HDFC UAT then refuses the business type for our channel**:

    Channel Not Authorized to consume given method..Please contact administrator !

Isolated to that one field, live, on a 3-year-old Swift (12798 / 10406):

| payload | UAT |
|---|---|
| Roll Over templates, untouched | prices, gross ₹6,242 |
| Roll Over templates, `BusinessType_Mandatary` → `"Used Car"` | refused |
| Used Car templates, `BusinessType_Mandatary` → `"Roll Over"` | prices, gross ₹12,863 |

So our Used Car payload is structurally acceptable to HDFC — it is the
entitlement that is missing. **New open confirmation: please enable the Used Car
product for our UAT channel.** (The ₹12,863 vs ₹6,242 gap in that third row is
expected, not alarming: `policyDetailsUsed` nulls the whole previous-policy
block, so no NCB is granted — which is exactly what HDFC's own pack says for a
used car, "NCB% not applicable".)

## Corporate policyholder (2026-08-10)

`mapper/customer.ts` no longer hardcodes `Customer_Type: "Individual"`. It
follows the canonical `MotorFullQuoteRequest.customerType`, with `companyName`
and `gstin` filling HDFC's existing `Company_Name` and `Customer_GSTIN_Number`
keys — a VALUE change only, so the golden proposal fixtures' key sets do not
move.

It cannot be exercised read-only: `Customer_Details` is not part of
CalculatePremium at all, so HDFC first sees the customer type at CreateProposal.
The kit also ships a separate **"Pehchaan Integration KIT - Corporate.docx"**, so
a live corporate proposal needs a corporate e-KYC journey. That journey **is**
wired as of 2026-08-21 — `hdfcCompleteCkyc` routes a `customerType: "corporate"`
request to `/partner/corporate/kyc` with entity-shaped parameters, and it is
live-proven on UAT; see "Corporate Pehchaan e-KYC — first live UAT behaviour
(2026-08-21)" below.

## Pehchaan e-KYC — first live UAT behaviour (2026-08-13)

`scripts/_hdfc-kyc-probe.ts` called `hdfcCompleteCkyc` against
`https://ekyc-uat.hdfcergo.com/e-kyc`, endpoint `/primary/kyc-verified`, for the
first time. Two calls, both against PAN `ABCPD1234E`.

- Case 1 (panNumber, dob, mobile, fullName, txn id) returned
  `isKycSuccess=true kycId=DUT8DKQABF requiresRedirect=false`, status
  `approved`, `name: "Rahul Automation"`, `pan: "UQSPF3870N"`.
- Case 2 (panNumber + txn id only) returned
  `isKycSuccess=true kycId=338D8R5Y8H requiresRedirect=false`, status
  `approved`, `name: "Anmol Arora"`, `pan: "ABCPD1234E"`.

**The mechanism is headless.** `/primary/kyc-verified` returned a verified KYC
directly — `iskycVerified: 1`, `status: "approved"`, a real `kyc_id` — with no
hosted-journey link in either response. So the hosted Pehchaan journey is not
required to obtain a Pehchaan id on UAT, and a server-side flow can complete
e-KYC unattended. `normalizePehchaan`'s redirect branch was not exercised here.

> **Correction (2026-08-21):** this originally read "remains unproven", which
> implied it might work. It could not have. The branch keyed on
> `redirection_link` — a spelling Pehchaan never emits, on the individual path
> as much as the corporate one. The real field is `redirect_link`. Fixed and
> live-proven; see "Corporate Pehchaan e-KYC — first live UAT behaviour
> (2026-08-21)" below.

**UAT's identity data does not correspond to the PAN submitted.** The same PAN
(`ABCPD1234E`) produced two different identities on two consecutive calls
("Rahul Automation" vs "Anmol Arora", different DOB, different address), and
case 1's response carried a different PAN (`UQSPF3870N`) than the one sent.
The only conclusion the evidence supports: UAT appears to return an identity
from a fixed pool rather than verifying the specific PAN submitted. What
production does with a real PAN is untested and not asserted here.

**`mobile` and `email` come back empty** in both responses, even though case 1
supplied a mobile number.

**Consequence for issuance, flagged as an OPEN QUESTION, not a settled fact:**
because the Pehchaan record carries its own name / dob / address, a proposal's
`Customer_Details` should arguably be built from the KYC result rather than
from separately-invented customer data, or the two will disagree. This has not
been tested — it is not known whether `CreateProposal` validates
`Customer_Pehchaan_id` against `Customer_Details`, or whether a mismatch is
accepted, rejected, or silently overwritten. Needs confirmation with HDFC.

## Corporate Pehchaan e-KYC — first live UAT behaviour (2026-08-21)

`scripts/_hdfc-corporate-kyc-probe.ts` called `hdfcCompleteCkyc` with
`customerType: "corporate"` against `https://ekyc-uat.hdfcergo.com/e-kyc`,
endpoint `/partner/corporate/kyc`, for the first time. Three cases, all taken
from the kit's own "Test data on UAT" in *1.2 Pehchaan Integration KIT -
Corporate.docx* — its two positive entities and one of its negative ones. Raw
bodies in `scripts/_hdfc-corporate-kyc-probe.json` (gitignored).

**The corporate endpoint works, and it is headless like the individual one.**
Both positive cases returned `iskycVerified: 1`, `status: "approved"` and a real
`kyc_id` directly, with no hosted journey:

| case | sent | got |
|---|---|---|
| 1 | `ent_cin=U74999DL2021PTC388965&doi=26/10/2021&ent_type=company` | `kyc_id COMZEY2M1Z`, `name "AEROTRUST AVIATION PVT LTD"`, `cin` echoed verbatim, `doi 26/10/2021`, `ckycNumber 70025099099179` |
| 2 | `ent_pan=AADCC2489H&doi=20/11/2007&ent_type=company` | `kyc_id COF95V8WJA`, `name "CPP ASSISTANCE SERVICES PRIVATE LIMITED"`, `pan` echoed verbatim, `doi 20/11/2007`, `ckycNumber 80047842325885` |

**Unlike the individual endpoint, the corporate one does appear to key off the
entity submitted.** This is the sharpest contrast with the 2026-08-13 finding
above, and two pieces of persisted evidence carry it:

- **Case 2 reproduces the kit's documented identity exactly** — same `name`,
  same `pan`, same `doi`, and critically the same `ckycNumber`
  `80047842325885`. A 14-digit CKYC number matching HDFC's own published sample
  for the PAN we submitted is not something a fixed pool would produce.
- **Both cases echo the submitted identifier and DOI back verbatim** — `cin` in
  case 1, `pan` in case 2, `doi` in both. The individual endpoint did the
  opposite: it returned a *different* PAN than the one sent.

Where `/primary/kyc-verified` handed back two unrelated people for one PAN on
consecutive calls, nothing of that kind appears here. So the fixed-pool
behaviour recorded above does **not** reproduce on the corporate endpoint.

Run-to-run stability corroborates this, and is now persisted rather than
asserted: two probe runs at `07:44:06Z` and `07:44:30Z`
(`scripts/_hdfc-corporate-kyc-probe-2026-08-21T07-44-06-909Z.json` and
`…T07-44-30-325Z.json`) returned identical `kyc_id`, `name` and `ckycNumber`
for both positive cases. Treat this as the weaker of the three signals — a
fixed pool could also be stable; it is the `ckycNumber` match and the echoed
identifiers that carry the conclusion.

(An earlier draft asserted that stability from memory. The probe overwrote a
fixed output filename at the time, so only one run survived on disk and nothing
supported it. The probe now writes timestamped files, which is why the claim
can be made at all.)

Two caveats, so this is not read as stronger than it is:

- Case 1's name is **not** the kit's documented one. The kit says CIN
  `U74999DL2021PTC388965` returns "ADANI POWER (JHARKHAND) LIMITED"; UAT
  returned "AEROTRUST AVIATION PVT LTD". The kit's own case-1 sample is
  internally inconsistent — its request says `doi=26/10/2021` but the sample
  response says `doi: "18/12/2015"`, and its CURL uses a different CIN
  (`U40100GJ2015PLC085448`, which is the Adani one) — so the likeliest reading
  is that the kit pasted the wrong sample, not that UAT substituted an entity.
  Our response is self-consistent: the CIN and DOI we sent both come back
  unchanged. Not proven either way; recorded as observed.
- Case 2's addresses are internally contradictory. `permanentAddress` reads
  "…Marine Lines, Mumbai, Maharashtra 400020" while `permanentCity` is `"DELHI"`
  and `permanentPincode` is `110019`, and `correspondenceAddress` is a Gurugram
  address whose `correspondenceCity`/`correspondencePincode` are also
  `DELHI`/`110019`. Do not trust UAT's city/pincode fields to agree with its own
  address strings. Note `permanentPincode` arrives as a **number**, not a string.

**`mobile` and `email` come back empty** on both corporate cases, exactly as on
the individual endpoint — even though the kit's samples show both populated
(`7738184161` / `GAGAN.CHAWLA@CPPINDIA.COM` for case 2). Any flow that needs
contact details must collect them itself; Pehchaan UAT will not supply them.

### The redirect branch was dead code, and the negative case proved it

The third case (`ent_pan=BMZPA6536P&doi=29/01/1996`, the kit's own negative
entity) returned `iskycVerified: 0`, `kyc_id: null` and a hosted-journey link —
**under the key `redirect_link`**:

```json
{ "success": true, "data": {
  "iskycVerified": 0, "kyc_id": null, "txn_id": "12365",
  "redirect_link": "https://ekyc-uat.hdfcergo.com/e-kyc/verified-partner?txnId=12365&redirectUrl=…&token=…&entity_type=company&customerType=C&channel=NOVACRED%2520INSURANCE%2520BROKING",
  "isRpt": false } }
```

`normalizePehchaan` read `redirection_link` / `redirectionLink` / `link` — and
**neither kit ever spells it that way.** Counted across both documents,
`redirection_link` and `redirectionLink` occur **zero** times; `redirect_link`
carries the hosted-journey URL in **all nine** negative samples — six in doc 1.2
and three in doc 1.2.1.

The kits do also use `redirect_url` (24 occurrences), but that is the
**request** query parameter we send — "Page where the user needs to be
redirected back from Pehchaan" — not a response field. `redirect_link` is the
**response** field. They are not two spellings of one thing, so `redirect_url`
must **not** be added to the read chain. (The `redirectUrl=` seen inside the
returned link is a query parameter of that URL string — our own value echoed
back — not a JSON key either.)
So the redirect branch had never fired against the real service on *either*
path: the first live redirect Pehchaan ever handed us was normalized to a bare
`isKycSuccess: false` with `requiresRedirect` unset and the link discarded,
leaving the customer with a failed KYC and nowhere to go.

Fixed: `redirect_link` is now the first key read, with the `redirection_link`
spellings kept as tolerant fallbacks. Re-running the probe then produced
`requiresRedirect=true` with the full hosted-journey URL and `ckycRefId=12365`,
so **`normalizePehchaan`'s redirect branch is now live-proven** — it was
unproven at the time of the 2026-08-13 note above, and the reason it was
unproven is that it could not have worked.

Note the link Pehchaan builds is on `ekyc-uat.hdfcergo.com/e-kyc/verified-partner`,
not the `pehchaanuat.hdfcergo.com/login` or CloudFront hosts the kit's samples
show, and it carries our own `channel=NOVACRED INSURANCE BROKING` plus a
short-lived `token` query param (~30 min from `iat`/`exp` in the JWT). The
redirect URL is therefore **not durable** — it must be handed to the customer
promptly, not stored and replayed.

### Further observations from the live corporate responses

None of these were fixed in this task — they are recorded while the evidence is
fresh, and each needs its own decision.

**The real CKYC numbers are being discarded.** Both live corporate responses
carry a genuine 14-digit `ckycNumber` (`70025099099179` for case 1,
`80047842325885` for case 2), but `normalizePehchaan` sets
`ckycNumber: str(d.kyc_id)` — so the canonical field *named* `ckycNumber` holds
the **Pehchaan id**, and the actual CKYC number is dropped on the floor. The
table above lists both real numbers; they do not survive into `KycResult`.

This is pre-existing and deliberately **not** a drive-by fix: `toPehchaanParams`
round-trips `kyc_id: req.ckycNumber` so a post-redirect lookup can re-enter the
same call, and `Customer_Pehchaan_id` reads from that slot. Changing the
meaning of the field would break both. Recorded as a known mislabelling that
will bite the moment `KycResult.ckycNumber` is surfaced to a customer or
consumed cross-provider — FG's `ckycNumber` genuinely is a CKYC number, so the
same field means two different things depending on which vendor filled it.

**The live response carries fields the kit does not document:**
`proprietorName`, `gst`, `cin`, `isEdd`, `isRpt` and `ent_type`. None are read
today. `gst` and `proprietorName` may matter for corporate proposals —
`Customer_GSTIN_Number` is already a HEI key we fill from canonical input, so a
Pehchaan-supplied `gst` is a candidate source, and `proprietorName` is likely
required for `ent_type: "properietor"`, which we have never exercised.

**`permanentAddress` came back empty on live case 1**, with only
`correspondenceAddress` populated — the reverse of what the kit's samples show.
`normalizePehchaan` falls back correspondence → permanent for
`correspondenceAddress`, but there is **no** fallback in the other direction, so
`permanentAddress` stays empty. If corporate issuance requires a permanent
address, that response shape breaks it. Untested: no corporate CreateProposal
has been attempted.

**The probe artifacts contain secrets.** `scripts/_hdfc-corporate-kyc-probe-*.json`
and any console log embed a live Pehchaan bearer JWT (in the returned
`redirect_link`) and the broker identity `NOVACRED INSURANCE BROKING`. They are
gitignored, so this is not a repo leak — but **redact both before pasting a
probe log into a vendor ticket, email or issue tracker.** The probe now prints
this warning itself.

### Still open

- The hosted journey behind that link has not been walked, so what actually
  comes back to `redirect_url` on completion is still untested; doc 1.2.2's
  `kyc_id` re-fetch (`/partner/corporate/kyc?kyc_id=…`) is not wired.
- **No rejection can reach a customer, on either journey.** `hdfcKycStatusByKycId`
  and `hdfcKycStatusByTxnId` exist and are tested but are unreachable from the
  application — no route, no controller, no `HDFC_OPERATIONS` entry. They are the
  documented way to learn a verification was REJECTED (the fetch endpoints only
  ever say "verified" or "go to the hosted journey"), so an end-to-end rejection
  path is not observable today. See §6.
- The 2026-08-13 open question stands unchanged for corporates: it is still
  unknown whether `CreateProposal` validates `Customer_Pehchaan_id` against
  `Customer_Details`, so whether a corporate proposal must take its
  `Company_Name` from the Pehchaan record is unconfirmed.

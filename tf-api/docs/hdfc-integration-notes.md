# HDFC ERGO — integration notes

Provider: `src/providers/hdfc/`. Design spec:
`docs/superpowers/specs/2026-08-07-hdfc-ergo-provider-design.md`.
Frozen predecessor: `docs/reference/hdfc-ergo-standalone/`.

HDFC is fully wired — quote, proposal, Pehchaan CKYC, issuance, renewal and
COI — behind `HDFC_ENABLED` (default `false`). 201 unit tests, fixture-driven
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
- **Used Car is not reachable** from the canonical request — the wizard has no
  used-vehicle journey — so `reqPvtCarUsed`/`policyDetailsUsed` exist and are
  unit-tested but are only reachable by a caller who sets `businessType`
  explicitly through code, not through any UI path today. Its `fibertank`
  addon has no canonical source either and always resolves to `false`.
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
   is based on.
8. Whether HDFC accepts a Roll Over payload carrying `kmsYouExpectToDrive` —
   restored in §7 but never proven live.
9. Whether a TP-only quote genuinely needs the 28-key rollover-shaped
   `Policy_Details` that `liability-premium.json` shows (§6), or whether the
   Roll Over shape our resolver currently produces for it is close enough.

Raised by the certification-pack run (2026-08-07):

10. **A 2-year OD term is refused.** `POLICY_TENURE: 2` on a New Vehicle
    comprehensive fails with `SA_OD Policy is only allowed for Short Term Policy
    period`, even though HDFC's own data dictionary
    (`PrivateCarDataDictionary.xlsx`, "03 CalculatePremium Request" row 40)
    documents `2OD - 3TP` under PRODUCT_CODE 2311. 1+3 and 3+3 both work. This
    blocks 38 of the 152 "Long Team" conditions.
11. **How a multi-year standalone OD should be requested.** HDFC's own
    "New Business / SA_OD / 3 years" sample expresses the term through
    `Policy_Details.PolicyEndDate` (start 03/07/2025, end 01/07/2028) while
    leaving `POLICY_TENURE: 1`. Confirmed live: adding `PolicyEndDate` produces a
    genuine multi-year OD with `IdvYear2` populated, while `POLICY_TENURE` alone
    is ignored for `OD Only`. Our `Policy_Details` templates emit no
    `PolicyEndDate` key, so 3+0 and 2+0 are unreachable today.
12. **Is the RTI ceiling 3 years or 5?** The scenario sheet says "RTI cover is
    valid up to 3 year's for all product", but UAT prices RTI on a 4-year-old
    car and only declines it at 5, in the same message as the other add-ons.
13. **Is the anti-theft discount live or not?** The sheet says "Anti Theft
    Discount not applicable for all motor product", yet `AntiTheftDiscFlag: true`
    earns an `AntiTheftDisc_Premium` discount on UAT.
14. **Is `PlanType` inert?** Rows 33-38 of "Long Team" ask for six named plans
    (Gold / Silver / Diamond / Platinum / Titanium / Menu Card). The New Business
    `Req_PvtCar` sample carries no `PlanType` key at all; forced onto the Roll
    Over template, HDFC accepts every value — including a made-up one — and the
    gross premium never changes. The master workbook's own `PlanTypes` sheet
    lists a different set again (Silver / Platinum / Titanium / Diamond /
    Essential ZD / Essential EGP).
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

### Certification pack — 205 conditions run live (2026-08-07)

`npm run hdfc:scenarios` (`scripts/hdfc-uat-scenarios.ts`) encodes every
condition of HDFC's `PVTcarTestScenarios.xls` and fires it read-only at UAT
through the production provider. Results, per-row and verbatim, live in
[`hdfc-uat-scenario-results.md`](./hdfc-uat-scenario-results.md).

Rules HDFC **enforces server-side**, so we need not: the 15-year vehicle-age
ceiling; add-ons declined by vehicle age; accessories capped at 25% of the
vehicle's base value; NCB voided by a declared claim; NCB voided by a >90-day
break; NCB never granted on a liability policy; CPA never charged on a
standalone-OD policy; a 3-year CPA tenure only on a new vehicle; the NCB ladder
itself (it computes the next slab from `PreviousPolicy_NCBPercentage`).

Rules HDFC **silently accepts**, so they are ours to enforce: the RTI ≤3-year
ceiling (HDFC prices RTI at 4 years); "anti-theft discount not applicable" (HDFC
grants one); own-damage add-ons on a `TP Only` policy (HDFC bills a zero-dep
premium against a zero own-damage premium).

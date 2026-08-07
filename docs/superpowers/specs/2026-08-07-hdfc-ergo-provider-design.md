# HDFC ERGO Motor Provider — Design Spec

Date: 2026-08-07
Status: approved (sections 1–4 signed off)
Supersedes: the standalone module at `tf-api/src/hdfc-ergo-integration/`

---

## 1. Goal

Add HDFC ERGO as a fourth motor provider in `tf-api`, behind the existing
`InsuranceProvider` adapter contract, so it participates in compare, proposal,
CKYC, issuance and renewal alongside FG, ICICI Lombard and IFFCO-Tokio.

The work is a **port**, not a greenfield build. Another developer has already
built and UAT-verified an HDFC Private Car integration as a standalone Express
app (`tf-api/src/hdfc-ergo-integration/`). That module's payload construction is
correct and hard-won; its architecture is incompatible with `tf-api`. This spec
moves the former into the latter.

### Scope (decided)

- **Lifecycle:** everything — quote, proposal, CKYC, issuance, renewal, COI.
- **Categories:** Private Car only (`fourWheeler` + `newVehicle`), PRODUCT_CODE `2311`.
- **Approach:** faithful port — the three collection-exact `Req_PvtCar` templates
  are carried over verbatim; only their *input* changes.
- **Masters:** cross-walk only. No new rows in `mmv_master` / `rto_master` /
  `insurer_master`; only `provider_*_codes` rows for slug `hdfc`.
- **Old module:** moved to `tf-api/docs/reference/hdfc-ergo-standalone/`, frozen.

### Explicitly out of scope

- **Two-wheeler and commercial.** The kit ships no TW/CV collection, no product
  code and no master data. The dev's `payloadBuilderMotor.js` (`Req_TW` /
  `Req_GCV` / `Req_PCV`) is entirely speculative — every field is marked
  `// VERIFY` and `.env.example` seeds fake `0000` codes. None of it is ported.
  Precedent: ICICI excludes commercial, ITGI excludes CVI, for the same reason.
- **A new payment gateway.** HDFC's kit contains none (see §6).
- **`retrieveQuote`, `policyStatus`, `inspection`, `ovd`** — no vendor endpoint
  exists for any of them (see §3.1).

### Success criteria

1. `POST /api/v1/motor/quotes/compare` returns an HDFC card with a real premium
   for a UAT test vehicle from `PVTcarTestScenarios.xls`.
2. The three `Req_PvtCar` golden-payload tests pass field-for-field against JSON
   lifted from the Postman collection.
3. A full new-business journey completes on UAT: quote → proposal → Pehchaan
   KYC → issuance → policy document.
4. `npm run db:import:hdfc` is idempotent, touches only the `hdfc` partition,
   and resolves every vehicle and RTO in the kit's UAT test sheets.
5. `npm run typecheck`, `npm run lint` and `npm test` are clean in `tf-api`.
6. FG's renewal behaviour is unchanged by the contract relaxation in §7.

---

## 2. Vendor shape (essential facts)

**HEI motor service.** JSON over HTTPS. Base (UAT):
`https://accessuat.hdfcergo.com/cp/integration/heiintegrationservice/integration/`

Eight operations, identical across products — only the `PRODUCT_CODE` header
changes:

```
authenticate            GET   → Authentication.Token
getcalculateidv         POST  → CalculatedIDV { IDV_AMOUNT, MIN_IDV_AMOUNT, MAX_IDV_AMOUNT }
calculatepremium        POST  → Resp_PvtCar { Total_Premium, Net_Premium, OD_Premium, TP_Premium, Service_Tax }
createproposal          POST  → Policy_Details.ProposalNumber
getproposaldocument     POST  → proposal PDF / CIS
submitpaymentdetails    POST  → Policy_Details.PolicyNumber
getpolicydocument       POST  → policy PDF
getpolicydataforrenewal POST  → expiring-policy snapshot
```

Headers: `SOURCE`, `CHANNEL_ID`, `PRODUCT_CODE` on every call; `CREDENTIAL` +
`TRANSACTIONID` on authenticate; `TOKEN` on the rest.

**Business cases** each send a *different* `Policy_Details` and `Req_PvtCar`
field set — New Vehicle, Roll Over, Used Car — plus a `Req_Renewal`-based
renewal flow. This is why the port keeps three separate templates rather than
one merged shape: HDFC's Blaze rules engine rejects payloads carrying fields the
sample for that business type doesn't send.

**Pehchaan e-KYC** is a separate service: `https://ekyc-uat.hdfcergo.com/e-kyc`,
`api_key` → ~10-minute JWT, then fetch-by-PAN/DOB → hosted redirect journey →
status poll. Its `kyc_id` feeds the motor proposal's `Customer_Pehchaan_id`.
HDFC's rule: never issue when `iskycVerified !== 1`.

**Collection versions.** The kit ships two Postman collections. The port is based
on `Private Car.postman_collection.json`, which the dev verified against.
`Private Car_New.postman_collection` is richer — it adds SA_OD (short-term /
1 year / long-term) and multi-year new business (1+3, 2+3, 3+3). Reconciling the
two is open confirmation #7 (§10).

---

## 3. Architecture

```
src/providers/hdfc/
  config.ts            slug, capabilities, operations, motorCapabilities,
                       loadHdfcConfig(), endpoint paths, product code
  auth.ts              hdfcTokenFetcher(config) → TokenFetcher
  http.ts              FetchTransport + normalizeHdfcResponse + assertHdfcSuccess
  mapper/
    index.ts           the eight build* entry points
    canonical.ts       MotorQuoteRequest/MotorFullQuoteRequest → HdfcRequestShape
    req-pvtcar.ts      the three Req_PvtCar templates, verbatim
    policy-details.ts  the three Policy_Details templates, verbatim
    customer.ts        Customer_Details
    renewal.ts         Req_Renewal builders
    format.ts          toHdfcDate, formatRegWithDashes, yearOnly, bool01, …
  normalizer.ts        Resp_PvtCar / CalculatedIDV / proposal / payment / doc
  db-code-resolver.ts  canonical IDs → HDFC model + RTO + insurer codes
  ckyc.ts              Pehchaan (own base URL, own JWT)
  renewal.ts           RenewalProvider methods
  hdfc.provider.ts     the class
  index.ts             registerHdfcProvider()
  __tests__/
  fixtures/
```

`mapper/canonical.ts` is the only genuinely new logic: it translates the
canonical request into the intermediate shape the ported builders already
consume (`{ vehicleType, businessType, vehicle, policy, previousPolicy, addons,
ev, customer, payment }`). Everything downstream of it is the dev's verified code
retyped. This boundary is what makes the port auditable — a reviewer can diff
`req-pvtcar.ts` against the original and against the collection.

### 3.1 Capability surface

Slug `hdfc`, display name **HDFC ERGO**, registered in `app.ts` behind
`HDFC_ENABLED` (off by default).

| | |
|---|---|
| `capabilities` | `fourWheeler`, `newVehicle` |
| `operations` | `quote`, `proposal`, `ckyc`, `issuance`, `renewal`, `coi` |
| `fourWheeler` plan types | `comprehensive`, `thirdParty`, `standAloneOD` |
| `newVehicle` plan types | `comprehensive` |

Not declared, each for a concrete reason:

- **`retrieveQuote`** — no get-quote-by-id endpoint; premium is recomputed from
  the payload each time.
- **`policyStatus`** — no such endpoint in the kit.
- **`inspection`** — break-in is triggered automatically at HDFC's end
  (`PVTcarTestScenarios.xls` → *"Proposal should be triggered for Inspection"*).
  Same situation as ITGI: nothing to call.
- **`ovd`** — the Pehchaan kit has no document-upload API; documents are captured
  inside HDFC's hosted journey.

**The `ovd` wrinkle.** `supportsKyc()` requires *both* `completeCkyc` and
`initiateOvd` to exist as methods. HDFC therefore implements `initiateOvd` but
throws `AppError(501, …)` from it, and leaves `"ovd"` out of `operations` — so
`requireOperation` rejects the OVD route cleanly while `/kyc/ckyc` works. No
contract change.

### 3.2 Method → vendor call mapping

| Canonical method | HDFC calls |
|---|---|
| `getQuote` | 02 GetCalculateIDV → 03 CalculatePremium |
| `getFullQuote` | 04 CreateProposal → 05 GetProposalDocument |
| `issuePolicy` | 06 SubmitPaymentDetails → 07 GetPolicyDocument |
| `getCertificate` | 07 GetPolicyDocument standalone (by policy no) |
| `completeCkyc` | Pehchaan `GET /primary/kyc-verified` |
| `initiateOvd` | *(throws 501)* |
| `renewalQuote` | RenewalExtract → GetCalculateIDV → CalculatePremium |
| `renewalProposal` | CreateProposal with the `Req_Renewal` block |
| `renewalCreatePolicy` | SubmitPaymentDetails → GetPolicyDocument |

### 3.3 Business-type resolution

Canonical → HDFC `BusinessType_Mandatary`:

| Canonical | HDFC |
|---|---|
| `businessType: "new"` or `vehicleType: "newVehicle"` | `"New Vehicle"` |
| `businessType: "rollover"` / `"renewal"` with a registration number | `"Roll Over"` |
| used-vehicle journey | `"Used Car"` |

Mirrors FG's rule (`req.businessType === "new" || req.vehicleType === "newVehicle"`).

### 3.4 Transport and auth

`hdfcTokenFetcher` performs the `GET authenticate` call and returns
`{ accessToken, expiresAt }`. HDFC's response carries **no expiry**, so
`expiresAt` is computed from `HDFC_TOKEN_TTL` with the manager's 80% staleness
threshold. Cache key is `hdfc:<productCode>`, following FG's per-product token
pattern so a future TW/CV product can't collide.

`TRANSACTIONID` must be present and unique on the authenticate header or auth
fails outright — a documented pitfall from the original integration.

The transport must **not** throw on HTTP status alone: HDFC UAT returns useful
bodies with non-2xx codes. It reads the body, then `assertHdfcSuccess` accepts
`StatusCode` of `1` / `200` / `SUCCESS` and otherwise raises a `ProviderError`
carrying the step name and HDFC's verbatim `Error` text.

### 3.5 UAT-earned behaviours carried across verbatim

These are the reason this is a port and not a rewrite. Each gets an English
comment naming the failure it prevents (the originals are in transliterated
Marathi), and a unit test where one is cheap.

1. `TRANSACTIONID` always set on Authenticate.
2. GetCalculateIDV always sends `Registration_No: "New"` and **no**
   `registrationNumberSection*` — a real plate makes HDFC's schema demand the
   section fields.
3. CreateProposal needs the real plate in **dash format** (`MH-01-QQ-7878`),
   still with no section fields.
4. **Always price with HDFC's recommended IDV** (`CalculatedIDV.IDV_AMOUNT`);
   deviation is rejected with *"IDV Deviation not allowed"*. A caller-supplied
   IDV is used only when there is no recommendation, and only inside
   `[MIN_IDV_AMOUNT, MAX_IDV_AMOUNT]`.
5. Rollover date sanity — previous policy end must be strictly before the new
   start; otherwise shift start to `prevEnd + 1 day`.
6. `PreviousPolicy_CorporateCustomerId_Mandatary` must be a code from HDFC's own
   insurer master; `"OTHERS"` fails with *"No Data found for given previous
   insured code"*. Supplied by `ProviderInsurerCode(hdfc)` — see §5.
7. CalculatePremium sends `null` for previous insurer and policy number; only
   CreateProposal sends the real values.
8. `YearOfManufacture` must be a bare 4-digit year — `"10/2011"` crashes Blaze.
9. Claim status is `"YES"` / `"NO"`, all caps.
10. Premium is read from `Resp_PvtCar.Total_Premium` plus OD / TP / net / tax.

### 3.6 Add-on mapping

HDFC `Req_PvtCar` cover → canonical `AddonKey`:

| HDFC field | Canonical |
|---|---|
| `IsZeroDept_Cover` | `zeroDep` |
| `IsTyreSecure_Cover` | `tyreProtect` |
| `IsNCBProtection_Cover` | `ncbProtection` |
| `IsRTI_Cover` | `rti` |
| `IsCOC_Cover` | `consumables` |
| `IsEngGearBox_Cover` | `engineProtect` |
| `IsEA_Cover` / `IsEAW_Cover` / `IsEAAdvance_Cover` | `rsa` |
| `IsLossOfPersonalBelongings_Cover` | `lossOfBelongings` |
| `CPA_Tenure` | `paOwner` |
| `NoofUnnamedPerson` / `UnnamedPersonSI` | `paUnnamedPassenger` |
| `LLPaiddriver` / `PAPaiddriverSI` | `legalLiabilityPaidDriver` |
| `isElectricMotorCover` / `isZeroDepClaimforBattery` / `isBatteryChargerAccessoryCover` | `batteryProtect` (EV) |

HDFC has no `rimProtect`, `keyProtect`, `garageCash` or `drivingAccessories`;
those stay out of its capability matrix.

### 3.7 Normalization

`Resp_PvtCar` → `CanonicalQuoteResult`. All amounts are whole rupees end to end,
matching the rest of the stack — no paise conversion anywhere.
`CalculatedIDV` supplies `idvValue` / `minIdv` / `maxIdv`. The proposal response
supplies `contractDetails.proposalNumber`; the payment response supplies
`policyNumber` (HDFC spells it `Policy_Details.PolicyNumber`, without the
underscore — accept the observed variants).

### 3.8 Config and registration

Env, validated in `src/config/env.ts`, credentials env-only:

```
HDFC_ENABLED           gate (default false)
HDFC_BASE_URL          HEI base
HDFC_SOURCE            channel source
HDFC_CHANNEL_ID        channel id
HDFC_CREDENTIAL        channel password  (secret)
HDFC_PRODUCT_PVTCAR    default 2311
HDFC_TOKEN_TTL         seconds, default 1500  (unconfirmed — see §12)
HDFC_KYC_BASE_URL      Pehchaan base
HDFC_KYC_API_KEY       Pehchaan api_key  (secret)
HDFC_KYC_TOKEN_TTL     seconds, default 480
HDFC_KYC_RETURN_URL    absolute URL Pehchaan returns the browser to
```

The dev's `.env.example` seeded TW/GCV/PCV with fake `0000` codes. Those are
**not** carried over: a placeholder HDFC will reject is worse than an absent
capability.

---

## 4. Pehchaan e-KYC

Own base URL and `api_key` → JWT, cached in the shared `TokenManager` under
`hdfc:kyc` rather than a module-level variable, so invalidation and single-flight
come for free.

`completeCkyc(req)` calls `GET /primary/kyc-verified` with PAN + DOB (or the
other accepted combinations) plus `redirect_url = HDFC_KYC_RETURN_URL`, and
returns one of two canonical shapes:

- **Verified** → `{ isKycSuccess: true, kycId, name, dob, email, phone,
  permanentAddress, correspondenceAddress }`
- **Not found** → `{ isKycSuccess: false, requiresRedirect: true, redirectUrl,
  ckycRefId: <txn_id> }`

The second is byte-for-byte the shape FG's manual-KYC fallback already produces,
so tf-web's existing redirect handling applies unchanged.

**Status polling needs no new route.** Pehchaan's fetch endpoint accepts `kyc_id`
and `txn_id` as lookup keys, so after the redirect returns with `?kycId=…` the
client re-calls `POST /hdfc/kyc/ckyc` with that id in `ckycNumber`. Zero contract
change. (There is no canonical KYC-status route today; FG polls internally.)

`kycId` feeds `Customer_Pehchaan_id` on CreateProposal, and the provider refuses
to build a proposal when KYC is unverified. A 401 mid-flight invalidates the
cached token and retries once.

---

## 5. Masters and code resolution

`scripts/import-hdfc-master.ts`, wired as `npm run db:import:hdfc`, reading
`PrivateCarMasterData.xls` from the kit. **Cross-walk only**: it writes no rows
into `mmv_master` / `rto_master` / `insurer_master`, only into the three
`provider_*_codes` partitions for slug `hdfc`. Idempotent upserts, partition-
scoped, so FG's and ICICI's codes can never be disturbed.

### Vehicles — `Model_Master` (10,827 rows)

Columns: `MANUFACTURER`, `VEHICLEMODELCODE`, `VEHICLEMODEL`, `NUMBEROFWHEELS`,
`CUBICCAPACITY`, `GROSSVEHICLEWEIGHT`, `SEATINGCAPACITY`, `CARRYINGCAPACITY`,
`TXT_FUEL`, `TXT_VARIANT`.

HDFC's vehicle identity is a **single** `VEHICLEMODELCODE` — no separate make or
model code, exactly like ITGI. So `ProviderMmvCode` stores
`providerMakeCode = MANUFACTURER` and `providerModelCode = VEHICLEMODELCODE`, and
the resolver reads back `providerModelCode`.

`@@unique([providerSlug, mmvId])` allows one HDFC code per canonical vehicle.
Where several HDFC variants collapse onto one `MmvMaster` row, the import takes
the closest match on variant + engine CC and logs the rest.

Matching order: make → model → variant → fuel, with HDFC's fuel labels
normalised onto our `FuelType` enum first. `CUBICCAPACITY`, `SEATINGCAPACITY`,
`GROSSVEHICLEWEIGHT` and `NUMBEROFWHEELS` give extra discriminators the ITGI
import did not have.

### RTOs — `RTO Master` (1,599 rows vs our 1,535)

`REGISTRATION_STATE_CITY` is `"MH-1-MUMBAI"`, `REGISTRATION_STATE_CITY_CODE` is
`"MH--1"`. Join key is state + RTO number parsed from those, matched against
`RtoMaster.stateCode` + `code`. Rows are written with `line: "fw"` — HDFC is
private-car only today, and being explicit prevents a future two-wheeler master
from silently reusing four-wheeler codes.

### Previous insurers — `Insurance_Company` (39 rows)

`SHORTNAME` (`ICICILOMBARD`, `BAJAJALLIANZ`, …) matched by name against our 25
`InsurerMaster` rows. **Not cosmetic**: this is the fix for behaviour 6 in §3.5.
Lacking this table, the original module hard-coded `'ICICILOMBARD'` as the
previous insurer on *every* rollover proposal. With it populated,
`db-code-resolver.ts` returns the real code and that fallback is deleted.

### Reporting

The import prints a per-sheet summary (matched / unmatched / ambiguous) and
writes the unmatched list to `scripts/_hdfc-unmatched.json`. Under cross-walk-only,
an unmatched vehicle means HDFC honestly cannot quote it; the report quantifies
that cost so widening the master stays an informed, separate decision.

### Sheets deliberately skipped

Pincode/locality, city-district, state, financier, bank, relation, salutation,
extension country, plan types. `pincode_master` already holds 166,915 rows, and
the rest are either enum-ish values belonging in `config.ts` or fields we do not
currently send.

### Early assertion

`PVTcarTestScenarios.xls` ships a `UAT Test Model` sheet (39 HDFC-approved test
vehicles) and an `RTO` sheet (MH-1 Mumbai `10406`, MH-12 Pune `10416`, GJ-1
`10085`, DL-1 `10084`, …). The import asserts every one of them cross-walks. If
the UAT test vehicles do not resolve, nothing will — better to learn it from the
import than from a failing quote.

### Resolver

`db-code-resolver.ts` mirrors ICICI's: resolve model code, RTO code and
previous-insurer code, throwing `NotFoundError` with a readable message on each
miss, so an un-onboarded vehicle fails closed as `no_quote` rather than being
mispriced. `passthroughCodeResolver` serves fixtures and tests.

---

## 6. Payment and issuance

HDFC's kit contains **no vendor-hosted payment gateway**.
`submitpaymentdetails` records money already collected:

```
PAYMENT_AMOUNT  INSTRUMENT_NUMBER  PAYMENT_DATE
PAYMENT_MODE_CD  BANK_NAME  BANK_BRANCH_NAME  PAYER_TYPE
```

The canonical `PaymentReceipt` maps straight onto it: `amount` →
`PAYMENT_AMOUNT`, `tranRefNo` → `INSTRUMENT_NUMBER`, `transactionDate` →
`PAYMENT_DATE`, with mode / bank defaults from config.

`initiatePayment` in `payment.service.ts` stays **FG-only**. Adding HDFC there
would mean inventing a gateway HDFC did not supply. Money is collected by
whatever PG the app already uses, and the receipt is handed to
`POST /hdfc/policy/issue`. Whether HDFC mandates a nominated PG is open
confirmation #4 (§12).

**Contract change:** add optional `transactionId` to
`PolicyIssuanceRequestSchema`. HDFC keys the payment step by its cross-step
`TransactionID`, while `quoteNo` carries the Proposal_Number. `clientId` stays
required for FG; HDFC reads `transactionId ?? clientId`. Requires
`npm run openapi:gen` in `tf-api`, then `npm run gen:api` in `tf-web`.

---

## 7. Renewal contract relaxation

`RenewalProposalRequestSchema` and `RenewalCreatePolicyRequestSchema` in
`src/contracts/renewal.ts` are canonical in name only — they are FG's renewal
contract. They require `productCode`, `clientCode`, `agentCode`, `branch`,
`coverCode: "CO"|"OD"|"LO"`, `proposalNo` = `"00"` + previous policy number, and
`imt10`…`imt29`. Essentially none of that exists in HDFC's renewal, which needs
only `Policy_No`, `Vehicle_Regn_No`, `Vehicle_IDV`, the `Req_PvtCar` block and
`Customer_Details`.

`RenewalQuoteRequestSchema` (step 1) *is* generic and maps straight across.
Steps 2 and 3 do not.

**Decision:** relax rather than fork.

- `RenewalProposalRequestSchema`: `productCode`, `clientCode`, `agentCode`,
  `branch`, `coverCode`, `imt*` become optional. Add optional `transactionId`,
  `registrationNo`, `policyType`.
- `RenewalCreatePolicyRequestSchema`: `clientId`, `agentCode`, `branchCode`
  become optional. Add optional `transactionId`.
- A shared `requireFields(req, [...], providerSlug)` helper raising
  `ValidationError` is called at the top of each provider's renewal builders,
  restoring per-provider strictness.
- A test asserts FG still returns 400 on a missing `agentCode`, so the
  relaxation cannot silently degrade FG.

This is the **only** place the port touches shared code. The alternative — a
separate HDFC renewal route and contract — is less invasive to FG but forks the
abstraction the whole codebase is built on.

---

## 8. Error handling

HDFC's `BUSINESS EXCEPTION` text is the only diagnostic it provides, so
`assertHdfcSuccess` raises a `ProviderError` carrying the step name and HDFC's
verbatim message. That message reaches the logs and surfaces as the compare
card's `no_quote` reason rather than being flattened to a generic failure.

Credentials, `CREDENTIAL`, `api_key` and tokens go in pino's redact list.
Request/response payload debugging reuses the project's existing debug-payload
flag rather than the standalone module's bespoke `ENABLE_DEBUG_PAYLOAD`.

---

## 9. Testing strategy (tests first)

**Golden-payload tests are the centrepiece.** Each of the three `Req_PvtCar`
templates and its matching `Policy_Details` is asserted field-for-field against
JSON lifted from the Postman collection. This is what makes a *faithful* port
verifiable rather than merely claimed, and it is the regression net for all ten
behaviours in §3.5.

Around that:

- Unit — `format.ts` helpers: `toHdfcDate` (DD/MM/YYYY), `formatRegWithDashes`,
  `yearOnly` (rejects `"10/2011"`), `normalizeClaim` (all-caps), `bool01`.
- Unit — `mapper/canonical.ts`: canonical request → `HdfcRequestShape`, including
  business-type resolution and the rollover date-sanity shift.
- Unit — IDV selection: recommended wins; caller IDV used only when there is no
  recommendation and it falls inside `[min, max]`.
- Fixture-driven provider tests — `src/providers/hdfc/fixtures/*.json` for IDV,
  premium, proposal, payment and policy-document responses. No live calls,
  matching FG and ICICI.
- Unit — import matching functions: fuel normalisation, RTO key parsing,
  insurer name matching.
- Contract — FG renewal still rejects a missing `agentCode` with 400 (§7).
- Live — `scripts/hdfc-uat-probe.ts`, read-only, exercising authenticate + IDV +
  premium for the kit's UAT test vehicles. ITGI precedent.

---

## 10. Disposal of the standalone module

1. `git mv tf-api/src/hdfc-ergo-integration` →
   `tf-api/docs/reference/hdfc-ergo-standalone/`.
2. Delete the four dead duplicates — `motorController_29.js`,
   `payloadBuilder_1.js`, `payloadBuilder_28-07.js`, `payloadBuilder_29.js` —
   plus `package-lock.json` and any `node_modules`.
3. Add a README marking the folder frozen reference and pointing at
   `src/providers/hdfc/`.
4. Distil the vendor quirks into `tf-api/docs/hdfc-integration-notes.md`
   (ITGI precedent), including the open confirmations below.

Note the module's own inconsistency, preserved only as a historical caution: its
`schema.sql` declares `model_master` / `rto_master` while its services query
`hdfcmmv` / `hdfcrto_master`. Neither pair exists in the current `tf_api_dev`.
The canonical tables replace both.

---

## 11. Frontend impact

`tf-web` is entirely provider-slug driven — compare, proposal, KYC, payment and
inspection pages all take `providerSlug` from the API. Once `/providers` lists
`hdfc` and compare returns its quote, the card appears with no `tf-web` code
change.

Two items to verify during implementation:

- an insurer logo asset for the HDFC card;
- the KYC page's redirect handling — it already handles FG's `requiresRedirect`,
  and Pehchaan should reuse it, but that must be confirmed against a real
  Pehchaan response rather than assumed.

The `openapi:gen` → `gen:api` regeneration in §6 is required regardless.

---

## 12. Open confirmations for HDFC

1. Real `HDFC_CREDENTIAL`, `HDFC_SOURCE` and `HDFC_CHANNEL_ID` for UAT and prod.
2. `HDFC_KYC_API_KEY` from the KYC kit email.
3. Actual token TTL — the kit does not state it; 1500 s is the original
   developer's guess.
4. Whether payment must be collected through an HDFC-nominated PG, or any PG's
   receipt is acceptable for `submitpaymentdetails`.
5. Two-wheeler and commercial product codes, Postman collections and master data.
6. Production base URLs for both HEI and Pehchaan.
7. Whether `Private Car_New.postman_collection` (SA_OD, 1+3 / 2+3 / 3+3
   multi-year) supersedes `Private Car.postman_collection.json`, which this port
   is based on.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Cross-walk coverage is poor — many HDFC vehicles don't match canonical rows | Import reports unmatched counts before any code depends on them; UAT test vehicles asserted explicitly |
| The port silently drifts from the collection | Golden-payload tests assert field-for-field against collection JSON |
| Renewal contract relaxation weakens FG validation | `requireFields` per provider + an explicit FG regression test |
| The port targets the older collection while HDFC has moved on | Open confirmation #7; SA_OD and multi-year cases are additive folders, so the base flow is unaffected |
| Pehchaan redirect shape differs from FG's, breaking tf-web reuse | Verify against a real response before claiming no frontend change |
| Token TTL guess causes mid-journey 401s | Transport invalidates and retries once; TTL is env-tunable pending confirmation #3 |

---

## 14. Implementation order (for the plan)

1. Move the standalone module to `docs/reference/`; delete dead files; write
   `hdfc-integration-notes.md`.
2. Env config + `config.ts` capability surface + registration behind
   `HDFC_ENABLED`.
3. `format.ts` + tests.
4. `auth.ts` + `http.ts` + tests.
5. `mapper/` — canonical translation and the three templates + golden-payload
   tests.
6. `normalizer.ts` + fixture tests.
7. `import-hdfc-master.ts` + matching-function tests; run it; check the
   unmatched report and the UAT-vehicle assertion.
8. `db-code-resolver.ts`.
9. `hdfc.provider.ts` — `getQuote` / `getFullQuote` first; verify compare on UAT.
10. `ckyc.ts` (Pehchaan).
11. `issuePolicy` + `getCertificate` + the `PolicyIssuanceRequest` contract
    change; regenerate OpenAPI and tf-web bindings.
12. Renewal contract relaxation + `requireFields` + FG regression test.
13. `renewal.ts` — the three renewal methods.
14. `scripts/hdfc-uat-probe.ts`; full end-to-end UAT journey.
15. tf-web verification: logo, KYC redirect handling.

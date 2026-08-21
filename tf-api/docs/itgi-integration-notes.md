# ITGI (IFFCO-Tokio) Motor Integration — Consolidated Kit Notes

Distilled from `dock boyz/itgi kit/` (Motor Partner Integration Kit v4.0 + Partner CKYC Kit v1.4.1).
Only the facts needed to build a `src/providers/itgi/` adapter in the FG/ICICI pattern. Anything
marked **⚠ CONFIRM** is a gap to resolve with ITGI before go-live.

---

## 1. What ITGI is, at a glance

- **Line of business in this kit:** motor only — **PCP** (private car / `fw`) and **TWP** (two-wheeler / `tw`).
  Commercial (CVI) exists in the kit but has **no master data here** — treat as out of scope for phase 1.
- **Hybrid transport:** motor quote/proposal/payment/status/download are **SOAP/XML** (like FG);
  **CKYC is a separate REST/JSON API**. Two different mappers/normalizers needed.
- **No token/OAuth.** SOAP auth = partner credentials **in the body** (`partnerCode` / `partnerBranch` /
  `externalServiceConsumer`). CKYC REST shows **no auth header at all** → almost certainly **IP-whitelisting**. ⚠ CONFIRM.
  → **No `TokenManager` needed** for ITGI. Just env-stored partner codes (+ Basic-auth creds for policy download).
- **Money:** rupees end-to-end (samples show decimals, e.g. `18318.79`) — matches our whole-rupee convention.
- **Dates:** US format `MM/DD/YYYY` and `MM/DD/YYYY HH:mm:ss`.
- **Two integration modes** — we use **Partner-PG** (payment collected on our side), NOT the ITGI-hosted
  redirect (`XML_DATA` hidden-field POST). Partner-PG = pure web-service calls, fits tf-web's own flow.

---

## 2. End-to-end Partner-PG flow

```
CKYC (REST): fetch → [validate-otp] → [create] → itgiUniqueReferenceId (IURN)
   ↓ (IURN is required on every proposal)
IDV (SOAP getVehicleIdv)  →  Premium (SOAP getMotorPremium)  →
Proposal (SOAP validateProposalRequest) → returns orderNo + traceNo →
[collect payment on our PG] →
Payment update (SOAP updatePaymentDetails) → returns policyNumber + SUCCESSFULLY_SUBMITTED_IN_P400 →
Poll status (SOAP getPolicyStatus, keyed by uniqueQuoteId) →
Download policy PDF (REST JSON /policy/download, HTTP Basic)
```

**State to thread through:** we generate `uniqueQuoteId` (echoed everywhere; len 12–20 for break-in) →
proposal returns `orderNo` + `traceNo` → payment update returns `policyNumber` → status/download keyed by
`uniqueQuoteId` / `policyNo`. Success sentinel across the stack: **`SUCCESSFULLY_SUBMITTED_IN_P400`**
(or `..._UPDATED_IN_P400`); break-in returns `PAYMENT_ACCEPTED_BREAK_IN`.

---

## 3. Endpoints (UAT / staging)

| Purpose | Endpoint | Transport |
|---|---|---|
| IDV | `.../portaltest/services/IDVWebService` | SOAP |
| Premium (with add-ons) | `.../portaltest/services/MotorPremiumWebserviceVA` | SOAP |
| Premium (basic) | `.../portaltest/services/MotorPremiumWebService` | SOAP |
| New-vehicle premium | `.../portaltest/services/NewVehiclePremiumWebserviceVA` | SOAP |
| Proposal (Partner-PG) | `.../portaltest/services/PartnerProposalRequest` | SOAP |
| Payment update | `.../portaltest/services/PaymentUpdateWS` | SOAP |
| Policy status | `.../portaltest/services/CheckPolicyStatus` | SOAP |
| Policy download | `.../partner-services/policy/download` | REST/JSON, **HTTP Basic** |
| CKYC fetch/search | `.../partner-services/kyc/fetch` | REST/JSON |
| CKYC validate-OTP | `.../partner-services/kyc/fetch-validate-otp` | REST/JSON |
| CKYC create | `.../partner-services/kyc/create` | REST/JSON |
| CKYC update | `.../partner-services/kyc/update` | REST/JSON (optional for issuance) |
| Master data | `.../partner-services/master/data` | REST/JSON, **HTTP Basic** — request spec unknown (§8.5) |
| Partner portal (HTML) | `.../portaltest/MotorServiceReq` | Browser page, **not** a web service (§8.8) |

**Auth:** SOAP carries no header — the partner code in the body is the credential. **Every REST service
(CKYC, master data, policy download) takes HTTP Basic** with the partner username/password; without it
they answer 401 with an empty body (verified 2026-08-21).

Base host: `https://staging.iffcotokio.co.in`. ⚠ WSDL `<soap:address>` values are dev placeholders — ignore
them, use the table above. ⚠ Production host/paths not provided.

### SOAP transport facts (all services)
- SOAP 1.1, `style="document"`, `SOAPAction: ""` (empty), `Content-Type: text/xml; charset=utf-8`, empty `<soapenv:Header/>`.
- **Two namespace families:**
  - Premium + IDV → `http://premiumwrapper.motor.itgi.com` (body often unqualified; **misspelled tags**:
    `engineCpacity`, `regictrationCity`, `totalPremimAfterDiscLoad`, `erorMessage`).
  - Proposal/Payment/Status → ops in `http://util.ptnr.itgi.com` (`util:`), data in `http://wrapper.data.ptnr.itgi.com` (`wrap:`).

---

## 4. SOAP payload shapes (key tags only)

### 4.1 IDV — `getVehicleIdv`
Request needs composite `makeCode = {contractType}-{MAKE}-{yearOfMfr}` (e.g. `PCP-MRSFT-2016`) + `rtoCity`,
`dateOfRegistration`, `inceptionDate`. Response: `idv`, `minimumIdvAllowed`, `maximumIdvAllowed`.
(CVI Taxi: skip IDV service — average IDV is in masters, allowed range = avg ±10%.)

### 4.2 Premium — `getMotorPremium`
Key inputs: `contractType` (PCP/TWP), dates, `vehicle{capacity, engineCpacity, grossVehicleWt, make,
registrationDate, seatingCapacity, regictrationCity, vehicleClass, yearOfManufacture, zcover(=CO/AC),
validDrivingLicence, vehicleSubclass, vehicleCoverage[items]}`, `partner{partnerCode}`.
Coverage item = `{coverageId, number?, sumInsured}` where `sumInsured` is a numeric limit **or `Y`** for flag covers.

Response returns **one or two** `getMotorPremiumReturn` blocks: `autocoverage=false` (base) and, if add-ons
elected, `autocoverage=true` (base + bundled add-ons incl. default Depreciation Waiver). **Pick the block matching
the customer's add-on selection.** Persist per-cover `coverageName/odPremium/tpPremium` (add-on covers use a
single combined `coveragePremium`) + totals `totalODPremium, totalTPPremium, totalPremimAfterDiscLoad,
discountLoading, discountLoadingAmt, serviceTax, premiumPayable, totalPremium`. These OD/TP feed the proposal.

### 4.3 Proposal — `validateProposalRequest` (`util:proposalInput`)
Blocks: `contact` (customer), `coverage` (`util:item` per cover with `code/ODPremium/TPPremium/sumInsured/number`),
`partnerDetail` (`partnerCode`, `responseURL`), `policy` (dates, all premium totals from premium response,
`uniqueQuoteId`, `product`, `breakInofMorethan90days`, prev-policy fields), `vehicle` (reg number split across
**4 tags** `registrationNumber1..4` e.g. `DL/10/AH/4567`, `make`, engine/chassis, `rtoCity`, `zCover`),
`vehicleThirdParty` (hypothecation/interested-party). **IURN** goes here (KYC tag). → Response: `orderNo`, `traceNo`, `amountPayable`.

### 4.4 Payment update — `updatePaymentDetails` (`util:input`, `util:`-qualified)
`{amount, authorizationCode, authorizationDecision=Y, authorizationStatus, orderNumber(=orderNo),
partnerCode, traceNumber(=traceNo)}` → Response: `policyNumber`, `statusMessage`, `premiumPayable`.

### 4.5 Status — `getPolicyStatus` (`util:input`)
`{contractType, messageId, partnerCode, uniqueQuoteId}` → `{policyNo, status, traceNo, authFlag}`.
`authFlag` = `Y` (paid+issued) / `N` (payment failed) / blank (no payment attempted).

### 4.6 Policy download — REST JSON, **HTTP Basic auth**
`POST /partner-services/policy/download` `{contractType, policyDownloadNo, partnerDetail{partnerCode}}`
→ `{policyDownloadLink, statusMessage, error}`. ⚠ Staging returns a placeholder PDF; real PDFs supplied
manually by ITGI. Treat non-empty link + `SUCCESS` as success.

---

## 5. CKYC (REST/JSON) — search → validate-otp → create

All `Content-Type: application/json`, `POST`, **no auth header shown (IP-whitelist ⚠ CONFIRM)**. Response envelope
is `{status, result:{status, ...}}` (or `{status:400, errors:[...]}`).

**fetch/search** — IND needs `firstName, dateofBirth(DD-MM-YYYY), idType, idNumber, clientType, mobileNumber`
(mobile must match CKYCRR). `idType` enum: ITGI UNIQUE IDENTIFIER, CKYC IDENTIFIER, PAN, PASSPORT, VOTER ID,
DRIVING LICENSE, AADHAR CARD NUMBER, NREGA JOB CARD, NPR LETTER (+ LE-only doc types).
Result statuses: record found → details+IURN; `OTPPending` → go to validate-otp; not found → create.

**fetch-validate-otp** — `{itgiUniqueReferenceId(14-char IURN), validateOTPFlag, cersaiDownloadOTP, resendOTPFlag}`.
Exactly one of validate/resend = Y. Statuses: `OTPValidation-Success` (then re-call `/fetch` to get details),
`OTPValidation-Failed`, `OTPReTriggered-Success/Failed`.

**create** — full personal + related-person + permanent/correspondence address + `kycDocuments[]`
(`idType` ∈ IDENTITY_PROOF/ADDRESS_PROOF/OTHERS, `idName`, `idNumber`, `fileName`, `fileExtension` ∈ pdf/jpg/jpeg/tif/tiff,
`fileBase64`). Rules: PAN **or** FORM60 mandatory; ≥1 ADDRESS_PROOF; **PHOTOGRAPH mandatory for IND**.
Result: `SUCCESS` + IURN (`recordCreated:Y`), or `EXISTING RECORD` + IURN (doc already on file), or a
document-error status with blank IURN. **IURN is the output we carry into the proposal.**

**update** — optional (`updateFields` CSV over DOB/NAME/ADDRESS/RELATED_PERSON/COMMUNICATION/DOCUMENT_UPLOAD).
Not needed for issuance.

---

## 6. Master data — shapes & cross-walk

⚠ `ReadMe.txt`: these Excels may be outdated; ITGI expects the **live Master Data Service** feed. Treat as format refs.

- **MMV (`ITGI_Motor Data` → MAKE sheet, 16,679 rows):** one row per **variant**. `MAKE` is ITGI's 5–6 char
  variant code (e.g. `CBLTL`, `KNE6PZ`) — **the only join key**; there's no separate make/model/PASIA-numeric code.
  Columns: MAKE, MANUFACTURE, MODEL, VARIANT, CC, SEATING_CAPACITY, FUEL_TYPE, FROM/TO_YEAR(1990/2099 sentinel),
  CONTRACT_TYPE (PCP 11,536 / TWP 5,143). **No GVW, no vehicle-class.** Normalize fuel (BATTERY vs Electric,
  HYBRID vs Hybrid Electric). → maps to canonical `MmvMaster` via `ProviderMmvCode` (source=`itgi`), line by CONTRACT_TYPE.
- **RTO master: MISSING from the kit** (sheet says "Shared in another Excel"; ~2,134 rows expected: RTO code/city/state).
  ⚠ Must obtain from ITGI before building line-aware `ProviderRtoCode`. State/city are otherwise pincode-derived by ITGI.
- **Coverages (`PCP_TWP_Coverages.xls`, PCP+TWP sheets):** keyed by **coverage NAME, not a code** + OD/TP side.
  Exact coverage strings (use verbatim): `IDV Basic`, `PA Owner / Driver`, `PA to Passenger`, `TPPD`,
  `Legal Liability to Driver`, `Legal Liability to Employee`, `No Claim Bonus`, `Electrical Accessories`,
  `Cost of Accessories`, `CNG Kit`, `CNG Kit Company Fit`, `Voluntary Excess`, `AAI Discount`, `Anti-Theft`,
  `Embassy`, `Geographical Area`, `Side Car`, `Own Premises`, `Depreciation Waiver`, `Towing & Related`,
  `Consumable`, `Engine Gear Box Protection`, `RIM`, `Tyre Protection`, `HELMET` (TWP), `Preferred Garage Opted cover`,
  `Pay As You Drive`. Allowed-value enums: NCB {20,25,35,45,50}; Voluntary Excess PCP {2500,5000,7500,15000} /
  TWP {500,750,1000,1500,3000}; PA-to-Passenger SI 10k→200k step 10k; TPPD PCP 750000 / TWP 100000.
  → maps by name+side to canonical OD/TP components + `MotorAddon`.
- **Financier (`FinancierMaster`, 95,403 rows):** `EXTERNAL_CONTACT_NUMBER` = 8-digit zero-padded string code + name.
- **Previous insurers (45, names only, no codes):** fuzzy-match to `InsurerMaster`.
- **NotDeclinedMakes_TP (925):** whitelist of MAKE codes acceptable for standalone-TP.
- **Lookups (tiny CODE=LABEL):** GENDER M/F; OCCUPATION STDN/RETD/HSWF/BCON/SWPR/SHOP/DOCT/OTHR;
  SALUTATION MR/MS/MRS; MARITAL M/U/S/N; nominee-relationship = labels only.

---

## 7. Business rules worth encoding

- Old vehicle = first registration > 90 days before inception. Comprehensive max age 15y (10y with Zero-dep); Act-only 20y.
- Break-in (TWP+PCP comprehensive & standalone-TP): inception = date+3 (inspection at ITGI); TWP IDV > ₹3L ineligible;
  `breakInofMorethan90days` Y/N mandatory when prev-policy details blank; NCB allowed only if renewed within 90d.
- CPA / PA Owner-Driver: `validDrivingLicence` + `AlternatePACover` govern issuance (see Annexure XI scenarios).
- Default covers always present: Legal Liability to Driver, PA Owner/Driver, TPPD (TWP 100000 / PCP 750000).
- Add-ons allowed: Depreciation/Zero-Dep (+ Limited Dep), Towing & Related, Consumable, Helmet (TWP, SI ≤50000),
  Pay As You Drive (odometer in `number`, plan B01–B06 in `sumInsured`), and **RIM / Tyre Protection / Engine Gear
  Box Protection — now valid for BOTH Private Car and Two Wheeler** (updated in the "(1) - new" kit; the older doc
  said PCP-only). Tyre cover only for vehicles ≤4 years old.
- Single-year OD renewal (`type=OD`) needs the running package TP policy details.

---

## 7a. Which kit folders to use (vendor shared duplicates — 2026-07-24)

- **Motor: use `ITGI_PARTNER_MOTOR_INTEGRATION_KIT_v4.0 (1) - new`.** It equals the older copy plus one new file
  (`ServicesAndSamples/Two Wheeler_EngineTyreRimTWP_curl.xml`) and one help-doc line: Engine/Tyre/RIM add-ons
  extended from PCP-only to **Private Car + Two Wheeler**. Coverage `.xls` differs only cosmetically (identical coverage lists).
- **CKYC: use `ITGI_PARTNER_CKYC_KIT_V1.4.1` — NOT `CKYC-Kit- new`.** The "new" CKYC folder is a **regression**:
  it ships search API **v1.2 (Jan 2023)** vs the v1.4 (May 2024) we already have, and **omits** the update API
  (v1.1 Jul 2025), the validate/resend-OTP API, and two sample files.

**Evidence from the new curl sample** (first real working call in the kit) — worth keeping:
- Headers are only `SOAPAction;` (empty), `Content-Type: application/xml`, and a `JSESSIONID` cookie →
  **confirms no API key/token on SOAP**; auth really is `partnerCode` in body (+ presumed IP whitelist).
- Shows a live partner code belonging to **another partner** (`ITGIMOT216` / branch `PHONEPE_INSURANCE`) —
  confirms the format `ITGIMOT###` + branch = partner-name string. Not usable by us.
- `regictrationCity` is sent as plain **`DELHI`** (readable city name), whereas other samples use `CHHDHAMT`.
  → ⚠ Ask ITGI whether `rtoCity`/`regictrationCity` accepts city names/standard RTO codes; if yes, the missing
  RTO master (gap #3) downgrades from blocker to nice-to-have.
- Confirms the dual `autocoverage=false/true` response pair, add-on premiums as a single `coveragePremium`.

## 8. Gaps / open confirmations

**Status 2026-08-21** — ITGI issued UAT credentials for Novacred Insurance Broking (PCP & TWP) and we
re-probed live: `npx tsx --env-file=.env scripts/itgi-uat-probe.ts` (read-only; never touches proposal
or payment). The former hard blockers are gone. Production URLs deliberately excluded (not needed yet).

### Resolved — live-verified 2026-08-21
1. **IP whitelisting — RESOLVED.** `staging.iffcotokio.co.in` now answers; the July 2026 TCP-drop is gone.
   `IDVWebService` returns a real band for a 2023 Swift/Delhi: idv 4,72,300 (min 4,45,995 / max 6,29,640).
2. **Partner credentials — RECEIVED and working.** `ITGIMOT321` / branch `Novacred` / sub-branch `Novacred`
   (both PCP and TWP), Basic-auth pair `ITGIMOT321` : `partner@2020`. `MotorPremiumWebserviceVA` priced the
   same vehicle live: **₹14,483.32** base (`autocoverage=false`) and **₹18,384.40** with the bundled
   Depreciation Waiver (`autocoverage=true`) — the documented dual-block response, exactly as §7 predicted.
3. **CKYC auth — ANSWERED: HTTP Basic, same partner pair.** Unauthenticated `/kyc/fetch` returns **401 with an
   empty body**; with Basic it returns `200 {"status":"200","result":{"status":"No Record"}}`. So it was never
   an IP question — the kit simply omits the auth section.
4. **Policy-download credentials — RECEIVED** (same pair). `/policy/download` answers the business validation
   `{"statusMessage":"FAIL","error":[{"errorField":"policyDownloadNo","errorMessage":"Policy Number is required."}]}`.

### Still open
5. **RTO master** — still not shipped. The help doc defines `RTOCity` as "RTO city code. Should match the ITGI
   master data", and the samples use tokens like `CHHDHAMT`. Mitigating evidence: the plain city name **`DELHI`
   is accepted by both IDV and premium** in our live calls, so the field takes a city token, not a numeric code.
   We still need the full canonical→ITGI city list. The **master-data service** (`/partner-services/master/data`)
   exists and accepts our Basic auth, but every request shape we tried returns
   `{"status":0,"error":[{"errorField":"runtime","errorMessage":"...technical fault..."}]}` → **ask ITGI for its
   request spec**, which would also replace the stale kit Excels.
6. **UAT smoke-test data** — a known-good TWP make+RTO combo, and a test PAN/Aadhaar+mobile that returns an
   actual CKYC record (our probe PAN correctly returns "No Record").
7. **Proposal → payment → status → COI not yet exercised live.** `PartnerProposalRequest` is up (an empty POST
   draws an Axis SOAP fault, so the service is there), but these create real records in ITGI's core, so they
   need ITGI's go-ahead plus the `authorizationCode` / `authorizationStatus` / `authorizationDecision` semantics
   for `updatePaymentDetails`, and confirmation of the real policy-PDF/COI delivery.
8. **`/portaltest/MotorServiceReq`** — listed with the credentials, but it serves the **"ITGI Partner Web Portal"
   HTML page**, not a web service. Presumably the browser leg of the Partner-PG flow; confirm its role.
   Held in `ITGI_ENDPOINTS.partnerPortal`, unused for now.
9. **Three WSDLs absent** — `PaymentUpdateWS`, `CheckPolicyStatus`, `PartnerDownloadPolicyCopy` ship as sample
   req/res only. Envelopes are hand-built from the samples; workable.
10. **CVI (commercial)** — no masters in kit; defer unless ITGI provides them.

### Payload defects the live calls exposed (both fixed 2026-08-21)
- **`policyHeader` was missing** from the premium envelope. Axis binds the operation's parameters positionally,
  so it read `<policy>` as the `PolicyHeader` and faulted
  `org.xml.sax.SAXException: Invalid element in com.itgi.motor.premiumwrapper.PolicyHeader - contractType`.
  Every kit sample opens with `<policyHeader><messageId>…</messageId></policyHeader>`; we now do too.
- **New-vehicle pricing used the wrong operation.** We posted `<getMotorPremium>` to
  `NewVehiclePremiumWebserviceVA`; the operation is `<getNewVehiclePremium>` and its response comes back
  under `getNewVehiclePremiumReturn` (the normalizer now reads both tags).

---

## 8a. Implementation status (2026-08-21)

The quote half of the adapter is now **live on ITGI UAT**: IDV and premium both price real vehicles with
our own partner code, and the CKYC / policy-download REST services authenticate. The issuance half
(proposal → payment → status → COI) is built and unit-tested but **still never executed live**, because
those calls create real records — see gap 7. `ITGI_ENABLED` defaults to `false`, so the provider is not
registered until it is turned on.

**Not yet quotable through the app**, despite the live pricing above: `ProviderRtoCode(itgi)` is empty and
`scripts/import-itgi-master.ts` has not been run against any environment (0 itgi rows in mmv/rto/insurer
locally, vs ~7.5k for icici). Until the RTO master lands, `db-code-resolver.ts` raises
`ItgiUnmappedCodeError` → `no_quote`, so ITGI is silently omitted from comparisons.

Implemented in `src/providers/itgi/`: config + capabilities, error classification, SOAP/JSON transports,
formatting helpers, policy-path resolution (comprehensive / act-only / OD-renewal / new-vehicle, with
break-in as a composable modifier), strict code resolver, IDV + premium mapper, response normalizer
(incl. dual `autocoverage` block selection), CKYC REST client, proposal → payment → status → certificate,
the provider class, and `scripts/import-itgi-master.ts`. 104 ITGI unit tests; full suite 913 passing.

**Two corrections to the original design, made during implementation:**

1. **No `renewal` or `inspection` operation is declared.** The kit exposes only six SOAP services
   (IDV, MotorPremium ×2, NewVehiclePremium, CVIIDV, PartnerProposalRequest) — there is **no renewal API
   and no create-inspection endpoint**. Declaring those capabilities would make the `supports*()`
   type-guards lie. Both journeys are still fully supported *inside the normal quote/proposal flow*:
   single-year OD renewal as a policy **type** (`standAloneOD` → ITGI `PolicyType=OD` + running TP policy
   details), and break-in as a **modifier** (inception+3, `breakInofMorethan90days`, inspection-evidence
   tags, `PAYMENT_ACCEPTED_BREAK_IN`). Break-in progress is observed via `policyStatus`.
2. **No Prisma migration.** Coverage names are a static map in `config.ts`; MMV/insurer codes reuse the
   existing `Provider*Code` tables (keyed by `providerSlug`, not the `source` column on canonical rows).

**RTO remains strict:** `scripts/import-itgi-master.ts` writes **no** `ProviderRtoCode` rows and prints a
warning. Until the vendor's RTO master is imported, every ITGI quote raises `ItgiUnmappedCodeError` →
surfaced as `no_quote`, so ITGI is simply omitted from the comparison rather than erroring.

## 9. How it maps onto our provider pattern

New `src/providers/itgi/`: `config.ts` (env → partner codes + endpoints + capability constants),
`http.ts` (SOAP transport, `SOAPAction:""`), `mapper.ts` + `normalizer.ts` (motor premium/IDV — mind the misspelled
tags), `ckyc.ts` (REST fetch/validate-otp/create; implements `KycCapableProvider`), `proposal`/`payment`/
`policy-status`/`certificate` capability files (Partner-PG chain), `db-code-resolver.ts` (canonical IDs → ITGI
MAKE/RTO/coverage-name codes, source=`itgi`), `itgi.provider.ts`, `index.ts` (`registerItgiProvider`).
**No `auth.ts`/token manager.** `operations`: motorQuote, kyc, issuance, policyStatus, certificate (+ inspection for break-in).
Off by default via `ITGI_ENABLED`. Imports idempotent + source-tagged like FG/ICICI.

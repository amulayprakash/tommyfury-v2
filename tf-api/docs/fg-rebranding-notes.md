# FG → Generali Central — Rebranding + Motor JSON Migration Notes

**Source kit:** `dock boyz/FG API Kit/TCS Motor API KIT - JSON Latest Revised Rebranding/…/TCS Motor KIT - JSON`
(plus the sibling XML kit, `fg more/`, and the CKYC / Payment / Renewal / Inspection sub-kits).
**Compiled:** 2026-07-22, from a full read of every file in the kit by 8 parallel intel agents.
**Status:** INTEL ONLY — no code changed. This is the input for a later migration plan.

> **One-line summary:** Future Generali rebranded to **Generali Central Insurance**
> (`futuregenerali.in` → `generalicentralinsurance.com`) **and** moved the motor
> new-business API from **SOAP/XML (`MotorNB/1.0.0`)** to **JSON (`MotorAPI/1.0.0`)**.
> CKYC, payment, renewal and inspection also have rebranded artifacts. The TCS-BANCS
> backend, field semantics and master codes (PASIA_CODE etc.) are **unchanged** — this
> is a transport + host + branding migration, not a schema redesign.

---

## 0. Headline deltas (what actually changed)

| Area | Current tf-api adapter | New Generali Central kit | Impact |
|---|---|---|---|
| **Motor protocol** | SOAP 1.1 / XML, `text/xml`, `tem:` envelope, CDATA `<Root>` | **JSON**, `application/json`, flat `Root` tree | **Rewrite** mapper + normalizer + http |
| **Motor product path** | `/MotorNB/1.0.0/{GetQuote,CreateProposal,PolicyIssuance}` | `/MotorAPI/1.0.0/{GetQuote,CreateProposal,**IssueProposal**}` | issuance op **renamed**, path segment changed |
| **Host** | mixed (motor on GC, CKYC+renewal still `futuregenerali.in` in live `.env`) | all on `*.generalicentralinsurance.com` | env/host cleanup |
| **Renewal** | JSON-req / XML-resp, `motorRenewal/1.0.0/TCS-Renewal/API/MotorRenewal` | **full JSON**, `Renewal/1.0.0/RenewalModify/*`, `Internal-Key` header | **rewrite** renewal adapter |
| **Payment** | v1.40, `fgnluat.fggeneral.in/…/WebAggPayNew.aspx` | v1.41, `digi[uat].generalicentralinsurance.com/…/WebAggPayNew.aspx` + SOAP recon | update URLs, add recon step |
| **CKYC** | `GCKYC/3.0.0`, matches | `GCKYC/3.0.0` (kit also shows a `GCKYC/2.1.0` prod variant) | host cleanup, confirm version |
| **Inspection** | LiveChek `newapi.test.livechek.com`, static app-key | LiveChek (unchanged) | verify keys survive rebrand |
| **CKYCNo on proposer** | optional/blank | **mandatory** at CreateProposal | contract + validation change |

**The canonical `Root` payload survived the migration almost verbatim** — the JSON body is the
old SOAP `<Root>` CDATA element re-serialized as JSON (same tag names, nesting, enum values).
So the motor mapper port is largely "emit the same tree as JSON instead of XML-in-CDATA".

---

## 1. Environments, hosts, auth

### 1.1 Hosts (UAT — all rebranded)

| Purpose | Host:port | Notes |
|---|---|---|
| WSO2 token (OAuth2) | `uat-internal-apim.generalicentralinsurance.com:9443/oauth2/token` | **already the tf-api `FG_TOKEN_URL` default** |
| API gateway (motor/ckyc/renewal) | `uat-internal-apigw.generalicentralinsurance.com:8243` | **already the tf-api `FG_BASE_URL` default** |
| CKYC redirection / eKYC portal | `https://ekyc-uat.fggeneral.in/kyc-v2-verification` | ⚠ still on `fggeneral.in` |
| Payment UAT | `https://digiuat.generalicentralinsurance.com/Ecom_UAT/WEBAPPLN/UI/Common/WebAggPayNew.aspx` | v1.41 |
| Payment PROD | `https://digi.generalicentralinsurance.com/Ecom_NL/WEBAPPLN/UI/Common/WebAggPayNew.aspx` | v1.41 |
| Payment recon (SOAP, live) | `https://pg.generalicentralinsurance.com/quick_pay/quickpay/comservice.asmx?op=FetchTRNDetails` | new |

> **The `-internal-` in the gateway hostnames** suggests these may be network-restricted /
> IP-whitelisted. Confirm the external/prod reachable host before go-live.
> **No production API hosts** for motor/CKYC/renewal are in the kit (only UAT + prod *token* + prod *payment*).

### 1.2 Auth — WSO2 OAuth2 password grant (per-product subscription)

The kit's motor GetQuote/Proposal/Issuance samples all ship `Authorization: Bearer null` (captured
against a security-stripped gateway), but the **token endpoint + UAT creds are recoverable** from the
renewal `Auth Token API.txt`, the masters integration doc, and the postman collections:

```
POST https://uat-internal-apim.generalicentralinsurance.com:9443/oauth2/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(consumerKey:consumerSecret)>
Body: grant_type=password&username=<user>&password=<pass>
→ { access_token (JWT RS256), refresh_token, token_type: Bearer, expires_in }
```

This is **the same grant tf-api already implements** (`auth.ts` / `token-manager.ts`). Each WSO2
**product is its own subscription** (its own consumerKey:secret) — matches the existing per-product
token pattern (`fg:default`, `fg-ckyc:default`, `fg-renewal:default`, `fg-health:default`).

**UAT credentials found in the kit** (see §9 appendix for the full table). Notably the numeric
`AgentCode 60001464`, `BranchCode 10`, `VendorCode Webagg` — already the tf-api env defaults.

Open auth questions: token TTL (`expires_in` labelled "60000 ms" but JWT math = 60000 s ≈ 16.6 h;
docs also say "generate a token per request"); whether the `sess_map` sticky cookie must be echoed;
whether the JSON `MotorAPI/1.0.0` product needs a **new consumer key** distinct from the current
`MotorNB` subscription.

---

## 2. Motor — JSON new-business flow (GetQuote → CreateProposal → IssueProposal)

### 2.1 Endpoints

| Op | METHOD tag | URL |
|---|---|---|
| Get Quote | `ENQ` | `…:8243/MotorAPI/1.0.0/GetQuote` |
| Create Proposal | `CRT` | `…:8243/MotorAPI/1.0.0/CreateProposal` |
| Policy Issuance | (none) | `…:8243/MotorAPI/1.0.0/IssueProposal`  ← was SOAP `PolicyIssuance_Vendors` |

Headers (all three): `accept: */*`, `Content-Type: application/json`, `Authorization: Bearer <token>`.
All values sent as **JSON strings** (incl. numerics). Dates `dd/MM/yyyy` (samples date-only; dict says `dd/MM/yyyy HH:mm:ss`).

### 2.2 Request tree (`Root`) — quote/proposal share the shape

Top-level: `Uid, VendorCode, VendorUserId, PolicyHeader, POS_MISP?, Banca?, Client, Receipt, Risk`.

- **PolicyHeader**: `PolicyStartDate, PolicyEndDate, AgentCode(8), BranchCode(2), strpolicyquoteNumber, MajorClass("MOT"), ContractType(3), METHOD(ENQ|CRT), PolicyIssueType("I"), PolicyNo(""), ClientID(""), ReceiptNo("")`.
  - ⚠ **casing:** CreateProposal uses `strpolicyquoteNumber` (lower p); IssueProposal uses `strPolicyQuoteNumber` (upper P). Send exactly as each op expects.
- **Client** (blank-able for quote, full for proposal): `ClientType(I/C), CreationType(C=new/rollover,U=renewal), Salutation, FirstName, LastName(".." if none), DOB, Gender(M/F/T), MaritalStatus(M/S/D/W), Occupation(4ch master), PANNo, GSTIN, AadharNo, **CKYCNo(20, MANDATORY at proposal)**, CKYCRefNo, Address1/2/3{AddrLine1..3(max30), Landmark, Pincode(6), City, State, Country("IND"), AddressType(R/P/K), MobileNo(10), EmailAddr}, VIPFlag`.
- **Risk**: `RiskType(3), Zone("A"), Cover(CO/LO/OD), Vehicle{…}, InterestParty{Code(HP/HY/LA),BankName}, AdditionalBenefit{…}, AddonReq(Y/N), Addon[{CoverCode}], PreviousTPInsDtls{…}, PreviousInsDtls{UsedCar,RollOver,NewVehicle + lists}`, + trailing blank flags (`ZLLOTFLG, GARAGE, ZREFRA, ZREFRB, ZIDVBODY, COVERNT, CNTISS, ZCVNTIME, AddressSeqNo`).
  - **Vehicle**: `TypeOfVehicle(2W=T/3W=W/4W=O), VehicleClass, RTOCode(4,"MH01"), Make(master), ModelCode(=PASIA_CODE,"HO0002"), RegistrationNo, RegistrationDate, ManufacturingYear, FuelType(P/D/C/L/B/H/PH/DH), CNGOrLPG{InbuiltKit,IVDOfCNGOrLPG}, BodyType(master), EngineNo, ChassiNo, CubicCapacity, SeatingCapacity, IDV("0"→system computes on quote), GrossWeigh, ValidPUC(N new/Y rollover), SchoolBusFlag`.
  - **AdditionalBenefit**: `Discount(neg=loading), NCB(%), CPAReq+CPA{nominee}, CPAYear, NPAReq+NPA[], PACoverForUnnamedPassengers, LegalLiability*, ExistingPACover+PA{}, PAYAsYouDiscount{}(new telematics block, blank)`.
  - **PreviousInsDtls.RollOverList** (rollover): `PolicyNo, InsuredName, PreviousPolExpDt, ClientCode(prev-insurer master), NCBInExpiringPolicy, ClaimInExpiringPolicy, NCBDeclartion, PreviousPolStartDt, NoOfClaims, AddonCover{ZeroDepreciation,EngineProtect,RTI,TyreProtect}, InspectionRptNo/Dt`.
  - **PreviousTPInsDtls** (standalone-OD rollover only): `PreviousInsurer, TPPolicyNumber, TPPolicyEffdate, TPPolicyExpiryDate`.

### 2.3 IssueProposal request (minimal)

```json
{ "Uid","VendorCode","PolicyHeader":{"strPolicyQuoteNumber","PolicyStartDate","PolicyEndDate","ClientID"},
  "Receipt":{"UniqueTranKey","CheckType","BSBCode","TransactionDate","ReceiptType":"IVR","Amount","TCSAmount","TranRefNo","TranRefNoDate","PGType"} }
```
No Client/Risk re-sent (server has them against the quote). `strPolicyQuoteNumber` + `ClientID` come from the CreateProposal response; Receipt from the payment gateway response.

### 2.4 Responses (⚠ envelope inconsistency)

- **GetQuote & CreateProposal**: wrapped `{ "Root": { "Client", "Receipt", "Policy" } }`.
- **IssueProposal**: **NOT** wrapped in `Root` — top-level `{ "Client", "Receipt", "Policy" }`.
- Extraction points:
  - Quote no = `Root.Client.QuotationNo` → feed to `PolicyHeader.strpolicyquoteNumber`.
  - Client id = `Root.Client.ClientId` (CreateProposal) → feed to IssueProposal `ClientID`.
  - IDV = `Policy.VehicleIDV` (JSON = plain `"572729"`, SOAP was comma-grouped).
  - Premium = `Policy.NewDataSet.Table1[]` line items keyed by `Code` + `Type(OD|TP)` + **`BOValue`** (use this; `DBValue` is 0). Codes: `IDV, PrmDue, OD, TP, CPA, TOTALADDON, Gross Premium, ServTax(GST 18%), DISCPERC, NCB, IMT16/24/28/29, NEA, CNG`, plus addon codes.
  - Final policy no = `Policy.PolicyNo` (e.g. `132/14/11/0529/MTP/2410002509`); `Receipt.ReceiptNo`, `Policy.ApplicationNo`.
  - Success flags: `Table.LdrErrLvl="0"`, `Table.PolNo="Successful"`, each block `Status="Successful"`. FG returns HTTP 200 on business failures — detect via `Status`/`ErrorMessage`. **No error-response sample in kit.**
- **No COI / policy-PDF URL** returned by any op — delivery mechanism undocumented (gap).

### 2.5 Contract-type / risk-type matrix (Motor field Master → "Contract Type")

| Product | Normal CT | POS CT | MISP CT | RiskType | Cover / tenure |
|---|---|---|---|---|---|
| Private Car Annual | FPV | PPV | MPV | **FPV** | CO 1+1 / LO 0+1 |
| Private Car Bundled (new) | F13 | P13 | M13 | **F13** | CO 1yr OD + 3yr TP |
| Private Car Standalone OD | FVO | PVO | MVO | **FVO** | OD 1+0 |
| Commercial (Goods) | FCV | PCV | MCV | **FGV** | CO / LO 1+1 |
| Passenger (Auto) | FCV | PCV | MCV | **FPC** | CO / LO 1+1 |

⚠ **RiskType ≠ ContractType for POS/MISP/commercial** (e.g. POS car `ContractType=PPV` but `RiskType=FPV`; `FCV`→`FGV`/`FPC`). Matches current `resolveContract()` for the Webagg (Normal) channel. Two-wheeler/Taxi/Misc are in the master but **not allowed for web-agg yet**.

### 2.6 CV / Passenger caveat

**Only PVT car (F13/FPV) has rebranded JSON samples.** Goods (FGV) and Passenger (FPC) sample logs
in the kit are still **legacy SOAP/XML**. The JSON contract is the same `Root` tree, but request
rebranded JSON CV/passenger samples + confirm endpoints from GCI before commercial go-live.

---

## 3. CKYC — `GCKYC/3.0.0`

- **Endpoints** (POST, `Bearer` + optional `Token` subscription header): `…/GCKYC/3.0.0/Web/VerifyCKYC`, `…/GCKYC/3.0.0/Verify/GetKycStatus`, `…/GCKYC/3.0.0/Verify/UploadDocBytes`. (A prod postman shows a **`GCKYC/2.1.0`** variant at `apigw.generalicentralinsurance.com` — confirm the prod version.)
- **VerifyCKYC** req: `req_id, id_type(PAN/AADHAAR/CKYC/CIN/VOTER/DL/PASSPORT), id_num, dob, mobile, full_name, gender, url_type, customer_type(I/C), redirect_url, system_name`. Resp envelope: `apiStatus(Success/Failed)`, `kycStatus(1=record found, 0=none)`, `response{ckyc_number, url, proposal_id(PR_xxx)}`.
- **Flow:** record found → `ckyc_number` straight to proposal. No record → `response.url` = eKYC redirect (`ekyc-uat.fggeneral.in/kyc-v2-verification?access=<token>`) → customer uploads docs (CERSAI miss → Arya OCR verification) → browser returns to our `VISoF_Return_URL` → we poll **`GetKycStatus`** by `proposal_id` (`finalStatus` 1 or 3 = success; 0/null = re-upload).
- **Redirection bridge** (`fg_kyc_redirection*.html`): auto-submitting form to the eKYC portal; hidden fields `VISoF_KYC_Req_No`, `IC_KYC_No` (= proposal_id) and `VISoF_Return_URL` (our return URL — sample is a placeholder). Loads jQuery from Google CDN → **must self-host** under CSP.
- **Correlation key:** `proposal_id` (`PR_xxx`) threads VerifyCKYC → redirect → GetKycStatus. There is no query-param callback of the CKYC number — must pull via GetKycStatus.
- vs current `ckyc.ts`: endpoints match; **UploadDocBytes is new** (current `initiateOvd` throws 501). Current live `.env` CKYC host still `futuregenerali.in` → repoint to `generalicentralinsurance.com`.
- Open: IP-whitelisting; grant type (password vs client_credentials both documented); `system_name` canonical value (`Webagg` vs `KYCWEBAGG`); DOB format (`dd-mm-yyyy` vs `YYYY-MM-DD`); OTP path (naming says OTP, behaviour is redirect); `finalStatus` 1 vs 3 meaning; prod hosts.

---

## 4. Payment — Web Aggregator v1.41

- **Model:** browser HTML-form POST (redirect), **not** a server API. Backend builds a signed field set the browser auto-submits; PG posts result back to our `ResponseURL`. Then a **server-side SOAP recon** (`FetchTRNDetails`) re-validates before issuance.
- **URLs:** UAT `digiuat.generalicentralinsurance.com/Ecom_UAT/…/WebAggPayNew.aspx`; PROD `digi.generalicentralinsurance.com/Ecom_NL/…/WebAggPayNew.aspx`. (The PG-parameter xlsx + Test_html still carry OLD `fggeneral.in` URLs — PDF v1.41 is authoritative.)
- **Request fields** (order = checksum order): `TransactionID, PaymentOption(1=PayTm,2=HDFC,3=PayU), ResponseURL, ProposalNumber, PremiumAmount, UserIdentifier, UserId, FirstName, LastName, Mobile, Email, Vendor, CheckSum`.
- **Checksum:** plain **SHA-256 hex** (no HMAC/salt) over the 11 fields pipe-joined **with trailing `|`** (`Vendor`+`CheckSum` excluded). PHP path appends a 12th timestamp field. tf-api is Node → use the 11-field `.NET` string with `Vendor` blank/0.
- **Response:** `.NET` path = one DES-encrypted `ResponseData` (DES-CBC, key `&%#@?,:*`, IV `[18,50,80,125,140,170,205,230]`, `$`→`+` before decode); PHP path = plaintext query params. Fields: `WS_P_ID, TID, PGID, Premium, Response(Success/Failure/Error)`.
- **Issuance linkage:** `WS_P_ID → Receipt.UniqueTranKey`, `PGID → Receipt.TranRefNo`, `ReceiptType="IVR"`, `Amount=` premium (whole rupees). **PayU is mandated** for web-agg (Razorpay on request; for Razorpay swap `UniqueTranKey`↔`TranRefNo`).
- **Flow position:** Quote → CKYC → Proposal → **Payment** → Issuance (break-in inserts Inspection before Payment).
- vs current `payment.ts`: implements v1.40 with old `fggeneral.in` URL and `Vendor:"1"` (PHP). **Update:** URLs → v1.41 GC hosts; **add the SOAP recon step**; decide `.NET`(11-field, DES-decrypt) vs current PHP path; DES crypto constants unchanged.
- Open: `PaymentOption` mapping conflict (PDF vs old xlsx); Node's `Vendor` value; real `UserIdentifier`/`UserId` (booking code); UAT recon URL; current UAT test card expired (05/2025).

---

## 5. Renewal — `Renewal/1.0.0/RenewalModify` (full rewrite)

- **Separate WSO2 product** `GCMotorRenewalAPI`, context `/Renewal/1.0.0`, own subscription/token. Token via password grant; **the three calls send the token in an `Internal-Key` header, not `Authorization: Bearer`** (docx says Bearer — contradiction, confirm).
- **Endpoints (JSON, all POST):** `…/Renewal/1.0.0/RenewalModify/{ModifyRenewalQuote, ModifyRenewalProposal, ModifyRenewalPolicyIssuance}`.
- **Flow:** `ModifyRenewalQuote{policyNo,expiryDate,registrationNo,vendorCode}` → returns full expiring-policy snapshot (`PolicyHolderDeatils, VehicleDetails, OldPolicyDetails, ODPremium, TPPremium`, break-in/CKYC flags) → `ModifyRenewalProposal` (echo Quote values, apply a constrained modification delta) → payment → `ModifyRenewalPolicyIssuance{PolicyNo, ClientID, ProposalNo, AgentCode, BranchCode, Receipt{…}}` → new `policyNumber`.
- **Modifiable surface** (`ModifyDetails`): add-ons (`AddonCode:[{CoverCode}]`), IDV, cover conversion (CO/SAOD/SATP), `DiscountPercentage` (negative, as returned), IMT flags, CNG/LPG SI, IDVOfCNGOrLPG. Break-in linkage via `InspectionNo`/`InspectionDate`. CKYC inline via `CKYCNo`/`CKYCRefNo` when unverified.
- **Business rules:** claims impact (1=remove NCB, 2=remove NCB+discount, 3=reject online); break-in ≤90d retains NCB (needs inspection), >90d loses NCB; market renewal blocked.
- **Load-bearing misspellings** to preserve: `PolicyHolderDeatils, ExipryDate, ChassiNo, ENgineNo, VehicaleIDV, NCBPercntage, RegistrationNO`.
- vs current `renewal.ts`: current is JSON-req/XML-resp at `motorRenewal/1.0.0/TCS-Renewal/API/MotorRenewal` on **legacy host**, 2 ops (`GetQuote`/`CreatePolicy`). New is **3 ops, full JSON, new path/host, `Internal-Key` header, "modify" semantics** → effectively a rewrite.
- Open: prod URLs (blank); `Internal-Key` vs Bearer; token-per-request vs cache; `VendorCode` (`Webagg` vs `BAJAJ` in samples); IDV-variation contradiction; comma-grouped IDV strings; break-in inspection number source; the "renewal" postman is mislabeled (actually CKYC prod / `GCKYC/2.1.0`).

---

## 6. Inspection / break-in — LiveChek (third-party)

- **Not FG-hosted.** LiveChek REST, static `App-key` header. Create `POST newapi.test.livechek.com/api/reports/`, status `GET …/reports/:refId/status`. UAT keys present in kit (companyId, aip/pitAppId, App-key, appUserId, branchId).
- **Trigger:** break-in fires **only after underwriter approval** (on UW reject, no inspection). `InspectionRptNo` + `InspectionDt` inject into the CRT proposal/issuance for rollover-with-break-in and used-car.
- **Status enum → gate:** `initial/company-approved/request-approved`=pending; `in-process`=pending QC; `accepted`=recommended (proceed), `rejected`=not recommended (block), `refer`=to underwriting.
- **⚠ Break-in is confirmed OUT OF SCOPE for the web-aggregator/broker portal** per partner agreement (masters guidelines) — the inspection docs ship but the portal doesn't run break-in. tf-api already has `inspectionRequired()` gating; keep but treat as dormant for web-agg.
- vs current `inspection.ts`: matches (LiveChek, app-key, reports endpoints). Only the real `InspectionWebservice_Documentation.docx` (FG-side wrapper + image-upload spec) is **missing from the kit** (only an Office lock file) — source from GCI if break-in is ever enabled.

---

## 7. Masters & business rules (import + validation)

- **Master workbook** `Motor field Master.xls` (30 sheets): PVT Car MMV 16,934 / GCV 16,412 / PCV 1,061 (`PASIA_CODE`=ModelCode, plus GVW/seating/CC/body/fuel/status/BANCS code); RTO 1,536; Pincode ~168k (3 sheets); Cashless Garage 6,994; Contract Type; Add-On Covers (age-eligibility); Additional Benefits; Fuel/Occupation(141)/Body(104)/Salutation/Relation/State(43); PYP Insurer(31) & TP Insurer(25) → `ClientCode` for rollover; NCB slabs 0/20/25/35/45/50; Exclusion covers (anti-theft/geo/AAI/restricted-TPPD — hidden on portal).
  - **Masters are unchanged vs the current FG import** (same PASIA_CODE keys) — re-import largely as-is via `db:import:fg`. **Do not override the shared master/provider-code tables to pass a test** (they feed the live resolver).
- **Add-on combos** (PVT car, by max vehicle age): `STRSA<15, STZDP<7, ZDCNS<7, ZDCNE<7, ZDCNT<5, ZDCET<5, ZCETR<3, STNCB<5, STINC<5` (STNCB/STINC cannot be standalone — need a Zero-Dep addon). Electric: `ZDCBG/ZCEBG/ZCTBG/ZDETB<5, ZCTRB/ZETRB<3`. GCV: `ZODEP<3, CONSM/AT10K/AT20K<5` (only with Zero-Dep). PCV auto: no add-ons.
- **Business rules / validations to surface pre-payment:** vehicle age >15 → no quote; declined RTO Haryana **HR-38**; declined MMV (e.g. Audi RS6 petrol, Honda Amaze 1.2 EX); blacklisted/duplicate registrations; advance inception **max 45 days**; PVT IDV ±20%, GCV/PCV ±50%, GCV UW cap >25 lakh; rollover PUC mandatory; CPA individual-only; inspection waiver T+2 (GCV/PCV, ex-MP RTO).
- Open: declined-RTO/MMV/blacklist masters not in workbook (only in test cases) — get authoritative decline masters from GCI; prod insurer `ClientCode` master; MP-RTO list for waiver.

---

## 8. Gap list vs current tf-api adapter (actionable)

Ordered by effort. This is the migration backlog, **not yet actioned**.

1. **Motor mapper/normalizer/http → JSON (large).** Replace SOAP envelope builder (`mapper.ts buildSoapEnvelope`, `http.ts parseSoapResponse`/`text/xml`/`SOAPAction`) with JSON POST + `application/json`; path `MotorNB/1.0.0`→`MotorAPI/1.0.0`; issuance op `PolicyIssuance_Vendors`→`IssueProposal`. Normalizer: handle **Root-wrapped quote/proposal vs un-wrapped issuance**; same `Table1[]`/`BOValue` parsing. Keep `resolveContract`, fuel map, addon codes (unchanged). New fixtures from kit JSON logs.
2. **Renewal adapter rewrite (medium).** New 3-op `Renewal/1.0.0/RenewalModify` JSON flow, `Internal-Key` header, echo-then-modify proposal, new host. New product token/subscription.
3. **Payment update (medium).** URLs → v1.41 GC hosts; add SOAP `FetchTRNDetails` recon step; decide `.NET` 11-field checksum + DES-decrypt vs current PHP path; keep DES constants.
4. **CKYC touch-ups (small).** Repoint live `.env` CKYC host to `generalicentralinsurance.com`; implement `UploadDocBytes` (currently 501); self-host jQuery in the redirect bridge; confirm `GCKYC/3.0.0` vs `2.1.0` prod version.
5. **CKYCNo mandatory (small).** Enforce `Client.CKYCNo` at CreateProposal (contract + validation).
6. **Config/env (small).** Add a JSON `MotorAPI` product path (or flip `MotorNB`→`MotorAPI`); ensure per-product consumer keys; remove residual `futuregenerali.in` hosts from live `.env`.
7. **Masters re-import (small).** Re-run `db:import:fg` from the new workbook (idempotent, source-tagged); verify PASIA_CODE parity.
   - ✅ DONE (2026-07-23): re-imported from the new JSON-kit `Motor field  Master.xls` via `db:import:fg`; parity verified (`db:verify:fg`) — MMV and RTO are exact zero-drift (20310 / 1535, unchanged before and after the re-import); idempotency proven via a double-import into `tf_api_dev` (stable counts both runs: 20310 MMV / 1535 RTO / 140 occupation / 24 insurer(fg) / 17 addon / 168011 pincode) plus a dedicated row-count + PASIA_CODE spot-check test against a freshly-migrated `tf_api_test`. Insurer parity shows a **stable Δ=1 "removed"** (`ICICI_LOMBARD`) on both runs — not a re-import defect: it is a pre-existing `prisma/seed.ts` row (`InsurerMaster.code="ICICI_LOMBARD"`) mistagged `source="fg"` even though it is actually linked to the ICICI provider via `ProviderInsurerCode`; the FG importer's insurer step is upsert-only by design (it never deactivates codes missing from the sheet), so it correctly leaves this row untouched. Three DATA GAPS remain, open with GCI (not code):
     - **PYP Policy Insurer** (30 rollover `ClientCode`s, 14 not present in `insurer_master`) is not ingested — the importer only reads `TP Policy Insurer` (24 codes, standalone-OD). Confirm whether rollover `PreviousInsDtls.ClientCode` must resolve against PYP.
     - Add-On CoverCodes with digits (**AT10K, AT20K** GCV towing) are dropped by the importer's `/^[A-Z]{4,6}$/` filter (pre-existing; unchanged by rebrand).
     - Production insurer `ClientCode` master + declined-RTO/MMV/blacklist masters are NOT in the workbook (only in test cases) — get authoritative decline masters + prod `ClientCode` list from GCI (already tracked in §10 #12).
   - **Internal follow-up (not GCI, not actioned here):** `prisma/seed.ts`'s `ICICI_LOMBARD` insurer row should likely be re-tagged `source="icici"` since it is not FG workbook data — out of scope for this masters-reimport work (touches `prisma/seed.ts`, not `scripts/`) and left as-is per the "never touch masters to pass a test" rule.
8. **Inspection (none for now).** Break-in out of scope for portal; no change beyond verifying LiveChek keys.

---

## 9. Credentials & codes appendix (UAT values found in kit)

> These are **UAT test values from the kit**, recorded here for wiring the UAT integration.
> They belong in env, never in committed code. Production values are all TBD from GCI.

| Item | UAT value | Source |
|---|---|---|
| Token host | `uat-internal-apim.generalicentralinsurance.com:9443/oauth2/token` | renewal auth / masters |
| API gateway | `uat-internal-apigw.generalicentralinsurance.com:8243` | all motor samples |
| Motor username / password | `Webagg` / `Webagg#2024` | masters integration doc |
| Motor Basic (consumer key:secret) | `hdt3qurkD4EK45cwUG64iEeKa7ka` : `hsd5cvAGSIqewQBq3MfBZPveQAMa` | masters (decoded Basic) |
| VendorCode / VendorUserId | `Webagg` (JSON) / `Webnew` (old SOAP) | motor samples |
| AgentCode / BranchCode / Zone | `60001464` / `10` / `A` | all samples |
| Renewal product | `GCMotorRenewalAPI`, `/Renewal/1.0.0` | JWT in renewal curls |
| Renewal UAT Basic | `aGR0M3F1cmtENEVLNDVjd1VHNjRpRWVLYTdrYTpoc2Q1Y3ZBR1NJcWV3UUJxM01mQlpQdmVRQU1h` (=`Webagg`/`Webagg#2024`) | Auth Token API.txt |
| Renewal PROD Basic | `aWdwUGpBZDdtQmJUZUYxVThPeFBmSlU4UlBvYTpVdzBKZjZncFlJc2lpalYxSkZ2VjBOVjJjdW9h` (=`WebAgg`/`WebAgg@123`) | renewal postman |
| CKYC token user / pass | `GCCKYC_Dev` / `GCKYC@dev26` | CKYC postman |
| CKYC consumer key : secret | `eyDiaNP80ohm6CVno6feAkGwRlwa` : `rl7ozsHZEZKzy4lDgq0XthHOXGEa` | CKYC postman |
| Payment UAT / PROD | `digiuat.…/Ecom_UAT/…/WebAggPayNew.aspx` / `digi.…/Ecom_NL/…/WebAggPayNew.aspx` | payment v1.41 |
| Payment recon (SOAP) | `pg.generalicentralinsurance.com/quick_pay/quickpay/comservice.asmx?op=FetchTRNDetails` | payment v1.41 |
| Payment DES key / IV | `&%#@?,:*` / `[18,50,80,125,140,170,205,230]` | payment v1.41 (unchanged) |
| LiveChek App-key / companyId | `TRTLjVqk6fVC7W9B64sSTX` / `5b6d23cd6494176414fda886` | inspection API doc |

---

## 10. Consolidated open confirmations for GCI (pre-go-live)

1. **Production hosts** for motor/CKYC/renewal API + token (kit is UAT-only; only prod token + prod payment given). Confirm `-internal-` gateway is externally reachable / whether our IPs need whitelisting.
2. **JSON `MotorAPI/1.0.0` auth** — does it reuse the current WSO2 credential set or a new consumerKey/secret? Is the `sess_map` cookie required?
3. **Production VendorCode / AgentCode / BranchCode / IMD** (UAT hardcodes `Webagg`/`60001464`/`10`).
4. **CV & Passenger JSON contract** — only PVT car has rebranded JSON samples; request CV/PCV JSON endpoints + samples.
5. **Error-response envelope** for motor JSON (no error sample in kit).
6. **FuelType format** — coded (`P`) vs full word (`PETROL`); DOB/date time component optional?
7. **CKYCRefNo** mandatory-but-blank when CKYCNo present? `system_name` canonical value? DOB format? `GCKYC` 3.0.0 vs 2.1.0 prod? IP-whitelist? `finalStatus` 1 vs 3?
8. **COI / policy-PDF delivery** — no document URL returned by issuance; how is the COI delivered?
9. **Payment** — `PaymentOption` mapping (v1.41 vs old xlsx), Node `Vendor` flag, `.NET` vs PHP response path, UAT recon URL, current test card expired.
10. **Renewal** — `Internal-Key` vs Bearer; token-per-request vs cache; prod URLs; IDV-variation rule.
11. **Break-in** confirmed out-of-scope for portal — confirm it stays out; source the missing `InspectionWebservice_Documentation.docx` if ever enabled.
12. **Decline masters** — authoritative declined-RTO / declined-MMV / blacklist / prod insurer `ClientCode` lists (only test-case samples in kit).

---

## Appendix — file inventory covered

Motor JSON (Get Quote / Create Proposal / Issue Proposal data dictionaries, sample logs, Postman, CURLs);
CKYC Process docs & latest API (API doc, portal guide, redirection HTML, postman, test scenarios, flowchart);
Web Aggregator Pay Integration v1.41 (PDF, PG params xlsx, test HTML, process flowchart);
Renewal With Modification Rebranding (auth token, 3 ops, modify docs, postman);
Inspection Service (LiveChek API doc, break-in dataflow, test cases — note missing webservice docx);
Motor field Master.xls (30 sheets), Motor Test Cases & Guidelines, TCS-BO Integration Document v1.2, Check List 3.

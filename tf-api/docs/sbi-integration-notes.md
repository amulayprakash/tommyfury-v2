# SBI General — Motor (PMCAR001) integration notes

Consolidated from the vendor kit at
`dock boyz/SBI - M4W updated/M4W/M4W/` — the `SBIG_PMCAR01_Motor_JSON_Integration_Kit_Client`
folder, the `PDF service 2.0` folder, and `UAT Credentials.txt`.

Status: **not yet implemented in `tf-api`.** This document plus the Postman
collection are the groundwork; no provider adapter exists under
`src/providers/sbi/` yet.

## Postman

- Collection: `docs/sbi-motor-uat.postman_collection.json`
- Environment: `docs/sbi-motor-uat.postman_environment.json`
- Published to the Postman workspace **SBI General – Motor**
  (`eeed2c57-81f1-4408-b1db-97c86bd8c833`), collection
  `16751049-d22ccb4a-c2cb-4da2-8a5b-d55b55d87a53`.

The collection covers the whole journey — token → quick quote → full quote →
issuance → policy PDF — and chains each step to the next through collection
variables, so it runs top-to-bottom in the Collection Runner.

## Product

| | |
| --- | --- |
| Product | Private Motor 3 & 4 wheeler |
| `ProductCode` | `PMCAR001` (`ProductId` 3514900341089, `TechProductCode` TECHVEHICLE) |
| Risk element | `R10005` |
| Model version | `PMCAR001_Policy_Model_V1.75` (13.07.2023) |
| Agreement code | `6660` UAT (`0006660` for the PDF 2.0 service) |

A two-wheeler product (`MTW001`) is referenced by the masters
(`SBI_T_Make_2W` / `Model_2W` / `Variant_2W`, and the `MTW001` rows in
`SBI_T_Voluntarydeductibles`) but the kit ships no 2W payload spec.

## Endpoints (UAT)

All on `https://devapi.sbigeneral.in`, all JSON/REST, all authenticated with a
Bearer token **plus** `X-IBM-Client-Id` and `X-IBM-Client-Secret` on every call.

| Step | Method | Path | `RequestHeader.action` |
| --- | --- | --- | --- |
| Token | GET | `/cld/v1/token` | — |
| Quick quote | POST | `/cld/v1/quickquote` | `quickQuote` |
| Full quote | POST | `/cld/v1/fullquote` | `fullQuote` |
| Issuance | POST | `/cld/v1/issurance` (sic) | `getIssurance` |
| Policy document | GET | `/customers/v1/policies/documents?policyNumber=…` | — |
| Policy PDF 2.0 | POST | `/ept/getPDFArgCd` | `getPDF` (inside the ciphertext) |

The token response is `{ "access_token": "…", "expire_in": 7200 }`.

Every business request is wrapped in the same envelope:

```json
{
  "RequestHeader": {
    "requestID": "123456",
    "action": "quickQuote",
    "channel": "SBIG",
    "transactionTimestamp": "01-Feb-2018-01:02:02"
  },
  "RequestBody": { }
}
```

`transactionTimestamp` is `dd-MMM-yyyy-HH:mm:ss`, which is **not** the format used
by any date field inside `RequestBody` (those are ISO `yyyy-MM-ddTHH:mm:ss`).

## Flow

1. **Quick quote** — pricing probe, persists nothing. Omit `IDV_User` and SBI
   returns `IDV_Suggested`, `MinIDV_Suggested`, `MaxIDV_Suggested` alongside the
   premium breakdown. That is the natural way to populate the IDV slider.
2. **Full quote** — the same payload plus `IDV_User`. Sending it *without*
   `QuotationNo` creates the quote and returns one (`ProposalStatus` `10`);
   sending it *with* `QuotationNo` re-prices that quote in place.
3. **Issuance** — takes `QuotationNo` plus a collection/receipt record and
   returns `PolicyNo`, `ProposalNo`, `ProposalStatus` `3`, `AutoUwResultCode`.
4. **Document** — either the plain endpoint (`[filename, base64Pdf]`) or the
   encrypted PDF 2.0 service.

Quick quote and full quote take an identical `RequestBody`; only the `action`
differs. There is no separate proposal call — the full quote *is* the proposal.

## Covers and benefits

Cover codes are `C1010xx`, benefit codes `B000xx`. The statutory minimum for a
Package policy:

| Cover | Code | Benefits |
| --- | --- | --- |
| Own Damage | `C101064` | `B00002` OD Basic (`Price` = ex-showroom) |
| Legal Liability to Third Party | `C101065` | `B00008` TP bodily injury (SI 9999999), `B00009` TP property damage (SI 750000) |
| PA Cover | `C101066` | `B00015` PA owner-driver (SI 1500000, nominee mandatory) |

Optional covers, with the age limits from the kit's `UW-BUSI RULES` sheet:

| Cover | Code | Limit |
| --- | --- | --- |
| Return to Invoice | `C101067` | vehicle age >= 3 rejected |
| Basic Road Side Assistance | `C101069` (+ `B00025`/`B00026`) | vehicle age >= 8 rejected |
| Enhanced PA | `C101070` | needs matching benefits in `C101066` |
| Hospital Cash | `C101071` | paid-driver benefit needs `B00013` on the LLTP cover |
| Depreciation Reimbursement (zero-dep) | `C101072` | vehicle age >= 5 rejected |
| Key Replacement | `C101073` | — |
| Inconvenience Allowance | `C101074` | SI must be 1000 / 2000 / 3000 |
| Loss of Personal Belongings | `C101075` | — |
| Engine Guard | `C101108` | vehicle age >= 5 rejected |
| EMI Protector | `C101109` | — |
| Tyre & Rim Guard | `C101110` | vehicle age >= 5 rejected |
| Cover for consumables | `C101111` | — |

Policy type drives the cover periods, and liability-only types need the OD
covers **removed from the JSON**, not zeroed:

| `PolicyType` | Name | OD | TP | PA |
| --- | --- | --- | --- | --- |
| 1 | Package | 1yr | 1yr | 1yr |
| 2–5 | Liability Only (plain / +Fire / +Theft / +both) | — | 1yr | 1yr |
| 6 | Bundled Product | 1yr | 3yr | 1 or 3yr |
| 7 | Long Term Package | 3yr | 3yr | 1 or 3yr |
| 8 | Long Term-Liability Only | — | 3yr | 1 or 3yr |
| 9 | Stand-alone OD | 1 or 3yr | — | — |

## Masters

`Master_datatables/` ships 58 `SBI_T_*` workbooks. Each has three sheets; the
data is in the **last** one. The big ones:

| Table | Rows | Key columns |
| --- | --- | --- |
| `SBI_T_Make_4W` | 69 | `Make_ID`, `Make_Name`, `TAC_Code` |
| `SBI_T_Model_4W` | — | `Make_ID`, `Model_ID`, `Model_Name`, `Vehicle_Segment` |
| `SBI_T_Variant_4W` | 4558 | `Variant_ID`, `Model_ID`, `CC`, `Fuel_Type`, `Seating`, `BodyStytle`, `Blacklisted`, `Status` |
| `SBI_T_RTO_Location` | 1187 | `RTO_Code`, `Location_ID`, `District_Code`, `RTO_Cluster`, `RTO_Region`, `RTO_Zone`, `State_ID` |
| `SBI_T_State` | — | `State_Code`, `State_ID`, `Branch_GST_Number` |
| `SBI_T_City` | 1176 | `City_Code`, `District_Code`, `State_Code` |

Two gotchas when building the code resolver:

- **`Blacklisted` is not a boolean.** 455 of the 4558 4W variants carry
  `Blacklisted: "Negative"` (the rest are `"Active"`), and 391 carry
  `Status: "NA"`. A negative-listed variant trips
  `PMCAR_DeclineVehicle_ValidateRule` — "Selected vehicle is blacklisted". Filter
  the cross-walk on `Blacklisted == "Active" && Status == "Active"`.
- **The RTO fields are one row split across seven request fields.** A single
  `SBI_T_RTO_Location` row supplies `RTOLocation` (= `RTO_Code`),
  `RTOLocationID` (= `Location_ID`), `RTOCityDistric` (= `District_Code`),
  `RTONameCode` (= `State_ID`), `RTOCluster`, `RTORegion` and `Zone`
  (= `RTO_Zone`). Sending an inconsistent set is the easiest way to get a
  silently wrong rate.

`SBI_T_BankBranch` and `SBI_T_Locality` ship empty — SBI still owes us that data.

## Payment / collection codes

Issuance carries a receipt record built from the BCP masters:

- `PayMode` (`SBI_T_BCP_PayMode`): `103` Cheque (the kit sample), `113`
  Internetbanking, `105`/`110` Credit Card, `212` EFT. For an online aggregator
  journey `113` is the realistic value; the kit only demonstrates `103`.
- `RemitBankAccount` (`SBI_T_BCP_RemitBankAccount`): `8` = HDFC Premium
  Collection A/C 7513, `2`/`17` = SBIG Receipt A/C 7089.
- `LocationType` (`SBI_T_BCP_LocationType`): `1` = local cheque, own bank/branch.
- `FeeType`: the kit uses `11`, but `SBI_T_FeeType.xlsx` ships **empty**, so the
  value is unverified.

`Amount` must equal the `DuePremium` from the latest full quote.

## PDF 2.0 encryption

`/ept/getPDFArgCd` takes and returns a single field, `{ "ciphertext": "…" }`:

- **AES-256-GCM**, no AAD.
- Key: the fixed UAT string `CQuYCxIVNyTOt487084UPBMxhS0XxRE4` (32 ASCII bytes).
- IV: the fixed UAT string `w6tmvKzUj6Rg` (12 ASCII bytes, 96-bit). It is *not*
  prefixed to the ciphertext.
- Wire format: `base64(ciphertext || 16-byte auth tag)`.

Confirmed by decrypting the vendor's own sample in
`PDF service/encrypted-get-pdf.txt` and re-encrypting it byte-for-byte. The
Postman collection carries a crypto-js implementation of GCM (Postman's bundled
crypto-js has CTR but no GCM), verified against that same sample.

Decrypted response: `{ StatusCode, TransactionID, Description, DocBase64 }`.

## Error handling

SBI returns business, validation and underwriting failures **inside an HTTP 200**.
Anything built on top of this must inspect the body, not the status code:

- `IsPremiumCalcSuccess` — `"Y"` on a successful rate.
- `AutoUwResultCode` on issuance — anything other than `1` is a UW referral, and
  a referral is *not* bound cover even though `PolicyNo` may be present.
- Validation codes are `SBIG-PA-Validation-Bxxxx`; UW codes are
  `SBIG-PA-UW-Uxxxx`. The full active list is in the `UW-BUSI RULES` sheet.

The ones most likely to bite an aggregator flow:

| Code | Meaning |
| --- | --- |
| `B1036` / `B1037` | `SBIGBranchStateCode` / `Customer.State` are mandatory |
| `B9255` | registration number `NEW` is rejected |
| `B9307` | registration number does not match the registration type (Bharat series) |
| `B9319` | chassis number format |
| `B9326` | proposal date more than 45 days from policy start |
| `B1064` | vehicle blacklisted |
| `B1095` / `B1096` | vehicle age < 6 months → only Standalone OD / Bundled / Long-term liability; >= 6 months → Bundled not allowed |
| `B2241` / `B2257` | nominee details mandatory for the PA cover |
| `U1011` | vehicle age > 12 years |
| `U1012` / `U1013` | `IDV_User` moved more than -10% / +20% off suggested |
| `U1014` | ex-showroom price is zero |
| `U1006`–`U1010` | SI above 50L / 75L / 90L / 1cr / 2cr bands |

## Field-name traps

SBI's schema misspells two fields. Sending the corrected spelling drops the
value silently:

- `AdditonalCompDeductible` (missing the second `i`)
- `RTOCityDistric` (missing the trailing `t`)

## Open confirmations for SBI

1. **UAT gateway is IP-allowlisted.** `devapi.sbigeneral.in` (103.17.18.75)
   drops TCP:443 from our egress IP **49.36.171.93** — 20s timeout — while
   `www.sbigeneral.in` connects instantly from the same host. Nothing in the
   flow has been exercised live. Ask SBI to allowlist both the dev egress IP
   **49.36.171.93** and the application server **103.127.167.212** (Shree, where
   `tf-api` runs — see [[server-deployment-topology]]), since the integration
   will call SBI from the server, not from a developer machine.
2. **`IssuingBranchCode`** — the kit only has the literal placeholder
   `"IssuingBranchCode"`. Need the real value for our agreement.
3. **`IntermediaryCode`** — the kit uses `"Others"`. Need our broker code.
4. **`ChannelType`** — the kit sample uses `3` (Bancassurance). For a broker
   agreement this is presumably `2`; confirm which SBI expects against agreement
   `6660`.
5. **`FeeType`** — `11` in the sample, master table empty. Confirm the value and
   the correct `PayMode` for an online payment gateway collection (`113`?).
6. **`SBI_T_BankBranch` and `SBI_T_Locality` are empty.** Needed if we ever have
   to send a real bank branch or locality code.
7. **Production hosts** — the kit only documents `devapi.sbigeneral.in`, and the
   AES key/IV are labelled "UAT fixed". Need the production host set and the
   production key/IV.
8. **Two-wheeler product** — `MTW001` is referenced by the masters but no payload
   spec ships. Request the 2W kit if we want SBI on the 2W journey.

# HDFC ERGO Motor Integration — Tommy & Furry / Novacred

Node.js (Express, MVC) backend + React (Vite) frontend integrating the HDFC ERGO
**Private Car** HEI service (PRODUCT_CODE `2311`) end to end, plus an
architecture ready for Two-Wheeler and Commercial once their product codes are
supplied.

Each request body is built to match the HDFC Postman collection **exactly** —
same keys, same order, same defaults — for every business case.

## Business cases (each sends its own exact body)

| Case            | vehicleType         | LOB / product code | Req block | Notes |
|-----------------|---------------------|--------------------|-----------|-------|
| Four wheeler    | `four_wheeler`      | pvtcar / **2311**  | Req_PvtCar | verified vs collection |
| EV car          | `ev`                | pvtcar / **2311**  | Req_PvtCar | + EV covers |
| New vehicle     | `new_vehicle`       | pvtcar / **2311**  | Req_PvtCar | fresh registration |
| Used vehicle    | `four_wheeler`+`usedVehicle` | pvtcar / **2311** | Req_PvtCar | Used Car template |
| Rollover        | `four_wheeler`      | pvtcar / **2311**  | Req_PvtCar | full previous-policy |
| Renewal         | any car             | pvtcar / **2311**  | Req_Renewal | `getpolicydataforrenewal` |
| Two wheeler     | `two_wheeler`       | twowheeler / *TBD* | Req_TW    | code pending — see below |
| Commercial GCV  | `commercial_gcv`    | commercial / *TBD* | Req_GCV   | goods; code pending |
| Commercial PCV  | `commercial_pcv`    | commercial / *TBD* | Req_PCV   | passenger; code pending |

**Private Car (four_wheeler / ev / new_vehicle / used / rollover)** is built
field-for-field to the collection and verified.

**Two-Wheeler and Commercial GCV/PCV** are wired end to end using HDFC's standard
HEI envelope with a product-specific `Req_TW` / `Req_GCV` / `Req_PCV` block
(`services/payloadBuilderMotor.js`). Those Req_* field sets are marked `// VERIFY`
and must be confirmed against HDFC's two-wheeler & commercial collections when you
receive them — the collection, auth, token cache, endpoints, controllers and
routes do NOT change.

## Product codes — datatable driven

Codes live in **`data/productMaster.js`** (mirrored by the `product_master` SQL
table). The Postman collection and all 7 endpoints stay identical per product;
only the `PRODUCT_CODE` header changes, resolved per LOB (and per commercial
sub-type). Today:

```
pvtcar     -> 2311   (LIVE, from the collection)
twowheeler -> ''     (fill when HDFC gives the code)
commercial -> gcv '' / pcv ''   (fill when HDFC gives the code(s))
```

To enable two-wheeler / commercial, set the code in `data/productMaster.js` OR
via `.env` (`HDFC_PRODUCT_TWOWHEELER`, `HDFC_PRODUCT_GCV`, `HDFC_PRODUCT_PCV`,
or a single shared `HDFC_PRODUCT_COMMERCIAL`). Until a code is present the API
returns a clear "not yet enabled" error and the frontend shows that type as
disabled — it never calls HDFC with an empty product code. Commercial supports
either one shared code for both GCV & PCV, or separate codes per sub-type.

## Flow (per collection)

```
01 Authenticate  → GET  authenticate            (TOKEN cached per LOB; TRANSACTIONID always set)
02 GetCalculateIDV → POST getcalculateidv
03 CalculatePremium → POST calculatepremium
04 CreateProposal → POST createproposal
05 GetProposalDocument → POST getproposaldocument
06 SubmitPaymentDetails → POST submitpaymentdetails
07 GetPolicyDocument → POST getpolicydocument
(Renewal) RenewalExtract → POST getpolicydataforrenewal
```

## API endpoints (backend, default `http://localhost:4000`)

Master/lookups: `GET /api/master/vehicle-types|models|rtos|addons`

Discrete steps: `POST /api/hdfc/{authenticate|idv|premium|proposal|proposal-document|payment|policy-document|renewal-extract}`

Orchestrated:
- `POST /api/hdfc/quote` — IDV + Premium
- `POST /api/hdfc/issue` — Proposal → Doc → Payment → Policy
- `POST /api/hdfc/renewal-quote` — Extract → IDV → Premium
- `POST /api/hdfc/renewal-issue` — Proposal → Doc → Payment → Policy

## Sample request body (frontend → backend)

```json
{
  "vehicleType": "ev",
  "businessType": "New Vehicle",
  "vehicle": { "modelCode": "42774", "rtoCode": "10406", "registrationNo": "New",
               "manufactureYear": "2024", "fuelType": "ELECTRIC", "idv": 949411 },
  "policy": { "startDate": "2024-03-19", "proposalDate": "2024-03-18",
              "tenure": 1, "policyType": "OD Plus TP" },
  "addons": { "zeroDep": 1, "tyreSecure": 1, "ncbProtection": 1, "rti": 1,
              "consumables": 1, "roadsideAssistance": 1,
              "payAsYouDrive": true, "kmsYouExpectToDrive": 5000 },
  "ev": { "motorCover": 1, "zeroDepBattery": 1, "batteryChargerCover": 1 },
  "customer": { "firstName": "MAHENDRA", "lastName": "GHANCHI", "mobile": "7387005111",
                "panNo": "BXGPG2512P", "dob": "1996-07-22", "permPinCode": "307801" },
  "payment": { "amount": "43150.00" }
}
```

The backend converts this into the collection-exact HDFC JSON (dates → DD/MM/YYYY,
covers → 0/1, EV flags, business-type-specific field set).

## Run

Backend:
```bash
cd backend
cp .env.example .env      # fill HDFC_CREDENTIAL
npm install
npm run dev               # http://localhost:4000
```

Frontend:
```bash
cd frontend
npm install
npm run dev               # http://localhost:5173 (proxies /api → 4000)
```

MySQL: `mysql < backend/data/schema.sql` (schema `tf_api_dev`). Swap the
`data/uatSeed.js` lookups for queries against `model_master` / `rto_master` /
`pincode_master` in production.

## Enabling Two-Wheeler / Commercial

1. Get the HDFC product code(s) for two-wheeler and/or commercial (GCV, PCV).
2. Put them in `backend/data/productMaster.js` (or the matching env vars).
3. That's it — the frontend enables those tiles, and quotes route with the
   right `PRODUCT_CODE`. When you also receive their Postman collections, adjust
   the `// VERIFY` fields in `services/payloadBuilderMotor.js` to match exactly,
   the same way Private Car was matched.

## Recurring pitfalls handled

- `TRANSACTIONID` is always generated and set on the Authenticate header.
- Single `app.listen` guarded by `require.main === module` (no duplicate startup).
- Token cached per LOB with TTL and proactive refresh before data calls.
- Premium read from `response.Resp_PvtCar.Total_Premium` (and OD/TP/net/tax).

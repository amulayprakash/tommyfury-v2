# Integrating into your existing frontend

Your app already exists (React, hash routes like `/#/vehicle_second`) and shows
multiple insurer cards (Digit, Bajaj, Zuno, Shriram, HDFC). This backend gives
you the HDFC pieces to fill the HDFC card and to run KYC. Nothing here replaces
your app — you call these endpoints the same way you already call your other
insurers.

Backend base URL (adjust to where you host it): `http://localhost:4000/api`

--------------------------------------------------------------------------------
## A. Motor quote — fill the HDFC card on `vehicle_second`

Where your code fills each insurer card, add an HDFC call. Private Car
(four-wheeler / EV / new / used / rollover) is verified and ready. Commercial
(GCV/PCV) works once its product code is set. **Two-wheeler stays "N/A" unless
you have an HDFC two-wheeler product code** — you told us there's no two-wheeler
collection, so leave the HDFC card as N/A for bikes.

```js
// existing pattern: you loop insurers and set each card's price.
// add HDFC like this (four wheeler / car shown):
async function fetchHdfcQuote(vehicleFromRto, tab /* 'tp' | 'od' | 'comprehensive' */) {
  const policyType = tab === 'tp' ? 'TP Only'
                   : tab === 'od' ? 'OD Only'
                   : 'Comprehensive';

  const res = await fetch('http://localhost:4000/api/hdfc/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicleType: 'four_wheeler',          // 'ev' | 'new_vehicle' | 'commercial_gcv' | 'commercial_pcv'
      vehicle: {
        modelCode: vehicleFromRto.modelCode, // from your RTO fetch (EditVehicleNo)
        rtoCode:   vehicleFromRto.rtoCode,
        registrationNo: vehicleFromRto.regNo,
        manufactureYear: vehicleFromRto.regYear,
        fuelType: vehicleFromRto.fuel,
      },
      policy: { startDate: new Date().toISOString().slice(0,10), tenure: 1, policyType },
      previousPolicy: {                       // from your "previous policy details" screen
        endDate: vehicleFromRto.prevPolicyExpiry,
        ncbPercentage: 0,
        claim: 'No',
      },
      addons: { zeroDep: 1 },                 // whatever the user ticked
    }),
  });
  const data = await res.json();
  // data.premium.totalPremium -> put on the HDFC card
  // data.transactionId        -> keep; you pass it to /issue later
  return data;
}
```

`data.premium` has `{ totalPremium, netPremium, tax, odPremium, tpPremium, idv }`.
If the backend returns `success:false` with `"not yet enabled"`, that product's
code isn't configured — show N/A for that card.

--------------------------------------------------------------------------------
## B. KYC (Pehchaan) — the form before issuance

The KYC service is SEPARATE (own base URL, own token — you don't manage the
token, the backend does). The correct order is: **fetch → (if not found) open
Pehchaan journey → poll status → when approved, issue**.

### B1. Try to fetch an existing KYC (PAN + DOB preferred)

```js
async function fetchKyc({ pan, dob, mobile, name }) {
  const res = await fetch('http://localhost:4000/api/kyc/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pan, dob,                 // dob format DD/MM/YYYY
      mobile, name,
      redirect_url: 'https://insurance.tommyandfurry.com/tommyandfurry/#/kyc-return',
    }),
  });
  return res.json();
}
```

Response is one of:

- **Verified** → `{ verified: true, proposer: { pehchaanId, name, dob, panNo,
  permAddress1, permCityDistrict, permPinCode, ... } }`. Use `proposer` to
  prefill your issuance form; keep `pehchaanId`.
- **Not found** → `{ verified: false, redirect: { link, txnId } }`. Open
  `redirect.link` (new tab or same tab). The user completes KYC on Pehchaan and
  is sent back to your `redirect_url` with `success`, `kycId`, `status` query
  params. Keep `txnId` too.

### B2. After the user returns, poll status

On your `/kyc-return` route, read `kycId` (or use the `txnId` you saved):

```js
// by kycId (from the redirect query string)
const s = await fetch(`http://localhost:4000/api/kyc/status/${kycId}`).then(r => r.json());
// or by txnId
const s = await fetch(`http://localhost:4000/api/kyc/status-by-txn/${txnId}`).then(r => r.json());

if (s.verified) {
  // KYC approved -> safe to issue the policy
} else {
  // still 'pending for verification' or 'rejected' -> do NOT issue
}
```

Corporate customers: same shape, POST `/api/kyc/corporate` with
`{ ent_pan, doi, ent_type, txn_id, redirect_url }`.

--------------------------------------------------------------------------------
## C. Issue — only after KYC is verified

Feed the Pehchaan id into the proposal. Reuse the `transactionId` from the quote.

```js
await fetch('http://localhost:4000/api/hdfc/issue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ...quotePayload,                 // same body you sent to /quote
    transactionId: quote.transactionId,
    vehicle: { ...quotePayload.vehicle, idv: quote.premium.idv },
    customer: {
      // prefer values from the verified KYC proposer:
      firstName, lastName, mobile, email,
      panNo: proposer.panNo,
      dob: proposer.dob,
      permAddress1: proposer.permAddress1,
      permCityDistrict: proposer.permCityDistrict,
      permPinCode: proposer.permPinCode,
      pehchaanId: proposer.pehchaanId,   // <-- goes into Customer_Pehchaan_id
    },
    payment: { amount: String(quote.premium.totalPremium) },
  }),
});
// returns { proposalNumber, policyNumber, policyDocument, trail }
```

**Rule from HDFC:** never issue when `iskycVerified !== 1`. The backend maps
`pehchaanId` into the proposal's `Customer_Pehchaan_id` automatically.

--------------------------------------------------------------------------------
## Endpoint summary

Motor: `POST /api/hdfc/quote`, `POST /api/hdfc/issue` (+ discrete steps under
`/api/hdfc/*`, and `/api/hdfc/renewal-quote|renewal-issue`).

KYC (separate): `GET /api/kyc/token`, `POST /api/kyc/fetch`,
`POST /api/kyc/corporate`, `GET /api/kyc/status/:kycId`,
`GET /api/kyc/status-by-txn/:txnId`.

Config: set `HDFC_KYC_API_KEY` (from the KYC kit email) in `.env`. The motor
`.env` keys are unchanged.

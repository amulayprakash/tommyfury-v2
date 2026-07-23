# ICICI Lombard — CKYC blocked on UAT (partner integration)

**To:** ICICI Lombard API / integration support
**From:** Tommy & Furry (Nova Cred Insurance) — motor aggregator integration
**Environment:** UAT — `https://ilesbapigee.insurancearticlez.com`
**Status:** Blocker — no proposal can reach `PolicyNo`; every row stops at CKYC.

> Before sending: fill in the actual identity values and a fresh `CorelationId` from a
> recent run (masked here deliberately). ICICI needs those to trace the call on their side.

---

## 1. Summary

Every CKYC lookup on UAT fails with `StatusCode 451`, which then blocks the proposal with
`ErrorCode 443 "KYC PENDING"`. This includes **ICICI's own documented sample Aadhaar**, which
is why we believe this is a UAT data/provisioning issue rather than a request-format issue on
our side.

We are **not** reporting an OVD problem — a separate defect on our own client was found and is
being fixed independently. This report is limited to the CKYC registry lookup.

---

## 2. Exact call being made

```
POST https://ilesbapigee.insurancearticlez.com/generic/common/ckyc/generic/ckyc
Authorization: Bearer <JWT from /auth-api/access/token>
Content-Type: application/json
```

Token is obtained from:

```
POST https://ilesbapigee.insurancearticlez.com/auth-api/access/token
{ "Login": "<partner login>", "Password": "<pre-encrypted password supplied by ICICI>", "LoginType": "App" }
```

The token issues successfully and is accepted by the premium and proposal endpoints on the
same session, so authentication is not in question for 2W/4W.

### Request body — PAN variant

```json
{
  "TransactionId": "epn_6hj43wjvSWw1VQwslU",
  "DateOfBirth": "08-Nov-1992",
  "PanNumber": "<PAN>",
  "CkycNumber": null,
  "AadhaarNumber": null,
  "NameAsPerAadhaar": null,
  "Gender": null,
  "PolicyType": 1
}
```

### Request body — Aadhaar variant

```json
{
  "TransactionId": "epn_...",
  "DateOfBirth": "1990-05-15 → sent as 15-May-1990",
  "PanNumber": null,
  "CkycNumber": null,
  "AadhaarNumber": "987654398765",
  "NameAsPerAadhaar": "<name>",
  "Gender": "M",
  "PolicyType": 1
}
```

`DateOfBirth` is sent as `dd-MMM-yyyy` and `PolicyType: 1` (motor) per the partner spec.
Please confirm both are correct if the format is a factor.

---

## 3. Response received (verbatim, unmodified)

HTTP status is **200**; the failure is carried in the body as `Success: false`.

```json
{
  "Name": null,
  "DOB": null,
  "EmailId": null,
  "PhoneNo": null,
  "Gender": null,
  "PermanentAddress": null,
  "CorrespondenceAddress": null,
  "RequestId": null,
  "ErrorId": 0,
  "Success": false,
  "isKycSuccess": false,
  "StatusCode": 451,
  "TechnicalError": null,
  "DisplayMessage": "Failed: - Request failed, please retry with alternate KYC options.",
  "CorelationId": "22ba5579-07d5-4e0c-b9cc-52896158d11b",
  "KycID": null,
  "OVDLink": "https://bancaassure.insurancearticlez.com/bancakrgapp/KycDocUpload/#/?id=..."
}
```

Two distinct `DisplayMessage` values have been observed, both with `StatusCode 451`:

| # | `DisplayMessage` (verbatim) |
|---|---|
| 1 | `Failed: - Request failed, please retry with alternate KYC options.` |
| 2 | `Failed:No record found, please retry with alternate KYC options.` |

### Downstream effect on the proposal

With CKYC unresolved, the proposal is rejected — which is correct behaviour, but it means no
row can be certified end-to-end:

```json
{
  "PolicyReferenceId": "epn_6hkVf1nllRs7wsacY",
  "Status": null, "PolicyNo": null,
  "StartDate": "2026-07-12T00:00:00", "EndDate": "2027-07-12T00:00:00",
  "CertificateUrl": null, "PaymentLink": null, "InspectionId": null,
  "isKycSuccess": false, "ProposalAmount": 5632,
  "Success": false, "ErrorMessage": "KYC PENDING", "ErrorCode": "443",
  "CorelationId": null
}
```

---

## 4. Why we believe this is a UAT data issue, not a request-format issue

1. **ICICI's own sample Aadhaar `987654398765` — taken directly from the `KYC_Generic.pdf`
   supplied to us — returns the same `451`.** A documented example failing against the
   documented endpoint points at the environment, not the caller.
2. Multiple independently fabricated PANs return `451` as well, with the same shape.
3. `StatusCode 451` with `ErrorId 0` and `TechnicalError: null` reads as a clean *registry
   miss*, not a validation rejection. A malformed request would be expected to surface a
   validation error or non-zero `ErrorId`.
4. The same JWT, in the same session, is accepted by the premium and proposal endpoints —
   so this is not an auth/subscription scope problem for 2W/4W.
5. Reproduced across **20 consecutive scenarios** (7 two-wheeler + 7 private car + repeats)
   on 2026-07-09, and again via a direct single-transaction probe on 2026-07-14. Every
   one returned `451`. `CorelationId` values are available for all of them on request.

---

## 5. What we are asking ICICI for

1. **Does UAT provide pre-seeded / dummy PAN or Aadhaar identities for partner certification?**
   If so, please share them. This is the primary unblock — it lets us demonstrate a full
   quote → CKYC → proposal → `PolicyNo` chain without using a real person's identity.
2. **If UAT queries the live CKYC/Aadhaar registry**, please confirm that explicitly, so we
   can plan certification around a consenting real identity with the appropriate consent
   and data-handling controls in place.
3. **Please confirm the semantics of `StatusCode 451`** and whether it is distinguishable
   from other CKYC failure modes. Right now `451` is returned for both observed messages,
   so we cannot tell "no record exists" apart from "lookup service unavailable" — which
   matters for whether our UI should offer a retry or push the customer to OVD.
4. **Is `PolicyType: 1` correct for motor**, and is `dd-MMM-yyyy` the expected
   `DateOfBirth` format? Confirming these rules them out as contributing factors.
5. **`OVDLink` in the failure body** — please confirm this hosted page is the intended
   production fallback when auto-KYC misses, and whether a KYC completed there
   propagates back to the same `TransactionId` automatically or requires a callback.

---

## 6. Reference

- Transaction IDs from the 2026-07-09 run and their `CorelationId` values are available on
  request — a sample: `epn_6hj43wjvSWw1VQwslU` (2W), `epn_6hj26DoTFchBqquxPo` (4W).
- Separately tracked and **not** part of this escalation: commercial-vehicle proposals return
  `401 Invalid Authorization Credentials` before reaching CKYC, which may indicate the CV
  product is not subscribed on our UAT credentials. Happy to raise that as its own ticket.

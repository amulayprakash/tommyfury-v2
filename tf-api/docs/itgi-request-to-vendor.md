# Email draft — what we need from IFFCO-Tokio

Copy-paste ready. Fill the **[square brackets]** before sending.
Order matters: items 1–3 block everything else.

---

**Subject:** Motor API integration — access and details needed to start UAT testing

Hi [Name],

We have completed our side of the development for the Motor integration (private car and
two-wheeler) using the Partner Integration Kit v4.0 and the CKYC Kit v1.4.1. We are using the
"Partner PG" option, where we collect the payment at our end.

To start testing on your UAT/staging system, we need a few things from your side. I have put the
blocking ones first.

## 1. Please whitelist our IP address (most urgent)

Right now we cannot reach your staging server at all. Our connection requests to
`staging.iffcotokio.co.in` (IP 220.227.8.74) get no response and simply time out. From the same
computer, your public website `www.iffcotokio.co.in` opens normally in under a second, so the
problem is not on our internet connection — it looks like our IP is not yet allowed through your
firewall.

Please whitelist these IP addresses:

- **[our office/dev public IP]** — for development and testing
- **[our server IP, e.g. 103.127.167.212]** — for the application server

Please confirm once this is done, and let us know if you need anything else from us for it.

## 2. Please share our partner details

We need our own codes to send in every request:

- Partner Code
- Partner Branch
- Partner Sub Branch

Please confirm whether these are the same for private car (PCP) and two-wheeler (TWP), or
different for each.

For your records, the details you asked for in the kit (Annexure II) are:

- Public IP of our server: **[same as above]**
- Request URL: **[our base URL]**
- Response URL: **[our response URL]**
- Company name, address, phone, email and logo for the policy document: **[attach / fill]**

## 3. Please confirm how the CKYC API is secured

The CKYC documents (fetch, create, validate OTP) do not mention any username, password, API key
or token in the request. We assume access is controlled only by IP whitelisting. Please confirm
this is correct — and if there is some login or key we should be sending, please share it.

## 4. Please share the RTO master file

The kit's master data folder has the vehicle (MAKE) list, financier list, previous insurer list
and coverage sheets — but the RTO sheet inside `ITGI_Motor Data_Updated_01032024.xlsx` only says
"Shared in another Excel", and we could not find that file anywhere in the kit.

We need the RTO master (RTO code, city, state) because `rtoCity` is mandatory in the IDV, premium
and proposal requests and must match your master.

**One quick question that may save us both time:** we noticed your own sample requests use
different formats — one sends `regictrationCity` as `DELHI` (a plain city name) and another uses
`CHHDHAMT`. Can we simply send the city name or the standard RTO code (like DL01)? If yes, we may
not need the master file at all.

## 5. Please share the login for the policy download API

The policy download API (`/partner-services/policy/download`) uses basic authentication. Please
share the username and password for UAT.

## 6. Please share working test data for UAT

To test end to end, please give us a few combinations that will definitely go through on your UAT:

- A vehicle make/model code plus RTO that returns a premium successfully (one for private car,
  one for two-wheeler)
- A test PAN or Aadhaar that returns a proper CKYC record on your UAT (with the matching mobile
  number, since the CKYC search requires the mobile to match)

This is usually where integrations lose the most time, so having your known-good samples upfront
would help a lot.

## 7. A few smaller clarifications

- **Payment update:** in `updatePaymentDetails`, what values should we send in
  `authorizationCode`, `authorizationStatus` and `authorizationDecision`? These come from our own
  payment gateway, so we want to be sure of the format you expect.
- **Error codes:** is there a list of the error messages/codes your services return? It will help
  us show the right message to the customer instead of a generic error.
- **Break-in cases:** the document says that after inspection, approval is sent to us by email. Is
  there any API or callback we can use instead, so the policy can be issued automatically at our
  end without manual tracking?
- **Missing WSDLs:** we have WSDL files for IDV, Premium and Proposal, but not for
  `PaymentUpdateWS`, `CheckPolicyStatus` or `PartnerDownloadPolicyCopy`. We have built these from
  your sample requests, but please share the WSDLs if available.

## 8. One thing to flag

The sample file `Two Wheeler_EngineTyreRimTWP_curl.xml` in the kit you shared contains a live
partner code and branch belonging to another partner (PhonePe). We have not used it and have not
sent any request with it. You may want to remove it from the kit before sharing it further.

---

Once items 1 and 2 are done, we can start testing immediately and will share our results with you.

Thanks and regards,
[Your name]
[Designation / Company]
[Phone / Email]

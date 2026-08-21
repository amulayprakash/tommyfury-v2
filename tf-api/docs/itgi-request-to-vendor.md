# Email to IFFCO-Tokio — remaining items

Written 21/08/2026, after the Novacred UAT credentials were verified live. Fill the **[brackets]** and send.
(The earlier, pre-credentials version is in git history.)

---

**Subject:** Motor UAT — credentials working, 4 items pending

Hi [Name],

Thank you for the UAT credentials. We have tested them and they work — IDV and premium return live
quotes for both private car and two-wheeler using partner code ITGIMOT321, and the KYC, master-data
and policy-download services accept the Basic auth credentials.

Four items are pending to complete UAT:

**1. RTO master**
`rtoCity` is mandatory in IDV, premium and proposal, and must match your master data. The RTO sheet is
missing from the kit (`ITGI_Motor Data_Updated_01032024.xlsx` says "Shared in another Excel"). Please
send either:
- the RTO / city master sheet, or
- the request format for `partner-services/master/data` — it accepts our credentials, but every payload
  we try returns "Your request can not be processed due to technical fault".

Also, is the plain city name (DELHI) acceptable, or must we send your code (e.g. CHHDHAMT)?

**2. Approval + test data for proposal and payment**
We have not called `PartnerProposalRequest`, `PaymentUpdateWS` or `CheckPolicyStatus` yet, as they create
real records at your end. Please confirm we may run them on UAT, and share:
- one private-car and one two-wheeler make/model + RTO combination that goes through end-to-end
- a test PAN/Aadhaar with mobile number that returns a valid CKYC record

**3. Payment update fields**
For `updatePaymentDetails`, what values should `authorizationCode`, `authorizationStatus` and
`authorizationDecision` carry from our payment gateway? A list of your error codes would also help.

**4. `portaltest/MotorServiceReq`**
This URL returns the "ITGI Partner Web Portal" web page, not a web service. Please confirm what it is
used for — is it the browser redirect for the Partner PG flow?

Not blocking, but useful when convenient: WSDLs for `PaymentUpdateWS`, `CheckPolicyStatus` and
`PartnerDownloadPolicyCopy` (the kit has samples only), and the production URLs closer to go-live.

One more thing for your attention: the kit file `Two Wheeler_EngineTyreRimTWP_curl.xml` contains another
partner's live partner code and branch (ITGIMOT216 / PHONEPE_INSURANCE). We have not used it — you may
want to remove it before sharing the kit further.

Thanks and regards,
[Your name]
[Company] | [Phone] | [Email]

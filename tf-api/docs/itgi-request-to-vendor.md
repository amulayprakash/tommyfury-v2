# Email to IFFCO-Tokio — short version

Fill the **[brackets]** and send. (A longer, more detailed version of this mail is in git history,
commit `5f7f6fe`, if they ask for specifics.)

---

**Subject:** Motor API integration — pending items to start UAT

Hi [Name],

Our development for the Motor integration (private car and two-wheeler, Partner PG option) is
complete. To start UAT testing, we need the following from your side:

**1. Whitelist our IP addresses**
Our requests to `staging.iffcotokio.co.in` currently time out with no response, while your public
website opens normally from the same machine — so it appears our IP is not whitelisted yet.
Please allow:
- [dev/office public IP]
- [server IP]

**2. Partner details**
- Partner Code
- Partner Branch
- Partner Sub Branch
(Please confirm if these differ for PCP and TWP.)

**3. CKYC API access**
The CKYC documents show no API key, token or password. Please confirm access is by IP whitelisting
only — or share the credentials if not.

**4. RTO master file**
The RTO sheet in `ITGI_Motor Data_Updated_01032024.xlsx` says "Shared in another Excel", which was
not in the kit. We need it as `rtoCity` is mandatory in the IDV, premium and proposal requests.
*Quick question:* can we simply send the city name (e.g. DELHI) or the standard RTO code (e.g.
DL01) instead? Your samples use both `DELHI` and `CHHDHAMT`, so if the plain city name is accepted
we may not need the file at all.

**5. Policy download credentials**
Username and password for the basic-auth on `/partner-services/policy/download`.

**6. UAT test data**
- A make/model + RTO combination that returns a premium successfully (one PCP, one TWP)
- A test PAN/Aadhaar with matching mobile number that returns a valid CKYC record on UAT

**7. Clarifications**
- `updatePaymentDetails` — expected values/format for `authorizationCode`, `authorizationStatus`
  and `authorizationDecision`
- List of error codes/messages returned by your services
- Break-in cases — is there an API or callback for inspection approval, or is it only by email?
- WSDLs for `PaymentUpdateWS`, `CheckPolicyStatus` and `PartnerDownloadPolicyCopy` (not in the kit)

**Also for your information:** the sample file `Two Wheeler_EngineTyreRimTWP_curl.xml` in the kit
contains another partner's live partner code and branch. We have not used it. You may want to
remove it before sharing the kit further.

Items 1 and 2 are blocking — we can begin testing as soon as those are done.

Thanks and regards,
[Your name]
[Company] | [Phone] | [Email]

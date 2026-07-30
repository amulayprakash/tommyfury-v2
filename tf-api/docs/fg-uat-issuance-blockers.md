# FG UAT — Motor policy-issuance blockers (Web Aggregator)

> ## ✅ RESOLVED (2026-07-29) — Defect 1 root-caused to OUR test data; GCI was right
>
> The "User-Defined Exception from Reinsurance" on FPV/FVO was **not** a missing
> FG treaty configuration. Our rollover tests reused a real RC whose previous
> policy expires 2027-06-11, so the proposal asked for a policy starting ~11
> months ahead — beyond FG's **45-day advance-inception cap** and outside the
> reinsurance treaty period. Proven live (same vehicle, same minute): start
> **+7 days → ISSUED** `132/02/11/0827/MTP/2410003304`; start +10 months →
> reinsurance exception. We now enforce the 45-day cap with a clear message
> (commit 5ec1267). Full matrix with realistic dates issues end-to-end:
> F13 new (`…3305`), FPV rollover ×4 incl. NCB 20/50 and add-ons
> (`…3306`–`…3309`), FVO standalone-OD (`…3310`, product MOD).
> **We withdraw Defect 1 — apologies for the noise, and thanks to the GCI team.**
> Remaining relevant asks: the current UAT **decline list** (it changed around
> 26–28 Jul: Bolt, Baleno, Ciaz now decline), TP channel intent, F33 eligibility,
> UAT guard behaviour, and production credentials.

> **STATUS UPDATE (2026-07-26) — GCI responses received.**
>
> | Item | GCI's answer | Our status |
> |---|---|---|
> | Defect 1 — FPV/FVO reinsurance | "The team is working on it now. We'll let you know when it's fixed." Confirmed only rollover affected; "We do not have any reinsurance configuration set up." | ⏳ **Waiting on GCI fix.** Nothing needed our side; rollover binds as soon as they configure it. |
> | Defect 2 — TP-only declined | **Deliberate**: "Standalone Third-Party policies are blocked… as per UW guidelines" (same agent code works for everything else). | ✅ Closed as by-design. We removed `thirdParty` from FG's four-wheeler capability, so FG is no longer offered on TP compares (ICICI still quotes TP). Reversible if GCI enables the channel. |
> | Q1 — 3-yr TP for new cars | Only **bundled** products exist for new cars: **F13** (1yr OD + 3yr TP) and **F33** (3yr OD + 3yr TP; POS: P13/P33). No standalone long-term TP. | ✅ Confirms our block of new-car TP-only. F33 noted as an optional future product (needs a tenure selector). |
> | Q2 — NCB field semantics | **Not answered.** | ❓ Still open — re-ask. |
> | Q3 — UAT skips blacklist/duplicate/>15yr checks | **Not answered.** | ❓ Still open — re-ask. |
>
> **Remaining asks for GCI** (see "Open follow-ups" at the bottom): reinsurance ETA, NCB semantics, UAT-vs-prod guard behaviour, TP channel intent, and whether Webagg may sell F33.

> **SECOND UPDATE (2026-07-28) — GCI's follow-up reply, and our re-verification.**
>
> | GCI's claim | Our finding |
> |---|---|
> | "The proposal creation issue has already been resolved… no pending reinsurance-related blocker from our side." | ❌ **Not what UAT shows.** Re-tested the same day: rollover Comprehensive (City, Verna, i20, Fortuner) and Standalone-OD (Ciaz) ALL still fail CreateProposal with the identical `User-Defined Exception from Reinsurance`, while a new-business F13 control ISSUED in the same minutes (`132/14/11/0729/MTP/2410003303`). Please re-check the fix actually reached UAT, or run one FPV CreateProposal yourselves and share the result. |
> | NCB: RollOverList takes the PREVIOUS year's NCB; `AdditionalBenefit.NCB` takes the NEW NCB. | ✅ **Implemented** (commit ca53078): `NCBInExpiringPolicy` = expiring NCB, `AdditionalBenefit.NCB` = next IRDAI slab (0→20→25→35→45→50), 0 on claim or new business. Live-verified pricing gradient. Closed. |
> | F33 (3OD+3TP) is available; details in the earlier table. | ✅ Noted — will be wired once a tenure selector exists in the product UI. Closed for now. |
>
> Also observed 2026-07-28: FG's UAT decline list changed again — Tata Bolt (previously our reliable issuer) now returns "Declined Vehicle" at quote; Baleno/Ciaz new-business now "Vehicle Is Decline" at proposal. Please share the current UAT decline list so certification vehicles can be chosen deterministically.

**To:** FG / TCS Motor API support
**From:** Tommy & Furry (Web Aggregator integration)
**Environment:** UAT — gateway `uat-internal-apigw.generalicentralinsurance.com:8243`, token host `uat-internal-apim.generalicentralinsurance.com:9443`
**Credentials in use:** VendorCode `Webagg`, AgentCode `60001464`, BranchCode `10` (all match the kit's Create-Proposal sample)
**CKYC:** working (e.g. PAN `DHQPG4064J` → CKYC `40053862382888`)

We have the full chain wired end-to-end (Token → GetQuote → CKYC → CreateProposal → IssueProposal) and can **issue real policies for new-business (ContractType F13)**. Two UAT issues block the remaining products. **Defect 1 blocks the entire rollover journey**, which is the primary customer flow.

---

## P1 — Defect 1: Reinsurance exception on FPV / FVO issuance (CreateProposal)

**Products affected:** annual private-car **Comprehensive rollover (ContractType FPV)** and **Standalone-OD (ContractType FVO)**.

**Symptom:** GetQuote succeeds and CKYC succeeds, but `CreateProposal` (METHOD=CRT, PolicyIssueType=I) fails with:

```
Status:      "Failed!"
Message:     "Error During Quote Issuance"
Description: "POLICY HAS NOT BEEN ISSUED due to 0 1******User-Defined Exception from Reinsurance"
```

**This is not downtime and not vehicle/IDV specific.** In the *same* window we confirmed:

- **New-business Comprehensive (ContractType F13) ISSUES cleanly** — real policy numbers bound: `132/14/11/0729/MTP/2410003242` … `…/2410003247`.
- FPV/FVO fail **for every vehicle and every IDV** tried (IDV ₹2.3L → ₹33.8L, multiple makes) with the identical reinsurance exception.

**Re-verified (latest run, single window, with a control):**

| Journey | ContractType | Result |
|---|---|---|
| New Comprehensive — Tata Bolt | F13 | ✅ **ISSUED** `132/14/11/0729/MTP/2410003249` (IDV ₹6,21,252, ₹28,930) |
| Rollover Comprehensive — Honda City | FPV | ❌ Reinsurance exception (quote fine: IDV ₹5,36,016, ₹22,563) |
| Standalone-OD — Maruti Ciaz | FVO | ❌ Reinsurance exception (quote fine: IDV ₹3,22,010, ₹13,098) |

The control issuing in the same minute rules out downtime, credentials, and CKYC.

Because F13 issues while FPV/FVO do not — same credentials, same CKYC, same window — this points to the **reinsurance treaty/arrangement not being configured for the FPV and FVO products in UAT**.

**Request:** Please enable the reinsurance treaty for the **FPV** (annual private-car comprehensive) and **FVO** (standalone-OD) products in UAT, **or** advise the field our reinsurance step is missing. Sample failing QuotationNos can be supplied on request.

---

## P1 — Defect 2: Third-Party (LO) declined for all vehicles

**Product affected:** standalone **Third-Party (cover LO)**.

**Symptom:** every TP-only vehicle we submit is refused — most at GetQuote with `Referral due to: Declined Vehicle`, and at least one (Maruti Ciaz) **prices correctly at GetQuote (TP premium ₹4,031) and is then refused at CreateProposal with `Vehicle is Declined`**. Tried across Verna, City, Swift, Venue, Tiago, Baleno, Bolt, WagonR, Ciaz on multiple RTOs (~10 vehicles) — none issue.

The Ciaz case is important: it shows the **TP request itself is now well-formed and rateable** (FG returns a real TP premium), so the refusal is an **underwriting/decline-list decision on FG's side**, not a malformed request.

**Request:** Please confirm whether the Web Aggregator agent (`60001464`) is authorised for standalone TP-only issuance in UAT, and if so, supply at least one **UAT-approved make/model for TP-only** so we can certify the TP journey.

---

## For confirmation (not blocking)

1. **Long-term (3-year) standalone TP for a NEW vehicle — is there a product?** A new-business TP submitted under **F13** is rejected at ENQ with `Incorrect AgentCode Combination Passed`. We now route standalone TP through **FPV/LO**, which passes ENQ — but your contract master lists FPV as **"LO 0+1"**, i.e. a **one-year** TP, and a new private car legally requires a **3-year** TP. We have therefore **blocked new-vehicle TP-only in our portal** rather than bind an invalid 1-year TP. Please confirm either (a) the ContractType for a long-term standalone TP, or (b) that new vehicles must always use the bundled product.

2. **`NCB` vs `NCBInExpiringPolicy` — which value does FG expect?** Our request carries a single canonical "NCB %". At CRT we currently send it in **both** `Risk.NCB` and `PreviousInsDtls.NCBInExpiringPolicy`. Please confirm FG's intent: is `NCB` the **applicable** NCB for the new policy (i.e. the next slab, e.g. expiring 20% → applicable 25%), while `NCBInExpiringPolicy` is the **expiring** policy's NCB? If so we will send the next-slab value in `NCB`. We would rather confirm than guess, since it directly changes the OD discount.
3. **UAT does not enforce some issuance-stage checks** — blacklisted plates (e.g. `MH02EP6349`) and duplicate registrations (e.g. `MH01UH5433`) **issued successfully** in UAT, and a **>15-year** vehicle still returned a quote. Please confirm these guards are prod/issuance-stage only (we enforce >15yr and decline messaging on the portal).

---

## Evidence summary

| Product / journey | ContractType | UAT result |
|---|---|---|
| New business, Comprehensive | F13 | ✅ Issues (policy no. returned) |
| New business, Electric Comprehensive | F13 | ✅ Issues |
| Rollover, Comprehensive | FPV | ❌ Reinsurance exception at CreateProposal |
| Standalone OD | FVO | ❌ Reinsurance exception at CreateProposal |
| Third-Party only | FPV/LO | ❌ Declined Vehicle (all ~10 vehicles tried; one priced then declined at proposal) |
| CKYC (valid / invalid PAN) | — | ✅ Verifies / correctly fails |

Nothing further is required on our side for the rollover journey to bind — once the FPV/FVO reinsurance treaty is enabled in UAT, CreateProposal will proceed straight through to IssueProposal.

---

## Open follow-ups after GCI's 2026-07-26 reply

1. **Reinsurance fix ETA + notification.** Please share a target date for the FPV/FVO reinsurance configuration and confirm you will notify us when it is deployed, so we can immediately re-run rollover certification (our test rig is ready).
2. **NCB fields (unanswered).** At CreateProposal we send the same value in `Risk.NCB` and `PreviousInsDtls.NCBInExpiringPolicy`. Should `NCB` carry the NEW applicable slab (expiring 20% → applicable 25%) while `NCBInExpiringPolicy` carries the expiring policy's? This directly changes the OD discount — we need a written answer before rollover go-live.
3. **UAT guard behaviour (unanswered).** Blacklisted plates, duplicate registrations and >15-year vehicles all pass in UAT. Please confirm these checks are production/issuance-stage only.
4. **Standalone TP channel intent.** Is the UW block on TP-only permanent for the Web Aggregator channel, or will it be enabled later? We have hidden FG on TP journeys and will re-enable on your confirmation.
5. **F33 eligibility.** Your table lists **F33 (3yr OD + 3yr TP)** for new cars. Is the Webagg channel (agent 60001464) permitted to sell F33? If yes we will add it as a customer option alongside F13.

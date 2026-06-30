# Full-Flow Frontend Test Cases — FG + ICICI (live UAT, real vehicles)

**Environment:** UAT · **Verified:** 2026-06-26 · live quote calls fired against FG
(`generalicentralinsurance`/`futuregenerali`) and ICICI (`ilesbapigee.insurancearticlez.com`).

Unlike [`icici-test-cases.md`](./icici-test-cases.md) (which only passes at the
unit/fixture level), **every reg number below was driven through the real
`compareQuotes` service and returned a live premium from the named provider(s).**
The registration numbers are **real plates** from `dock boyz/rc2026vhicle.csv`, served
to the wizard via a local RC mock so each plate resolves to a known vehicle every time.

> **Coverage reality (why each plate targets specific providers):**
> **4W = both FG + ICICI** · **2W = ICICI only** (FG has no two-wheeler line) ·
> **Commercial = FG only** (ICICI's CV master isn't onboarded → request is correctly rejected).

---

## TL;DR — verified golden plates

| Reg No | Resolves to | Route | Providers (live) |
|---|---|---|---|
| **DL10CN1591** | Honda City 1.5 V petrol · Delhi | Car | **FG + ICICI** |
| **DL10CS5721** | Hyundai i20 petrol · Delhi | Car | **FG + ICICI** |
| **GA06D0799** | Hyundai Santro petrol · Goa | Car | **FG + ICICI** |
| **MH34AA1936** | Hyundai Santro petrol · Chandrapur | Car | **FG + ICICI** |
| MH03DK2902 | Hyundai Verna petrol · Mumbai | Car | FG + ICICI (FG declines TP) |
| MP09ZF7032 | Hero Splendor Plus petrol · Indore | 2-Wheeler | **ICICI** |
| MP45ZA2548 | Honda Activa 125 petrol · Jhabua | 2-Wheeler | **ICICI** |
| MP09ZH7220 | Suzuki Access 125 petrol · Indore | 2-Wheeler | **ICICI** |
| MP11ZA2818 | Hero Glamour petrol · Dhar | 2-Wheeler | **ICICI** |
| JH02AM5328 | Mahindra Bolero Pickup diesel · Hazaribagh | Commercial | **FG** |
| MH10EQ0074 | Ashok Leyland Bada Dost diesel · Sangli | Commercial | **FG** |
| JH05DP6795 | Tata Intra diesel · Jamshedpur | Commercial | **FG** |

The four **bold 4W plates quote on BOTH providers across all three plans
(Comprehensive / Own-Damage / Third-Party)** — use these for the headline both-provider demo.

---

## One-time setup

```powershell
# 1. DB + masters. ORDER MATTERS: import-fg-master wipes ALL provider codes, so run FG first,
#    then ICICI (line-aware cross-walk: one RTO code per vehicle line — see Known Issues #1).
cd tf-api
npm run db:up
npm run db:import:fg        # FG is the master data source (canonical MMV/RTO rows)
npm run db:import:icici     # ICICI per-line RTO + make/model cross-walk onto the FG rows

# 2. Start the local RC mock (serves dock boyz/rc2026vhicle.csv in regtech shape)
npx tsx scripts/rc-mock-server.ts          # http://localhost:4100 — leave running

# 3. Point the frontend at the mock (already written): tf-web/.env.local
#      VITE_RC_API_URL=http://localhost:4100/api/rc_validationworking
#    Then bring up the stack:
cd ..
./dev-up.ps1               # DB, backend (FG_ENABLED + ICICI_ENABLED), frontend :8080
```

Remove `tf-web/.env.local` to switch the wizard back to the live regtech API.

---

## A. Four-wheeler — FG + ICICI (Car route, business = Rollover)

Enter the reg number on **Car Insurance**, confirm the vehicle, then on the **Plans**
step toggle **Comprehensive / OD / TP**. Both insurer cards should price.

Live premiums (₹, incl. GST — these are realistic full-value premiums, displayed as-is):

| Reg No | Vehicle | Plan | ICICI | FG |
|---|---|---|---|---|
| **DL10CN1591** | Honda City petrol (Delhi) | Comprehensive | ₹36,031 | ₹19,531 |
| | (prev policy **expired** → also exercises break-in) | Own-Damage | ₹31,930 | ₹8,026 |
| | | Third-Party | ₹16,299 | ₹4,031 |
| **DL10CS5721** | Hyundai i20 petrol (Delhi) | Comprehensive | ₹20,301 | ₹17,607 |
| | | Own-Damage | ₹16,270 | ₹7,030 |
| | | Third-Party | ₹10,429 | ₹4,031 |
| **GA06D0799** | Hyundai Santro petrol (Goa) | Comprehensive | ₹14,438 | ₹7,798 |
| | | Own-Damage | ₹10,408 | ₹1,950 |
| | | Third-Party | ₹7,737 | ₹4,031 |
| **MH34AA1936** | Hyundai Santro petrol (Chandrapur) | Comprehensive | ₹14,438 | ₹11,147 |
| | | Own-Damage | ₹10,408 | ₹3,685 |
| | | Third-Party | ₹7,737 | ₹4,031 |
| MH03DK2902 | Hyundai Verna petrol (Mumbai) | Comprehensive | ₹33,488 | ₹21,229 |
| | (prev expired) | Own-Damage | ₹24,170 | ₹8,905 |
| | | Third-Party | ₹17,394 | ⚠ FG referral-declined |

Also verified on both: **KA01MJ2265** (Santro, Bangalore) and **KL57V0274** (i20, Kerala) —
Comprehensive + OD on both; FG referral-declines their TP (see Known Issues #4).

### New-vehicle (business = New) — via "Add details manually"

The reg-number path is always Rollover. To test **New**, click **"Add details manually"**,
pick the same make/model + RTO, today's date. Verified live:

| Plan | ICICI | FG | Notes |
|---|---|---|---|
| Comprehensive (New) | ✅ quotes (e.g. City ₹373→**₹37,300-class**) | ✅ quotes | ICICI product **20** |
| Own-Damage (New) | ⛔ rejected | ⛔ rejected | No brand-new standalone-OD product (correct) |
| Third-Party (New) | ⛔ rejected | ⛔ rejected | No brand-new-TP product (correct) |

---

## B. Two-wheeler — ICICI only (2-Wheeler route, business = Rollover)

FG has no 2W line, so only the ICICI card prices (the FG card shows "not supported").

| Reg No | Vehicle | Comprehensive | Own-Damage | Third-Party |
|---|---|---|---|---|
| **MP09ZF7032** | Hero Splendor Plus (Indore) | ₹1,154 | ₹312 | ₹1,154 |
| **MP45ZA2548** | Honda Activa 125 (Jhabua) | ₹1,291 | ₹448 | ₹1,291 |
| **MP09ZH7220** | Suzuki Access 125 (Indore) | ₹6,086 | ₹5,244 | ₹6,086 |
| **MP11ZA2818** | Hero Glamour (Dhar) | ₹1,104 | ₹262 | ₹1,104 |

ICICI product codes exercised: Rollover Comprehensive **13**, OD **16**, TP **26**;
New-Comprehensive **10**. New-OD / New-TP are correctly rejected. (Since the line-aware RTO
fix, 2W resolves in **any** RTO that has a `tw` code — `tw:949/1504` — not just these cities.)

> Bonus EV/large-bike plates that also quote on ICICI: **MH01EG1058** (Royal Enfield
> Interceptor 650, Mumbai) and **MH12UY8208** (Ola S1 Pro, electric, Pune). The Royal
> Enfield occasionally returns a transient ICICI gateway error on Comprehensive — retry,
> or prefer the four above for a clean demo.

---

## C. Commercial — FG only (Commercial route, business = Rollover, goods)

Use the **Commercial Vehicle** route; on confirm, set type = **Goods**, gross weight, seating.
ICICI's card correctly shows "not supported" (CV master not onboarded).

| Reg No | Vehicle | Comprehensive (FG) | Third-Party (FG) |
|---|---|---|---|
| **JH02AM5328** | Mahindra Bolero Pickup (Hazaribagh) | ₹18,129 | ₹16,851 |
| **MH10EQ0074** | Ashok Leyland Bada Dost (Sangli) | ₹17,917 | ₹16,851 |
| **JH05DP6795** | Tata Intra (Jamshedpur) | ₹6,227 | ₹4,492 |

FG commercial has no standalone-OD product (OD tab → "not offered"). Heavy trucks and
3-wheelers (Atul Gem, Tata LPT 3118) get FG `Declined`/`Vehicle Class` rejections — keep to
light goods vehicles like the three above.

---

## D. Downstream steps (quote → … → payment) and the test data to use

The wizard after **Plans**: **Proposal → KYC → Review → Payment**. Per the agreed scope,
**stop at the Payment page** (do not complete payment). Copy-paste data:

**Proposal form** ([`proposal-schema.ts`](../../tf-web/src/features/vehicle/lib/proposal-schema.ts)):
- First / Last name: `Ravi` / `Kumar` · Email: `ravi.kumar@example.com`
- Mobile: `9876543210` (10 digits, starts 6-9) · DOB: `1990-05-15` · Gender: `M`
- Address line 1: `12 MG Road` · City/State: from the RTO (e.g. `Delhi`/`Delhi`) · **Pincode: 6 digits** (e.g. `110046` — the mock supplies one from the RC for most plates)
- Engine / Chassis no: pre-filled from the RC mock (e.g. City → `L15Z17017646` / `MAKGM653JKN400896`); any non-empty value passes validation · Finance: `None`
- Nominee (optional): `Sita Kumar` / `Spouse` / `45`

**KYC** ([`kyc-page.tsx`](../../tf-web/src/features/vehicle/pages/kyc-page.tsx)): PAN in
`ABCDE1234F` format, e.g. **`ABCPK1234F`** + the DOB above.

**Payment page (stop here):**
- **FG** → renders the gateway form / redirect to FG's `WebAggPayNew.aspx`. **Do not submit.**
- **ICICI** → `getFullQuote` returns a hosted `paymentUrl`. **Do not open it.** Note:
  ICICI's `/payment/initiate` is **`501 NOT_IMPLEMENTED`** server-side, so ICICI cannot be
  *driven past* a hosted redirect in-app — reaching the payment screen is the end state.

---

## Known issues & caveats (discovered during live verification)

1. **ICICI RTO codes are per vehicle line — now modelled correctly (line-aware).** ICICI uses
   a different RTO code for the same city per line (Pune 4W=`9`, 2W=`634`). `ProviderRtoCode`
   now has a `line` column (`tw`/`fw`/`cv`/`all`) with `@@unique([providerSlug, rtoId, line])`;
   `import-icici-master.ts` stores one code per line from the Private-Car / Two-Wheeler RTO
   CSVs, and `getProviderRtoCode(slug, rto, line)` resolves the request's line (via
   `resolveLine(req.vehicleType)`). So **2W and 4W quote in the same RTO simultaneously** — e.g.
   Pune serves `fw=9` and `tw=634`. ⚠ This replaced an earlier band-aid that pinned 7 metros to
   their 2W codes and **silently broke live 4W quoting there** — never override the shared
   `provider_*_codes`/master tables to make a test pass; they feed the live resolver.
2. **ICICI 4W make/model cross-walk is ~62% and some codes the UAT rejects** (`Vehicle details
   not found`). A stricter name+engine-CC matcher was attempted to raise accuracy but **made it
   worse** — it changed already-working vehicles to plausible-but-unprovisioned codes the UAT
   rejects (`Response body is null`). A name/CC heuristic can't know which of several model
   codes is the one provisioned in UAT. Reverted to the proven matcher. **Improving 4W accuracy
   safely needs a validation pass that calls the live premium API for each candidate pair and
   keeps only the ones that price** (a batched, rate-limited job) — not a smarter offline guess.
   **That batch now exists**: `scripts/validate-icici-codes.ts` probes each ICICI code against
   the live UAT, records `verifiedAt`/`verifyError` on `ProviderMmvCode`/`ProviderRtoCode`, and
   `--cleanup` deletes only codes the UAT definitively rejects as "not found" (never transient
   500/504/null/token errors). Run it when ICICI UAT is healthy:
   `npx tsx --env-file=.env scripts/validate-icici-codes.ts --what=both` then `--cleanup`.
3. **ICICI payment is `501 NOT_IMPLEMENTED`** — ICICI can't complete to an issued policy
   in-app; FG has the full payment→callback→issuance path.
4. **FG UAT referral-declines some vehicles/covers** (`Referral due to: Declined Vehicle`),
   notably TP on certain Santro/i20 RTOs and most heavy commercial — a UAT underwriting rule,
   not a code bug. The both-provider 4W demo uses Comprehensive (declined far less often).
5. **Premiums are real full-value rupees** (City Comp ICICI ₹36,031). `grossPremium` is
   stored and displayed in rupees end-to-end (`formatInr` does not divide) — there is **no**
   paise bug despite CLAUDE.md's "paise" note; the providers store rupees.

---

## How to re-verify / regenerate

```bash
cd tf-api
# 1. Find real plates that resolve to both-/single-provider-covered vehicles (read-only):
npx tsx --env-file=.env scripts/find-frontend-test-vehicles.ts --limit=40 --out=scripts/_candidates.json
# 2. Fire LIVE FG + ICICI quotes for each candidate (the actual "test against real vehicles"):
npx tsx --env-file=.env scripts/verify-test-vehicles.ts --in=scripts/_candidates.json \
    --plans=comprehensive,standAloneOD,thirdParty --max=40 --bucket=4W-both
#    add --business=new to exercise the manual-entry path; --bucket=2W-icici / commercial-fg
# 3. Serve plates to the UI:
npx tsx scripts/rc-mock-server.ts
```

Scripts: [`find-frontend-test-vehicles.ts`](../scripts/find-frontend-test-vehicles.ts),
[`verify-test-vehicles.ts`](../scripts/verify-test-vehicles.ts),
[`rc-mock-server.ts`](../scripts/rc-mock-server.ts),
[`rc-csv.ts`](../scripts/rc-csv.ts),
[`icici-master-overrides.json`](../scripts/icici-master-overrides.json).

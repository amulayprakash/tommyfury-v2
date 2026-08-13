# FG UAT certification journey (`/fg`) — design

**Date:** 2026-08-07
**Status:** approved, ready for implementation planning

## Purpose

Give the Generali Central (FG) integration team a self-contained journey they can drive
themselves, end to end, to certify their own flows against our integration. Today they
have no way to exercise the chain without us running scripts and mailing logs back and
forth; every defect round-trip costs a day.

The journey lives at `/fg`, covers only the categories FG actually sells, and finishes on
a real UAT policy number — the artifact the 37 certification test cases record as proof.

## Scope

**In scope**
- A new `/fg/*` route group: category → vehicle → plans → proposal → KYC → review →
  payment → policy number.
- Manual vehicle entry with full control over every condition the 37 cases need.
- FG-only provider scoping, categories and plan types derived from FG's declared
  capabilities.
- Raw request/response visibility on every step.
- Presets for the 37 certification cases.

**Out of scope**
- Health insurance and every other provider.
- Any change to the customer-facing wizard.
- Two-wheeler (see Constraints).
- End-to-end browser tests.

## Constraints discovered

**FG has no two-wheeler.** `FG_CAPABILITIES` (`tf-api/src/providers/fg/config.ts`)
declares `fourWheeler`, `commercial` and `newCommercial` only, and `mmv_master` holds
10,734 four-wheeler and 9,576 commercial rows for `source='fg'` with **zero** two-wheeler.
A 2W tile would have nothing behind it, so it is omitted. Because the tiles are derived
from the capability endpoint rather than hard-coded, a 2W tile will appear on its own if
FG's master ever gains one.

**Third party is absent for private car by design.** GCI confirmed in writing that
standalone third-party is blocked for the web-aggregator channel, so it was removed from
`FG_MOTOR_CAPABILITIES.fourWheeler`. Deriving plan types from capabilities keeps that
correct without special-casing.

**The customer wizard is unauthenticated.** *Corrected during implementation — an earlier
draft assumed it sat behind `ProtectedRoute`. It does not:* the vehicle routes are mounted
directly under `WizardLayout` in `routes.tsx`, and `ProtectedRoute` guards only the
account, checkout and post-sale sections. `/fg` therefore needs its own guard wrapper, and
requiring a login makes the harness stricter than production rather than equivalent to it.
That was confirmed as the intent after the correction: GCI testers need accounts, and live
UAT calls stay behind a login.

**Two payment environment variables must be re-pointed, or the journey cannot finish.**
Both are configuration, not code, and both are stated on screen in the harness so a tester
who hits a dead end can read why.

1. `FG_PAYMENT_RESPONSE_URL` — defaults to `http://localhost:4000/...`. Must be this
   deployment's `/api/v1/fg/payment/callback`, or FG's gateway never calls back and no
   policy is issued.
2. `FG_PAYMENT_SUCCESS_URL` — defaults to `<ALLOWED_ORIGINS[0]>/insurance_ps`, which is
   the **customer wizard's** success page. Left as-is, a tester who completes payment is
   redirected out of the harness into the customer journey and never sees the policy
   number. Must be this deployment's `/fg/success`.

*Discovered during implementation:* the policy number reaches the browser as a **URL
query parameter** on that success redirect (`?quoteNo=…&policyNo=…`) after the callback
issues the policy — not from any API call the frontend makes. The success page reads it
from the query string, mirroring the customer wizard's own success page.

*Also discovered:* payment initiation returns a checksum-signed **form** (`url` plus
`fields`) that must be POSTed, not a URL to redirect to. A GET against the URL alone fails
FG's checksum.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Two-wheeler | Omit | FG cannot quote it; showing it invites false defect reports |
| Access | Behind `ProtectedRoute` | GCI testers get real accounts. Note this is **stricter** than the customer journey, which is unauthenticated (see Constraints) — a deliberate choice to keep live UAT calls behind a login |
| Vehicle entry | Manual only | Certification needs exact control of dates, NCB, claims and break-in; also avoids per-call regtech cost and works with FG's fictional kit plates |
| Journey end | Real policy number | FG UAT does not validate the payment transaction, so the full chain is reachable and the PolicyNo is the certification artifact |
| Code structure | Separate `src/features/fg-uat/` | Zero regression risk to the live customer journey; free to expose certification-only controls |

## Architecture

### Routes

Added to `tf-web/src/app/router/paths.ts` as a new `fgUat` group, mounted in
`routes.tsx` inside `ProtectedRoute`. Legacy `vehicle` paths are untouched.

```
/fg              category picker — Car · Commercial · New Commercial
/fg/vehicle      vehicle + policy conditions
/fg/plans        quote, plan type, add-ons
/fg/proposal     proposer + nominee
/fg/kyc          CKYC (PAN/DOB), OVD upload fallback
/fg/review       resolved payload summary, create proposal
/fg/payment      gateway redirect → callback → issue
/fg/success      policy number
```

### Module layout

```
src/features/fg-uat/
  pages/            one page per route above
  fg-uat-store.ts   Zustand, persisted under its own key
  test-presets.ts   the 37 certification cases as form state
  components/       raw-exchange drawer, condition field groups
```

Reuses, rather than reimplements: the `vendorClient` API hooks, the canonical contracts,
`addon-selection.ts` (combo + zero-dep rules), `DateInput`, `IdvControl`, `NcbSelect`.
GCI therefore exercises the **same tf-api → FG code path** as production; only the harness
around it differs.

The store is separate and separately persisted, so a tester cannot collide with a real
customer session held in the existing journey store.

### Data flow

Identical to the customer journey: the page builds a `MotorQuoteRequest`, `compareQuotes`
scoped to `providers: ["fg"]` returns the quote, CKYC runs before the proposal,
`getFullQuote` creates it, `payment/initiate` hands off to FG's gateway, the callback
issues and returns the PolicyNo.

## Components

### Category picker (`/fg`)

Tiles built from `GET /providers/fg` capabilities. No hard-coded category list.

### Vehicle + conditions (`/fg/vehicle`)

One screen, grouped. Every field is directly editable — that is the point.

| Group | Fields |
|---|---|
| Vehicle | make/model/variant typeahead (FG-source rows), RTO typeahead, registration number (free text), registration date, engine number, chassis number |
| Business | business type (new / rollover / renewal), plan type, IDV override |
| Previous policy | insurer, policy number, start date, expiry date, expired flag |
| Previous TP | number, start, expiry — shown only for standalone OD |
| NCB & claims | NCB %, claim in previous policy |
| Break-in | inspection reference, inspection date |
| Commercial | sub-type (goods/passenger), GVW, seating capacity, carrying capacity |

Client-side guards stay active — the 45-day advance-inception cap, the standalone-OD TP
date rule, and the add-on combo rules. GCI needs to see the same validations a customer
would hit, not a bypass.

### Plans (`/fg/plans`)

Plan types from `motorCapabilities[category].policyTypes`. Add-ons from the catalog
endpoint, selection governed by the existing rules: at most one base combo cover, and
zero-dep-gated extras (`STNCB`, `STINC`) only alongside a cover providing zero dep.

The premium panel breaks out OD, TP, each add-on, discounts, and the **OD special
discount percentage** — that figure determines whether the proposal will clear
underwriting, so it must be visible before the tester proceeds.

### Proposal, KYC, review

Proposer and nominee prefilled with the identity already proven to clear FG's client
creation — PAN `DHQPG4064J`, DOB 15/05/1990, a non-sequential mobile (FG's CRT rejects
`9876543210`), and a complete address including landmark and pincode. Every field stays
editable; the prefill only saves testers from rediscovering FG's input quirks.

CKYC by PAN + DOB with the existing OVD-upload fallback. Review shows the resolved FG-side
values — contract type, policy period, IDV, cover codes — then creates the proposal and
captures ClientId and QuotationNo.

### Payment (`/fg/payment`)

`payment/initiate` → FG gateway → callback → issue → `/fg/success` with the PolicyNo.

### Raw exchange drawer

A collapsible panel on every step showing the actual request and response for that call.
This is the highest-value element for a vendor: on failure they see their own payload
immediately instead of requesting logs from us.

**This requires two tf-api changes.**

*Corrected during implementation — an earlier draft of this spec claimed the motor
normalizers do not populate `_rawResponse`. They do:* `normalizer.ts` sets
`_rawResponse: body` unconditionally on both quote and proposal, and it is load-bearing —
`quote.repository.ts` persists it as `rawFullQuote`. It must not be stripped.

So the vendor's **response** is already captured. What the harness adds is the **request**
half — the payload carrying agent code, branch code and vendor code — plus a way for it to
reach the browser:

1. **`FgProvider` attaches the request** alongside the response as
   `_rawResponse: { request, response }` when `includeRawExchange` is set on the request.
   Without the flag the value is unchanged, so persistence and existing responses stay
   byte-identical.
2. **The compare path stops discarding it.** `compare.controller.ts` deletes
   `_rawResponse` from every result unconditionally, so the plans page would otherwise
   receive nothing. It must keep the field when the request asked for it.

**Two gates, both required.** The request flag signals intent; `ENABLE_DEBUG_PAYLOAD`
grants deployment permission — the control `quote.controller.ts` already uses for the same
data. Requiring both means a stray client cannot pull vendor payloads out of production by
setting a flag, and the harness works by enabling one environment variable where it is
hosted. If `ENABLE_DEBUG_PAYLOAD` is off, the drawer is simply empty.

### Test-case presets

A dropdown of the 37 cases that fills the form for that scenario — TC_16 sets an expired
previous policy and reveals the inspection fields, TC_18 sets a >90-day break-in, TC_20
sets ownership transfer. Testers select a case rather than reconstructing its conditions.

## Error handling

FG's raw `Status` / `Message` / `Description` are shown verbatim, with the HTTP status and
our error code alongside. The customer wizard should soften vendor errors; a certification
harness must not — the exact vendor string is the thing under test.

No silent fallbacks. If a master code cannot be resolved, or a guard rejects the input,
the harness says which one and why.

## Testing

Unit tests for the pure logic:
- preset → form state for each of the 37 cases
- category and plan-type derivation from the capability payload
- add-on selection rules (already covered by `addon-selection.test.ts`)

No end-to-end browser tests. The journey's value is that it hits live FG UAT, whose
responses are not deterministic — vehicle decline lists and discount percentages change
day to day.

## Risks

| Risk | Mitigation |
|---|---|
| Testers hit live UAT and create real proposals | Expected and desired; nothing binds until payment, and UAT issues no real cover |
| FG's decline list changes and a preset's vehicle stops quoting | Presets are editable form state, not fixtures; a tester can substitute a vehicle |
| `FG_PAYMENT_RESPONSE_URL` left on localhost | Called out in Constraints; verify before handing the URL to GCI |
| Feature drifts from the customer journey's contract | Both consume the same hooks and contracts; a contract change breaks both at compile time |

## Open items

- The motor `Webagg` credential is currently returning `invalid_grant`. The FG motor
  endpoints do not require a bearer, but `FgProvider` fetches one before every call, so
  this must be restored before `/fg` can run against UAT.
- Hosting location for `/fg` and the corresponding `FG_PAYMENT_RESPONSE_URL` value.

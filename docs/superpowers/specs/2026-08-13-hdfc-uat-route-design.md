# HDFC ERGO — `/hdfc` UAT certification journey

**Date:** 2026-08-13
**Status:** approved, ready for implementation planning
**Predecessor:** [2026-08-07-hdfc-ergo-provider-design.md](2026-08-07-hdfc-ergo-provider-design.md)

## Goal

Finalize HDFC ERGO's UAT certification. Today the provider is live on UAT for
quoting only: `scripts/hdfc-uat-scenarios.ts` fires all 205 conditions of HDFC's
own `PVTcarTestScenarios.xls` and 104 pass, but the runner is deliberately
read-only — it has never called `CreateProposal` or `SubmitPaymentDetails`, so
no policy has ever been bound and the last mile of the integration is unproven.

This spec adds a provider-scoped frontend journey at `/hdfc` that:

1. shows **only HDFC quotes**, and
2. can drive HDFC's certification conditions **end to end on our system**, from
   vehicle entry through to a real UAT policy number and certificate.

**Issuance on the shared HDFC UAT sandbox is explicitly authorized** for this
work (decision recorded 2026-08-13). This reverses the read-only stance that
governs `scripts/hdfc-uat-scenarios.ts`; that runner stays read-only and is not
changed by this spec.

## Scope boundary — what this cannot achieve

Of the 205 pack conditions, 104 pass and **99 cannot be made to pass from our
side**:

| Reason | Count | Examples |
| --- | ---: | --- |
| HDFC sandbox refusals | 88 | 2+3 and 2+0 term gates, Used Car channel entitlement, missing IDV master rows, Blaze rules-engine crashes |
| Blocked on missing vendor data | 11 | Gold plan's unnamed cover `N161521G0020`, financier master cross-walk, proposal-only rules |
| Manual UI conditions | 2 | IDV slider, accessories SI prompt |

This route makes every one of them **reproducible and evidenced end to end on
our system**. The remedies belong to HDFC. A consolidated blocker list is a
deliverable of this work (see Deliverables).

## Architecture

A separate feature module, `tf-web/src/features/hdfc/`, with its own routes,
store and API hooks, **reusing the existing presentational components** rather
than copying them.

The alternative — mounting the existing wizard pages under `/hdfc` with a
`lockedProvider` flag — was rejected. Certification needs inputs the generic
journey does not expose (used-car purchase, multi-year standalone OD, plan
bundles, accessories and bi-fuel sums insured, break-in dates). Threading those
through shared pages as conditionals is exactly the coupling that would let a
UAT-shaped field regress the live FG/ICICI journey. An isolated module is also
cleanly deletable, or promotable, once HDFC signs off.

HDFC is **Private Car only** (`HDFC_CAPABILITIES` = `fourWheeler`), so the
journey has no category picker.

### Route map

| Route | Page | Backend call |
| --- | --- | --- |
| `/hdfc` | Vehicle & policy setup | `GET /masters/mmv`, `GET /masters/rto`, RC lookup |
| `/hdfc/quotes` | HDFC-only quotes, add-ons, IDV | `POST /motor/quotes/compare` with `providers:["hdfc"]` |
| `/hdfc/proposal` | Customer, vehicle identity, nominee, financier | — |
| `/hdfc/kyc` | Pehchaan e-KYC (redirect out) | `POST /hdfc/kyc/ckyc` |
| `/hdfc/kyc/return` | e-KYC return landing, reads `kycId` | `POST /hdfc/kyc/ckyc` (status lookup) |
| `/hdfc/payment` | Payment details → issuance | `POST /hdfc/policy/issue` |
| `/hdfc/success` | Policy number + certificate | `GET /hdfc/policy/:transactionId/certificate` |

Every step is guarded on the previous step's state; landing deep without it
redirects to `/hdfc`.

### Module layout

```
tf-web/src/features/hdfc/
  hdfc-journey-store.ts        Zustand + sessionStorage
  api/
    hdfc-api.ts                compare / proposal / kyc / issue / certificate
    hooks.ts                   TanStack Query wrappers
  pages/
    setup-page.tsx
    quotes-page.tsx
    proposal-page.tsx
    kyc-page.tsx
    kyc-return-page.tsx
    payment-page.tsx
    success-page.tsx
  components/
    scenario-presets.tsx       dev-only drawer (see below)
    vendor-message.tsx         renders HDFC's verbatim error
  scenarios.generated.json     exported from the backend runner
  __tests__/
```

Reused as-is from `features/vehicle/components/`: `quote-card`,
`addon-selector`, `premium-breakdown`, `idv-control`, `inspection-card`.

## State & provider pinning

`hdfc-journey-store.ts` holds the quote request, selected quote, proposal
input, `proposalNumber`, KYC result and `policyNumber`, persisted to
`sessionStorage` so a Pehchaan redirect round-trip does not lose the journey.

The provider is a module constant. `providers:["hdfc"]` is sent on every
compare, and `hdfc` is the path parameter on every lifecycle call. Nothing in
this module reads or writes the shared `vehicle-quote-store`, so the live
multi-provider journey is untouched.

## Driving the certification pack

The setup page exposes every input the pack needs and the generic journey does
not:

- business type: new / rollover / **used** (`isUsedVehiclePurchase`)
- policy type: comprehensive / TP-only / **standalone OD**
- `tenureYears`, registration date, previous-policy expiry,
  `isPreviousPolicyExpired`, previous TP policy number and dates
- `ncbPercent`, `claimInPreviousPolicy`
- electrical / non-electrical accessories SI, bi-fuel kit type and SI
- unnamed-PA sum insured
- **plan bundles** via `providerAddonCodes` (`"Silver Plan"`, `"Diamond Plan"`, …)

### Scenario presets (one source of truth)

`scripts/hdfc-uat-scenarios.ts` gains an export flag that writes
`tf-web/src/features/hdfc/scenarios.generated.json` — for each row that has a
request builder: sheet, number, condition text, and the canonical
`MotorQuoteRequest`. The scenario catalogue therefore stays defined in exactly
one place.

A **dev-only** presets drawer (rendered only when `import.meta.env.DEV`) lists
those rows. Selecting one loads its request into the journey store and jumps to
`/hdfc/quotes`, so any pack condition can be driven through the real UI to a
real policy.

## Backend touch points

Small — the provider-parameterized lifecycle already exists and the compare
endpoint already honours a `providers` allow-list.

1. `HDFC_KYC_RETURN_URL` is currently empty in `.env`; set it to
   `<web origin>/hdfc/kyc/return`. **Plan 1.**
2. Add the scenario-preset export flag to `scripts/hdfc-uat-scenarios.ts`.
   **Plan 2** — it exists only to feed the UI's presets drawer, so it lands with
   that drawer rather than with the issuance proof.

No canonical contract changes and no provider changes are expected. If one
proves necessary during implementation it is a finding to raise, not a silent
edit — the contracts are the seam every other vendor shares.

## Error handling

HDFC's verbatim message surfaces on the step that produced it, via
`vendor-message.tsx`. Never a generic failure toast.

This is deliberate. The vendor's own words are the evidence UAT sign-off rests
on, and the pack's value lies in messages like `SA_OD Policy is only allowed for
Short Term Policy period`. A refusal that a condition *expects* is a normal
outcome of the journey, not an application error: the page shows it plainly and
the journey remains restartable.

Distinguish three cases in the UI:

- **our validation error** — fix before the call is made;
- **HDFC refusal** — HDFC's text, verbatim, with the step that produced it;
- **transport failure** (429, timeout) — retryable, with the retry offered.

## Testing

### Automated (`tf-web`, vitest + MSW)

- route guards: each step redirects to `/hdfc` without its prerequisite state;
- the compare request body asserts `providers:["hdfc"]`;
- a compare response containing a non-HDFC result renders **no** card for it —
  the provider lock is proven, not assumed;
- quote render, including HDFC's own IDV band and inspection flag;
- proposal validation;
- e-KYC return handling, including a missing or failed `kycId`;
- payment step and success page, including certificate retrieval;
- HDFC refusals render verbatim rather than as a generic error.

### Live (`tf-api`)

`npm run hdfc:issue` — a scripted end-to-end that issues real UAT policies
through the same call sequence the route makes (quote → proposal → e-KYC →
payment → certificate), capturing proposal number, policy number and
certificate for each scenario it runs.

It issues a **fixed, named set of six**, chosen to cover the product matrix
without flooding a shared sandbox. Each already prices today, so a failure is
about issuance rather than an unrelated quoting gap:

| # | Scenario | Proves |
| ---: | --- | --- |
| 1 | Roll Over 1+1 comprehensive, no add-ons | the baseline package policy |
| 2 | Roll Over 1+1 comprehensive, all covers | add-ons survive to issuance |
| 3 | New Business 1+3 comprehensive | the statutory 3-year TP leg |
| 4 | Standalone OD 0+1 | the OD-only product |
| 5 | Liability 0+1 (TP only) | the liability product |
| 6 | Roll Over 1+1 with a >24 h break-in | inspection routing at proposal time |

The runner must be explicit that it binds real policies, and must refuse to run
without an opt-in flag.

Payment note: `SubmitPaymentDetails` needs no gateway redirect. It takes a
`Payment_Details` block (bank, `PAYMENT_MODE_CD: "EP"`, instrument number,
amount, date); `PAYMENT_AMOUNT` must equal the proposal's premium.

The existing 205-row read-only pack must stay green.

## Deliverables

1. `/hdfc` journey in `tf-web`, HDFC-only, end to end.
2. Passing `tf-web` test suite for the route.
3. `tf-api/docs/hdfc-uat-issuance-results.md` — real UAT policy numbers and
   certificates from the live end-to-end run.
4. A consolidated **vendor blocker list** for HDFC covering the 99 conditions
   we cannot pass, each with HDFC's verbatim message and the evidence already
   gathered (the 2+3 term probe, the Used Car entitlement isolation, the
   missing IDV models, the unnamed Gold-plan cover).
5. `HDFC_KYC_RETURN_URL` documented in `.env.example`.

## Risks

- **Binding policies on a shared sandbox.** Authorized, but each live run
  creates real UAT policies. The e2e runner should issue a deliberately small,
  named set rather than sweeping all 205 rows.
- **Pehchaan e-KYC has never run live.** The hosted journey, the return URL and
  the corporate variant are all unproven; e-KYC is the likeliest place for the
  first live end-to-end attempt to stop.
- **Issuance code is unit-tested but never fired.** Expect first-run payload
  rejections at `CreateProposal`, in the same way quoting needed live iteration.

# FG → Generali Central Migration — Execution Order & Cross-Plan Coordination

> **Read this before executing any of the 5 FG migration plans.** They edit shared files
> (`env.ts`, `config.ts`, `fg.provider.ts`, `src/contracts/*`, `openapi.json`), so order and
> a few mechanics matter. Derived from an adversarial cross-plan verification pass (2026-07-22).

## The five plans

| Order | Plan | File | Verdict after fixes |
|---|---|---|---|
| 1 | Motor SOAP→JSON cutover | `2026-07-22-fg-motor-json-migration.md` | ready |
| 2 | Payment v1.41 | `2026-07-22-fg-payment-v141.md` | ready |
| 3 | CKYC touch-ups | `2026-07-22-fg-ckyc-touchups.md` | ready |
| 4 | Renewal RenewalModify rewrite | `2026-07-22-fg-renewal-modifyrenewal-rewrite.md` | ready (blocker fixed) |
| 5 | Masters re-import verification | `2026-07-22-fg-masters-reimport-verification.md` | ready |

## Recommended execution order: **motor → payment → ckyc → renewal → masters**

**Rationale:**
- **Motor first** — a self-contained transport cutover (`http.ts`, `mapper.ts`, `normalizer.ts`, motor ops in `fg.provider.ts`, fixtures) that touches **no contract**. Its "openapi regenerates with no diff" check only holds against a pristine contract baseline, so it must precede the contract-changing plans.
- **Payment second** — `env.ts` + `config.ts` + `payment.ts`/`payment-recon.ts`/`payment.service.ts` only. No contracts, no `fg.provider.ts`. Minimal coupling.
- **CKYC third, Renewal fourth** — both mutate `src/contracts` (`kyc.ts` / `renewal.ts`) and regenerate `openapi.json` + tf-web bindings. Run them back-to-back so the **last** one performs a single final `npm run openapi:gen` (tf-api) + `npm run gen:api` (tf-web) capturing both.
- **Masters last (or any time)** — fully isolated (`scripts/`, `package.json`, DB imports). Shares no `env.ts`/`config.ts`/provider/contract surface. Can run at any point.

## ⚠ Pre-flight (do this once before starting)

The working tree at plan-authoring time already had **uncommitted changes to `tf-api/src/contracts/kyc.ts` and `tf-api/openapi/openapi.json`** (unrelated in-flight work). Before executing:

1. **Commit or stash those pre-existing changes.** Otherwise (a) the motor plan's "openapi unchanged" check misfires, and (b) the CKYC plan's `kyc.ts` edit + any `openapi:gen` will entangle the unrelated diff into an FG commit.
2. Confirm `git status` is clean (or only the intended in-flight files remain, understood).
3. Ensure MySQL is up for repository-touching suites (`tf_api_test`), per `vitest.config.ts`.

## Shared-file coordination (all resolvable by sequencing + text-anchored edits)

**Apply every edit to a shared file by MATCHING THE QUOTED BLOCK TEXT, not the line numbers stated in the plans.** The plans were written against the current file and cite absolute line numbers; as each earlier plan lands, those numbers drift. No two plans add a duplicate symbol — the additions are textually disjoint — so once text-anchored they compose cleanly.

| File | Plans touching it | Coordination |
|---|---|---|
| `src/config/env.ts` | motor, payment, ckyc, renewal | Disjoint regions (motor: FG_BASE_URL comment; ckyc: FG_CKYC_* + new FG_CKYC_RETURN_URL; renewal: FG_RENEWAL_* incl. **must-set** FG_RENEWAL_CLIENT_BASIC; payment: FG_PAYMENT_* incl. new FG_PAYMENT_VENDOR/RECON_URL/RECON_SOURCE). Text-anchor each; no var-name collision. |
| `src/providers/fg/config.ts` | ckyc, payment, renewal | `FgProductAuth` (ckyc adds `returnUrl?`) and `FgPaymentConfig` (payment replaces) are back-to-back interfaces; all three mutate different property sub-blocks of the same `loadFgConfig()` return literal. Apply ckyc's `FgProductAuth` edit before payment re-anchors `FgPaymentConfig`. Disjoint once text-anchored. |
| `src/providers/fg/fg.provider.ts` | motor, renewal, ckyc | Method bodies are disjoint (motor: getQuote/getFullQuote/issuePolicy transport xmlBody→jsonBody; renewal: renewalQuote edit + new renewalProposal method; ckyc: replace initiateOvd). The **import block at the top** is edited by all three — rebase it sequentially. Payment does **not** touch this file. |
| `openapi/openapi.json` | ckyc, renewal (regen); motor (asserts no-diff) | Run motor first on a clean contract baseline (its check passes). Regenerate `openapi.json` **once** after the last contract-changing plan (renewal). Never regenerate with another plan's contract edits half-applied. |
| `tf-web/.../generated/vendor-api.d.ts` | ckyc, renewal (via `gen:api`) | Single `npm run gen:api` in tf-web **after both** kyc.ts and renewal.ts changes are committed to tf-api. Treat any intermediate per-plan regen as provisional. |
| `src/providers/fg/http.ts` | motor (rewrite); renewal (imports only) | No textual collision. Renewal does **not** edit http.ts — it defines its own private `postJson()` and imports `classifyFgError`. Motor must keep exporting `classifyFgError` (http.ts) and `toFgDate` (mapper.ts) — both are explicitly preserved. |
| `config.ts` FG_OPERATIONS set | ckyc only | Only ckyc mutates the set (adds `"ovd"`, already a valid `ProviderOperationSchema` member). Renewal's `renewalProposal` is a **method** on `RenewalProvider`/`FgProvider`, gated by the existing `"renewal"` op — do **not** add a `renewalProposal` operation. |
| `src/providers/fg/insurance-provider.ts` | renewal only | `KycCapableProvider.initiateOvd` already exists (ckyc does not edit the interface). Only renewal edits this file (adds `renewalProposal` to `RenewalProvider`, tightens `supportsRenewal`). |

## Shared-symbol / naming notes (be aware; not blockers)

1. **Four independent JSON-POST wrappers** now exist by design (isolation): motor's `jsonBody?` on the shared `FetchTransport`; renewal's private `postJson(url, token, body)` (Internal-Key, 3 args); ckyc's private generic `postJson<T>(url, token, subscriptionToken, body)` (Bearer + optional Token, 4 args); payment-recon's `reconcilePayment`. The two module-private `postJson`s share a name with **incompatible signatures** — fine since both are module-scoped, but don't cross-import them.
2. **Receipt `pgType` serializes differently per product:** motor's `IssueProposal` emits `PGType`; renewal's `ModifyRenewalPolicyIssuance` emits `PaymentType`. Both consume the same canonical `PaymentReceiptSchema` produced by payment's `pgResultToReceipt`. Verify the vendor expects the different key per product.
3. **Soft dependencies:** renewal.ts imports `toFgDate` (mapper.ts) + `classifyFgError` (http.ts) — motor preserves both. Payment's callback calls the provider's `issuePolicy` (which motor migrates to JSON) — either order works, but the end-to-end recon→issue path is only fully exercised once motor's JSON issuance has landed.

## Open confirmations roll-up

All pre-go-live confirmations for GCI are consolidated in **[`../fg-rebranding-notes.md`](../fg-rebranding-notes.md) §10**. The verification pass added these live-rejection risks to watch:
- **Motor:** FuelType coded (`P`) vs full-word (`PETROL`); JSON error-envelope shape (no sample in kit); whether `MotorAPI/1.0.0` needs a new WSO2 consumer key + `sess_map` echo.
- **Renewal:** `FG_RENEWAL_CLIENT_BASIC` must be the `GCMotorRenewalAPI` subscription Basic (silent fallback to the motor Basic → 401); CO/SAOD/SATP → `[CO,OD,LO]` mapping.
- **Payment:** which id `FetchTRNDetails` is keyed by (our `TransactionID` vs PG `WS_P_ID`) — do not hard-block issuance until confirmed; recon URL form (`?op=` vs `/` vs `GetQuickPayDetailsNew`); PHP checksum trailing-space/AM-PM format.
- **CKYC:** GCKYC 3.0.0 vs 2.1.0 prod; `system_name` value; DOB format; `finalStatus` 1 vs 3; return-URL registration; CKYC-specific token creds.
- **Masters:** PYP rollover insurer master (30 ClientCodes) not imported; `AT10K/AT20K` dropped by the CoverCode regex; decline/blacklist masters absent from the workbook.

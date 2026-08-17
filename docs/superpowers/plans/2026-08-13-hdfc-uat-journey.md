# HDFC `/hdfc` UAT Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A provider-scoped certification journey at `/hdfc` that shows only HDFC quotes and drives HDFC's certification conditions end to end, from vehicle entry to a real bound UAT policy.

**Architecture:** A new `tf-web/src/features/hdfc-uat/` module that **mirrors the existing `features/fg-uat/` harness** — same file layout, same store shape, same page sequence, same reuse of `features/vehicle/api` hooks. HDFC is pinned as the only provider at the request-building layer.

**Tech Stack:** React 19, Vite, React Router 7 data router, TanStack Query, Zustand (`persist`), react-hook-form + zod, Tailwind v4, shadcn-style primitives, vitest + jsdom + MSW.

---

## Context for the implementer

**Read `tf-web/src/features/fg-uat/` before writing anything.** This plan builds the HDFC equivalent of that module, and the strong expectation is that the two look like siblings. Where this plan does not specify a detail (JSX structure, class names, loading and error states, spacing), copy how the FG page for the same step does it.

Predecessors:
- Spec: `docs/superpowers/specs/2026-08-13-hdfc-uat-route-design.md`
- Plan 1 (complete): `docs/superpowers/plans/2026-08-13-hdfc-uat-issuance-proof.md` — proved the backend path live and bound five real UAT policies.
- FG's equivalent spec: `docs/superpowers/specs/2026-08-07-fg-uat-journey-design.md`

### What Plan 1 proved live, which this journey must honour

These are not opinions; each was a live HDFC rejection:

1. **Nominee relationship must match HDFC's RELATION MASTER.** `"spouse"` was rejected; the backend now normalises it (`hdfcNomineeRelation` in `src/providers/hdfc/config.ts`). The UI should offer the master's values rather than free text, so a tester never sends something the master lacks.
2. **A rollover must NOT have already lapsed.** A previous policy that expired yesterday is a *break-in*, and HDFC answers `Break-in ID required`. The default conditions must put the previous policy's expiry in the FUTURE.
3. **Standalone OD requires a previous insurer.** A null `PreviousPolicy_TPINSURER` gives `Valid TP policy is required to book SAOD Policy.` The SAOD path must carry `previousInsurerId`.
4. **Break-in issuance is impossible today** — HDFC's kit ships no endpoint returning a `BreakIN_ID`. The journey may quote a break-in (quoting works and flags inspection) but must tell the tester plainly that the proposal will be refused, rather than letting them hit an opaque error.
5. **HDFC is Private Car only** (`fourWheeler`).
6. **HDFC has no payment gateway.** Issuance is `POST /:provider/policy/issue` with a `PaymentReceipt` — not FG's `initiatePayment` redirect. This is the one place the HDFC journey genuinely differs from FG's.

### Existing API surface (reuse, do not rebuild)

`tf-web/src/features/vehicle/api/hooks.ts` already exports `useProviders`, `useMmvSearch`, `useRtoSearch`, `useCompareQuotesQuery`, `useProviderAddons`, `useFullQuote`, `useCkyc`. `vehicle-api.ts` exports the matching functions. The FG pages consume these directly via `../../vehicle/api/hooks` — do the same.

The one gap: **there is no `issuePolicy` function or hook.** Task 7 adds them.

---

## File structure

| File | Responsibility |
| --- | --- |
| Create `tf-web/src/features/hdfc-uat/hdfc-capabilities.ts` | Categories/plan types from the provider's declared capabilities |
| Create `tf-web/src/features/hdfc-uat/hdfc-uat-store.ts` | Journey state (conditions, proposer, quote, kyc, proposal, policy, exchanges) |
| Create `tf-web/src/features/hdfc-uat/build-hdfc-request.ts` | Conditions → canonical quote/full-quote request, pinned to HDFC |
| Create `tf-web/src/features/hdfc-uat/test-presets.ts` | The certification scenarios a tester can load |
| Create `tf-web/src/features/hdfc-uat/components/condition-fields.tsx` | The editable condition form |
| Create `tf-web/src/features/hdfc-uat/pages/*.tsx` | Eight pages, one per step |
| Create `tf-web/src/features/hdfc-uat/__tests__/*.test.ts(x)` | Unit + route tests |
| Modify `tf-web/src/app/router/paths.ts` | Add the `hdfcUat` block |
| Modify `tf-web/src/app/router/routes.tsx` | Lazy imports + route entries |
| Modify `tf-web/src/features/vehicle/api/vehicle-api.ts` | Add `issuePolicy` |
| Modify `tf-web/src/features/vehicle/api/hooks.ts` | Add `useIssuePolicy` |

---

## Task 1: Routes and capabilities

**Files:**
- Create: `tf-web/src/features/hdfc-uat/hdfc-capabilities.ts`
- Create: `tf-web/src/features/hdfc-uat/__tests__/hdfc-capabilities.test.ts`
- Modify: `tf-web/src/app/router/paths.ts`
- Modify: `tf-web/src/app/router/routes.tsx`

- [ ] **Step 1: Write the failing test**

`tf-web/src/features/hdfc-uat/__tests__/hdfc-capabilities.test.ts` — model it on `features/fg-uat/__tests__/fg-capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { hdfcCategories, hdfcPlanTypes, CATEGORY_LABELS } from "../hdfc-capabilities";
import type { ProviderInfo } from "../../vehicle/api/types";

const provider = {
  slug: "hdfc",
  capabilities: ["fourWheeler"],
  motorCapabilities: {
    fourWheeler: { policyTypes: ["comprehensive", "thirdParty", "standAloneOD"], addons: [] },
  },
} as unknown as ProviderInfo;

describe("hdfcCategories", () => {
  it("offers only the categories HDFC declares", () => {
    expect(hdfcCategories(provider)).toEqual(["fourWheeler"]);
  });

  it("offers nothing when the provider is absent", () => {
    expect(hdfcCategories(undefined)).toEqual([]);
  });

  it("never invents a category HDFC does not declare", () => {
    const twoWheelerOnly = { ...provider, capabilities: ["twoWheeler"] } as unknown as ProviderInfo;
    expect(hdfcCategories(twoWheelerOnly)).not.toContain("fourWheeler");
  });

  it("labels private car", () => {
    expect(CATEGORY_LABELS.fourWheeler).toBe("Private Car");
  });
});

describe("hdfcPlanTypes", () => {
  it("reads the plan types the provider declares for a category", () => {
    expect(hdfcPlanTypes(provider, "fourWheeler")).toEqual([
      "comprehensive", "thirdParty", "standAloneOD",
    ]);
  });

  it("returns nothing for a category HDFC does not sell", () => {
    expect(hdfcPlanTypes(provider, "commercial")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd tf-web && npx vitest run src/features/hdfc-uat -v`
Expected: FAIL, cannot resolve `../hdfc-capabilities`.

- [ ] **Step 3: Implement**

`tf-web/src/features/hdfc-uat/hdfc-capabilities.ts` — the FG file (`features/fg-uat/fg-capabilities.ts`) is the template. Differences: HDFC declares only `fourWheeler` (Private Car), so `ORDER` is `["fourWheeler"]`. Keep reading from `provider.capabilities` rather than hard-coding, and say in a comment that HDFC's kit ships no two-wheeler or commercial product (`HDFC_CAPABILITIES` in the backend confirms it).

- [ ] **Step 4: Run and confirm green**

Run: `cd tf-web && npx vitest run src/features/hdfc-uat`

- [ ] **Step 5: Add the paths**

In `tf-web/src/app/router/paths.ts`, directly after the `fgUat` block (around line 87), add:

```ts
  /** HDFC UAT certification harness — docs/superpowers/specs/2026-08-13-hdfc-uat-route-design.md */
  hdfcUat: {
    start: "/hdfc",
    vehicle: "/hdfc/vehicle",
    plans: "/hdfc/plans",
    proposal: "/hdfc/proposal",
    kyc: "/hdfc/kyc",
    review: "/hdfc/review",
    payment: "/hdfc/payment",
    success: "/hdfc/success",
  },
```

- [ ] **Step 6: Wire the routes**

In `tf-web/src/app/router/routes.tsx`, mirror the FG block exactly — lazy imports next to the FG ones (with a comment naming this spec), and route entries inside the SAME `ProtectedRoute` children array the FG routes use (around line 183). All eight pages. Until later tasks create them, create each page file as a minimal stub exporting the named component so the app still builds; later tasks fill them in.

- [ ] **Step 7: Verify the app builds and routes resolve**

```bash
cd tf-web
npm run typecheck
npx vitest run src/features/hdfc-uat
```

- [ ] **Step 8: Commit**

```bash
git add tf-web/src/features/hdfc-uat tf-web/src/app/router/paths.ts tf-web/src/app/router/routes.tsx
git commit -m "feat(hdfc-uat): route skeleton for the /hdfc certification journey"
```

---

## Task 2: The journey store

**Files:**
- Create: `tf-web/src/features/hdfc-uat/hdfc-uat-store.ts`

Model on `features/fg-uat/fg-uat-store.ts` — same shape, same `persist` usage, same "spread, don't hand back `initial`" reset comment (that bug is real and the comment explains it).

- [ ] **Step 1: Write it**

`HdfcConditions` carries what HDFC's certification needs. Include every field below; each is here because the backend or the pack needs it:

```ts
export interface HdfcConditions {
  // vehicle
  makeId: string; makeName: string; modelId: string; modelName: string;
  fuelType: string; engineCC?: number;
  rtoCode: string; registrationNumber: string; registrationDate: string;
  engineNumber: string; chassisNumber: string;
  // business
  businessType: "new" | "rollover";
  /** HDFC's Used Car product — a separate flag, not a business type. */
  isUsedVehiclePurchase: boolean;
  planType: string;
  tenureYears: number;
  idvValue?: number;
  paOwner: boolean;
  // previous policy
  previousInsurerId: string; previousInsurerName: string; previousPolicyNumber: string;
  previousPolicyStartDate?: string; previousPolicyExpiryDate?: string;
  isPreviousPolicyExpired: boolean;
  // previous TP (standalone OD only)
  previousTpPolicyNumber?: string; previousTpStartDate?: string; previousTpExpiryDate?: string;
  // ncb & claims
  ncbPercent: number; claimInPreviousPolicy: boolean;
  // accessories & bi-fuel
  electricalAccessoriesSI?: number; nonElectricalAccessoriesSI?: number;
  bifuelKitType?: string; bifuelKitSI?: number;
  unnamedPaSumInsured?: number;
}
```

`HdfcProposer` mirrors `FgProposer` but **drops `panNumber`'s FG-specific comment** and adds nothing else — HDFC's e-KYC takes the PAN too. Keep `nomineeName`, `nomineeRelation`, `nomineeAge`.

State fields: `category`, `presetId`, `conditions`, `proposer`, `providerAddonCodes`, `quote`, `ckyc`, `kycRefId`, `proposal`, `proposalNumber`, `policyNo`, `exchanges`, plus the matching setters, `recordExchange` and `reset`. Persist under `{ name: "hdfc-uat-journey" }` — a DIFFERENT key from FG's, so the two harnesses cannot corrupt each other.

`DEFAULT_PROPOSER` must use a **nominee relation from HDFC's RELATION MASTER** — use `"Spouse"` (capital S), and comment that HDFC matches this master case-sensitively and that Plan 1's live run was rejected for sending `"spouse"`.

- [ ] **Step 2: Verify**

Run: `cd tf-web && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add tf-web/src/features/hdfc-uat/hdfc-uat-store.ts
git commit -m "feat(hdfc-uat): journey store"
```

---

## Task 3: Request building — pinned to HDFC

This is the heart of the requirement "only HDFC quotes will be shown". Test it hard.

**Files:**
- Create: `tf-web/src/features/hdfc-uat/build-hdfc-request.ts`
- Create: `tf-web/src/features/hdfc-uat/__tests__/build-hdfc-request.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";

import { buildHdfcQuoteRequest, HDFC_SLUG } from "../build-hdfc-request";
import type { HdfcConditions } from "../hdfc-uat-store";

const base: HdfcConditions = {
  makeId: "12798", makeName: "MARUTI", modelId: "12798", modelName: "SWIFT ZXI",
  fuelType: "petrol", rtoCode: "10406",
  registrationNumber: "MH01QQ7878", registrationDate: "2025-08-13",
  engineNumber: "ENG1234567890123", chassisNumber: "MA3EWDE1S00123456",
  businessType: "rollover", isUsedVehiclePurchase: false,
  planType: "comprehensive", tenureYears: 1, paOwner: true,
  previousInsurerId: "TATAAIG", previousInsurerName: "Tata AIG",
  previousPolicyNumber: "PREVPOL0001",
  previousPolicyExpiryDate: "2026-08-20", isPreviousPolicyExpired: false,
  ncbPercent: 20, claimInPreviousPolicy: false,
};

describe("buildHdfcQuoteRequest", () => {
  it("asks for HDFC and nothing else", () => {
    expect(buildHdfcQuoteRequest("fourWheeler", base, []).providers).toEqual([HDFC_SLUG]);
  });

  it("carries the vehicle and policy conditions through", () => {
    const req = buildHdfcQuoteRequest("fourWheeler", base, []);
    expect(req.vehicleType).toBe("fourWheeler");
    expect(req.selectedPolicy).toBe("comprehensive");
    expect(req.modelId).toBe("12798");
    expect(req.rtoCode).toBe("10406");
    expect(req.tenureYears).toBe(1);
  });

  it("sends the previous TP policy only for a standalone OD", () => {
    const withTp: HdfcConditions = {
      ...base, planType: "standAloneOD",
      previousTpPolicyNumber: "TPPOL0001",
      previousTpStartDate: "2025-08-13", previousTpExpiryDate: "2028-07-14",
    };
    expect(buildHdfcQuoteRequest("fourWheeler", withTp, []).previousTpPolicyNumber)
      .toBe("TPPOL0001");
    expect(buildHdfcQuoteRequest("fourWheeler", base, []).previousTpPolicyNumber)
      .toBeUndefined();
  });

  it("always names the previous insurer on a standalone OD, because HDFC validates the TP policy against it", () => {
    const saod: HdfcConditions = { ...base, planType: "standAloneOD" };
    expect(buildHdfcQuoteRequest("fourWheeler", saod, []).previousInsurerId).toBe("TATAAIG");
  });

  it("omits engineCC when it is zero, which the contract rejects", () => {
    const ev: HdfcConditions = { ...base, fuelType: "electric", engineCC: 0 };
    expect(buildHdfcQuoteRequest("fourWheeler", ev, []).engineCC).toBeUndefined();
  });

  it("passes HDFC's own plan bundles through as provider addon codes", () => {
    const req = buildHdfcQuoteRequest("fourWheeler", base, ["Silver Plan"]);
    expect(req.providerAddonCodes).toEqual(["Silver Plan"]);
  });

  it("asks for the raw exchange so the drawer can show it", () => {
    expect(buildHdfcQuoteRequest("fourWheeler", base, []).includeRawExchange).toBe(true);
  });

  it("suppresses owner PA only when the condition turns it off", () => {
    expect(buildHdfcQuoteRequest("fourWheeler", base, []).paOwner).toBe(true);
    expect(buildHdfcQuoteRequest("fourWheeler", { ...base, paOwner: false }, []).paOwner).toBe(false);
  });

  it("carries HDFC's used-car product flag", () => {
    const used: HdfcConditions = { ...base, isUsedVehiclePurchase: true };
    expect(buildHdfcQuoteRequest("fourWheeler", used, []).isUsedVehiclePurchase).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `cd tf-web && npx vitest run src/features/hdfc-uat/__tests__/build-hdfc-request.test.ts -v`

- [ ] **Step 3: Implement**

`build-hdfc-request.ts`, modelled on `features/fg-uat/build-fg-request.ts`. Key differences, each of which needs a comment saying why:

- `export const HDFC_SLUG = "hdfc";` and `providers: [HDFC_SLUG]` on every request — this is what makes the page HDFC-only, and it is enforced here rather than in a page so no page can forget it.
- Unlike FG, HDFC **does** honour the canonical add-on flags, so pass them through from the conditions rather than forcing everything off. (Backend: `HDFC_MOTOR_CAPABILITIES` lists the add-ons it accepts.)
- `tenureYears` comes from the conditions, since HDFC sells long-term new-business terms.
- Accessories, bi-fuel and unnamed-PA sums pass through when set.
- `isUsedVehiclePurchase` passes through.
- Send `previousInsurerId` whenever it is set — required for SAOD (Plan 1 finding 3).

Also export `buildHdfcFullQuoteRequest(category, conditions, proposer, addonCodes, kyc)` returning a `MotorFullQuoteRequest`: the quote request plus `quoteId`, `proposer`, `address`, `vehicle` (engine/chassis/financeType), `nomineeName`/`nomineeRelation`/`nomineeAge`, and `kycRefId`/`ckyc`. Add tests for it in the same file asserting the nominee relation and the KYC id both reach the request.

- [ ] **Step 4: Green, then commit**

```bash
cd tf-web && npx vitest run src/features/hdfc-uat && npm run typecheck
git add tf-web/src/features/hdfc-uat
git commit -m "feat(hdfc-uat): build canonical requests pinned to HDFC"
```

---

## Task 4: Certification presets

**Files:**
- Create: `tf-web/src/features/hdfc-uat/test-presets.ts`
- Create: `tf-web/src/features/hdfc-uat/__tests__/test-presets.test.ts`

Model on `features/fg-uat/test-presets.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { HDFC_PRESETS, presetById } from "../test-presets";

describe("HDFC certification presets", () => {
  it("covers the six scenarios Plan 1 bound as real UAT policies", () => {
    expect(HDFC_PRESETS.map((p) => p.id)).toEqual([
      "rollover-bare", "rollover-all-covers", "new-business-1-3",
      "saod", "liability", "break-in",
    ]);
  });

  it("gives every preset a unique id and a human label", () => {
    const ids = HDFC_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of HDFC_PRESETS) expect(p.label.length).toBeGreaterThan(0);
  });

  it("never lets a rollover preset start already lapsed, which HDFC refuses as a break-in", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const p of HDFC_PRESETS) {
      if (p.id === "break-in") continue;
      if (p.conditions.businessType !== "rollover") continue;
      expect(p.conditions.isPreviousPolicyExpired).toBe(false);
      expect(p.conditions.previousPolicyExpiryDate! >= today).toBe(true);
    }
  });

  it("names a previous insurer on the standalone OD preset", () => {
    expect(presetById("saod")!.conditions.previousInsurerId).toBeTruthy();
  });

  it("uses a nominee relation from HDFC's RELATION MASTER", () => {
    // HDFC matches this master case-sensitively; "spouse" was rejected live.
    const MASTER = ["Brother", "Child", "Daughter", "Father", "Husband", "Mother",
      "Sister", "Son", "Wife", "Spouse", "Partner", "Police Holder"];
    for (const p of HDFC_PRESETS) {
      if (!p.proposerOverrides?.nomineeRelation) continue;
      expect(MASTER).toContain(p.proposerOverrides.nomineeRelation);
    }
  });

  it("warns on the break-in preset that HDFC cannot issue it", () => {
    expect(presetById("break-in")!.warning).toMatch(/break-in id/i);
  });

  it("finds a preset by id and returns undefined for an unknown one", () => {
    expect(presetById("saod")?.id).toBe("saod");
    expect(presetById("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, watch fail, implement**

Each preset is `{ id, label, describes, conditions, proposerOverrides?, addonCodes?, warning? }`. Build them from the six scenarios in `tf-api/scripts/hdfc-uat-issuance.ts` — same vehicle (Swift `12798`, RTO `10406`), same policy shapes, same dates relative to today. The `break-in` preset sets `isPreviousPolicyExpired: true` with an expiry 3 days back and carries a `warning` explaining that HDFC will quote it but refuse the proposal with `Break-in ID required`, because its kit ships no endpoint that issues one.

- [ ] **Step 3: Green, then commit**

```bash
cd tf-web && npx vitest run src/features/hdfc-uat && npm run typecheck
git add tf-web/src/features/hdfc-uat
git commit -m "feat(hdfc-uat): certification presets matching the six bound scenarios"
```

---

## Task 5: Category, vehicle and plans pages

**Files:**
- Create/replace the stubs: `pages/hdfc-category-page.tsx`, `pages/hdfc-vehicle-page.tsx`, `pages/hdfc-plans-page.tsx`
- Create: `components/condition-fields.tsx`
- Create: `tf-web/src/features/hdfc-uat/__tests__/hdfc-plans-page.test.tsx`

Mirror `fg-category-page.tsx`, `fg-vehicle-page.tsx`, `fg-plans-page.tsx` and `fg-uat/components/condition-fields.tsx`. Reuse `useProviders`, `useMmvSearch`, `useRtoSearch`, `useCompareQuotesQuery`, `useProviderAddons` from `../../vehicle/api/hooks`, and the shared presentational components from `features/vehicle/components/` (`quote-card`, `addon-selector`, `premium-breakdown`, `idv-control`, `inspection-card`) rather than writing new ones.

Specifics for this journey:
- The category page shows only what `hdfcCategories()` returns — one tile, Private Car.
- The vehicle page renders the preset picker plus `condition-fields`. It must expose everything in `HdfcConditions`, including `isUsedVehiclePurchase`, `tenureYears`, the accessory/bi-fuel sums and the previous-TP block (the last shown only for `standAloneOD`).
- **Nominee relation must be a select** populated from HDFC's RELATION MASTER, not a free-text input. The 24 values are in `tf-api/src/providers/hdfc/config.ts` as `HDFC_RELATION_MASTER`; duplicate the list here with a comment pointing at that constant as the source of truth (tf-web cannot import from tf-api).
- The plans page renders the HDFC quote card(s) and the raw-exchange drawer.
- When a preset carries a `warning`, show it prominently before the tester fires the request.
- Dates must display as **dd/mm/yyyy** and use the shared `DateInput` component, never `<input type="date">`.

- [ ] **Step 1: Write the failing route test**

`__tests__/hdfc-plans-page.test.tsx` — this is the test that proves the requirement. Follow the MSW setup used by the existing tf-web tests (`src/features/vehicle/__tests__/` and `src/test/` for handlers/setup):

```tsx
// Intercept the compare call, assert we asked ONLY for HDFC, and assert that a
// response containing another insurer renders no card for it.
```

Assert three things:
1. the outgoing compare request body has `providers: ["hdfc"]`;
2. an HDFC result renders its card;
3. a response that ALSO contains an `icici` result renders **no** ICICI card — the provider lock is proven, not assumed.

- [ ] **Step 2: Run, watch fail, implement the three pages**

- [ ] **Step 3: Verify**

```bash
cd tf-web
npx vitest run src/features/hdfc-uat
npm run typecheck
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add tf-web/src/features/hdfc-uat
git commit -m "feat(hdfc-uat): category, vehicle and HDFC-only plans pages"
```

---

## Task 6: Proposal and e-KYC pages

**Files:**
- Create/replace: `pages/hdfc-proposal-page.tsx`, `pages/hdfc-kyc-page.tsx`

Mirror `fg-proposal-page.tsx` and `fg-kyc-page.tsx`.

Differences that matter:
- **e-KYC:** HDFC uses Pehchaan via `useCkyc()` against provider `hdfc`. Plan 1 proved UAT verifies a PAN **headlessly** — `isKycSuccess: true` with a `kycId`, no redirect — so the happy path is a direct verification, and the redirect branch (`requiresRedirect`/`redirectUrl`) is the fallback. Handle both; the redirect returns to `/hdfc/kyc` with a `kycId` query parameter which is fed back as `ckycNumber`.
- **Do NOT offer OVD upload.** HDFC's backend `initiateOvd` throws `NOT_IMPLEMENTED` — documents are captured inside Pehchaan's own journey. The FG page has an OVD tab; the HDFC page must not.
- Show the KYC-returned name and DOB, and note on the page that HDFC's UAT returns a pooled test identity that need not match the PAN submitted (Plan 1 finding, recorded in `tf-api/docs/hdfc-integration-notes.md`). The proposal uses the KYC record's identity.

- [ ] **Step 1: Implement both pages**
- [ ] **Step 2: Verify** — `npx vitest run src/features/hdfc-uat && npm run typecheck && npm run lint`
- [ ] **Step 3: Commit**

```bash
git add tf-web/src/features/hdfc-uat
git commit -m "feat(hdfc-uat): proposal and Pehchaan e-KYC pages"
```

---

## Task 7: Review, payment and success — issuance

**Files:**
- Modify: `tf-web/src/features/vehicle/api/vehicle-api.ts`
- Modify: `tf-web/src/features/vehicle/api/hooks.ts`
- Create/replace: `pages/hdfc-review-page.tsx`, `pages/hdfc-payment-page.tsx`, `pages/hdfc-success-page.tsx`
- Create: `tf-web/src/features/hdfc-uat/__tests__/issue-policy.test.ts`

This is where HDFC differs most from FG: **no payment gateway.** The review page creates the proposal via `useFullQuote()`; the payment page records a payment and issues via a new `issuePolicy` call.

- [ ] **Step 1: Write the failing test for `issuePolicy`**

Assert it POSTs to `/{provider}/policy/issue`, sends `quoteNo` (HDFC's proposal number), `clientId`, `transactionId`, `vehicleCategory` and a `receipt`, and returns the `policyNumber` from the envelope. Use the MSW setup the other `vehicle/api` tests use.

- [ ] **Step 2: Implement `issuePolicy` + `useIssuePolicy`**

In `vehicle-api.ts`, following the shape of the neighbouring functions:

```ts
export async function issuePolicy(
  provider: string,
  req: PolicyIssuanceRequest,
): Promise<PolicyIssuanceResult> {
  const { data } = await vendorClient.post<ApiEnvelope<PolicyIssuanceResult>>(
    `/${provider}/policy/issue`,
    req,
  );
  return data.response;
}
```

Take `PolicyIssuanceRequest`/`PolicyIssuanceResult` from the generated vendor types (`src/lib/api/generated/vendor-api.d.ts`) via `features/vehicle/api/types.ts`, exactly as the other request types are taken. Add `useIssuePolicy` as a mutation hook beside the existing ones.

- [ ] **Step 3: Build the three pages**

- **Review** — shows the priced quote and every condition, then calls `useFullQuote()` with `buildHdfcFullQuoteRequest(...)`, storing `proposalNumber` from `contractDetails.proposalNumber`. Surface HDFC's verbatim error on failure; do not wrap it in a generic message.
- **Payment** — HDFC records an already-collected payment, so the form collects the receipt fields (`tranRefNo`, `tranRefNoDate`, `pgType`, `amount`). **`amount` must default to the proposal's premium and be shown as such**, because HDFC re-rates at issuance and a mismatch is rejected. Then `useIssuePolicy()`.
- **Success** — shows the bound policy number and the proposal number, with a link to fetch the certificate via the existing certificate route.

- [ ] **Step 4: Verify**

```bash
cd tf-web
npx vitest run          # the whole tf-web suite must stay green
npm run typecheck
npm run lint
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add tf-web/src/features/hdfc-uat tf-web/src/features/vehicle/api
git commit -m "feat(hdfc-uat): review, payment and issuance to a bound policy"
```

---

## Task 8: Drive it end to end against live UAT

- [ ] **Step 1: Start the stack**

```bash
./dev-up.ps1
```
Backend `http://localhost:4000/api/v1`, frontend `http://localhost:8080`. `HDFC_ENABLED=true` must be set in `tf-api/.env` (it is).

- [ ] **Step 2: Walk the journey**

Open `http://localhost:8080/hdfc`, load the `rollover-bare` preset, and go through to a bound policy. **This binds a real UAT policy** — that is the point, and it is authorized, but do it once per scenario, not repeatedly.

- [ ] **Step 3: Confirm the provider lock in the browser**

With devtools open, check the `/motor/quotes/compare` request body carries `providers: ["hdfc"]` and that only HDFC cards render.

- [ ] **Step 4: Record the result**

Append a short section to `tf-api/docs/hdfc-uat-issuance-results.md` recording that the same scenarios were driven through the `/hdfc` UI, with the policy numbers obtained. Keep the existing script-run table intact.

- [ ] **Step 5: Commit**

```bash
git add tf-api/docs/hdfc-uat-issuance-results.md
git commit -m "docs(hdfc): policies bound through the /hdfc journey"
```

---

## Done when

- `/hdfc` walks category → vehicle → plans → proposal → kyc → review → payment → success.
- The compare request sends `providers: ["hdfc"]`, and a non-HDFC result in the response renders no card — proven by test, not assumption.
- Every certification condition is expressible from the vehicle page, and the six presets load.
- A real UAT policy has been bound through the browser.
- `npx vitest run`, `npm run typecheck`, `npm run lint` and `npm run build` are all clean in `tf-web`.
- The break-in preset warns the tester up front instead of failing opaquely.

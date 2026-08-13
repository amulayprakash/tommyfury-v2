# FG UAT Certification Journey (`/fg`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Generali Central's integration team a self-contained journey at `/fg` that drives quote → CKYC → proposal → payment → policy number against FG UAT, with every certification condition editable and every vendor exchange visible.

**Architecture:** A new isolated feature folder `tf-web/src/features/fg-uat/` with its own routes, Zustand store and pages, reusing the existing `vendorClient` API hooks, canonical contracts and shared components. The customer wizard is not touched. One small `tf-api` change adds an opt-in raw request/response echo so the harness can show FG their own payloads.

**Tech Stack:** React 19, React Router 7, TanStack Query, Zustand, Tailwind v4, vitest. Backend: Express + TypeScript + zod contracts.

**Spec:** `docs/superpowers/specs/2026-08-07-fg-uat-journey-design.md`

---

## File Structure

**tf-api (one change only)**
- Modify `src/contracts/quote-request.ts` — add optional `includeRawExchange` flag
- Modify `src/providers/fg/fg.provider.ts` — attach `_rawResponse` when the flag is set
- Modify `src/providers/fg/__tests__/` — tests for the above
- Regenerate `openapi/openapi.json`

**tf-web (new feature)**
- `src/features/fg-uat/fg-capabilities.ts` — derive categories + plan types from the provider payload (pure)
- `src/features/fg-uat/test-presets.ts` — the 37 certification cases as form state (pure)
- `src/features/fg-uat/fg-uat-store.ts` — journey state, persisted under its own key
- `src/features/fg-uat/components/raw-exchange.tsx` — collapsible request/response drawer
- `src/features/fg-uat/components/condition-fields.tsx` — grouped policy-condition inputs
- `src/features/fg-uat/pages/` — `category`, `vehicle`, `plans`, `proposal`, `kyc`, `review`, `payment`, `success`
- `src/features/fg-uat/__tests__/` — tests for the two pure modules
- Modify `src/app/router/paths.ts` and `src/app/router/routes.tsx`

Pure logic lives in `fg-capabilities.ts` and `test-presets.ts` so it is unit-testable without rendering. Pages stay thin.

---

## Task 1: Opt-in raw exchange on the FG contract

**Files:**
- Modify: `tf-api/src/contracts/quote-request.ts`
- Test: `tf-api/src/providers/fg/__tests__/mapper.test.ts`

Vendor payloads carry agent codes, branch codes and internal identifiers. The flag keeps default responses byte-identical so only this harness receives them.

- [ ] **Step 1: Write the failing test**

Append to `tf-api/src/providers/fg/__tests__/mapper.test.ts`:

```typescript
describe("includeRawExchange flag", () => {
  it("is accepted on a motor quote request and defaults to undefined", () => {
    const withFlag = MotorQuoteRequestSchema.parse({
      ...baseQuote(),
      includeRawExchange: true,
    });
    expect(withFlag.includeRawExchange).toBe(true);
    expect(baseQuote().includeRawExchange).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/mapper.test.ts -t "includeRawExchange"`
Expected: FAIL — `expected undefined to be true` (zod strips the unknown key).

- [ ] **Step 3: Add the field to the contract**

In `tf-api/src/contracts/quote-request.ts`, inside the object passed to the motor quote schema (alongside `providerAddonCodes`):

```typescript
  /**
   * Echo the raw vendor request/response back on the result. Off by default —
   * vendor payloads carry agent/branch codes that the customer journey has no
   * reason to ship to a browser. Set only by the FG UAT certification harness.
   */
  includeRawExchange: z.boolean().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/mapper.test.ts -t "includeRawExchange"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/contracts/quote-request.ts tf-api/src/providers/fg/__tests__/mapper.test.ts
git commit -m "feat(fg): opt-in raw exchange flag on the motor quote contract"
```

---

## Task 2: Populate the raw exchange in FgProvider

**Files:**
- Modify: `tf-api/src/providers/fg/fg.provider.ts` (`getQuote` ~line 234, `getFullQuote` ~line 255)
- Test: `tf-api/src/providers/fg/__tests__/fg-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create or append to `tf-api/src/providers/fg/__tests__/fg-provider.test.ts`. Use the existing fixture-transport pattern from the sibling provider tests in this folder — a fake `FgTransport` returning a recorded quote fixture:

```typescript
import { describe, it, expect } from "vitest";
import { FgProvider } from "../fg.provider.ts";
import { loadFgConfig } from "../config.ts";
import { passthroughCodeResolver } from "../db-code-resolver.ts";
import quoteFixture from "../fixtures/get-quote.json";
import { MotorQuoteRequestSchema } from "@/contracts/quote-request.ts";

const transport = { request: async () => quoteFixture };
const provider = () =>
  new FgProvider({
    config: loadFgConfig(),
    codeResolver: passthroughCodeResolver,
    transport,
    tokenProvider: async () => "test-token",
  });

const req = (over = {}) =>
  MotorQuoteRequestSchema.parse({
    vehicleType: "fourWheeler", selectedPolicy: "comprehensive", businessType: "rollover",
    makeId: "HONDA", makeName: "Honda", modelId: "HO0002", modelName: "City",
    fuelType: "petrol", rtoCode: "MH01", registrationDate: "2020-03-30",
    engineCC: 1298, ...over,
  });

describe("raw exchange echo", () => {
  it("omits _rawResponse by default", async () => {
    const r = await provider().getQuote(req(), { requestId: "t1" });
    expect(r._rawResponse).toBeUndefined();
  });

  it("returns the request and response when includeRawExchange is set", async () => {
    const r = await provider().getQuote(req({ includeRawExchange: true }), { requestId: "t2" });
    const raw = r._rawResponse as { request: unknown; response: unknown };
    expect(raw.response).toEqual(quoteFixture);
    expect(raw.request).toMatchObject({ PolicyHeader: { METHOD: "ENQ" } });
  });
});
```

If `src/providers/fg/fixtures/get-quote.json` does not exist, use whichever quote fixture the existing FG tests import — check `src/providers/fg/fixtures/` and adjust the import path and name to match.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/fg-provider.test.ts -t "raw exchange"`
Expected: FAIL — `expected undefined to have property 'response'`.

- [ ] **Step 3: Attach the exchange in getQuote**

In `tf-api/src/providers/fg/fg.provider.ts`, replace the `return normalizeQuote(...)` at the end of `getQuote`:

```typescript
    const result = normalizeQuote(body, {
      requestId: ctx.requestId,
      policyType: req.selectedPolicy,
      vehicleCategory: req.vehicleType,
    });
    // Certification harness only — see contracts/quote-request.ts.
    return req.includeRawExchange
      ? { ...result, _rawResponse: { request: payload, response: body } }
      : result;
```

- [ ] **Step 4: Apply the same to getFullQuote**

In `getFullQuote`, find the `normalizeProposal(...)` return and wrap it identically, using that method's own `payload` and `body` locals:

```typescript
    return req.includeRawExchange
      ? { ...result, _rawResponse: { request: payload, response: body } }
      : result;
```

Assign the `normalizeProposal(...)` call to `const result` first if it is currently returned directly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/fg/ && npm run typecheck && npx eslint src/providers/fg/fg.provider.ts`
Expected: all PASS, typecheck and lint clean.

- [ ] **Step 6: Regenerate the API contract**

```bash
cd tf-api && npm run openapi:gen
cd ../tf-web && npm run gen:api && npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add tf-api/src/providers/fg/ tf-api/openapi/openapi.json tf-web/src/lib/api/generated/
git commit -m "feat(fg): echo raw vendor exchange when the harness asks for it"
```

---

## Task 2b: Let the raw exchange survive the compare path

**Files:**
- Modify: `tf-api/src/controllers/compare.controller.ts`
- Test: `tf-api/src/controllers/__tests__/compare.controller.test.ts`

Discovered during Task 2. `stripRaw` deletes `_rawResponse` from every compare result
unconditionally, so the plans page would receive nothing however the provider behaves.
Two gates are required — the request flag for intent, `ENABLE_DEBUG_PAYLOAD` for
deployment permission (the control `quote.controller.ts` already applies to this data).

- [ ] **Step 1: Write the failing test**

Assert three behaviours against `handleCompareQuotes` with a stubbed `compareQuotes`
returning a result whose `quote._rawResponse` is set:

1. no flag → response results carry no `_rawResponse`
2. `includeRawExchange: true` **and** `ENABLE_DEBUG_PAYLOAD` on → `_rawResponse` present
3. `includeRawExchange: true` but `ENABLE_DEBUG_PAYLOAD` off → still stripped

- [ ] **Step 2: Run it and confirm case 2 fails**

Run: `cd tf-api && npx vitest run src/controllers/__tests__/compare.controller.test.ts`
Expected: case 2 FAILS (`_rawResponse` undefined); cases 1 and 3 already pass.

- [ ] **Step 3: Make the strip conditional**

```typescript
    const keepRaw = Boolean(quoteReq.includeRawExchange) && env.ENABLE_DEBUG_PAYLOAD;
    const sanitized = keepRaw
      ? results
      : results.map((r) => (r.quote ? { ...r, quote: stripRaw(r.quote) } : r));
```

Import `env` from `@/config/env.ts`. Update `stripRaw`'s doc comment to say it is skipped
only when the caller opted in and the deployment permits it.

- [ ] **Step 4: Confirm it passes**

Run: `cd tf-api && npx vitest run src/controllers/ && npm test && npm run typecheck && npx eslint src/controllers/compare.controller.ts`
Expected: all pass, typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/controllers/
git commit -m "feat(fg): let an opted-in caller keep the raw exchange through compare"
```

---

## Task 3: Derive FG categories and plan types

**Files:**
- Create: `tf-web/src/features/fg-uat/fg-capabilities.ts`
- Test: `tf-web/src/features/fg-uat/__tests__/fg-capabilities.test.ts`

`GET /providers` already returns `capabilities` and `motorCapabilities` per provider, so nothing is hard-coded. FG has no two-wheeler today; if its master ever gains one the tile appears on its own.

- [ ] **Step 1: Write the failing test**

Create `tf-web/src/features/fg-uat/__tests__/fg-capabilities.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { fgCategories, fgPlanTypes, CATEGORY_LABELS } from "../fg-capabilities";

const fg = {
  slug: "fg",
  displayName: "Future Generali",
  capabilities: ["fourWheeler", "commercial", "newCommercial"],
  operations: ["quote", "proposal", "issuance"],
  motorCapabilities: {
    fourWheeler: { policyTypes: ["comprehensive", "standAloneOD"], addons: [] },
    commercial: { policyTypes: ["comprehensive", "thirdParty"], addons: [] },
    newCommercial: { policyTypes: ["comprehensive", "thirdParty"], addons: [] },
  },
} as never;

describe("fgCategories", () => {
  it("lists the categories FG declares, in journey order", () => {
    expect(fgCategories(fg)).toEqual(["fourWheeler", "commercial", "newCommercial"]);
  });

  it("omits two-wheeler because FG does not declare it", () => {
    expect(fgCategories(fg)).not.toContain("twoWheeler");
  });

  it("includes two-wheeler if FG ever declares it", () => {
    const withTw = { ...fg, capabilities: [...fg.capabilities, "twoWheeler"] } as never;
    expect(fgCategories(withTw)).toContain("twoWheeler");
  });

  it("returns nothing when the provider is absent", () => {
    expect(fgCategories(undefined)).toEqual([]);
  });
});

describe("fgPlanTypes", () => {
  it("returns the plan types declared for a category", () => {
    expect(fgPlanTypes(fg, "fourWheeler")).toEqual(["comprehensive", "standAloneOD"]);
  });

  it("excludes third party for private car (blocked for this channel)", () => {
    expect(fgPlanTypes(fg, "fourWheeler")).not.toContain("thirdParty");
  });

  it("returns an empty list for a category FG does not sell", () => {
    expect(fgPlanTypes(fg, "twoWheeler")).toEqual([]);
  });
});

describe("CATEGORY_LABELS", () => {
  it("has a human label for every category FG declares", () => {
    for (const c of fgCategories(fg)) expect(CATEGORY_LABELS[c]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tf-web && npx vitest run src/features/fg-uat/__tests__/fg-capabilities.test.ts`
Expected: FAIL — cannot resolve `../fg-capabilities`.

- [ ] **Step 3: Write the implementation**

Create `tf-web/src/features/fg-uat/fg-capabilities.ts`:

```typescript
import type { ProviderInfo } from "../vehicle/api/vehicle-api";

/**
 * Categories and plan types for the FG certification harness, read from the
 * provider's own declared capabilities rather than hard-coded.
 *
 * FG declares fourWheeler, commercial and newCommercial — there is no two-wheeler
 * capability and no 2W row in its master, so no tile is rendered for it. Third
 * party is absent for private car by design: GCI blocks standalone TP for the
 * web-aggregator channel, so it was removed from FG_MOTOR_CAPABILITIES.
 */

/** Journey order — the order testers see the tiles in. */
const ORDER = ["twoWheeler", "fourWheeler", "commercial", "newCommercial"] as const;

export type FgCategory = (typeof ORDER)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  twoWheeler: "Two Wheeler",
  fourWheeler: "Private Car",
  commercial: "Commercial Vehicle",
  newCommercial: "New Commercial Vehicle",
};

/** Categories FG declares, in journey order. */
export function fgCategories(provider: ProviderInfo | undefined): string[] {
  if (!provider) return [];
  const declared = new Set(provider.capabilities);
  return ORDER.filter((c) => declared.has(c));
}

/** Plan types FG declares for one category ([] when it does not sell it). */
export function fgPlanTypes(provider: ProviderInfo | undefined, category: string): string[] {
  const motor = provider?.motorCapabilities as
    | Record<string, { policyTypes?: string[] } | undefined>
    | undefined;
  return motor?.[category]?.policyTypes ?? [];
}
```

If `ProviderInfo` does not already expose `capabilities` and `motorCapabilities`, widen it in `tf-web/src/features/vehicle/api/vehicle-api.ts` to match the `/providers` payload before continuing.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tf-web && npx vitest run src/features/fg-uat/__tests__/fg-capabilities.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add tf-web/src/features/fg-uat/
git commit -m "feat(fg-uat): derive categories and plan types from FG capabilities"
```

---

## Task 4: The fg-uat store

**Files:**
- Create: `tf-web/src/features/fg-uat/fg-uat-store.ts`

Persisted under its own key so a tester cannot collide with a live customer session held in `vehicle-quote-store`.

- [ ] **Step 1: Write the store**

Create `tf-web/src/features/fg-uat/fg-uat-store.ts`:

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { CanonicalQuote } from "../vehicle/api/types";

/** Everything the 37 certification cases need to vary, in one flat object. */
export interface FgConditions {
  // vehicle
  makeId: string; makeName: string; modelId: string; modelName: string;
  variantId?: string; variantName?: string;
  fuelType: string; engineCC?: number;
  rtoCode: string; registrationNumber: string; registrationDate: string;
  engineNumber: string; chassisNumber: string;
  // business
  businessType: "new" | "rollover" | "renewal";
  planType: string;
  idvValue?: number;
  // previous policy
  previousInsurerName: string; previousPolicyNumber: string;
  previousPolicyStartDate?: string; previousPolicyExpiryDate?: string;
  isPreviousPolicyExpired: boolean;
  // previous TP (standalone OD only)
  previousTpPolicyNumber?: string; previousTpStartDate?: string; previousTpExpiryDate?: string;
  // ncb & claims
  ncbPercent: number; claimInPreviousPolicy: boolean;
  // break-in
  inspectionReportNumber?: string; inspectionDate?: string;
  // commercial only
  commercialSubType?: "goods" | "passenger";
  grossVehicleWeight?: number; seatingCapacity?: number; carryingCapacity?: number;
}

export interface FgProposer {
  firstName: string; lastName: string; email: string; mobile: string;
  dob: string; gender: "M" | "F"; panNumber: string;
  addressLine1: string; addressLine2: string; pincode: string; city: string; state: string;
  nomineeName: string; nomineeRelation: string; nomineeAge: number;
}

/** One recorded vendor call, for the raw-exchange drawer. */
export interface FgExchange {
  step: string;
  at: string;
  request: unknown;
  response: unknown;
}

interface FgUatState {
  category: string | null;
  presetId: string | null;
  conditions: FgConditions | null;
  proposer: FgProposer;
  providerAddonCodes: string[];
  quote: CanonicalQuote | null;
  ckyc: string | null;
  kycRefId: string | null;
  proposal: CanonicalQuote | null;
  policyNo: string | null;
  exchanges: FgExchange[];

  setCategory: (c: string) => void;
  setPreset: (id: string | null) => void;
  setConditions: (c: FgConditions) => void;
  setProposer: (p: FgProposer) => void;
  setAddonCodes: (codes: string[]) => void;
  setQuote: (q: CanonicalQuote | null) => void;
  setCkyc: (ckyc: string | null, ref: string | null) => void;
  setProposal: (p: CanonicalQuote | null) => void;
  setPolicyNo: (n: string | null) => void;
  recordExchange: (e: FgExchange) => void;
  reset: () => void;
}

/**
 * Prefilled with the identity proven to clear FG's client creation:
 * PAN DHQPG4064J, and a non-sequential mobile — FG's CreateProposal rejects
 * 9876543210 with "Mobile number is missing or invalid for the entered client".
 */
const DEFAULT_PROPOSER: FgProposer = {
  firstName: "Rahul", lastName: "Sharma",
  email: "rahul.sharma@tommyandfurry.com", mobile: "9822012345",
  dob: "1990-05-15", gender: "M", panNumber: "DHQPG4064J",
  addressLine1: "1204 Trade Centre, Bandra Kurla Complex", addressLine2: "Bandra East",
  pincode: "400051", city: "Mumbai", state: "Maharashtra",
  nomineeName: "Sunita Sharma", nomineeRelation: "spouse", nomineeAge: 34,
};

const initial = {
  category: null, presetId: null, conditions: null,
  proposer: DEFAULT_PROPOSER, providerAddonCodes: [] as string[],
  quote: null, ckyc: null, kycRefId: null, proposal: null,
  policyNo: null, exchanges: [] as FgExchange[],
};

export const useFgUatStore = create<FgUatState>()(
  persist(
    (set) => ({
      ...initial,
      setCategory: (category) => set({ category }),
      setPreset: (presetId) => set({ presetId }),
      setConditions: (conditions) => set({ conditions }),
      setProposer: (proposer) => set({ proposer }),
      setAddonCodes: (providerAddonCodes) => set({ providerAddonCodes }),
      setQuote: (quote) => set({ quote }),
      setCkyc: (ckyc, kycRefId) => set({ ckyc, kycRefId }),
      setProposal: (proposal) => set({ proposal }),
      setPolicyNo: (policyNo) => set({ policyNo }),
      recordExchange: (e) => set((s) => ({ exchanges: [...s.exchanges, e] })),
      reset: () => set(initial),
    }),
    { name: "fg-uat-journey" },
  ),
);

export { DEFAULT_PROPOSER };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd tf-web && npm run typecheck`
Expected: clean. If `CanonicalQuote` is not exported from `../vehicle/api/types`, import it from wherever `vehicle-quote-store.ts` imports it.

- [ ] **Step 3: Commit**

```bash
git add tf-web/src/features/fg-uat/fg-uat-store.ts
git commit -m "feat(fg-uat): journey store, persisted separately from the customer wizard"
```

---

## Task 5: Routes and the category picker

**Files:**
- Modify: `tf-web/src/app/router/paths.ts`
- Modify: `tf-web/src/app/router/routes.tsx`
- Create: `tf-web/src/features/fg-uat/pages/fg-category-page.tsx`

- [ ] **Step 1: Add the paths**

In `tf-web/src/app/router/paths.ts`, add a new top-level group beside `vehicle` (do not touch the legacy `vehicle` paths):

```typescript
  /** FG UAT certification harness — see docs/superpowers/specs/2026-08-07-fg-uat-journey-design.md */
  fgUat: {
    start: "/fg",
    vehicle: "/fg/vehicle",
    plans: "/fg/plans",
    proposal: "/fg/proposal",
    kyc: "/fg/kyc",
    review: "/fg/review",
    payment: "/fg/payment",
    success: "/fg/success",
  },
```

- [ ] **Step 2: Write the category page**

Create `tf-web/src/features/fg-uat/pages/fg-category-page.tsx`:

```tsx
import { useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProviders } from "../../vehicle/api/hooks";
import { CATEGORY_LABELS, fgCategories } from "../fg-capabilities";
import { useFgUatStore } from "../fg-uat-store";

export function FgCategoryPage() {
  const navigate = useNavigate();
  const providers = useProviders();
  const setCategory = useFgUatStore((s) => s.setCategory);
  const reset = useFgUatStore((s) => s.reset);

  const fg = providers.data?.find((p) => p.slug === "fg");
  const categories = fgCategories(fg);

  const choose = (category: string) => {
    reset();
    setCategory(category);
    void navigate(ROUTES.fgUat.vehicle);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Future Generali — UAT testing</h1>
        <p className="text-sm text-muted-foreground">
          Certification journey: quote → CKYC → proposal → payment → policy number.
        </p>
      </div>

      {providers.isPending ? (
        <p className="text-sm text-muted-foreground">Loading Future Generali capabilities…</p>
      ) : !fg ? (
        <p className="text-sm text-destructive">
          Future Generali is not registered. Check FG_ENABLED on the backend.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((c) => (
            <Card key={c}>
              <CardHeader>
                <CardTitle className="text-base">{CATEGORY_LABELS[c] ?? c}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button className="w-full" onClick={() => choose(c)}>
                  Start
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Only the categories Future Generali sells are shown. Two-wheeler is not offered by
        this insurer.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Mount the routes**

In `tf-web/src/app/router/routes.tsx`, inside the same `ProtectedRoute` block the vehicle wizard uses, add:

```tsx
        { path: ROUTES.fgUat.start, element: <FgCategoryPage /> },
        { path: ROUTES.fgUat.vehicle, element: <FgVehiclePage /> },
        { path: ROUTES.fgUat.plans, element: <FgPlansPage /> },
        { path: ROUTES.fgUat.proposal, element: <FgProposalPage /> },
        { path: ROUTES.fgUat.kyc, element: <FgKycPage /> },
        { path: ROUTES.fgUat.review, element: <FgReviewPage /> },
        { path: ROUTES.fgUat.payment, element: <FgPaymentPage /> },
        { path: ROUTES.fgUat.success, element: <FgSuccessPage /> },
```

Add the imports at the top. Until later tasks create them, temporarily point the seven not-yet-written routes at `<FgCategoryPage />` so the app compiles; each later task swaps in its real page.

- [ ] **Step 4: Verify**

Run: `cd tf-web && npm run typecheck && npm run lint`
Expected: clean. Then `npm run dev` and open `http://localhost:8080/fg` — three tiles: Private Car, Commercial Vehicle, New Commercial Vehicle. No two-wheeler tile.

- [ ] **Step 5: Commit**

```bash
git add tf-web/src/app/router/ tf-web/src/features/fg-uat/pages/
git commit -m "feat(fg-uat): /fg routes and capability-driven category picker"
```

---

## Task 6: Test-case presets

**Files:**
- Create: `tf-web/src/features/fg-uat/test-presets.ts`
- Test: `tf-web/src/features/fg-uat/__tests__/test-presets.test.ts`

Presets are editable starting points, not fixtures. FG's decline list changes week to week, so a tester must be able to substitute a vehicle.

- [ ] **Step 1: Write the failing test**

Create `tf-web/src/features/fg-uat/__tests__/test-presets.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { FG_TEST_PRESETS, applyPreset } from "../test-presets";

const base = {
  makeId: "", makeName: "", modelId: "", modelName: "", fuelType: "petrol",
  rtoCode: "", registrationNumber: "", registrationDate: "", engineNumber: "",
  chassisNumber: "", businessType: "rollover" as const, planType: "comprehensive",
  previousInsurerName: "", previousPolicyNumber: "", isPreviousPolicyExpired: false,
  ncbPercent: 0, claimInPreviousPolicy: false,
};

describe("FG_TEST_PRESETS", () => {
  it("covers every certification case with a unique id and label", () => {
    const ids = FG_TEST_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of FG_TEST_PRESETS) expect(p.label.length).toBeGreaterThan(0);
  });
});

describe("applyPreset", () => {
  it("sets a break-in scenario as an expired previous policy", () => {
    const out = applyPreset(base, "TC_16");
    expect(out.isPreviousPolicyExpired).toBe(true);
    expect(out.businessType).toBe("rollover");
  });

  it("zeroes NCB when the case has a claim in the previous policy", () => {
    const out = applyPreset(base, "TC_21");
    expect(out.claimInPreviousPolicy).toBe(true);
    expect(out.ncbPercent).toBe(0);
  });

  it("selects standalone OD for the standalone-OD case", () => {
    expect(applyPreset(base, "TC_02").planType).toBe("standAloneOD");
  });

  it("selects new business for the new-car case", () => {
    expect(applyPreset(base, "TC_01").businessType).toBe("new");
  });

  it("leaves conditions untouched for an unknown id", () => {
    expect(applyPreset(base, "NOPE")).toEqual(base);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tf-web && npx vitest run src/features/fg-uat/__tests__/test-presets.test.ts`
Expected: FAIL — cannot resolve `../test-presets`.

- [ ] **Step 3: Write the presets**

Create `tf-web/src/features/fg-uat/test-presets.ts`.

This is the **complete** preset list. Only certification cases that vary *journey
conditions* get a preset. The others need none and must not have one:

- **TC_33–TC_36** (anti-theft, geographical area, AAI, restricted TPPD) verify those covers
  are *absent from FG's add-on catalog* — nothing on this form changes.
- **TC_26, TC_27, TC_28, TC_31, TC_32** (declined model, declined RTO, blacklisted and
  duplicate registrations) are driven by *which vehicle or plate the tester types*, not by
  a condition flag. The relevant plates are listed on the vehicle page as hint text.
- **TC_05, TC_09** (electric, CNG/LPG) are driven by the fuel of the chosen vehicle.
- **TC_08, TC_10–TC_12, TC_23** (accessories, unnamed PA, standalone add-ons) are driven by
  add-on selection on the next page.

A preset sets only the fields its scenario pins; everything else stays as the tester
entered it.

```typescript
import type { FgConditions } from "./fg-uat-store";

export interface FgTestPreset {
  id: string;
  label: string;
  /** Only the fields this scenario pins. Everything else is left alone. */
  patch: Partial<FgConditions>;
}

/**
 * The FG certification cases as editable starting points. FG's decline list and
 * discount percentages change week to week, so these pin the *conditions* under
 * test, never a specific vehicle — the tester picks a vehicle that quotes today.
 */
export const FG_TEST_PRESETS: FgTestPreset[] = [
  { id: "TC_01", label: "TC_01 — New business (new car) incl. add-ons",
    patch: { businessType: "new", planType: "comprehensive", ncbPercent: 0,
             isPreviousPolicyExpired: false, claimInPreviousPolicy: false } },
  { id: "TC_02", label: "TC_02 — Standalone OD incl. add-ons",
    patch: { businessType: "rollover", planType: "standAloneOD", ncbPercent: 20 } },
  { id: "TC_03", label: "TC_03 — Comprehensive incl. add-ons",
    patch: { businessType: "rollover", planType: "comprehensive", ncbPercent: 20 } },
  { id: "TC_13", label: "TC_13 — NCB on standalone OD (next slab)",
    patch: { businessType: "rollover", planType: "standAloneOD", ncbPercent: 25,
             claimInPreviousPolicy: false } },
  { id: "TC_16", label: "TC_16 — Break-in comprehensive (inspection required)",
    patch: { businessType: "rollover", planType: "comprehensive",
             isPreviousPolicyExpired: true } },
  { id: "TC_18", label: "TC_18 — Break-in > 90 days, NCB denied",
    patch: { businessType: "rollover", planType: "standAloneOD",
             isPreviousPolicyExpired: true, ncbPercent: 0 } },
  { id: "TC_20", label: "TC_20 — Ownership transfer (NCB zero)",
    patch: { businessType: "rollover", planType: "standAloneOD", ncbPercent: 0 } },
  { id: "TC_21", label: "TC_21 — Claim in previous policy (NCB zero)",
    patch: { businessType: "rollover", planType: "comprehensive",
             claimInPreviousPolicy: true, ncbPercent: 0 } },
  { id: "TC_06", label: "TC_06 — CPA cover exclusion (owner-driver)",
    patch: { businessType: "rollover", planType: "comprehensive" } },
  { id: "TC_07", label: "TC_07 — IDV increase / decrease (±20%)",
    patch: { businessType: "new", planType: "comprehensive", ncbPercent: 0 } },
  { id: "TC_14", label: "TC_14 — PUC on rollover standalone OD",
    patch: { businessType: "rollover", planType: "standAloneOD" } },
  { id: "TC_15", label: "TC_15 — Break-in standalone OD",
    patch: { businessType: "rollover", planType: "standAloneOD",
             isPreviousPolicyExpired: true } },
  { id: "TC_17", label: "TC_17 — Break-in third party (inspection waived)",
    patch: { businessType: "rollover", planType: "thirdParty",
             isPreviousPolicyExpired: true } },
  { id: "TC_19", label: "TC_19 — Break-in > 90 days comprehensive, NCB denied",
    patch: { businessType: "rollover", planType: "comprehensive",
             isPreviousPolicyExpired: true, ncbPercent: 0 } },
  { id: "TC_22", label: "TC_22 — Vehicle older than 15 years",
    patch: { businessType: "rollover", planType: "comprehensive" } },
  { id: "TC_24", label: "TC_24 — Discount, new business (CO 1+3)",
    patch: { businessType: "new", planType: "comprehensive", ncbPercent: 0 } },
  { id: "TC_25", label: "TC_25 — Discount, comprehensive rollover (CO 1+1)",
    patch: { businessType: "rollover", planType: "comprehensive", ncbPercent: 20 } },
  { id: "TC_29", label: "TC_29 — Add-on age limit (cover disabled above limit)",
    patch: { businessType: "rollover", planType: "comprehensive" } },
  { id: "TC_30", label: "TC_30 — Advance inception beyond 45 days",
    patch: { businessType: "rollover", planType: "standAloneOD" } },
  { id: "TC_37", label: "TC_37 — CKYC verification failure (wrong PAN / DOB)",
    patch: { businessType: "rollover", planType: "comprehensive" } },
];

/** Apply a preset's patch. Unknown ids are a no-op so the UI never has to guard. */
export function applyPreset(conditions: FgConditions, presetId: string): FgConditions {
  const preset = FG_TEST_PRESETS.find((p) => p.id === presetId);
  return preset ? { ...conditions, ...preset.patch } : conditions;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tf-web && npx vitest run src/features/fg-uat/__tests__/test-presets.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add tf-web/src/features/fg-uat/test-presets.ts tf-web/src/features/fg-uat/__tests__/test-presets.test.ts
git commit -m "feat(fg-uat): certification test-case presets"
```

---

## Task 7: Vehicle and conditions page

**Files:**
- Create: `tf-web/src/features/fg-uat/components/condition-fields.tsx`
- Create: `tf-web/src/features/fg-uat/pages/fg-vehicle-page.tsx`
- Modify: `tf-web/src/app/router/routes.tsx` (swap in the real page)

Reuse the typeahead pattern from `tf-web/src/features/vehicle/pages/new-vehicle-page.tsx` — read it first; it already implements MMV search (first word = make, rest = model) and RTO search with `useMmvSearch` / `useRtoSearch`.

- [ ] **Step 1: Extract the condition field groups**

Create `tf-web/src/features/fg-uat/components/condition-fields.tsx` exporting one small
component per group, each taking `{ conditions, onChange }` where `onChange` receives a
`Partial<FgConditions>`:

`PreviousPolicyFields`, `PreviousTpFields`, `NcbClaimFields`, `BreakInFields`,
`CommercialFields`.

Use `DateInput` (from `@/components/ui/date-input`) for every date so they read and write
dd/mm/yyyy on screen while storing ISO. Keeping these out of the page stops it growing
into a file too large to reason about, and each group can be shown or hidden on its own.

- [ ] **Step 2: Build the page**

Create `tf-web/src/features/fg-uat/pages/fg-vehicle-page.tsx` with:

- A preset `<select>` at the top, bound to `FG_TEST_PRESETS`; on change call `setConditions(applyPreset(conditions, id))` and `setPreset(id)`.
- The MMV typeahead and RTO typeahead copied in structure from `new-vehicle-page.tsx`, writing into `conditions`.
- A plan-type `<select>` populated from `fgPlanTypes(fg, category)`.
- The field groups from Step 1, composed in the spec's order: Vehicle, Business, Previous policy, Previous TP (only when `planType === "standAloneOD"`), NCB & claims, Break-in, Commercial (only when the category is `commercial` or `newCommercial`).
- Hint text listing the plates the certification cases call for: blacklisted `MH02EP6349`, `MH02EE7034`, `MH14DX6896`, `GJ05RB3983`; duplicate `MH01UH5433`, `MH01UH8756`.
- Continue button: writes `conditions` to the store and navigates to `ROUTES.fgUat.plans`. Disabled until make, model, RTO and registration date are set.

Keep it presentational — no request building here.

- [ ] **Step 3: Verify**

Run: `cd tf-web && npm run typecheck && npm run lint`
Expected: clean. Then at `/fg` choose Private Car, confirm: the Previous TP group appears only when Standalone OD is selected, the Commercial group does not appear, and picking preset TC_16 ticks "previous policy expired".

- [ ] **Step 4: Commit**

```bash
git add tf-web/src/features/fg-uat/components/ tf-web/src/features/fg-uat/pages/fg-vehicle-page.tsx tf-web/src/app/router/routes.tsx
git commit -m "feat(fg-uat): vehicle and policy-condition entry"
```

---

## Task 8: Raw exchange drawer

**Files:**
- Create: `tf-web/src/features/fg-uat/components/raw-exchange.tsx`

- [ ] **Step 1: Write the component**

Create `tf-web/src/features/fg-uat/components/raw-exchange.tsx`:

```tsx
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { FgExchange } from "../fg-uat-store";

/**
 * Shows the actual request and response for a vendor call. This is the highest-value
 * element of the harness: on failure GCI sees their own payload immediately instead
 * of asking us for logs.
 */
export function RawExchange({ exchanges }: { exchanges: FgExchange[] }) {
  const [open, setOpen] = useState(false);
  if (exchanges.length === 0) return null;

  const copy = () => {
    void navigator.clipboard.writeText(JSON.stringify(exchanges, null, 2));
  };

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between p-3">
        <button
          type="button"
          className="text-sm font-medium underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Show"} raw request / response ({exchanges.length})
        </button>
        {open ? (
          <Button variant="outline" size="sm" onClick={copy}>
            Copy JSON
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-4 border-t p-3">
          {exchanges.map((e, i) => (
            <div key={`${e.step}-${i}`} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {e.step} · {e.at}
              </p>
              <div>
                <p className="text-xs font-medium">Request</p>
                <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(e.request, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-xs font-medium">Response</p>
                <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(e.response, null, 2)}
                </pre>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `cd tf-web && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add tf-web/src/features/fg-uat/components/raw-exchange.tsx
git commit -m "feat(fg-uat): raw vendor request/response drawer"
```

---

## Task 9: Plans page

**Files:**
- Create: `tf-web/src/features/fg-uat/pages/fg-plans-page.tsx`
- Modify: `tf-web/src/app/router/routes.tsx`

- [ ] **Step 1: Build the page**

Create `tf-web/src/features/fg-uat/pages/fg-plans-page.tsx`:

- Build a `CompareQuotesRequest` from `conditions`, with `providers: ["fg"]`, `includeRawExchange: true` and `providerAddonCodes` from the store.
- Call `useCompareQuotesQuery` (from `../../vehicle/api/hooks`).
- Fetch the add-on catalog with `useProviderAddons("fg", category, fuelClass, true)`; drive selection through `toggleAddonSelection` / `isAddonSelectable` from `../../vehicle/addon-selection` so the one-combo and zero-dep rules apply here too.
- Premium panel showing OD, TP, each entry of `quote.addonPremiums`, discounts, gross **and `odDiscountPercent`** — label it "OD special discount %" with a note that above roughly 40% FG's underwriting rejects the proposal.
- On a successful result call `recordExchange({ step: "GetQuote", at: new Date().toISOString(), request: <the request>, response: result.quote?._rawResponse ?? result })` and `setQuote(result.quote)`.
- Render `<RawExchange exchanges={exchanges} />` at the bottom.
- On error show FG's raw `error.code` and `error.message` verbatim — no friendly rewrite.
- Continue → `ROUTES.fgUat.proposal`.

- [ ] **Step 2: Verify**

Run: `cd tf-web && npm run typecheck && npm run lint`
Expected: clean. Then drive `/fg` → Private Car → a known-good vehicle and confirm a premium appears with the discount percentage, and that ticking Zero Dep replaces rather than adds to a previously selected cover.

- [ ] **Step 3: Commit**

```bash
git add tf-web/src/features/fg-uat/pages/fg-plans-page.tsx tf-web/src/app/router/routes.tsx
git commit -m "feat(fg-uat): plans, add-ons and premium breakdown"
```

---

## Task 10: Proposal and KYC pages

**Files:**
- Create: `tf-web/src/features/fg-uat/pages/fg-proposal-page.tsx`
- Create: `tf-web/src/features/fg-uat/pages/fg-kyc-page.tsx`
- Modify: `tf-web/src/app/router/routes.tsx`

- [ ] **Step 1: Build the proposal page**

`fg-proposal-page.tsx`: a form bound to `proposer` in the store, prefilled from `DEFAULT_PROPOSER`, every field editable — name, DOB, gender, mobile, email, PAN, address lines, pincode, city, state, nominee name/relation/age. Add a short note that FG's CreateProposal rejects the sequential mobile `9876543210`. Continue → `ROUTES.fgUat.kyc`.

- [ ] **Step 2: Build the KYC page**

`fg-kyc-page.tsx`: reuse the CKYC flow from `tf-web/src/features/vehicle/pages/kyc-page.tsx` — read it first and follow the same hook usage. Submit PAN + DOB via the existing CKYC mutation; on success `setCkyc(ckycNumber, kycRefId)` and record the exchange. Keep the existing OVD-upload fallback for the redirect/manual path. Continue → `ROUTES.fgUat.review`.

- [ ] **Step 3: Verify**

Run: `cd tf-web && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add tf-web/src/features/fg-uat/pages/ tf-web/src/app/router/routes.tsx
git commit -m "feat(fg-uat): proposer details and CKYC steps"
```

---

## Task 11: Review and create proposal

**Files:**
- Create: `tf-web/src/features/fg-uat/pages/fg-review-page.tsx`
- Modify: `tf-web/src/app/router/routes.tsx`

- [ ] **Step 1: Build the page**

`fg-review-page.tsx`:

- Summary of what will be sent: contract-relevant values (business type, plan, policy period, IDV, cover codes, NCB, previous-policy dates) and the proposer.
- Build a `MotorFullQuoteRequest` from `conditions` + `proposer` + `quote`, carrying `quoteId`, `ckyc`, `kycRefId`, `includeRawExchange: true`, `odDiscountPercent` from the quote, and `idvValue` from the quote when the tester did not override it.
- Submit via the existing full-quote hook. On success `setProposal(result)`, record the exchange, navigate to `ROUTES.fgUat.payment`.
- On failure show FG's `Status` / `Message` / `Description` verbatim plus our error code and HTTP status, and keep the tester on the page with the raw drawer open.
- Render `<RawExchange exchanges={exchanges} />`.

- [ ] **Step 2: Verify**

Run: `cd tf-web && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add tf-web/src/features/fg-uat/pages/fg-review-page.tsx tf-web/src/app/router/routes.tsx
git commit -m "feat(fg-uat): review and create proposal"
```

---

## Task 12: Payment and success

**Files:**
- Create: `tf-web/src/features/fg-uat/pages/fg-payment-page.tsx`
- Create: `tf-web/src/features/fg-uat/pages/fg-success-page.tsx`
- Modify: `tf-web/src/app/router/routes.tsx`

- [ ] **Step 1: Build the payment page**

`fg-payment-page.tsx`: follow `tf-web/src/features/vehicle/pages/payment-page.tsx` — read it first. Show the bound premium, call the existing `useInitiatePayment` mutation, then redirect to the returned `paymentUrl`. Add a visible note that `FG_PAYMENT_RESPONSE_URL` on the backend must point at this deployment's callback, or FG's gateway cannot return the tester here.

- [ ] **Step 2: Build the success page**

`fg-success-page.tsx`: read `policyNo` from the store (set by the callback result), show it large with a copy button, list ClientId and QuotationNo beneath, render `<RawExchange exchanges={exchanges} />`, and offer "Run another test case" which calls `reset()` and navigates to `ROUTES.fgUat.start`.

- [ ] **Step 3: Verify**

Run: `cd tf-web && npm run typecheck && npm run lint && npx vitest run`
Expected: clean, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tf-web/src/features/fg-uat/pages/ tf-web/src/app/router/routes.tsx
git commit -m "feat(fg-uat): payment handoff and policy-number success page"
```

---

## Task 13: End-to-end verification against FG UAT

**Files:** none — this is a manual verification pass.

Blocked until the motor `Webagg` credential is restored (see the spec's Open Items); FG's motor endpoints need no bearer, but `FgProvider` fetches one before every call.

- [ ] **Step 1: Confirm backend config**

```bash
cd tf-api && grep -E "^FG_ENABLED|^FG_PAYMENT_RESPONSE_URL" .env
```
Expected: `FG_ENABLED=true`, and `FG_PAYMENT_RESPONSE_URL` pointing at the deployment's `/api/v1/fg/payment/callback`, not localhost, if GCI will use it remotely.

- [ ] **Step 2: Run one case end to end**

Start both apps, open `/fg`, choose Private Car, select preset TC_03, pick a vehicle that quotes today, take a Zero-Dep cover, and complete quote → CKYC → proposal → payment → policy number.

Expected: a UAT PolicyNo on `/fg/success`, and the raw drawer showing GetQuote and CreateProposal payloads.

- [ ] **Step 3: Confirm the customer journey is unaffected**

Run the existing wizard once (`/Vehicle` through to a quote) and confirm no behaviour changed, and that its responses carry **no** `_rawResponse`.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix(fg-uat): issues found in end-to-end verification"
```

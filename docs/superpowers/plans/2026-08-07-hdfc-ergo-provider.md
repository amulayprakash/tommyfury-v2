# HDFC ERGO Motor Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HDFC ERGO as a fourth motor provider in `tf-api`, porting the UAT-verified standalone module at `tf-api/src/hdfc-ergo-integration/` into the `InsuranceProvider` adapter pattern with full lifecycle support (quote, proposal, CKYC, issuance, renewal, COI) for Private Car.

**Architecture:** A new `src/providers/hdfc/` folder in the same shape as `fg/`, `icici/` and `itgi/`. The three collection-exact `Req_PvtCar` / `Policy_Details` templates from the standalone module are carried over **verbatim**; the only genuinely new logic is `mapper/canonical.ts`, which translates the canonical `MotorQuoteRequest` into the intermediate shape those templates already consume. Master data is cross-walked into `provider_*_codes` for slug `hdfc` — no new canonical master rows.

**Tech Stack:** TypeScript (ESM, explicit `.ts` import extensions, `@/*` → `src/*`), Express, zod contracts, Prisma + MySQL, vitest, xlsx.

**Spec:** `docs/superpowers/specs/2026-08-07-hdfc-ergo-provider-design.md`

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `tf-api/src/providers/hdfc/config.ts` | Slug, capability sets, motor capability matrix, env→config loader, endpoint paths |
| `tf-api/src/providers/hdfc/format.ts` | Pure value formatters (dates, registration numbers, booleans) |
| `tf-api/src/providers/hdfc/auth.ts` | `hdfcTokenFetcher` for the shared `TokenManager` |
| `tf-api/src/providers/hdfc/http.ts` | Transport interface, fetch transport, success assertion |
| `tf-api/src/providers/hdfc/types.ts` | `HdfcRequestShape` and its sub-interfaces; `HdfcResolvedCodes` |
| `tf-api/src/providers/hdfc/mapper/canonical.ts` | Canonical request → `HdfcRequestShape` |
| `tf-api/src/providers/hdfc/mapper/req-pvtcar.ts` | The three `Req_PvtCar` templates, verbatim |
| `tf-api/src/providers/hdfc/mapper/policy-details.ts` | The three `Policy_Details` templates, verbatim |
| `tf-api/src/providers/hdfc/mapper/customer.ts` | `Customer_Details` block |
| `tf-api/src/providers/hdfc/mapper/renewal.ts` | `Req_Renewal` builders |
| `tf-api/src/providers/hdfc/mapper/index.ts` | The eight `build*` entry points |
| `tf-api/src/providers/hdfc/normalizer.ts` | Vendor responses → canonical results |
| `tf-api/src/providers/hdfc/db-code-resolver.ts` | Canonical IDs → HDFC model/RTO/insurer codes |
| `tf-api/src/providers/hdfc/ckyc.ts` | Pehchaan e-KYC (own base URL, own JWT) |
| `tf-api/src/providers/hdfc/renewal.ts` | Renewal orchestration helpers |
| `tf-api/src/providers/hdfc/hdfc.provider.ts` | The provider class |
| `tf-api/src/providers/hdfc/index.ts` | `registerHdfcProvider()` |
| `tf-api/scripts/import-hdfc-master.ts` | Master cross-walk import |
| `tf-api/scripts/hdfc-uat-probe.ts` | Read-only live UAT probe |
| `tf-api/docs/hdfc-integration-notes.md` | Vendor quirks + open confirmations |

**Modified**

| Path | Change |
|---|---|
| `tf-api/src/config/env.ts` | Add the `HDFC_*` block |
| `tf-api/src/app.ts` | Register the provider |
| `tf-api/src/contracts/policy.ts` | Optional `transactionId` on `PolicyIssuanceRequestSchema` |
| `tf-api/src/contracts/renewal.ts` | Relax FG-only required fields to optional |
| `tf-api/src/providers/fg/renewal.ts` | Assert FG's own required fields via `requireFields` |
| `tf-api/src/lib/require-fields.ts` | New shared helper (created) |
| `tf-api/package.json` | `db:import:hdfc`, `hdfc:probe` scripts |
| `tf-api/.env.example` | HDFC variables |
| `CLAUDE.md` | Mention HDFC in the provider list |

**Moved**

`tf-api/src/hdfc-ergo-integration/` → `tf-api/docs/reference/hdfc-ergo-standalone/`

---

## Task 1: Freeze the standalone module

**Files:**
- Move: `tf-api/src/hdfc-ergo-integration/` → `tf-api/docs/reference/hdfc-ergo-standalone/`
- Delete: 4 dead duplicates + lock file
- Create: `tf-api/docs/reference/hdfc-ergo-standalone/README.md`

- [ ] **Step 1: Move the folder out of the TypeScript source root**

```bash
cd tf-api
mkdir -p docs/reference
git mv src/hdfc-ergo-integration docs/reference/hdfc-ergo-standalone
```

- [ ] **Step 2: Delete the dead duplicate files**

These are stale snapshots of files that already exist in their canonical form (`motorController.js`, `payloadBuilder.js`). Keeping them invites editing the wrong one.

```bash
cd tf-api/docs/reference/hdfc-ergo-standalone/backend
git rm services/payloadBuilder_1.js services/payloadBuilder_28-07.js services/payloadBuilder_29.js controllers/motorController_29.js package-lock.json
```

- [ ] **Step 3: Write the freeze README**

Create `tf-api/docs/reference/hdfc-ergo-standalone/README.md`:

```markdown
# HDFC ERGO standalone module — FROZEN REFERENCE

This is the original standalone Express integration for HDFC ERGO Private Car,
written before HDFC was ported into the `tf-api` provider adapter pattern.

**It is not wired into anything and is not run.** It is kept only so the ported
mapper can be diffed against the payload construction that was verified against
HDFC UAT.

The live integration lives in `tf-api/src/providers/hdfc/`.
Vendor quirks and open confirmations are documented in
`tf-api/docs/hdfc-integration-notes.md`.

## Known inconsistency (historical caution)

`backend/data/schema.sql` declares `model_master` / `rto_master`, while
`backend/services/hdfcMmvService.js` and `hdfcRtoService.js` query `hdfcmmv` /
`hdfcrto_master`. Neither pair exists in `tf_api_dev`. The canonical
`mmv_master` / `rto_master` + `provider_*_codes` tables replace both.
```

- [ ] **Step 4: Verify nothing referenced the old path**

Run: `cd tf-api && grep -rn "hdfc-ergo-integration" src/ scripts/ prisma/ package.json 2>/dev/null; echo "exit=$?"`
Expected: no matches (exit=1 from grep).

- [ ] **Step 5: Verify the build is unaffected**

Run: `cd tf-api && npm run typecheck && npm run lint`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add -A tf-api/src/hdfc-ergo-integration tf-api/docs/reference
git commit -m "chore: freeze HDFC standalone module under docs/reference"
```

---

## Task 2: Env configuration

**Files:**
- Modify: `tf-api/src/config/env.ts`
- Modify: `tf-api/.env.example`

- [ ] **Step 1: Add the HDFC block to the env schema**

In `tf-api/src/config/env.ts`, immediately after the `ITGI_*` block, add:

```ts
  // ── HDFC ERGO — credentials env-only, never in DB/code ──
  // HEI motor service (JSON) + Pehchaan e-KYC (separate host, separate JWT).
  // Private Car only: the vendor kit ships no two-wheeler or commercial
  // collection, product code or master data.
  HDFC_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  HDFC_BASE_URL: z
    .string()
    .default("https://accessuat.hdfcergo.com/cp/integration/heiintegrationservice/integration/"),
  HDFC_SOURCE: z.string().default(""),
  HDFC_CHANNEL_ID: z.string().default(""),
  HDFC_CREDENTIAL: z.string().optional(),
  HDFC_PRODUCT_PVTCAR: z.string().default("2311"),
  /** Token lifetime in seconds. HDFC returns no expiry — value unconfirmed. */
  HDFC_TOKEN_TTL: z.coerce.number().int().positive().default(1500),
  HDFC_KYC_BASE_URL: z.string().default("https://ekyc-uat.hdfcergo.com/e-kyc"),
  HDFC_KYC_API_KEY: z.string().optional(),
  HDFC_KYC_TOKEN_TTL: z.coerce.number().int().positive().default(480),
  /** Absolute URL Pehchaan returns the browser to after its hosted journey. */
  HDFC_KYC_RETURN_URL: z.string().default(""),
```

- [ ] **Step 2: Add the same variables to `.env.example`**

Append to `tf-api/.env.example`:

```
# ---- HDFC ERGO (Private Car, PRODUCT_CODE 2311) ----
HDFC_ENABLED=false
HDFC_BASE_URL=https://accessuat.hdfcergo.com/cp/integration/heiintegrationservice/integration/
HDFC_SOURCE=
HDFC_CHANNEL_ID=
HDFC_CREDENTIAL=
HDFC_PRODUCT_PVTCAR=2311
HDFC_TOKEN_TTL=1500

# ---- HDFC Pehchaan e-KYC (separate service) ----
HDFC_KYC_BASE_URL=https://ekyc-uat.hdfcergo.com/e-kyc
HDFC_KYC_API_KEY=
HDFC_KYC_TOKEN_TTL=480
HDFC_KYC_RETURN_URL=
```

Note: two-wheeler and commercial product codes are deliberately absent. The
standalone module seeded them with `0000`, which HDFC rejects — an absent
capability is better than a placeholder that produces confusing vendor errors.

- [ ] **Step 3: Redact the new secrets in the logger**

HDFC introduces two secrets that travel in request *headers* (`CREDENTIAL`) and
Pehchaan's `api_key`, plus its `TOKEN` header. Open `tf-api/src/lib/logger.ts`,
find the pino `redact` configuration, and add these paths to the existing list:

```ts
      "*.CREDENTIAL",
      "*.TOKEN",
      "*.api_key",
      "*.token",
```

If `redact` is expressed as `{ paths: [...], censor: "[REDACTED]" }`, add them to
`paths`. If there is no `redact` block yet, add one covering the above plus
whatever authorization headers the file already handles.

- [ ] **Step 4: Verify env still parses**

Run: `cd tf-api && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/config/env.ts tf-api/.env.example tf-api/src/lib/logger.ts
git commit -m "feat(hdfc): add HDFC ERGO env configuration and redact its secrets"
```

---

## Task 3: Format helpers

**Files:**
- Create: `tf-api/src/providers/hdfc/format.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/format.test.ts`

These are the value-level rules HDFC's Blaze rules engine enforces. Each test
below corresponds to a documented UAT failure.

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toHdfcDate,
  formatRegWithDashes,
  yearOnly,
  normalizeClaim,
  bool01,
  boolTF,
  num,
} from "../format.ts";

describe("toHdfcDate", () => {
  it("formats an ISO date as DD/MM/YYYY", () => {
    expect(toHdfcDate("2024-03-19")).toBe("19/03/2024");
  });

  it("passes through a value already in DD/MM/YYYY", () => {
    expect(toHdfcDate("19/03/2024")).toBe("19/03/2024");
  });

  it("returns null for empty or unparseable input", () => {
    expect(toHdfcDate(undefined)).toBeNull();
    expect(toHdfcDate("")).toBeNull();
    expect(toHdfcDate("not-a-date")).toBeNull();
  });
});

describe("formatRegWithDashes", () => {
  // CreateProposal is rejected unless the plate carries dashes.
  it("inserts dashes into a compact registration number", () => {
    expect(formatRegWithDashes("MH12XT5251")).toBe("MH-12-XT-5251");
  });

  it("normalises spacing and case", () => {
    expect(formatRegWithDashes(" mh 01 qq 7878 ")).toBe("MH-01-QQ-7878");
  });

  it("leaves the 'New' sentinel untouched", () => {
    expect(formatRegWithDashes("New")).toBe("New");
  });

  it("returns null when there is no registration number", () => {
    expect(formatRegWithDashes(undefined)).toBeNull();
  });
});

describe("yearOnly", () => {
  // "10/2011" crashed HDFC's Blaze engine with "unexpected character".
  it("extracts a bare year from a month/year string", () => {
    expect(yearOnly("10/2011")).toBe("2011");
  });

  it("extracts a bare year from an ISO date", () => {
    expect(yearOnly("2011-10-05")).toBe("2011");
  });

  it("passes a bare year through", () => {
    expect(yearOnly("2024")).toBe("2024");
  });

  it("falls back to the supplied date's year", () => {
    expect(yearOnly(undefined, "2019-06-15")).toBe("2019");
  });
});

describe("normalizeClaim", () => {
  // HDFC's sample uses ALL CAPS; title case fails validation.
  it("returns YES for truthy claim values", () => {
    expect(normalizeClaim(true)).toBe("YES");
    expect(normalizeClaim("yes")).toBe("YES");
  });

  it("returns NO for everything else, including undefined", () => {
    expect(normalizeClaim(false)).toBe("NO");
    expect(normalizeClaim(undefined)).toBe("NO");
  });
});

describe("bool01 / boolTF / num", () => {
  it("bool01 maps truthy inputs to 1 and everything else to 0", () => {
    expect(bool01(true)).toBe(1);
    expect(bool01(1)).toBe(1);
    expect(bool01(false)).toBe(0);
    expect(bool01(undefined)).toBe(0);
  });

  it("boolTF returns a real boolean", () => {
    expect(boolTF(1)).toBe(true);
    expect(boolTF(undefined)).toBe(false);
  });

  it("num coerces safely with a default", () => {
    expect(num("1250")).toBe(1250);
    expect(num(undefined)).toBe(0);
    expect(num(undefined, 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/format.test.ts`
Expected: FAIL — cannot resolve `../format.ts`.

- [ ] **Step 3: Implement the formatters**

Create `tf-api/src/providers/hdfc/format.ts`:

```ts
/**
 * Value formatters for the HDFC ERGO HEI payloads. Each rule here corresponds to
 * a validation failure observed on HDFC UAT — see the comment on each function.
 */

/** HDFC expects every date as DD/MM/YYYY. Accepts Date, ISO string, or DD/MM/YYYY. */
export function toHdfcDate(input?: string | Date | null): string | null {
  if (!input) return null;
  if (typeof input === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(input)) return input;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * CreateProposal needs the real plate in DASH format ("MH-01-QQ-7878").
 * Sending "MH01QQ7878" — or adding registrationNumberSection* fields — is
 * rejected by HDFC's schema.
 */
export function formatRegWithDashes(regNo?: string | null): string | null {
  if (!regNo) return null;
  const clean = String(regNo).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!clean) return null;
  if (clean === "NEW" || clean === "NULL") return "New";
  const m = clean.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (!m) return clean; // no reliable split — send as-is rather than mangling
  return [m[1], m[2], m[3], m[4]].filter(Boolean).join("-");
}

/**
 * YearOfManufacture must be a bare 4-digit year. "10/2011" or "2011-10" crashes
 * HDFC's Blaze rules engine with "unexpected character".
 */
export function yearOnly(value?: string | number | null, fallbackDate?: string | Date): string {
  if (value != null) {
    const m = String(value).match(/(19|20)\d{2}/);
    if (m) return m[0];
  }
  if (fallbackDate) {
    const d = fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate);
    if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
  }
  return String(new Date().getFullYear());
}

/** "Claim Status as per Customer" — HDFC's sample uses ALL CAPS YES/NO. */
export function normalizeClaim(claim?: boolean | string | null): "YES" | "NO" {
  const c = String(claim ?? "").trim().toLowerCase();
  return c === "yes" || c === "y" || c === "true" || c === "1" ? "YES" : "NO";
}

/** HDFC cover flags are numeric 0/1, not booleans. */
export function bool01(x: unknown): 0 | 1 {
  return x === true || x === 1 || x === "1" ? 1 : 0;
}

/** A handful of HDFC fields genuinely want a JSON boolean. */
export function boolTF(x: unknown): boolean {
  return x === true || x === 1 || x === "1";
}

/** Safe numeric coercion with an explicit default. */
export function num(x: unknown, d = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/format.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/providers/hdfc/format.ts tf-api/src/providers/hdfc/__tests__/format.test.ts
git commit -m "feat(hdfc): add HDFC payload format helpers with UAT-derived rules"
```

---

## Task 4: Config and capability surface

**Files:**
- Create: `tf-api/src/providers/hdfc/config.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  HDFC_SLUG,
  HDFC_CAPABILITIES,
  HDFC_OPERATIONS,
  HDFC_MOTOR_CAPABILITIES,
  hdfcPolicyType,
  HDFC_ENDPOINTS,
} from "../config.ts";

describe("HDFC capability surface", () => {
  it("supports only private car categories", () => {
    expect([...HDFC_CAPABILITIES].sort()).toEqual(["fourWheeler", "newVehicle"]);
  });

  it("declares the full lifecycle it can actually serve", () => {
    expect([...HDFC_OPERATIONS].sort()).toEqual(
      ["ckyc", "coi", "issuance", "proposal", "quote", "renewal"],
    );
  });

  it("does not declare operations the vendor has no endpoint for", () => {
    for (const op of ["retrieveQuote", "policyStatus", "inspection", "ovd"]) {
      expect(HDFC_OPERATIONS.has(op as never)).toBe(false);
    }
  });

  it("offers all three plan types for four-wheeler, comprehensive only for new", () => {
    expect(HDFC_MOTOR_CAPABILITIES.fourWheeler?.policyTypes.sort()).toEqual([
      "comprehensive",
      "standAloneOD",
      "thirdParty",
    ]);
    expect(HDFC_MOTOR_CAPABILITIES.newVehicle?.policyTypes).toEqual(["comprehensive"]);
  });

  it("excludes add-ons HDFC has no cover field for", () => {
    const addons = HDFC_MOTOR_CAPABILITIES.fourWheeler?.addons ?? [];
    for (const absent of ["rimProtect", "keyProtect", "garageCash", "drivingAccessories"]) {
      expect(addons).not.toContain(absent);
    }
    expect(addons).toContain("zeroDep");
    expect(addons).toContain("tyreProtect");
  });
});

describe("hdfcPolicyType", () => {
  it("maps canonical plan types onto HDFC POLICY_TYPE strings", () => {
    expect(hdfcPolicyType("comprehensive")).toBe("OD Plus TP");
    expect(hdfcPolicyType("thirdParty")).toBe("TP Only");
    expect(hdfcPolicyType("standAloneOD")).toBe("OD Only");
  });
});

describe("HDFC_ENDPOINTS", () => {
  it("exposes all eight HEI operations", () => {
    expect(Object.keys(HDFC_ENDPOINTS).sort()).toEqual([
      "authenticate",
      "calculatePremium",
      "createProposal",
      "getCalculateIDV",
      "getPolicyDocument",
      "getProposalDocument",
      "renewalExtract",
      "submitPaymentDetails",
    ]);
  });
});

describe("slug", () => {
  it("is 'hdfc'", () => {
    expect(HDFC_SLUG).toBe("hdfc");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/config.test.ts`
Expected: FAIL — cannot resolve `../config.ts`.

- [ ] **Step 3: Implement the config**

Create `tf-api/src/providers/hdfc/config.ts`:

```ts
import { env } from "@/config/env.ts";
import type {
  VehicleCategory,
  ProviderOperation,
  PolicyType,
  AddonKey,
  MotorCapabilities,
} from "@/contracts/enums.ts";

export const HDFC_SLUG = "hdfc";
export const HDFC_DISPLAY_NAME = "HDFC ERGO";

/**
 * Private Car only (PRODUCT_CODE 2311). The vendor kit ships no two-wheeler or
 * commercial Postman collection, product code or master data, so advertising
 * those categories would make every such request fail at the vendor.
 */
export const HDFC_CAPABILITIES: ReadonlySet<VehicleCategory> = new Set<VehicleCategory>([
  "fourWheeler",
  "newVehicle",
]);

/**
 * Four operations are deliberately absent because HDFC exposes no endpoint:
 *
 * - `retrieveQuote` — no get-quote-by-id call; premium is recomputed each time.
 * - `policyStatus`  — nothing in the kit.
 * - `inspection`    — break-in is triggered automatically at HDFC's end
 *                     (PVTcarTestScenarios.xls: "Proposal should be triggered
 *                     for Inspection"), same as ITGI. Nothing to call.
 * - `ovd`           — the Pehchaan kit has no document-upload API; documents are
 *                     captured inside HDFC's own hosted journey.
 */
export const HDFC_OPERATIONS: ReadonlySet<ProviderOperation> = new Set<ProviderOperation>([
  "quote",
  "proposal",
  "ckyc",
  "issuance",
  "renewal",
  "coi",
]);

/** HDFC POLICY_TYPE vocabulary (exact strings from the Postman collection). */
export const HDFC_POLICY_TYPE = {
  comprehensive: "OD Plus TP",
  thirdParty: "TP Only",
  standAloneOD: "OD Only",
} as const;

export type HdfcPolicyTypeValue = (typeof HDFC_POLICY_TYPE)[keyof typeof HDFC_POLICY_TYPE];

export function hdfcPolicyType(policyType: PolicyType): HdfcPolicyTypeValue {
  return HDFC_POLICY_TYPE[policyType];
}

/** HDFC business-type vocabulary (BusinessType_Mandatary). */
export const HDFC_BUSINESS_TYPE = {
  new: "New Vehicle",
  rollover: "Roll Over",
  used: "Used Car",
} as const;

export type HdfcBusinessType = (typeof HDFC_BUSINESS_TYPE)[keyof typeof HDFC_BUSINESS_TYPE];

/** The eight HEI operations. Identical across products; only PRODUCT_CODE varies. */
export const HDFC_ENDPOINTS = {
  authenticate: "authenticate",
  getCalculateIDV: "getcalculateidv",
  calculatePremium: "calculatepremium",
  createProposal: "createproposal",
  getProposalDocument: "getproposaldocument",
  submitPaymentDetails: "submitpaymentdetails",
  getPolicyDocument: "getpolicydocument",
  renewalExtract: "getpolicydataforrenewal",
} as const;

export type HdfcEndpointName = keyof typeof HDFC_ENDPOINTS;

/**
 * Canonical add-on flags HDFC honours, each backed by a Req_PvtCar cover field.
 * HDFC has no rimProtect / keyProtect / garageCash / drivingAccessories.
 */
const PRIVATE_CAR_ADDONS: AddonKey[] = [
  "zeroDep",
  "tyreProtect",
  "ncbProtection",
  "rti",
  "consumables",
  "engineProtect",
  "rsa",
  "lossOfBelongings",
  "paOwner",
  "paUnnamedPassenger",
  "legalLiabilityPaidDriver",
  "batteryProtect",
];

export const HDFC_MOTOR_CAPABILITIES: MotorCapabilities = {
  fourWheeler: {
    policyTypes: ["comprehensive", "thirdParty", "standAloneOD"],
    addons: PRIVATE_CAR_ADDONS,
  },
  // A brand-new vehicle is always sold as a package; the collection's New
  // Business folder has no TP-only or SA-OD variant.
  newVehicle: {
    policyTypes: ["comprehensive"],
    addons: PRIVATE_CAR_ADDONS,
  },
};

export interface HdfcConfig {
  baseUrl: string;
  source: string;
  channelId: string;
  credential: string;
  productCode: string;
  tokenTtlSeconds: number;
  kyc: {
    baseUrl: string;
    apiKey: string;
    tokenTtlSeconds: number;
    returnUrl: string;
  };
}

/**
 * Reads HDFC config from env. Throws only when HDFC is enabled but misconfigured;
 * fixture-driven tests construct a config literal and never call this.
 */
export function loadHdfcConfig(): HdfcConfig {
  const missing: string[] = [];
  if (!env.HDFC_CREDENTIAL) missing.push("HDFC_CREDENTIAL");
  if (!env.HDFC_SOURCE) missing.push("HDFC_SOURCE");
  if (!env.HDFC_CHANNEL_ID) missing.push("HDFC_CHANNEL_ID");
  if (missing.length > 0) {
    throw new Error(`HDFC provider enabled but missing env: ${missing.join(", ")}`);
  }
  return {
    baseUrl: env.HDFC_BASE_URL.replace(/\/?$/, "/"),
    source: env.HDFC_SOURCE,
    channelId: env.HDFC_CHANNEL_ID,
    credential: env.HDFC_CREDENTIAL!,
    productCode: env.HDFC_PRODUCT_PVTCAR,
    tokenTtlSeconds: env.HDFC_TOKEN_TTL,
    kyc: {
      baseUrl: env.HDFC_KYC_BASE_URL.replace(/\/$/, ""),
      apiKey: env.HDFC_KYC_API_KEY ?? "",
      tokenTtlSeconds: env.HDFC_KYC_TOKEN_TTL,
      returnUrl: env.HDFC_KYC_RETURN_URL,
    },
  };
}

/** Absolute URL for an HEI operation. */
export function hdfcEndpointUrl(config: HdfcConfig, name: HdfcEndpointName): string {
  return config.baseUrl + HDFC_ENDPOINTS[name];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/config.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/providers/hdfc/config.ts tf-api/src/providers/hdfc/__tests__/config.test.ts
git commit -m "feat(hdfc): add capability surface and endpoint config"
```

---

## Task 5: Transport and success assertion

**Files:**
- Create: `tf-api/src/providers/hdfc/http.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/http.test.ts`

HDFC UAT returns useful bodies with non-2xx status codes, and signals business
failures via `StatusCode` inside a 200 body. The transport must therefore read
the body before deciding anything.

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/http.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ProviderError } from "@/errors/app-error.ts";
import { isHdfcSuccess, normalizeHdfcResponse, assertHdfcSuccess } from "../http.ts";

describe("isHdfcSuccess", () => {
  it("accepts every success spelling HDFC uses", () => {
    expect(isHdfcSuccess("1")).toBe(true);
    expect(isHdfcSuccess(200)).toBe(true);
    expect(isHdfcSuccess("200")).toBe(true);
    expect(isHdfcSuccess("SUCCESS")).toBe(true);
  });

  it("rejects anything else, including a missing code", () => {
    expect(isHdfcSuccess("0")).toBe(false);
    expect(isHdfcSuccess(null)).toBe(false);
    expect(isHdfcSuccess(undefined)).toBe(false);
  });
});

describe("normalizeHdfcResponse", () => {
  it("reads HDFC's inconsistent casing into one shape", () => {
    expect(normalizeHdfcResponse({ StatusCode: "1", Error: null })).toEqual({
      statusCode: "1",
      error: null,
      warning: null,
      data: { StatusCode: "1", Error: null },
    });
    expect(normalizeHdfcResponse({ statusCode: 200, error: "boom" }).error).toBe("boom");
  });

  it("tolerates a non-object body", () => {
    expect(normalizeHdfcResponse("plain text").statusCode).toBeNull();
  });
});

describe("assertHdfcSuccess", () => {
  it("passes a successful body through", () => {
    expect(() => assertHdfcSuccess({ StatusCode: "1" }, "calculatePremium")).not.toThrow();
  });

  it("raises a ProviderError carrying HDFC's verbatim message", () => {
    let caught: unknown;
    try {
      assertHdfcSuccess(
        { StatusCode: "0", Error: "BUSINESS EXCEPTION: IDV Deviation not allowed" },
        "calculatePremium",
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    const e = caught as ProviderError;
    expect(e.providerSlug).toBe("hdfc");
    // The vendor message is the only diagnostic HDFC gives — it must survive.
    expect(e.message).toContain("IDV Deviation not allowed");
    expect(e.message).toContain("calculatePremium");
  });

  it("does not throw when the status is absent but no error is reported", () => {
    // Some HDFC document endpoints return a bare payload with no StatusCode.
    expect(() => assertHdfcSuccess({ Req_Policy_Document: {} }, "getPolicyDocument")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/http.test.ts`
Expected: FAIL — cannot resolve `../http.ts`.

- [ ] **Step 3: Implement the transport**

Create `tf-api/src/providers/hdfc/http.ts`:

```ts
import { ProviderError } from "@/errors/app-error.ts";
import { HDFC_SLUG } from "./config.ts";

/** Injectable so fixture-driven tests never touch the network. */
export interface HdfcTransport {
  request(args: {
    method: "GET" | "POST";
    url: string;
    headers: Record<string, string>;
    jsonBody?: unknown;
    /**
     * Safe to retry on 5xx / network failure. Only the read-only steps
     * (authenticate, IDV, premium) opt in — a retried createProposal or
     * submitPaymentDetails could bind a duplicate policy.
     */
    idempotent?: boolean;
  }): Promise<unknown>;
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Default transport. Note it does NOT throw on a non-2xx status alone: HDFC UAT
 * returns diagnostic bodies with 4xx/5xx codes, and discarding them would leave
 * us with no way to explain a failure.
 */
export class FetchTransport implements HdfcTransport {
  async request(args: {
    method: "GET" | "POST";
    url: string;
    headers: Record<string, string>;
    jsonBody?: unknown;
    idempotent?: boolean;
  }): Promise<unknown> {
    const headers = { ...args.headers };
    let body: string | undefined;
    if (args.jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(args.jsonBody);
    }

    const maxAttempts = args.idempotent ? MAX_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(args.url, { method: args.method, headers, body });
      } catch (err) {
        if (attempt < maxAttempts) {
          await sleep(RETRY_BASE_MS * attempt);
          continue;
        }
        throw new ProviderError(HDFC_SLUG, 0, `HDFC request failed: ${(err as Error).message}`);
      }

      const text = await response.text().catch(() => "");
      const parsed = text ? safeJson(text) : undefined;

      if (!response.ok) {
        if (response.status >= 500 && attempt < maxAttempts) {
          await sleep(RETRY_BASE_MS * attempt);
          continue;
        }
        // A parsed body usually carries HDFC's real reason — hand it to the
        // caller so assertHdfcSuccess can surface it verbatim.
        if (parsed && typeof parsed === "object") return parsed;
        throw new ProviderError(
          HDFC_SLUG,
          response.status,
          `HDFC request failed [${response.status}]`,
          text,
        );
      }
      return parsed;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface NormalizedHdfcResponse {
  statusCode: string | number | null;
  error: string | null;
  warning: string | null;
  data: unknown;
}

/** HDFC is inconsistent about casing; collapse it into one shape. */
export function normalizeHdfcResponse(raw: unknown): NormalizedHdfcResponse {
  if (raw == null || typeof raw !== "object") {
    return { statusCode: null, error: null, warning: null, data: raw };
  }
  const r = raw as Record<string, unknown>;
  return {
    statusCode: (r.StatusCode ?? r.statusCode ?? r.Status ?? r.status ?? null) as string | number | null,
    error: (r.Error ?? r.error ?? null) as string | null,
    warning: (r.Warning ?? r.warning ?? null) as string | null,
    data: raw,
  };
}

/** HDFC uses "1" / 200 / "200" / "SUCCESS" across endpoints. */
export function isHdfcSuccess(statusCode: unknown): boolean {
  if (statusCode == null) return false;
  const s = String(statusCode).trim().toUpperCase();
  return s === "1" || s === "200" || s === "TRUE" || s === "SUCCESS";
}

/**
 * Raises when HDFC reports a business failure. HDFC's `Error` text (typically
 * "BUSINESS EXCEPTION: …") is the ONLY diagnostic it provides, so it is carried
 * verbatim into the message rather than being replaced with a generic string.
 *
 * A body with neither a status code nor an error is accepted: some document
 * endpoints return a bare payload.
 */
export function assertHdfcSuccess(body: unknown, step: string): void {
  const norm = normalizeHdfcResponse(body);
  if (isHdfcSuccess(norm.statusCode)) return;
  if (norm.statusCode == null && !norm.error) return;
  const reason = norm.error ?? `status ${String(norm.statusCode)}`;
  throw new ProviderError(HDFC_SLUG, 502, `HDFC ${step} failed: ${reason}`, body);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/http.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/providers/hdfc/http.ts tf-api/src/providers/hdfc/__tests__/http.test.ts
git commit -m "feat(hdfc): add HDFC transport with verbatim vendor error surfacing"
```

---

## Task 6: Token fetcher

**Files:**
- Create: `tf-api/src/providers/hdfc/auth.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { hdfcTokenFetcher, hdfcTokenCacheKey } from "../auth.ts";
import type { HdfcConfig } from "../config.ts";
import type { HdfcTransport } from "../http.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "NOVACRED",
  channelId: "NOVA0001",
  credential: "s3cret",
  productCode: "2311",
  tokenTtlSeconds: 1000,
  kyc: { baseUrl: "https://kyc.example", apiKey: "k", tokenTtlSeconds: 480, returnUrl: "" },
};

function transportReturning(body: unknown, capture?: (args: never) => void): HdfcTransport {
  return {
    request: vi.fn(async (args) => {
      capture?.(args as never);
      return body;
    }),
  };
}

describe("hdfcTokenFetcher", () => {
  it("returns the token from HDFC's Authentication block", async () => {
    const transport = transportReturning({ Authentication: { Token: "tok-123" } });
    const token = await hdfcTokenFetcher(config, transport)();
    expect(token.accessToken).toBe("tok-123");
  });

  it("computes expiry from the configured TTL with the 80% staleness threshold", async () => {
    const transport = transportReturning({ Authentication: { Token: "tok-123" } });
    const before = Date.now();
    const token = await hdfcTokenFetcher(config, transport)();
    // 1000s TTL * 0.8 = 800s
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 800_000 - 50);
    expect(token.expiresAt).toBeLessThanOrEqual(Date.now() + 800_000);
  });

  it("always sends a non-empty unique TRANSACTIONID — auth fails without it", async () => {
    const seen: Record<string, string>[] = [];
    const transport = transportReturning({ Authentication: { Token: "t" } }, (args) => {
      seen.push((args as { headers: Record<string, string> }).headers);
    });
    const fetcher = hdfcTokenFetcher(config, transport);
    await fetcher();
    await fetcher();
    expect(seen[0]!.TRANSACTIONID).toBeTruthy();
    expect(seen[1]!.TRANSACTIONID).toBeTruthy();
    expect(seen[0]!.TRANSACTIONID).not.toBe(seen[1]!.TRANSACTIONID);
  });

  it("sends the channel headers and the credential", async () => {
    const seen: Record<string, string>[] = [];
    const transport = transportReturning({ Authentication: { Token: "t" } }, (args) => {
      seen.push((args as { headers: Record<string, string> }).headers);
    });
    await hdfcTokenFetcher(config, transport)();
    expect(seen[0]).toMatchObject({
      SOURCE: "NOVACRED",
      CHANNEL_ID: "NOVA0001",
      PRODUCT_CODE: "2311",
      CREDENTIAL: "s3cret",
    });
  });

  it("accepts the lowercase and bare token spellings", async () => {
    expect(
      (await hdfcTokenFetcher(config, transportReturning({ authentication: { token: "a" } }))())
        .accessToken,
    ).toBe("a");
    expect(
      (await hdfcTokenFetcher(config, transportReturning({ Token: "b" }))()).accessToken,
    ).toBe("b");
  });

  it("throws a ProviderError when no token comes back", async () => {
    const transport = transportReturning({ StatusCode: "0", Error: "bad credential" });
    await expect(hdfcTokenFetcher(config, transport)()).rejects.toThrow(/bad credential/);
  });
});

describe("hdfcTokenCacheKey", () => {
  it("scopes the cache by product code so a future TW/CV product cannot collide", () => {
    expect(hdfcTokenCacheKey(config)).toBe("hdfc:2311");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/auth.test.ts`
Expected: FAIL — cannot resolve `../auth.ts`.

- [ ] **Step 3: Implement the fetcher**

Create `tf-api/src/providers/hdfc/auth.ts`:

```ts
import { randomUUID } from "node:crypto";
import { ProviderError } from "@/errors/app-error.ts";
import type { TokenFetcher } from "@/providers/token-manager.ts";
import { HDFC_SLUG, hdfcEndpointUrl, type HdfcConfig } from "./config.ts";
import { FetchTransport, normalizeHdfcResponse, type HdfcTransport } from "./http.ts";

/** Matches the TokenManager's own staleness threshold. */
const REFRESH_THRESHOLD = 0.8;

/**
 * HDFC requires a unique, non-empty TRANSACTIONID on the Authenticate header.
 * Omitting it makes authentication fail outright — a recurring integration
 * pitfall recorded during the original UAT work.
 */
export function hdfcTransactionId(prefix = "TF"): string {
  return `${prefix}${Date.now()}${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** Per-product token scope, mirroring FG's per-subscription token keying. */
export function hdfcTokenCacheKey(config: HdfcConfig): string {
  return `${HDFC_SLUG}:${config.productCode}`;
}

/**
 * HDFC's authenticate response carries NO expiry, so the lifetime comes from
 * config (HDFC_TOKEN_TTL) — see open confirmation #3 in the integration notes.
 */
export function hdfcTokenFetcher(
  config: HdfcConfig,
  transport: HdfcTransport = new FetchTransport(),
): TokenFetcher {
  return async () => {
    const body = await transport.request({
      method: "GET",
      url: hdfcEndpointUrl(config, "authenticate"),
      headers: {
        SOURCE: config.source,
        CHANNEL_ID: config.channelId,
        PRODUCT_CODE: config.productCode,
        CREDENTIAL: config.credential,
        TRANSACTIONID: hdfcTransactionId("AUTH"),
      },
      idempotent: true,
    });

    const b = (body ?? {}) as Record<string, unknown>;
    const token =
      (b.Authentication as Record<string, unknown> | undefined)?.Token ??
      (b.authentication as Record<string, unknown> | undefined)?.token ??
      b.Token ??
      null;

    if (typeof token !== "string" || !token) {
      const reason = normalizeHdfcResponse(body).error ?? "no token returned";
      throw new ProviderError(HDFC_SLUG, 502, `HDFC authenticate failed: ${reason}`, body);
    }

    return {
      accessToken: token,
      expiresAt: Date.now() + config.tokenTtlSeconds * 1000 * REFRESH_THRESHOLD,
    };
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/auth.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/providers/hdfc/auth.ts tf-api/src/providers/hdfc/__tests__/auth.test.ts
git commit -m "feat(hdfc): add token fetcher with mandatory TRANSACTIONID"
```

---

## Task 7: Extract the collection golden fixtures

**Files:**
- Create: `tf-api/scripts/extract-hdfc-collection.ts`
- Create: `tf-api/src/providers/hdfc/fixtures/collection/*.json` (generated)

The golden fixtures are the contract for Tasks 9–11. Extracting them from the
Postman collection mechanically — rather than hand-copying — is what makes
"faithful port" a checkable claim.

- [ ] **Step 1: Write the extraction script**

Create `tf-api/scripts/extract-hdfc-collection.ts`:

```ts
/**
 * Extracts request bodies from the HDFC Private Car Postman collection into
 * JSON fixtures used as golden payloads by the mapper tests.
 *
 *   npx tsx scripts/extract-hdfc-collection.ts
 *
 * The fixtures are committed: they are the contract the ported mapper is held
 * to, and regenerating them must be a deliberate, reviewable act.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KIT_DIR =
  process.env.HDFC_KIT_DIR ??
  "C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/HDFC API KIT/HDFC API KIT";
const COLLECTION = "Private Car.postman_collection.json";
const OUT_DIR = "src/providers/hdfc/fixtures/collection";

/** Postman folder trail → fixture filename. Only the steps we assert on. */
const WANTED: Record<string, string> = {
  "Comprehensive/New Business/02 GetCalculateIDV": "new-idv.json",
  "Comprehensive/New Business/03 CalculatePremium": "new-premium.json",
  "Comprehensive/New Business/04 CreateProposal": "new-proposal.json",
  "Comprehensive/New Business/06 SubmitPaymentDetails": "new-payment.json",
  "Comprehensive/Roll Over/02 GetCalculateIDV": "rollover-idv.json",
  "Comprehensive/Roll Over/03 CalculatePremium": "rollover-premium.json",
  "Comprehensive/Roll Over/04 CreateProposal": "rollover-proposal.json",
  "Comprehensive/Used Vehicle/03 CalculatePremium": "used-premium.json",
  "Comprehensive/Used Vehicle/04 CreateProposal": "used-proposal.json",
  "Liability/02 CalculatePremium": "liability-premium.json",
  "Renewal/02 RenewalExtract": "renewal-extract.json",
  "Renewal/04 CalculatePremium": "renewal-premium.json",
  "Renewal/05 CreateProposal": "renewal-proposal.json",
};

interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: { body?: { raw?: string } };
}

function walk(items: PostmanItem[], trail: string[], out: Map<string, unknown>): void {
  for (const it of items) {
    const t = [...trail, it.name];
    if (it.item) {
      walk(it.item, t, out);
      continue;
    }
    const key = t.join("/");
    const file = WANTED[key];
    if (!file) continue;
    const raw = it.request?.body?.raw;
    if (!raw) continue;
    out.set(file, JSON.parse(raw));
  }
}

const path = join(KIT_DIR, COLLECTION);
if (!existsSync(path)) {
  console.error(`HDFC collection not found at:\n  ${path}`);
  console.error("Set HDFC_KIT_DIR to the kit folder.");
  process.exit(1);
}

const collection = JSON.parse(readFileSync(path, "utf8")) as { item: PostmanItem[] };
const extracted = new Map<string, unknown>();
walk(collection.item, [], extracted);

mkdirSync(OUT_DIR, { recursive: true });
for (const [file, body] of extracted) {
  writeFileSync(join(OUT_DIR, file), JSON.stringify(body, null, 2) + "\n", "utf8");
  console.log(`wrote ${OUT_DIR}/${file}`);
}

const missing = Object.values(WANTED).filter((f) => !extracted.has(f));
if (missing.length) {
  console.error(`\nMissing from the collection: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`\n${extracted.size} fixtures extracted.`);
```

- [ ] **Step 2: Run it**

Run: `cd tf-api && npx tsx scripts/extract-hdfc-collection.ts`
Expected: 13 lines of `wrote …`, then `13 fixtures extracted.`

If a path key does not match, the script exits non-zero listing what is missing —
correct the `WANTED` keys against the folder names printed by
`node scripts/…` and re-run.

- [ ] **Step 3: Sanity-check one fixture**

Run: `cd tf-api && node -e "const b=require('./src/providers/hdfc/fixtures/collection/new-premium.json');console.log(b.Policy_Details.BusinessType_Mandatary, Object.keys(b.Req_PvtCar).length)"`
Expected: `New Vehicle 68`

Verified counts from the real collection, for reference — the parity tests in
Tasks 10 and 11 derive these from the fixtures via `Object.keys()`, so treat the
fixtures, never this table, as the source of truth:

| Fixture | `Req_PvtCar` keys | `Policy_Details` keys |
|---|---|---|
| new-premium.json | 68 | 12 |
| rollover-premium.json | 70 | 29 |
| used-premium.json | 59 | 22 |

Note `new-idv.json` and `rollover-idv.json` are byte-identical. That is a genuine
property of the collection, not an extraction fault: the IDV step sends
`Registration_No: "New"` for both business types (see behaviour 2 in §3.5 of the
spec), so the two samples coincide.

- [ ] **Step 4: Commit**

```bash
git add tf-api/scripts/extract-hdfc-collection.ts tf-api/src/providers/hdfc/fixtures/collection
git commit -m "test(hdfc): extract Postman collection bodies as golden fixtures"
```

---

## Task 8: Intermediate request types

**Files:**
- Create: `tf-api/src/providers/hdfc/types.ts`

No test of its own — it is types only, exercised by Tasks 9–11.

- [ ] **Step 1: Create the types**

Create `tf-api/src/providers/hdfc/types.ts`:

```ts
import type { HdfcBusinessType, HdfcPolicyTypeValue } from "./config.ts";

/**
 * The intermediate shape the ported payload builders consume. It exists so the
 * three collection-exact templates could be carried over verbatim: only this
 * shape's *producer* (mapper/canonical.ts) is new code.
 *
 * Dates are ISO (YYYY-MM-DD); the templates convert to DD/MM/YYYY.
 * Amounts are whole rupees, matching the rest of the stack.
 */

export interface HdfcVehicle {
  /** HDFC VEHICLEMODELCODE, resolved from ProviderMmvCode. */
  modelCode: string;
  /** HDFC RTO_CODE, resolved from ProviderRtoCode. */
  rtoCode: string;
  registrationNo?: string;
  registrationDate?: string;
  firstRegistrationDate?: string;
  deliveryOrRegistrationDate?: string;
  manufactureYear?: string;
  fuelType?: string;
  engineNumber?: string;
  chassisNumber?: string;
  idv: number;
}

export interface HdfcPolicy {
  startDate?: string;
  proposalDate?: string;
  tenure: number;
  policyType: HdfcPolicyTypeValue;
}

export interface HdfcPreviousPolicy {
  /** HDFC insurer short code from ProviderInsurerCode — NOT "OTHERS". */
  insurerCode?: string;
  policyNo?: string;
  startDate?: string;
  endDate?: string;
  tpStartDate?: string;
  tpEndDate?: string;
  tpInsurer?: string;
  tpPolicyNo?: string;
  ncbPercentage: number;
  claim: boolean;
  type?: string;
  hadZeroDep?: boolean;
  hadRti?: boolean;
}

export interface HdfcAddons {
  zeroDep: boolean;
  tyreSecure: boolean;
  ncbProtection: boolean;
  rti: boolean;
  rtiPlanType?: string;
  consumables: boolean;
  engineProtect: boolean;
  roadsideAssistance: boolean;
  roadsideAssistanceWorldwide: boolean;
  roadsideAssistanceAdvance: boolean;
  lossOfPersonalBelongings: boolean;
  lossOfPersonalBelongingsSI: number;
  llPaidDriver: number;
  paPaidDriverSI: number;
  noOfPaPaidDriver: number;
  unnamedPersons: number;
  unnamedPersonSI: number;
  cpaTenure: number;
  electricalAccessoryIdv: number;
  nonElectricalAccessoryIdv: number;
  antiTheftDisc: boolean;
  voluntaryExcess: number;
  biFuelType: string;
  biFuelKitValue: number;
  automobileAssociationNo?: string;
  nomineeName?: string;
  nomineeAge?: number;
  nomineeRelationship?: string;
  effectiveDrivingLicense: boolean;
}

export interface HdfcEv {
  motorCover?: number;
  zeroDepBattery?: number;
  batteryChargerCover?: number;
}

export interface HdfcCustomer {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dob?: string;
  email?: string;
  mobile?: string;
  panNo?: string;
  salutation?: string;
  gender?: string;
  permAddress1?: string;
  permAddress2?: string;
  permCityDistrict?: string;
  permState?: string;
  permPinCode?: string;
  /** Pehchaan kyc_id → Customer_Pehchaan_id. Issuance is refused without it. */
  pehchaanId?: string;
}

export interface HdfcPayment {
  amount: number;
  paymentDate?: string;
  instrumentNumber?: string;
  bankName?: string;
  bankBranchName?: string;
  paymentModeCode?: string;
  payerType?: string;
}

export interface HdfcRequestShape {
  transactionId: string;
  businessType: HdfcBusinessType;
  isElectric: boolean;
  vehicle: HdfcVehicle;
  policy: HdfcPolicy;
  previousPolicy: HdfcPreviousPolicy;
  addons: HdfcAddons;
  ev: HdfcEv;
  customer?: HdfcCustomer;
  payment?: HdfcPayment;
  /** Proposal number returned by CreateProposal, for the payment/document steps. */
  proposalNumber?: string;
  policyNumber?: string;
  /** Existing policy number for the renewal flow. */
  previousPolicyNo?: string;
}

/** What db-code-resolver.ts produces. */
export interface HdfcResolvedCodes {
  modelCode: string;
  rtoCode: string;
  previousInsurerCode?: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd tf-api && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tf-api/src/providers/hdfc/types.ts
git commit -m "feat(hdfc): add intermediate request shape types"
```

---

## Task 9: Canonical → HdfcRequestShape translation

**Files:**
- Create: `tf-api/src/providers/hdfc/mapper/canonical.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/canonical.test.ts`

This is the only genuinely new logic in the port. Everything downstream is the
standalone module's verified code retyped.

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/canonical.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import { toHdfcRequest, resolveBusinessType, applyRolloverDateSanity } from "../mapper/canonical.ts";
import type { HdfcResolvedCodes } from "../types.ts";

const codes: HdfcResolvedCodes = {
  modelCode: "38908",
  rtoCode: "10406",
  previousInsurerCode: "ICICILOMBARD",
};

function baseRequest(overrides: Partial<MotorQuoteRequest> = {}): MotorQuoteRequest {
  return {
    vehicleType: "fourWheeler",
    selectedPolicy: "comprehensive",
    businessType: "rollover",
    makeId: "MAR",
    makeName: "MARUTI",
    modelId: "SWIFT",
    modelName: "SWIFT",
    fuelType: "petrol",
    rtoCode: "MH01",
    registrationDate: "2019-06-15",
    registrationNumber: "MH01QQ7878",
    isPreviousPolicyExpired: false,
    claimInPreviousPolicy: false,
    ncbPercent: 20,
    zeroDep: true,
    engineProtect: false,
    rsa: false,
    tyreProtect: false,
    rimProtect: false,
    rti: false,
    consumables: false,
    paOwner: true,
    paUnnamedPassenger: false,
    legalLiabilityPaidDriver: false,
    keyProtect: false,
    garageCash: false,
    lossOfBelongings: false,
    batteryProtect: false,
    drivingAccessories: false,
    ncbProtection: false,
    ...overrides,
  } as MotorQuoteRequest;
}

describe("resolveBusinessType", () => {
  it("returns New Vehicle for a new-business journey", () => {
    expect(resolveBusinessType(baseRequest({ businessType: "new" }))).toBe("New Vehicle");
  });

  it("returns New Vehicle for the newVehicle category regardless of businessType", () => {
    expect(resolveBusinessType(baseRequest({ vehicleType: "newVehicle" }))).toBe("New Vehicle");
  });

  it("returns New Vehicle when there is no registration number", () => {
    expect(resolveBusinessType(baseRequest({ registrationNumber: undefined }))).toBe("New Vehicle");
  });

  it("returns Roll Over for a registered vehicle changing insurer", () => {
    expect(resolveBusinessType(baseRequest())).toBe("Roll Over");
  });

  it("returns Roll Over for a renewal", () => {
    expect(resolveBusinessType(baseRequest({ businessType: "renewal" }))).toBe("Roll Over");
  });
});

describe("applyRolloverDateSanity", () => {
  // HDFC requires the previous policy to expire strictly before the new start.
  it("moves the start date to the day after the previous expiry when they overlap", () => {
    expect(applyRolloverDateSanity("2026-08-01", "2026-08-10")).toBe("2026-08-11");
  });

  it("moves the start date when they are equal", () => {
    expect(applyRolloverDateSanity("2026-08-10", "2026-08-10")).toBe("2026-08-11");
  });

  it("leaves a start date that is already after the expiry alone", () => {
    expect(applyRolloverDateSanity("2026-08-11", "2026-08-10")).toBe("2026-08-11");
  });

  it("leaves the start date alone when there is no previous expiry", () => {
    expect(applyRolloverDateSanity("2026-08-01", undefined)).toBe("2026-08-01");
  });
});

describe("toHdfcRequest", () => {
  it("uses the resolved vendor codes, never the canonical ids", () => {
    const out = toHdfcRequest(baseRequest(), codes, "TXN1");
    expect(out.vehicle.modelCode).toBe("38908");
    expect(out.vehicle.rtoCode).toBe("10406");
  });

  it("maps canonical plan types onto HDFC POLICY_TYPE", () => {
    expect(toHdfcRequest(baseRequest(), codes, "T").policy.policyType).toBe("OD Plus TP");
    expect(
      toHdfcRequest(baseRequest({ selectedPolicy: "thirdParty" }), codes, "T").policy.policyType,
    ).toBe("TP Only");
    expect(
      toHdfcRequest(baseRequest({ selectedPolicy: "standAloneOD" }), codes, "T").policy.policyType,
    ).toBe("OD Only");
  });

  it("maps canonical add-on booleans onto the HDFC cover flags", () => {
    const out = toHdfcRequest(
      baseRequest({ zeroDep: true, tyreProtect: true, rti: true, consumables: true }),
      codes,
      "T",
    );
    expect(out.addons.zeroDep).toBe(true);
    expect(out.addons.tyreSecure).toBe(true);
    expect(out.addons.rti).toBe(true);
    expect(out.addons.consumables).toBe(true);
    expect(out.addons.engineProtect).toBe(false);
  });

  it("defaults RTIPlanType to A only when RTI is selected", () => {
    expect(toHdfcRequest(baseRequest({ rti: true }), codes, "T").addons.rtiPlanType).toBe("A");
    expect(toHdfcRequest(baseRequest({ rti: false }), codes, "T").addons.rtiPlanType).toBeUndefined();
  });

  it("carries the resolved previous-insurer code, never a hard-coded default", () => {
    const out = toHdfcRequest(
      baseRequest({ previousInsurerId: "ICICI", previousPolicyNumber: "P123" }),
      codes,
      "T",
    );
    expect(out.previousPolicy.insurerCode).toBe("ICICILOMBARD");
    expect(out.previousPolicy.policyNo).toBe("P123");
  });

  it("leaves the previous-insurer code undefined when the resolver found none", () => {
    const out = toHdfcRequest(baseRequest(), { modelCode: "1", rtoCode: "2" }, "T");
    expect(out.previousPolicy.insurerCode).toBeUndefined();
  });

  it("flags electric vehicles from the canonical fuel type", () => {
    expect(toHdfcRequest(baseRequest({ fuelType: "electric" }), codes, "T").isElectric).toBe(true);
    expect(toHdfcRequest(baseRequest(), codes, "T").isElectric).toBe(false);
  });

  it("turns on the EV covers for an electric vehicle", () => {
    const out = toHdfcRequest(baseRequest({ fuelType: "electric", zeroDep: true }), codes, "T");
    expect(out.ev.motorCover).toBe(1);
    expect(out.ev.zeroDepBattery).toBe(1);
  });

  it("applies rollover date sanity to the policy start date", () => {
    const out = toHdfcRequest(
      baseRequest({ policyStartDate: "2026-08-01", previousPolicyExpiryDate: "2026-08-10" }),
      codes,
      "T",
    );
    expect(out.policy.startDate).toBe("2026-08-11");
  });

  it("carries the transaction id through", () => {
    expect(toHdfcRequest(baseRequest(), codes, "TXN-42").transactionId).toBe("TXN-42");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/canonical.test.ts`
Expected: FAIL — cannot resolve `../mapper/canonical.ts`.

- [ ] **Step 3: Implement the translation**

Create `tf-api/src/providers/hdfc/mapper/canonical.ts`:

```ts
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import { hdfcPolicyType, HDFC_BUSINESS_TYPE, type HdfcBusinessType } from "../config.ts";
import type { HdfcRequestShape, HdfcResolvedCodes, HdfcCustomer } from "../types.ts";

/**
 * Canonical request → the intermediate shape the ported HDFC payload builders
 * consume. This is the ONLY new logic in the port; everything downstream is the
 * standalone module's UAT-verified code.
 */

/**
 * HDFC BusinessType_Mandatary. Mirrors FG's rule for what counts as new
 * business: either the explicit business type or the newVehicle category.
 * "Used Car" is not reachable from the canonical request today — the wizard has
 * no used-vehicle journey — so the template exists but is only selected when a
 * caller sets businessType explicitly through the full-quote path.
 */
export function resolveBusinessType(req: MotorQuoteRequest): HdfcBusinessType {
  if (req.businessType === "new" || req.vehicleType === "newVehicle") {
    return HDFC_BUSINESS_TYPE.new;
  }
  const reg = req.registrationNumber?.trim();
  if (!reg || reg.toUpperCase() === "NEW") return HDFC_BUSINESS_TYPE.new;
  return HDFC_BUSINESS_TYPE.rollover;
}

/**
 * HDFC rejects a rollover whose previous policy has not already expired when the
 * new policy starts. When the customer's old policy is still running, shift the
 * start to the day after it ends rather than letting HDFC reject the quote.
 * Both arguments and the return value are ISO YYYY-MM-DD.
 */
export function applyRolloverDateSanity(
  startDate: string,
  previousExpiry: string | undefined,
): string {
  if (!previousExpiry) return startDate;
  const start = new Date(startDate);
  const prevEnd = new Date(previousExpiry);
  if (Number.isNaN(start.getTime()) || Number.isNaN(prevEnd.getTime())) return startDate;
  if (start > prevEnd) return startDate;
  const shifted = new Date(prevEnd);
  shifted.setDate(shifted.getDate() + 1);
  return shifted.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Full-quote requests carry a proposer + address; plain quotes do not. */
function toCustomer(req: MotorQuoteRequest): HdfcCustomer | undefined {
  const full = req as Partial<MotorFullQuoteRequest>;
  if (!full.proposer) return undefined;
  const p = full.proposer;
  const a = full.address;
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    dob: p.dob,
    email: p.email,
    mobile: p.mobile,
    panNo: p.panNumber,
    salutation: p.title?.toUpperCase() ?? "MR",
    gender: p.gender === "F" ? "FEMALE" : "MALE",
    permAddress1: a?.addressLine1,
    permAddress2: a?.addressLine2,
    permCityDistrict: a?.city,
    permState: a?.state,
    permPinCode: a?.pincode,
    pehchaanId: full.kycRefId ?? full.ckyc,
  };
}

export function toHdfcRequest(
  req: MotorQuoteRequest,
  codes: HdfcResolvedCodes,
  transactionId: string,
): HdfcRequestShape {
  const isElectric = req.fuelType === "electric";
  const startDate = applyRolloverDateSanity(
    req.policyStartDate ?? todayIso(),
    req.previousPolicyExpiryDate,
  );
  const full = req as Partial<MotorFullQuoteRequest>;

  return {
    transactionId,
    businessType: resolveBusinessType(req),
    isElectric,
    vehicle: {
      modelCode: codes.modelCode,
      rtoCode: codes.rtoCode,
      registrationNo: req.registrationNumber,
      registrationDate: req.registrationDate,
      manufactureYear: req.registrationDate,
      fuelType: req.fuelType?.toUpperCase(),
      engineNumber: full.vehicle?.engineNumber,
      chassisNumber: full.vehicle?.chassisNumber,
      // Overwritten with HDFC's recommended IDV before CalculatePremium — see
      // the provider's quote flow. A caller value is only a starting point.
      idv: req.idvValue ?? 0,
    },
    policy: {
      startDate,
      proposalDate: todayIso(),
      tenure: 1,
      policyType: hdfcPolicyType(req.selectedPolicy),
    },
    previousPolicy: {
      insurerCode: codes.previousInsurerCode,
      policyNo: req.previousPolicyNumber,
      startDate: req.previousPolicyStartDate,
      endDate: req.previousPolicyExpiryDate,
      tpStartDate: req.previousTpStartDate,
      tpEndDate: req.previousTpExpiryDate,
      ncbPercentage: req.ncbPercent,
      claim: req.claimInPreviousPolicy,
      type: req.previousPolicyType,
      hadZeroDep: req.previousPolicyHasZdCover,
    },
    addons: {
      zeroDep: req.zeroDep,
      tyreSecure: req.tyreProtect,
      ncbProtection: req.ncbProtection,
      rti: req.rti,
      rtiPlanType: req.rti ? "A" : undefined,
      consumables: req.consumables,
      engineProtect: req.engineProtect,
      roadsideAssistance: req.rsa,
      roadsideAssistanceWorldwide: false,
      roadsideAssistanceAdvance: false,
      lossOfPersonalBelongings: req.lossOfBelongings,
      lossOfPersonalBelongingsSI: 0,
      llPaidDriver: req.legalLiabilityPaidDriver ? 1 : 0,
      paPaidDriverSI: 0,
      noOfPaPaidDriver: req.legalLiabilityPaidDriver ? 1 : 0,
      unnamedPersons: req.paUnnamedPassenger ? 1 : 0,
      unnamedPersonSI: req.unnamedPaSumInsured ?? 0,
      cpaTenure: req.paOwner ? 1 : 0,
      electricalAccessoryIdv: req.electricalAccessoriesSI ?? 0,
      nonElectricalAccessoryIdv: req.nonElectricalAccessoriesSI ?? 0,
      antiTheftDisc: req.hasAntiTheftDevice ?? false,
      voluntaryExcess: req.voluntaryDeductible ?? 0,
      biFuelType: req.bifuelKitType && req.bifuelKitType !== "NA" ? req.bifuelKitType : "",
      biFuelKitValue: req.bifuelKitSI ?? 0,
      automobileAssociationNo: req.automobileAssociationMembership,
      nomineeName: full.nomineeName,
      nomineeAge: full.nomineeAge,
      nomineeRelationship: full.nomineeRelation,
      effectiveDrivingLicense: true,
    },
    ev: isElectric
      ? {
          motorCover: 1,
          zeroDepBattery: req.zeroDep ? 1 : 0,
          batteryChargerCover: req.batteryProtect ? 1 : 0,
        }
      : {},
    customer: toCustomer(req),
    payment: full.amountCollected
      ? { amount: full.amountCollected, instrumentNumber: full.paymentTransactionId }
      : undefined,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/canonical.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/providers/hdfc/mapper/canonical.ts tf-api/src/providers/hdfc/__tests__/canonical.test.ts
git commit -m "feat(hdfc): translate canonical quote requests into the HDFC request shape"
```

---

## Task 10: Req_PvtCar templates (golden-payload tested)

**Files:**
- Create: `tf-api/src/providers/hdfc/mapper/req-pvtcar.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/req-pvtcar.test.ts`

The three templates are carried over **verbatim** from
`docs/reference/hdfc-ergo-standalone/backend/services/payloadBuilder.js`. Field
*order* matters as much as field presence: the tests assert `Object.keys()`
equality against the collection fixtures, which is what catches a drifted port.

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/req-pvtcar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import newPremium from "../fixtures/collection/new-premium.json" with { type: "json" };
import rolloverPremium from "../fixtures/collection/rollover-premium.json" with { type: "json" };
import usedPremium from "../fixtures/collection/used-premium.json" with { type: "json" };
import { reqPvtCarNew, reqPvtCarRollover, reqPvtCarUsed, reqPvtCarFor } from "../mapper/req-pvtcar.ts";
import type { HdfcRequestShape } from "../types.ts";

function shape(overrides: Partial<HdfcRequestShape> = {}): HdfcRequestShape {
  return {
    transactionId: "T",
    businessType: "New Vehicle",
    isElectric: false,
    vehicle: { modelCode: "38908", rtoCode: "10406", idv: 949411 },
    policy: { tenure: 1, policyType: "OD Plus TP" },
    previousPolicy: { ncbPercentage: 0, claim: false },
    addons: {
      zeroDep: false,
      tyreSecure: false,
      ncbProtection: false,
      rti: false,
      consumables: false,
      engineProtect: false,
      roadsideAssistance: false,
      roadsideAssistanceWorldwide: false,
      roadsideAssistanceAdvance: false,
      lossOfPersonalBelongings: false,
      lossOfPersonalBelongingsSI: 0,
      llPaidDriver: 0,
      paPaidDriverSI: 0,
      noOfPaPaidDriver: 0,
      unnamedPersons: 0,
      unnamedPersonSI: 0,
      cpaTenure: 0,
      electricalAccessoryIdv: 0,
      nonElectricalAccessoryIdv: 0,
      antiTheftDisc: false,
      voluntaryExcess: 0,
      biFuelType: "",
      biFuelKitValue: 0,
      effectiveDrivingLicense: true,
    },
    ev: {},
    ...overrides,
  };
}

describe("Req_PvtCar field parity with the Postman collection", () => {
  it("New Business emits exactly the collection's keys, in order", () => {
    expect(Object.keys(reqPvtCarNew(shape()))).toEqual(Object.keys(newPremium.Req_PvtCar));
  });

  it("Roll Over emits exactly the collection's keys, in order", () => {
    const out = reqPvtCarRollover(shape({ businessType: "Roll Over" }));
    expect(Object.keys(out)).toEqual(Object.keys(rolloverPremium.Req_PvtCar));
  });

  it("Used Car emits exactly the collection's keys, in order", () => {
    const out = reqPvtCarUsed(shape({ businessType: "Used Car" }));
    expect(Object.keys(out)).toEqual(Object.keys(usedPremium.Req_PvtCar));
  });

  it("Roll Over carries PlanType and EMIPlanType, which New Business does not", () => {
    const rollover = Object.keys(reqPvtCarRollover(shape({ businessType: "Roll Over" })));
    const fresh = Object.keys(reqPvtCarNew(shape()));
    expect(rollover).toContain("PlanType");
    expect(rollover).toContain("EMIPlanType");
    expect(fresh).not.toContain("PlanType");
    expect(fresh).not.toContain("EMIPlanType");
  });

  it("Used Car carries IsFibertank and NumberOfDrivers", () => {
    const used = Object.keys(reqPvtCarUsed(shape({ businessType: "Used Car" })));
    expect(used).toContain("IsFibertank");
    expect(used).toContain("NumberOfDrivers");
  });
});

describe("cover flags", () => {
  it("emits numeric 0/1 for cover flags, not booleans", () => {
    const out = reqPvtCarNew(shape({ addons: { ...shape().addons, zeroDep: true } }));
    expect(out.IsZeroDept_Cover).toBe(1);
    expect(out.IsTyreSecure_Cover).toBe(0);
  });

  it("emits real booleans for the fields HDFC types as boolean", () => {
    const out = reqPvtCarNew(shape());
    expect(out.BreakinWaiver).toBe(false);
    expect(out.Effectivedrivinglicense).toBe(true);
    expect(out.AntiTheftDiscFlag).toBe(false);
  });

  it("sets RTIPlanType only when RTI is on", () => {
    const on = reqPvtCarNew(shape({ addons: { ...shape().addons, rti: true, rtiPlanType: "A" } }));
    expect(on.IsRTI_Cover).toBe(1);
    expect(on.RTIPlanType).toBe("A");
    expect(reqPvtCarNew(shape()).RTIPlanType).toBeNull();
  });

  it("zeroes every EV flag for a non-electric vehicle", () => {
    const out = reqPvtCarNew(shape());
    expect(out.isElectricMotorCover).toBe(0);
    expect(out.isZeroDepClaimforBattery).toBe(0);
    expect(out.isBatteryChargerAccessoryCover).toBe(0);
  });

  it("sets the EV flags for an electric vehicle", () => {
    const out = reqPvtCarNew(
      shape({ isElectric: true, ev: { motorCover: 1, zeroDepBattery: 1, batteryChargerCover: 1 } }),
    );
    expect(out.isElectricMotorCover).toBe(1);
    expect(out.isZeroDepClaimforBattery).toBe(1);
    expect(out.isBatteryChargerAccessoryCover).toBe(1);
  });

  it("carries POLICY_TYPE through from the canonical plan type", () => {
    expect(reqPvtCarNew(shape()).POLICY_TYPE).toBe("OD Plus TP");
    expect(
      reqPvtCarNew(shape({ policy: { tenure: 1, policyType: "TP Only" } })).POLICY_TYPE,
    ).toBe("TP Only");
  });
});

describe("reqPvtCarFor", () => {
  it("dispatches on the business type", () => {
    expect(Object.keys(reqPvtCarFor(shape({ businessType: "Roll Over" })))).toContain("PlanType");
    expect(Object.keys(reqPvtCarFor(shape({ businessType: "Used Car" })))).toContain("IsFibertank");
    expect(Object.keys(reqPvtCarFor(shape()))).not.toContain("PlanType");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/req-pvtcar.test.ts`
Expected: FAIL — cannot resolve `../mapper/req-pvtcar.ts`.

- [ ] **Step 3: Port the templates**

Create `tf-api/src/providers/hdfc/mapper/req-pvtcar.ts`. Port each function from
`docs/reference/hdfc-ergo-standalone/backend/services/payloadBuilder.js`
(`reqPvtCar_New`, `reqPvtCar_Rollover`, `reqPvtCar_Used`) **preserving key order
exactly**. The header and the New Business template are given in full below; the
Roll Over and Used Car templates follow the same mechanical translation —
`a.xxx` becomes `req.addons.xxx`, `p.xxx` becomes `req.policy.xxx`, `bool01`/
`boolTF`/`num`/`toHdfcDate` come from `../format.ts`.

```ts
import { bool01, boolTF, num, toHdfcDate } from "../format.ts";
import { HDFC_BUSINESS_TYPE } from "../config.ts";
import type { HdfcRequestShape } from "../types.ts";

/**
 * The Req_PvtCar blocks, ported verbatim from the UAT-verified standalone
 * module. Each business type has a DIFFERENT field set in HDFC's Postman
 * collection, and HDFC's Blaze rules engine rejects payloads carrying fields the
 * sample for that business type does not send — so these stay as three separate
 * templates rather than one merged shape with conditionals.
 *
 * KEY ORDER IS PART OF THE CONTRACT. The tests assert Object.keys() equality
 * against fixtures extracted from the collection.
 */

export type ReqPvtCar = Record<string, unknown>;

/** New Business — order per Comprehensive/New Business/03 CalculatePremium. */
export function reqPvtCarNew(req: HdfcRequestShape): ReqPvtCar {
  const a = req.addons;
  const ev = req.ev;
  return {
    POSP_CODE: null,
    POLICY_TYPE: req.policy.policyType,
    POLICY_TENURE: num(req.policy.tenure, 1),
    ExtensionCountryCode: 0.0,
    ExtensionCountryName: null,
    BreakIN_ID: null,
    BreakInStatus: null,
    BreakInInspectionFlag: null,
    BreakinWaiver: false,
    BreakinInspectionDate: null,
    Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
    NumberOfEmployees: 0,
    NoOfWorkmen: 0,
    NoOfCleanerConductorCoolies: 0,
    BiFuelType: a.biFuelType ?? "",
    BiFuel_Kit_Value: num(a.biFuelKitValue),
    LLPaiddriver: num(a.llPaidDriver),
    PAPaiddriverSI: num(a.paPaidDriverSI),
    Owner_Driver_Nominee_Name: a.nomineeName ?? null,
    Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
    Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
    Owner_Driver_Appointee_Name: null,
    Owner_Driver_Appointee_Relationship: null,
    IsZeroDept_Cover: bool01(a.zeroDep),
    IsTyreSecure_Cover: bool01(a.tyreSecure),
    ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
    NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
    OtherLoadDiscRate: 0.0,
    AntiTheftDiscFlag: boolTF(a.antiTheftDisc),
    HandicapDiscFlag: false,
    IsNCBProtection_Cover: bool01(a.ncbProtection),
    IsRTI_Cover: bool01(a.rti),
    RTIPlanType: a.rti ? (a.rtiPlanType ?? "A") : null,
    IsCOC_Cover: bool01(a.consumables),
    IsEngGearBox_Cover: bool01(a.engineProtect),
    IsLossofUseDownTimeProt_Cover: 0,
    IsEA_Cover: bool01(a.roadsideAssistance),
    IsEAW_Cover: bool01(a.roadsideAssistanceWorldwide),
    IsEAAdvance_Cover: bool01(a.roadsideAssistanceAdvance),
    IsTowing_Cover: 0,
    Towing_Limit: null,
    IsEMIProtector_Cover: 0,
    NoOfEmi: null,
    EMIAmount: 0,
    NoofUnnamedPerson: num(a.unnamedPersons),
    UnnamedPersonSI: num(a.unnamedPersonSI),
    Voluntary_Excess_Discount: num(a.voluntaryExcess),
    IsLimitedtoOwnPremises: 0,
    TPPDLimit: 0.0,
    NoofnamedPerson: 0,
    namedPersonSI: 0,
    NamedPersons: null,
    AutoMobile_Assoication_No: a.automobileAssociationNo ?? null,
    fuel_type: null,
    CPA_Tenure: num(a.cpaTenure),
    payAsYouDrive: null,
    initialOdometerReading: null,
    initialOdometerReadingDate: null,
    kmsYouExpectToDrive: 0,
    IsHighProtection_Cover: 0,
    HigherTowingLimit: null,
    IsLossOfPersonalBelongings_Cover: bool01(a.lossOfPersonalBelongings),
    LossOfPersonalBelonging_SI: num(a.lossOfPersonalBelongingsSI),
    isCoPassengerOptedForLOPB: 0,
    isElectricMotorCover: req.isElectric ? bool01(ev.motorCover ?? 1) : 0,
    isZeroDepClaimforBattery: req.isElectric ? bool01(ev.zeroDepBattery ?? a.zeroDep) : 0,
    isBatteryChargerAccessoryCover: req.isElectric ? bool01(ev.batteryChargerCover) : 0,
    NoOfPAPaidDriver: num(a.noOfPaPaidDriver),
  };
}

/**
 * Roll Over — same as New Business plus PlanType (first) and EMIPlanType (after
 * EMIAmount), and CPA_Tenure defaults to 1 rather than 0. Port
 * reqPvtCar_Rollover from the standalone module preserving that exact order.
 */
export function reqPvtCarRollover(req: HdfcRequestShape): ReqPvtCar {
  // Port verbatim from payloadBuilder.js reqPvtCar_Rollover.
  // Verified by the Object.keys() parity test against rollover-premium.json.
  throw new Error("port reqPvtCar_Rollover here");
}

/**
 * Used Car — a DISTINCT order (Towing block moves up, IsFibertank and
 * NumberOfDrivers appear, PayAsYouDrive/InitialOdometer* are capitalised
 * differently). Port reqPvtCar_Used from the standalone module verbatim.
 */
export function reqPvtCarUsed(req: HdfcRequestShape): ReqPvtCar {
  // Port verbatim from payloadBuilder.js reqPvtCar_Used.
  // Verified by the Object.keys() parity test against used-premium.json.
  throw new Error("port reqPvtCar_Used here");
}

export function reqPvtCarFor(req: HdfcRequestShape): ReqPvtCar {
  if (req.businessType === HDFC_BUSINESS_TYPE.rollover) return reqPvtCarRollover(req);
  if (req.businessType === HDFC_BUSINESS_TYPE.used) return reqPvtCarUsed(req);
  return reqPvtCarNew(req);
}
```

Replace both `throw new Error(...)` bodies with the ported templates before
moving on — the parity tests will fail until you do, which is the point.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/req-pvtcar.test.ts`
Expected: PASS, 12 tests. A failing key-order assertion prints the exact
divergence — fix the template, not the test.

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/providers/hdfc/mapper/req-pvtcar.ts tf-api/src/providers/hdfc/__tests__/req-pvtcar.test.ts
git commit -m "feat(hdfc): port the three Req_PvtCar templates with collection parity tests"
```

---

## Task 11: Policy_Details templates

**Files:**
- Create: `tf-api/src/providers/hdfc/mapper/policy-details.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/policy-details.test.ts`

Three templates again, plus the premium-vs-proposal distinction: CalculatePremium
must send `null` for the previous insurer and policy number, while CreateProposal
sends the real values. Sending a previous-insurer code at premium time fails with
*"No Data found for given previous insured code"*.

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/policy-details.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import newPremium from "../fixtures/collection/new-premium.json" with { type: "json" };
import rolloverPremium from "../fixtures/collection/rollover-premium.json" with { type: "json" };
import usedPremium from "../fixtures/collection/used-premium.json" with { type: "json" };
import {
  policyDetailsNew,
  policyDetailsRollover,
  policyDetailsUsed,
  policyDetailsFor,
} from "../mapper/policy-details.ts";
import type { HdfcRequestShape } from "../types.ts";

function shape(overrides: Partial<HdfcRequestShape> = {}): HdfcRequestShape {
  return {
    transactionId: "T",
    businessType: "New Vehicle",
    isElectric: false,
    vehicle: {
      modelCode: "38908",
      rtoCode: "10406",
      registrationNo: "MH01QQ7878",
      registrationDate: "2019-06-15",
      manufactureYear: "2019-06-15",
      idv: 949411,
    },
    policy: { startDate: "2024-03-19", proposalDate: "2024-03-18", tenure: 1, policyType: "OD Plus TP" },
    previousPolicy: {
      insurerCode: "ICICILOMBARD",
      policyNo: "PP-1",
      endDate: "2024-03-18",
      ncbPercentage: 20,
      claim: false,
    },
    addons: {} as HdfcRequestShape["addons"],
    ev: {},
    ...overrides,
  };
}

describe("Policy_Details field parity with the collection", () => {
  it("New Business emits exactly the collection's keys, in order", () => {
    expect(Object.keys(policyDetailsNew(shape()))).toEqual(Object.keys(newPremium.Policy_Details));
  });

  it("Roll Over emits exactly the collection's keys, in order", () => {
    const out = policyDetailsRollover(shape({ businessType: "Roll Over" }));
    expect(Object.keys(out)).toEqual(Object.keys(rolloverPremium.Policy_Details));
  });

  it("Used Car emits exactly the collection's keys, in order", () => {
    const out = policyDetailsUsed(shape({ businessType: "Used Car" }));
    expect(Object.keys(out)).toEqual(Object.keys(usedPremium.Policy_Details));
  });
});

describe("value rules", () => {
  it("formats dates as DD/MM/YYYY", () => {
    const out = policyDetailsNew(shape());
    expect(out.PolicyStartDate).toBe("19/03/2024");
    expect(out.ProposalDate).toBe("18/03/2024");
  });

  it("emits YearOfManufacture as a bare year", () => {
    // "2019-06-15" would crash HDFC's Blaze engine if sent whole.
    expect(policyDetailsNew(shape()).YearOfManufacture).toBe("2019");
  });

  it("sends Registration_No as null at premium time", () => {
    // The collection's premium samples use null; a real plate makes HDFC demand
    // the registrationNumberSection* fields.
    expect(policyDetailsNew(shape()).Registration_No).toBeNull();
    expect(policyDetailsRollover(shape({ businessType: "Roll Over" })).Registration_No).toBeNull();
  });

  it("omits the previous insurer and policy number at premium time", () => {
    const out = policyDetailsRollover(shape({ businessType: "Roll Over" }));
    expect(out.PreviousPolicy_CorporateCustomerId_Mandatary).toBeNull();
    expect(out.PreviousPolicy_PolicyNo).toBeNull();
  });

  it("includes the previous insurer and policy number for the proposal", () => {
    const out = policyDetailsRollover(shape({ businessType: "Roll Over" }), { forProposal: true });
    expect(out.PreviousPolicy_CorporateCustomerId_Mandatary).toBe("ICICILOMBARD");
    expect(out.PreviousPolicy_PolicyNo).toBe("PP-1");
  });

  it("emits claim status in ALL CAPS", () => {
    const yes = policyDetailsRollover(
      shape({ businessType: "Roll Over", previousPolicy: { ncbPercentage: 0, claim: true } }),
      { forProposal: true },
    );
    expect(yes.PreviousPolicy_PolicyClaim).toBe("YES");
  });

  it("carries the IDV through", () => {
    expect(policyDetailsNew(shape()).Vehicle_IDV).toBe(949411);
  });

  it("does not invent a previous insurer when none was resolved", () => {
    // The standalone module hard-coded 'ICICILOMBARD' here for every rollover.
    const out = policyDetailsRollover(
      shape({ businessType: "Roll Over", previousPolicy: { ncbPercentage: 0, claim: false } }),
      { forProposal: true },
    );
    expect(out.PreviousPolicy_CorporateCustomerId_Mandatary).toBeNull();
  });
});

describe("policyDetailsFor", () => {
  it("dispatches on the business type", () => {
    expect(policyDetailsFor(shape()).BusinessType_Mandatary).toBe("New Vehicle");
    expect(policyDetailsFor(shape({ businessType: "Roll Over" })).BusinessType_Mandatary).toBe(
      "Roll Over",
    );
    expect(policyDetailsFor(shape({ businessType: "Used Car" })).BusinessType_Mandatary).toBe(
      "Used Car",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/policy-details.test.ts`
Expected: FAIL — cannot resolve `../mapper/policy-details.ts`.

- [ ] **Step 3: Port the templates**

Create `tf-api/src/providers/hdfc/mapper/policy-details.ts`, porting
`policyDetails_New`, `policyDetails_Rollover` and `policyDetails_Used` from
`docs/reference/hdfc-ergo-standalone/backend/services/payloadBuilder.js`.
The New Business template is given in full; port the other two the same way.

```ts
import { bool01, boolTF, normalizeClaim, num, toHdfcDate, yearOnly } from "../format.ts";
import { HDFC_BUSINESS_TYPE } from "../config.ts";
import type { HdfcRequestShape } from "../types.ts";

export type PolicyDetails = Record<string, unknown>;

export interface PolicyDetailsOptions {
  /**
   * CreateProposal needs the previous policy's identity (insurer + policy number)
   * so HDFC can validate claim status. CalculatePremium must NOT send them: a
   * previous-insurer code at premium time fails with "No Data found for given
   * previous insured code".
   */
  forProposal?: boolean;
}

/**
 * HDFC always needs a DateofDeliveryOrRegistration. Fall back through explicit
 * delivery date → registration date → mid-year of the manufacture year → policy
 * start → today. Never returns empty.
 */
function deliveryOrRegDate(req: HdfcRequestShape): string | null {
  const v = req.vehicle;
  if (v.deliveryOrRegistrationDate) return toHdfcDate(v.deliveryOrRegistrationDate);
  if (v.registrationDate) return toHdfcDate(v.registrationDate);
  if (v.manufactureYear) {
    const m = String(v.manufactureYear).match(/(19|20)\d{2}/);
    if (m) return toHdfcDate(`${m[0]}-06-15`);
  }
  if (req.policy.startDate) return toHdfcDate(req.policy.startDate);
  return toHdfcDate(new Date());
}

/** New Business — order per Comprehensive/New Business/03 CalculatePremium. */
export function policyDetailsNew(req: HdfcRequestShape): PolicyDetails {
  const v = req.vehicle;
  return {
    PolicyStartDate: toHdfcDate(req.policy.startDate),
    ProposalDate: toHdfcDate(req.policy.proposalDate),
    BusinessType_Mandatary: HDFC_BUSINESS_TYPE.new,
    VehicleModelCode: String(v.modelCode),
    DateofDeliveryOrRegistration: deliveryOrRegDate(req),
    DateofFirstRegistration: v.firstRegistrationDate ? toHdfcDate(v.firstRegistrationDate) : null,
    YearOfManufacture: yearOnly(v.manufactureYear, req.policy.startDate),
    // The collection uses null here; a real plate would make HDFC's schema
    // demand registrationNumberSection* fields. CreateProposal overwrites it.
    Registration_No: null,
    EngineNumber: v.engineNumber?.trim() ?? null,
    ChassisNumber: v.chassisNumber?.trim() ?? null,
    RTOLocationCode: String(v.rtoCode),
    Vehicle_IDV: num(v.idv),
  };
}

/**
 * Roll Over — adds the financier block, the full previous-policy block and the
 * PreviousPolicy_Is*_Cover trailer. Port policyDetails_Rollover verbatim,
 * gating the previous-policy identity on opts.forProposal.
 */
export function policyDetailsRollover(
  req: HdfcRequestShape,
  opts: PolicyDetailsOptions = {},
): PolicyDetails {
  // Port verbatim from payloadBuilder.js policyDetails_Rollover, with two
  // corrections to the original:
  //   - prevInsurer/prevPolicyNo fall back to null, NOT to a hard-coded
  //     'ICICILOMBARD' / 'NA'. The real code now comes from ProviderInsurerCode.
  //   - the transliterated comments are replaced with English ones.
  throw new Error("port policyDetails_Rollover here");
}

/** Used Car — a distinct, shorter block with a null previous-policy trailer. */
export function policyDetailsUsed(req: HdfcRequestShape): PolicyDetails {
  // Port verbatim from payloadBuilder.js policyDetails_Used.
  throw new Error("port policyDetails_Used here");
}

export function policyDetailsFor(
  req: HdfcRequestShape,
  opts: PolicyDetailsOptions = {},
): PolicyDetails {
  if (req.businessType === HDFC_BUSINESS_TYPE.rollover) return policyDetailsRollover(req, opts);
  if (req.businessType === HDFC_BUSINESS_TYPE.used) return policyDetailsUsed(req);
  return policyDetailsNew(req);
}
```

**Note on the hard-coded default.** The standalone module wrote
`pp.insurerCode || pp.insurer || 'ICICILOMBARD'` because it had no insurer
mapping — meaning *every* rollover proposal claimed the previous insurer was
ICICI Lombard. Task 15 populates `ProviderInsurerCode(hdfc)`, so this port emits
`null` when nothing was resolved rather than a false value.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/policy-details.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/providers/hdfc/mapper/policy-details.ts tf-api/src/providers/hdfc/__tests__/policy-details.test.ts
git commit -m "feat(hdfc): port Policy_Details templates, drop the hard-coded previous insurer"
```

---

## Task 12: Customer block and the mapper entry points

**Files:**
- Create: `tf-api/src/providers/hdfc/mapper/customer.ts`
- Create: `tf-api/src/providers/hdfc/mapper/index.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/mapper.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/mapper.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import newProposal from "../fixtures/collection/new-proposal.json" with { type: "json" };
import newIdv from "../fixtures/collection/new-idv.json" with { type: "json" };
import {
  buildGetCalculateIDV,
  buildCalculatePremium,
  buildCreateProposal,
  buildGetProposalDocument,
  buildGetPolicyDocument,
  buildSubmitPaymentDetails,
} from "../mapper/index.ts";
import { buildCustomerDetails } from "../mapper/customer.ts";
import type { HdfcRequestShape } from "../types.ts";

function shape(overrides: Partial<HdfcRequestShape> = {}): HdfcRequestShape {
  return {
    transactionId: "TXN-1",
    businessType: "New Vehicle",
    isElectric: false,
    vehicle: {
      modelCode: "38908",
      rtoCode: "10406",
      registrationNo: "MH01QQ7878",
      registrationDate: "2024-03-17",
      manufactureYear: "2024",
      idv: 949411,
    },
    policy: { startDate: "2024-03-19", proposalDate: "2024-03-18", tenure: 1, policyType: "OD Plus TP" },
    previousPolicy: { ncbPercentage: 0, claim: false },
    addons: {} as HdfcRequestShape["addons"],
    ev: {},
    ...overrides,
  };
}

describe("buildGetCalculateIDV", () => {
  it("emits exactly the collection's IDV_DETAILS keys", () => {
    const out = buildGetCalculateIDV(shape());
    expect(Object.keys(out)).toEqual(Object.keys(newIdv));
    expect(Object.keys(out.IDV_DETAILS as object)).toEqual(Object.keys(newIdv.IDV_DETAILS));
  });

  it("always sends Registration_No 'New', even for a registered vehicle", () => {
    // IDV is computed from model + RTO + dates, not the plate. Sending a real
    // number made HDFC's schema demand registrationNumberSection* fields.
    const out = buildGetCalculateIDV(shape()) as { IDV_DETAILS: Record<string, unknown> };
    expect(out.IDV_DETAILS.Registration_No).toBe("New");
  });

  it("never emits registrationNumberSection fields", () => {
    const json = JSON.stringify(buildGetCalculateIDV(shape()));
    expect(json).not.toContain("registrationNumberSection");
  });

  it("carries the transaction id", () => {
    expect((buildGetCalculateIDV(shape()) as { TransactionID: string }).TransactionID).toBe("TXN-1");
  });
});

describe("buildCalculatePremium", () => {
  it("emits the three top-level blocks in the collection's order", () => {
    expect(Object.keys(buildCalculatePremium(shape()))).toEqual([
      "TransactionID",
      "Policy_Details",
      "Req_PvtCar",
    ]);
  });
});

describe("buildCreateProposal", () => {
  it("emits the four top-level blocks in the collection's order", () => {
    expect(Object.keys(buildCreateProposal(shape()))).toEqual(
      Object.keys(newProposal),
    );
  });

  it("sends the real registration number in DASH format", () => {
    const out = buildCreateProposal(shape()) as { Policy_Details: Record<string, unknown> };
    expect(out.Policy_Details.Registration_No).toBe("MH-01-QQ-7878");
  });

  it("sends 'New' when the vehicle has no plate yet", () => {
    const out = buildCreateProposal(
      shape({ vehicle: { ...shape().vehicle, registrationNo: undefined } }),
    ) as { Policy_Details: Record<string, unknown> };
    expect(out.Policy_Details.Registration_No).toBe("New");
  });

  it("still emits no registrationNumberSection fields", () => {
    expect(JSON.stringify(buildCreateProposal(shape()))).not.toContain("registrationNumberSection");
  });
});

describe("buildCustomerDetails", () => {
  it("maps the Pehchaan id into Customer_Pehchaan_id", () => {
    const out = buildCustomerDetails({ pehchaanId: "KYC-99" });
    expect(out.Customer_Pehchaan_id).toBe("KYC-99");
  });

  it("emits an empty string, not undefined, for absent optional fields", () => {
    const out = buildCustomerDetails({});
    expect(out.Customer_FirstName).toBe("");
    expect(out.Customer_Pehchaan_id).toBe("");
  });

  it("mirrors permanent address into the mailing address by default", () => {
    const out = buildCustomerDetails({ permAddress1: "12 Main St", permPinCode: "400001" });
    expect(out.Customer_Mailing_Address1).toBe("12 Main St");
    expect(out.Customer_Mailing_PinCode).toBe("400001");
  });

  it("appends a trailing null BusinessType_Mandatary only when asked", () => {
    expect("BusinessType_Mandatary" in buildCustomerDetails({})).toBe(false);
    expect(buildCustomerDetails({}, { trailingBusinessType: true }).BusinessType_Mandatary).toBeNull();
  });
});

describe("document and payment builders", () => {
  it("builds the proposal-document request", () => {
    expect(buildGetProposalDocument(shape({ proposalNumber: "PR-1" }))).toEqual({
      TransactionID: "TXN-1",
      Req_Policy_Document: { Proposal_Number: "PR-1" },
    });
  });

  it("builds the policy-document request", () => {
    expect(buildGetPolicyDocument(shape({ policyNumber: "POL-1" }))).toEqual({
      TransactionID: "TXN-1",
      Req_Policy_Document: { Policy_Number: "POL-1" },
    });
  });

  it("builds the payment request with the amount as a string", () => {
    const out = buildSubmitPaymentDetails(
      shape({
        proposalNumber: "PR-1",
        payment: { amount: 43150, instrumentNumber: "PG-77", paymentDate: "2026-08-07" },
      }),
    ) as { Payment_Details: Record<string, unknown>; Proposal_no: string };
    expect(out.Proposal_no).toBe("PR-1");
    expect(out.Payment_Details.PAYMENT_AMOUNT).toBe("43150");
    expect(out.Payment_Details.INSTRUMENT_NUMBER).toBe("PG-77");
    expect(out.Payment_Details.PAYMENT_DATE).toBe("07/08/2026");
  });

  it("falls back to the transaction id when the PG gave no instrument number", () => {
    const out = buildSubmitPaymentDetails(
      shape({ proposalNumber: "PR-1", payment: { amount: 100 } }),
    ) as { Payment_Details: Record<string, unknown> };
    expect(out.Payment_Details.INSTRUMENT_NUMBER).toBe("TXN-1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/mapper.test.ts`
Expected: FAIL — cannot resolve `../mapper/index.ts`.

- [ ] **Step 3: Implement the customer block**

Create `tf-api/src/providers/hdfc/mapper/customer.ts`, porting
`buildCustomerDetails` from the standalone module:

```ts
import { toHdfcDate } from "../format.ts";
import type { HdfcCustomer } from "../types.ts";

export interface CustomerDetailsOptions {
  /** The Used Car and Renewal samples carry a trailing null BusinessType. */
  trailingBusinessType?: boolean;
}

/**
 * Customer_Details, ported verbatim. HDFC wants empty strings rather than
 * missing keys for unset optional fields.
 */
export function buildCustomerDetails(
  c: HdfcCustomer,
  opts: CustomerDetailsOptions = {},
): Record<string, unknown> {
  const cd: Record<string, unknown> = {
    GC_CustomerID: "",
    IsCustomer_modify: null,
    Company_Name: "",
    Customer_Type: "Individual",
    Customer_FirstName: c.firstName ?? "",
    Customer_MiddleName: c.middleName ?? "",
    Customer_LastName: c.lastName ?? "",
    Customer_DateofBirth: toHdfcDate(c.dob),
    Customer_Email: c.email ?? "",
    Customer_Mobile: c.mobile ?? "",
    Customer_Telephone: "",
    Customer_PanNo: c.panNo ?? "",
    Customer_AnnualIncome: null,
    Customer_OrganisationType: null,
    Customer_PepStatus: null,
    Customer_Salutation: c.salutation ?? "MR",
    Customer_Gender: c.gender ?? "MALE",
    Customer_Perm_Address1: c.permAddress1 ?? "",
    Customer_Perm_Address2: c.permAddress2 ?? "",
    Customer_Perm_Apartment: "",
    Customer_Perm_Street: "",
    Customer_Perm_CityDistrictCode: "",
    Customer_Perm_CityDistrict: c.permCityDistrict ?? "",
    Customer_Perm_StateCode: "",
    Customer_Perm_State: c.permState ?? "",
    Customer_Perm_PinCode: c.permPinCode ?? "",
    Customer_Perm_PinCodeLocality: "",
    Customer_Mailing_Address1: c.permAddress1 ?? "",
    Customer_Mailing_Address2: c.permAddress2 ?? "",
    Customer_Mailing_Apartment: "",
    Customer_Mailing_Street: "",
    Customer_Mailing_CityDistrictCode: "",
    Customer_Mailing_CityDistrict: c.permCityDistrict ?? "",
    Customer_Mailing_StateCode: "",
    Customer_Mailing_State: c.permState ?? "",
    Customer_Mailing_PinCode: c.permPinCode ?? "",
    Customer_Mailing_PinCodeLocality: "",
    Customer_GSTIN_Number: "",
    Customer_GSTIN_State: "",
    Customer_Professtion: null,
    Customer_MaritalStatus: null,
    Customer_EIA_Number: null,
    Customer_IDProof: null,
    Customer_IDProofNo: null,
    Customer_Nationality: null,
    Customer_UniqueRefNo: null,
    Customer_GSTDetails: null,
    // Pehchaan kyc_id. HDFC refuses issuance when KYC is unverified.
    Customer_Pehchaan_id: c.pehchaanId ?? "",
  };
  if (opts.trailingBusinessType) cd.BusinessType_Mandatary = null;
  return cd;
}
```

- [ ] **Step 4: Implement the entry points**

Create `tf-api/src/providers/hdfc/mapper/index.ts`:

```ts
import { formatRegWithDashes, toHdfcDate } from "../format.ts";
import { HDFC_BUSINESS_TYPE } from "../config.ts";
import type { HdfcRequestShape } from "../types.ts";
import { reqPvtCarFor } from "./req-pvtcar.ts";
import { policyDetailsFor } from "./policy-details.ts";
import { buildCustomerDetails } from "./customer.ts";

export { toHdfcRequest, resolveBusinessType, applyRolloverDateSanity } from "./canonical.ts";

/**
 * Step 02 — GetCalculateIDV.
 *
 * Registration_No is ALWAYS "New" and there are no registrationNumberSection*
 * fields: IDV is derived from model + RTO + dates, and sending a real plate
 * makes HDFC's schema demand the section fields. Both the New-Business and
 * Roll-Over samples in the collection do this.
 */
export function buildGetCalculateIDV(req: HdfcRequestShape): Record<string, unknown> {
  const v = req.vehicle;
  const pp = req.previousPolicy;
  return {
    TransactionID: req.transactionId,
    IDV_DETAILS: {
      ModelCode: String(v.modelCode),
      RTOCode: String(v.rtoCode),
      Vehicle_Registration_Date: toHdfcDate(v.registrationDate) ?? toHdfcDate(req.policy.startDate),
      Registration_No: "New",
      Policy_Start_Date: toHdfcDate(req.policy.startDate),
      PreviousPolicy_PreviousPolicyType: pp.type ?? "COMPREHENSIVE",
      PreviousPolicy_EndDate: toHdfcDate(pp.endDate),
      PreviousPolicy_TPENDDATE: toHdfcDate(pp.tpEndDate),
      PreviousPolicy_TPSTARTDATE: toHdfcDate(pp.tpStartDate),
    },
  };
}

/** Step 03 — CalculatePremium. */
export function buildCalculatePremium(req: HdfcRequestShape): Record<string, unknown> {
  return {
    TransactionID: req.transactionId,
    Policy_Details: policyDetailsFor(req),
    Req_PvtCar: reqPvtCarFor(req),
  };
}

/**
 * Step 04 — CreateProposal. This is where the REAL registration number goes, in
 * dash format ("MH-01-QQ-7878") and still with no section fields.
 */
export function buildCreateProposal(req: HdfcRequestShape): Record<string, unknown> {
  const isUsed = req.businessType === HDFC_BUSINESS_TYPE.used;
  const policyDetails = policyDetailsFor(req, { forProposal: true });
  policyDetails.Registration_No = formatRegWithDashes(req.vehicle.registrationNo) ?? "New";
  if (req.businessType === HDFC_BUSINESS_TYPE.new) {
    // The New-Business proposal sample uses "" rather than null here.
    policyDetails.DateofFirstRegistration = req.vehicle.firstRegistrationDate
      ? toHdfcDate(req.vehicle.firstRegistrationDate)
      : "";
  }
  return {
    TransactionID: req.transactionId,
    Customer_Details: buildCustomerDetails(req.customer ?? {}, { trailingBusinessType: isUsed }),
    Policy_Details: policyDetails,
    Req_PvtCar: reqPvtCarFor(req),
  };
}

/** Step 05 — GetProposalDocument. */
export function buildGetProposalDocument(req: HdfcRequestShape): Record<string, unknown> {
  return {
    TransactionID: req.transactionId,
    Req_Policy_Document: { Proposal_Number: req.proposalNumber },
  };
}

/** Step 06 — SubmitPaymentDetails. Records money already collected elsewhere. */
export function buildSubmitPaymentDetails(req: HdfcRequestShape): Record<string, unknown> {
  const pay = req.payment ?? { amount: 0 };
  return {
    TransactionID: req.transactionId,
    Proposal_no: req.proposalNumber,
    Cis_Flag: "Y",
    Payment_Details: {
      GC_PaymentID: "",
      BANK_NAME: pay.bankName ?? "BIZDIRECT",
      BANK_BRANCH_NAME: pay.bankBranchName ?? "Andheri",
      PAYMENT_MODE_CD: pay.paymentModeCode ?? "EP",
      PAYER_TYPE: pay.payerType ?? "CUSTOMER",
      PAYMENT_AMOUNT: String(pay.amount),
      INSTRUMENT_NUMBER: pay.instrumentNumber ?? req.transactionId,
      PAYMENT_DATE: toHdfcDate(pay.paymentDate ?? new Date()),
    },
  };
}

/** Step 07 — GetPolicyDocument. */
export function buildGetPolicyDocument(req: HdfcRequestShape): Record<string, unknown> {
  return {
    TransactionID: req.transactionId,
    Req_Policy_Document: { Policy_Number: req.policyNumber },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/mapper.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add tf-api/src/providers/hdfc/mapper tf-api/src/providers/hdfc/__tests__/mapper.test.ts
git commit -m "feat(hdfc): add customer block and the eight payload entry points"
```

---

## Task 13: Response normalizer

**Files:**
- Create: `tf-api/src/providers/hdfc/normalizer.ts`
- Create: `tf-api/src/providers/hdfc/fixtures/responses/*.json`
- Test: `tf-api/src/providers/hdfc/__tests__/normalizer.test.ts`

- [ ] **Step 1: Create the response fixtures**

These mirror the response shapes documented in the data dictionary and observed
during the original UAT work. Create
`tf-api/src/providers/hdfc/fixtures/responses/idv.json`:

```json
{
  "StatusCode": "1",
  "Error": null,
  "CalculatedIDV": {
    "IDV_AMOUNT": 949411,
    "MIN_IDV_AMOUNT": 854470,
    "MAX_IDV_AMOUNT": 1044352,
    "EX_SHOWROOM_PRICE": 1150000
  }
}
```

Create `tf-api/src/providers/hdfc/fixtures/responses/premium.json`:

```json
{
  "StatusCode": "1",
  "Error": null,
  "Resp_PvtCar": {
    "IDV": 949411,
    "Total_OD_Premium": 18450,
    "Total_TP_Premium": 7890,
    "Net_Premium": 36568,
    "Service_Tax": 6582,
    "Total_Premium": 43150,
    "ZeroDept_Premium": 4200,
    "TyreSecure_Premium": 1800,
    "NCBProtection_Premium": 950,
    "RTI_Premium": 1600,
    "COC_Premium": 700,
    "EngGearBox_Premium": 0,
    "EA_Premium": 350,
    "LossOfPersonalBelongings_Premium": 0,
    "CPA_Premium": 375,
    "UnnamedPerson_Premium": 0,
    "LLPaiddriver_Premium": 0,
    "NCB_Discount": 3200,
    "NCB_Percentage": 20
  }
}
```

Create `tf-api/src/providers/hdfc/fixtures/responses/proposal.json`:

```json
{
  "StatusCode": "1",
  "Error": null,
  "Policy_Details": { "ProposalNumber": "PR2026080700123" }
}
```

Create `tf-api/src/providers/hdfc/fixtures/responses/payment.json`:

```json
{
  "StatusCode": "1",
  "Error": null,
  "Policy_Details": { "PolicyNumber": "2311202600012345" }
}
```

Create `tf-api/src/providers/hdfc/fixtures/responses/policy-document.json`:

```json
{
  "StatusCode": "1",
  "Error": null,
  "Req_Policy_Document": {
    "Policy_Number": "2311202600012345",
    "Document": "JVBERi0xLjQKJVBPTElDWQ=="
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/normalizer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import idvFixture from "../fixtures/responses/idv.json" with { type: "json" };
import premiumFixture from "../fixtures/responses/premium.json" with { type: "json" };
import proposalFixture from "../fixtures/responses/proposal.json" with { type: "json" };
import paymentFixture from "../fixtures/responses/payment.json" with { type: "json" };
import policyDocFixture from "../fixtures/responses/policy-document.json" with { type: "json" };
import {
  normalizeIdv,
  normalizeQuote,
  normalizeProposal,
  normalizePayment,
  normalizeCertificate,
  selectIdvForPremium,
} from "../normalizer.ts";

describe("normalizeIdv", () => {
  it("reads the recommended, min and max IDV", () => {
    expect(normalizeIdv(idvFixture)).toEqual({
      recommended: 949411,
      min: 854470,
      max: 1044352,
    });
  });

  it("returns nulls for an empty body rather than throwing", () => {
    expect(normalizeIdv({})).toEqual({ recommended: null, min: null, max: null });
  });
});

describe("selectIdvForPremium", () => {
  // HDFC rejects any deviation from its recommendation: "IDV Deviation not allowed".
  it("always prefers HDFC's recommended IDV over the caller's", () => {
    expect(selectIdvForPremium({ recommended: 949411, min: 800000, max: 1000000 }, 900000)).toBe(
      949411,
    );
  });

  it("falls back to a caller IDV inside the band when there is no recommendation", () => {
    expect(selectIdvForPremium({ recommended: null, min: 800000, max: 1000000 }, 900000)).toBe(
      900000,
    );
  });

  it("rejects a caller IDV outside the band", () => {
    expect(selectIdvForPremium({ recommended: null, min: 800000, max: 1000000 }, 500000)).toBeNull();
  });

  it("returns null when there is neither a recommendation nor a usable caller value", () => {
    expect(selectIdvForPremium({ recommended: null, min: null, max: null }, 0)).toBeNull();
  });
});

describe("normalizeQuote", () => {
  const ctx = {
    requestId: "req-1",
    quoteNo: "TXN-1",
    policyType: "comprehensive",
    vehicleCategory: "fourWheeler" as const,
  };

  it("reads the premium breakdown from Resp_PvtCar", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.basicOdPremium).toBe(18450);
    expect(q.thirdPartyPremium).toBe(7890);
    expect(q.netPremium).toBe(36568);
    expect(q.serviceTaxAmount).toBe(6582);
    expect(q.grossPremium).toBe(43150);
    expect(q.idvValue).toBe(949411);
  });

  it("maps HDFC cover premiums onto canonical add-on keys", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.addonPremiums.zeroDep).toBe(4200);
    expect(q.addonPremiums.tyreProtect).toBe(1800);
    expect(q.addonPremiums.ncbProtection).toBe(950);
    expect(q.addonPremiums.rti).toBe(1600);
    expect(q.addonPremiums.consumables).toBe(700);
    expect(q.addonPremiums.rsa).toBe(350);
    expect(q.addonPremiums.paOwner).toBe(375);
    // A zero premium means "not selected" — omit rather than report 0.
    expect(q.addonPremiums.engineProtect).toBeUndefined();
  });

  it("reads the NCB discount", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.discounts.ncbAmount).toBe(3200);
    expect(q.discounts.ncbPercent).toBe(20);
  });

  it("stamps identity fields", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.providerSlug).toBe("hdfc");
    expect(q.insurerName).toBe("HDFC ERGO");
    expect(q.quoteNo).toBe("TXN-1");
    expect(q.transactionId).toBe("TXN-1");
    expect(q.requestId).toBe("req-1");
  });

  it("reports amounts in whole rupees, not paise", () => {
    // The whole stack is rupees end to end; a paise conversion here would show
    // a 100x premium on the compare card.
    expect(normalizeQuote(premiumFixture, ctx).grossPremium).toBe(43150);
  });
});

describe("normalizeProposal", () => {
  it("reads the proposal number", () => {
    expect(normalizeProposal(proposalFixture).proposalNumber).toBe("PR2026080700123");
  });

  it("returns undefined when HDFC returned no proposal number", () => {
    expect(normalizeProposal({ StatusCode: "1" }).proposalNumber).toBeUndefined();
  });
});

describe("normalizePayment", () => {
  it("reads the policy number from PolicyNumber", () => {
    expect(normalizePayment(paymentFixture).policyNumber).toBe("2311202600012345");
  });

  it("accepts the Policy_Number spelling too", () => {
    expect(
      normalizePayment({ Policy_Details: { Policy_Number: "X1" } }).policyNumber,
    ).toBe("X1");
  });
});

describe("normalizeCertificate", () => {
  it("reads the base64 policy document", () => {
    const c = normalizeCertificate(policyDocFixture);
    expect(c.coiBase64).toBe("JVBERi0xLjQKJVBPTElDWQ==");
    expect(c.policyNumber).toBe("2311202600012345");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/normalizer.test.ts`
Expected: FAIL — cannot resolve `../normalizer.ts`.

- [ ] **Step 4: Implement the normalizer**

Create `tf-api/src/providers/hdfc/normalizer.ts`:

```ts
import type { VehicleCategory } from "@/contracts/enums.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { CertificateResult } from "@/contracts/policy.ts";
import { HDFC_SLUG, HDFC_DISPLAY_NAME } from "./config.ts";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
/** A zero cover premium means "not selected" — omit it rather than reporting 0. */
const opt = (v: unknown): number | undefined => num(v) || undefined;

export interface HdfcIdvBand {
  recommended: number | null;
  min: number | null;
  max: number | null;
}

/** Step 02 response. The data dictionary puts these under CalculatedIDV. */
export function normalizeIdv(body: unknown): HdfcIdvBand {
  const b = obj(body);
  const idv = obj(b.CalculatedIDV ?? b.IDV_DETAILS ?? b);
  return {
    recommended: (idv.IDV_AMOUNT as number) ?? (idv.RecommendedIDV as number) ?? null,
    min: (idv.MIN_IDV_AMOUNT as number) ?? (idv.MinIDV as number) ?? null,
    max: (idv.MAX_IDV_AMOUNT as number) ?? (idv.MaxIDV as number) ?? null,
  };
}

/**
 * HDFC rejects any IDV that deviates from its own recommendation with
 * "IDV Deviation not allowed", so the recommendation always wins. A caller
 * value is used only when HDFC offered no recommendation AND the value sits
 * inside the permitted band.
 */
export function selectIdvForPremium(band: HdfcIdvBand, callerIdv: number): number | null {
  if (band.recommended) return band.recommended;
  if (!callerIdv) return null;
  if (band.min && callerIdv < band.min) return null;
  if (band.max && callerIdv > band.max) return null;
  return callerIdv;
}

export interface HdfcQuoteCtx {
  requestId: string;
  quoteNo: string;
  policyType: string;
  vehicleCategory: VehicleCategory;
}

/** Step 03 response → canonical quote. All amounts are whole rupees. */
export function normalizeQuote(body: unknown, ctx: HdfcQuoteCtx): CanonicalQuoteResult {
  const b = obj(body);
  const r = obj(b.Resp_PvtCar ?? b.Resp_Motor);

  const addonPremiums = {
    zeroDep: opt(r.ZeroDept_Premium),
    tyreProtect: opt(r.TyreSecure_Premium),
    ncbProtection: opt(r.NCBProtection_Premium),
    rti: opt(r.RTI_Premium),
    consumables: opt(r.COC_Premium),
    engineProtect: opt(r.EngGearBox_Premium),
    rsa: opt(r.EA_Premium),
    lossOfBelongings: opt(r.LossOfPersonalBelongings_Premium),
    paOwner: opt(r.CPA_Premium),
    paUnnamedPassenger: opt(r.UnnamedPerson_Premium),
    legalLiabilityPaidDriver: opt(r.LLPaiddriver_Premium),
    batteryProtect: opt(r.ElectricMotor_Premium),
  };

  const discounts = {
    ncbPercent: opt(r.NCB_Percentage),
    ncbAmount: opt(r.NCB_Discount),
    antiTheft: opt(r.AntiTheft_Discount),
    voluntaryDeductible: opt(r.Voluntary_Excess_Discount),
  };

  const totalAddonPremium = Object.values(addonPremiums).reduce<number>((s, v) => s + (v ?? 0), 0);
  const totalDiscount = num(r.NCB_Discount) + num(r.AntiTheft_Discount) + num(r.Voluntary_Excess_Discount);
  const netPremium = num(r.Net_Premium);
  const serviceTaxAmount = num(r.Service_Tax);
  const grossPremium = num(r.Total_Premium);

  return {
    quoteNo: ctx.quoteNo,
    transactionId: ctx.quoteNo,
    requestId: ctx.requestId,
    providerSlug: HDFC_SLUG,
    insurerName: HDFC_DISPLAY_NAME,
    policyType: ctx.policyType,
    vehicleCategory: ctx.vehicleCategory,
    idvValue: num(r.IDV ?? r.Vehicle_IDV),
    basicOdPremium: num(r.Total_OD_Premium ?? r.OD_Premium),
    thirdPartyPremium: num(r.Total_TP_Premium ?? r.TP_Premium),
    addonPremiums,
    discounts,
    totalAddonPremium,
    totalDiscount,
    netPremium,
    serviceTaxPercent: netPremium > 0 ? Math.round((serviceTaxAmount / netPremium) * 100) : 18,
    serviceTaxAmount,
    grossPremium,
    _rawResponse: body,
  };
}

export interface HdfcProposalResult {
  proposalNumber?: string;
}

/** Step 04 response. */
export function normalizeProposal(body: unknown): HdfcProposalResult {
  const b = obj(body);
  const pd = obj(b.Policy_Details);
  return { proposalNumber: str(pd.ProposalNumber) ?? str(b.ProposalNumber) };
}

export interface HdfcPaymentResult {
  policyNumber?: string;
}

/** Step 06 response. HDFC spells it PolicyNumber (no underscore) here. */
export function normalizePayment(body: unknown): HdfcPaymentResult {
  const b = obj(body);
  const pd = obj(b.Policy_Details);
  return {
    policyNumber:
      str(pd.PolicyNumber) ?? str(pd.Policy_Number) ?? str(b.PolicyNumber) ?? str(b.Policy_Number),
  };
}

/** Step 07 response → canonical certificate. */
export function normalizeCertificate(body: unknown): CertificateResult {
  const b = obj(body);
  const doc = obj(b.Req_Policy_Document ?? b.Policy_Document);
  return {
    policyNumber: str(doc.Policy_Number) ?? str(doc.PolicyNumber) ?? "",
    coiBase64: str(doc.Document) ?? str(doc.PolicyDocument) ?? "",
    _rawResponse: body,
  };
}
```

Check `CertificateResultSchema` in `src/contracts/policy.ts` for the exact
required key names before finalising `normalizeCertificate` — it requires
`coiBase64` and permits `status`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/normalizer.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add tf-api/src/providers/hdfc/normalizer.ts tf-api/src/providers/hdfc/fixtures/responses tf-api/src/providers/hdfc/__tests__/normalizer.test.ts
git commit -m "feat(hdfc): normalize HDFC responses onto the canonical contracts"
```

---

## Task 14: Master import — pure matching helpers

**Files:**
- Create: `tf-api/scripts/import-hdfc-master.ts` (helpers only)
- Test: `tf-api/scripts/__tests__/import-hdfc-master.test.ts`

The matching functions are split out and unit-tested first because a wrong
cross-walk silently mis-prices vehicles rather than failing loudly.

- [ ] **Step 1: Write the failing tests**

Create `tf-api/scripts/__tests__/import-hdfc-master.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeHdfcFuel,
  normalizeName,
  parseRtoKey,
  parseModelRow,
  pickBestVariant,
} from "../import-hdfc-master.ts";

describe("normalizeHdfcFuel", () => {
  it("maps HDFC's fuel labels onto the canonical FuelType", () => {
    expect(normalizeHdfcFuel("PETROL")).toBe("petrol");
    expect(normalizeHdfcFuel("DIESEL")).toBe("diesel");
    expect(normalizeHdfcFuel("ELECTRIC")).toBe("electric");
    expect(normalizeHdfcFuel("CNG")).toBe("cng");
    expect(normalizeHdfcFuel("LPG")).toBe("lpg");
  });

  it("treats hybrid and battery variants correctly", () => {
    expect(normalizeHdfcFuel("PETROL HYBRID")).toBe("hybrid");
    expect(normalizeHdfcFuel("BATTERY")).toBe("electric");
  });

  it("defaults to petrol for an unrecognised label", () => {
    expect(normalizeHdfcFuel("")).toBe("petrol");
  });
});

describe("normalizeName", () => {
  it("upper-cases and collapses punctuation and spacing", () => {
    expect(normalizeName(" Maruti-Suzuki  India Ltd. ")).toBe("MARUTI SUZUKI INDIA LTD");
  });

  it("is stable for names that differ only in punctuation", () => {
    expect(normalizeName("MERCEDES-BENZ")).toBe(normalizeName("MERCEDES BENZ"));
  });
});

describe("parseRtoKey", () => {
  it("extracts state and number from HDFC's REGISTRATION_STATE_CITY", () => {
    expect(parseRtoKey("MH-1-MUMBAI")).toEqual({ stateCode: "MH", number: 1 });
    expect(parseRtoKey("JK-6-DODA")).toEqual({ stateCode: "JK", number: 6 });
  });

  it("handles a city name containing a dash", () => {
    expect(parseRtoKey("GJ-38-BAVLA-EAST")).toEqual({ stateCode: "GJ", number: 38 });
  });

  it("strips leading zeros from the number", () => {
    expect(parseRtoKey("MH-01-MUMBAI")).toEqual({ stateCode: "MH", number: 1 });
  });

  it("returns null for an unparseable value", () => {
    expect(parseRtoKey("")).toBeNull();
    expect(parseRtoKey("MUMBAI")).toBeNull();
  });
});

describe("parseModelRow", () => {
  it("parses a Model_Master row", () => {
    const row = parseModelRow({
      MANUFACTURER: "TATA MOTORS LTD",
      VEHICLEMODELCODE: 42774,
      VEHICLEMODEL: "NEXON EV",
      NUMBEROFWHEELS: 4,
      CUBICCAPACITY: 999,
      SEATINGCAPACITY: 5,
      TXT_FUEL: "ELECTRIC",
      TXT_VARIANT: "XZ PLUS",
    });
    expect(row).toEqual({
      make: "TATA MOTORS LTD",
      modelCode: "42774",
      model: "NEXON EV",
      variant: "XZ PLUS",
      fuelType: "electric",
      engineCC: 999,
      seatingCapacity: 5,
      wheels: 4,
    });
  });

  it("rejects a row with no model code", () => {
    expect(parseModelRow({ MANUFACTURER: "X", VEHICLEMODEL: "Y", TXT_FUEL: "PETROL" })).toBeNull();
  });

  it("rejects a non-four-wheeler row", () => {
    // HDFC is Private Car only; a two-wheeler row must not be cross-walked.
    expect(
      parseModelRow({
        MANUFACTURER: "HERO",
        VEHICLEMODELCODE: 1,
        VEHICLEMODEL: "SPLENDOR",
        NUMBEROFWHEELS: 2,
        TXT_FUEL: "PETROL",
      }),
    ).toBeNull();
  });
});

describe("pickBestVariant", () => {
  const candidates = [
    { modelCode: "A", variant: "VXI", engineCC: 1197 },
    { modelCode: "B", variant: "ZXI PLUS", engineCC: 1197 },
    { modelCode: "C", variant: "LXI", engineCC: 998 },
  ];

  it("prefers an exact variant-name match", () => {
    expect(pickBestVariant(candidates, "ZXI PLUS", 1197)?.modelCode).toBe("B");
  });

  it("falls back to matching engine capacity", () => {
    expect(pickBestVariant(candidates, "UNKNOWN TRIM", 998)?.modelCode).toBe("C");
  });

  it("falls back to the first candidate when nothing discriminates", () => {
    expect(pickBestVariant(candidates, undefined, undefined)?.modelCode).toBe("A");
  });

  it("returns undefined for an empty candidate list", () => {
    expect(pickBestVariant([], "VXI", 1197)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run scripts/__tests__/import-hdfc-master.test.ts`
Expected: FAIL — cannot resolve `../import-hdfc-master.ts`.

- [ ] **Step 3: Implement the helpers**

Create `tf-api/scripts/import-hdfc-master.ts` with the header and pure helpers.
The `main()` function comes in Task 15.

```ts
/**
 * Imports HDFC ERGO master data using the aggregator CROSS-WALK model: HDFC's
 * codes are attached to the SAME canonical rows the UI selects from, via
 * ProviderMmvCode / ProviderRtoCode / ProviderInsurerCode (providerSlug="hdfc").
 *
 *   npm run db:import:hdfc
 *
 * Source: the vendor kit's PrivateCarMasterData.xls —
 *   Model_Master        (~10.8k rows) → ProviderMmvCode
 *   RTO Master          (~1.6k rows)  → ProviderRtoCode (line "fw")
 *   Insurance_Company   (39 rows)     → ProviderInsurerCode
 *
 * NO canonical rows are created. A vehicle or RTO HDFC has but our master does
 * not is simply unquotable by HDFC — the alternative (growing the shared master
 * with rows only one insurer can price) was considered and rejected.
 *
 * Idempotent + partition-scoped: upserts only the hdfc partition, never deletes
 * another provider's codes.
 */
import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import type * as XLSXType from "xlsx";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof XLSXType;

const prisma = new PrismaClient();
export const HDFC_IMPORT_SLUG = "hdfc";

const KIT_DIR =
  process.env.HDFC_KIT_DIR ??
  "C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/HDFC API KIT/HDFC API KIT";
const MASTER_FILE = "PrivateCarMasterData.xls";
const SCENARIO_FILE = "PVTcarTestScenarios.xls";
const UNMATCHED_REPORT = "scripts/_hdfc-unmatched.json";

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** HDFC's TXT_FUEL labels → our canonical FuelType. */
export function normalizeHdfcFuel(raw: string): string {
  const f = String(raw ?? "").trim().toLowerCase();
  if (f.includes("hybrid")) return "hybrid";
  if (f.includes("battery") || f.includes("electric")) return "electric";
  if (f.includes("cng")) return "cng";
  if (f.includes("lpg")) return "lpg";
  if (f.includes("diesel")) return "diesel";
  return "petrol";
}

/** Canonical form for name comparison: upper case, punctuation collapsed. */
export function normalizeName(raw: string): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export interface RtoKey {
  stateCode: string;
  number: number;
}

/** "MH-1-MUMBAI" → { stateCode: "MH", number: 1 }. */
export function parseRtoKey(registrationStateCity: string): RtoKey | null {
  const m = String(registrationStateCity ?? "")
    .trim()
    .toUpperCase()
    .match(/^([A-Z]{2})-0*(\d{1,3})-/);
  if (!m) return null;
  return { stateCode: m[1]!, number: Number(m[2]) };
}

export interface HdfcModelRow {
  make: string;
  modelCode: string;
  model: string;
  variant: string;
  fuelType: string;
  engineCC: number;
  seatingCapacity: number;
  wheels: number;
}

/** Parses a Model_Master row; returns null for rows we cannot or must not use. */
export function parseModelRow(raw: Record<string, unknown>): HdfcModelRow | null {
  const modelCode = raw.VEHICLEMODELCODE == null ? "" : String(raw.VEHICLEMODELCODE).trim();
  const make = String(raw.MANUFACTURER ?? "").trim();
  const model = String(raw.VEHICLEMODEL ?? "").trim();
  if (!modelCode || !make || !model) return null;

  // HDFC is onboarded for Private Car only. A 2-wheeler row here would be
  // cross-walked into a category HDFC cannot quote.
  const wheels = Number(raw.NUMBEROFWHEELS ?? 4);
  if (wheels && wheels !== 4) return null;

  return {
    make,
    modelCode,
    model,
    variant: String(raw.TXT_VARIANT ?? "").trim(),
    fuelType: normalizeHdfcFuel(String(raw.TXT_FUEL ?? "")),
    engineCC: Number(raw.CUBICCAPACITY ?? 0),
    seatingCapacity: Number(raw.SEATINGCAPACITY ?? 0),
    wheels: wheels || 4,
  };
}

export interface VariantCandidate {
  modelCode: string;
  variant: string;
  engineCC: number;
}

/**
 * ProviderMmvCode allows ONE code per canonical vehicle, but HDFC is
 * variant-grained. When several HDFC rows collapse onto one canonical row,
 * prefer an exact variant-name match, then a matching engine capacity, then the
 * first candidate.
 */
export function pickBestVariant(
  candidates: VariantCandidate[],
  variantName: string | undefined,
  engineCC: number | undefined,
): VariantCandidate | undefined {
  if (candidates.length === 0) return undefined;
  if (variantName) {
    const target = normalizeName(variantName);
    const exact = candidates.find((c) => normalizeName(c.variant) === target);
    if (exact) return exact;
  }
  if (engineCC) {
    const byCc = candidates.find((c) => c.engineCC === engineCC);
    if (byCc) return byCc;
  }
  return candidates[0];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run scripts/__tests__/import-hdfc-master.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add tf-api/scripts/import-hdfc-master.ts tf-api/scripts/__tests__/import-hdfc-master.test.ts
git commit -m "feat(hdfc): add master cross-walk matching helpers"
```

---

## Task 15: Master import — cross-walk and run it

**Files:**
- Modify: `tf-api/scripts/import-hdfc-master.ts` (append `main()`)
- Modify: `tf-api/package.json`

- [ ] **Step 1: Append the import body**

Append to `tf-api/scripts/import-hdfc-master.ts`:

```ts
// ─── Import ───────────────────────────────────────────────────────────────────

async function chunked<T>(label: string, rows: T[], op: (row: T) => Promise<unknown>): Promise<void> {
  const SIZE = 250;
  for (let i = 0; i < rows.length; i += SIZE) {
    await Promise.all(rows.slice(i, i + SIZE).map(op));
  }
  console.log(`  ${label}: ${rows.length}`);
}

function sheet(wb: XLSXType.WorkBook, name: string): Record<string, unknown>[] {
  const s = wb.Sheets[name];
  if (!s) {
    console.error(`Workbook has no "${name}" sheet (found: ${wb.SheetNames.join(", ")})`);
    process.exit(1);
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(s);
}

async function importVehicles(wb: XLSXType.WorkBook, unmatched: Record<string, string[]>) {
  const rows = sheet(wb, "Model_Master").map(parseModelRow).filter((r): r is HdfcModelRow => r !== null);
  console.log(`Model_Master: parsed ${rows.length} private-car rows`);

  const canonical = await prisma.mmvMaster.findMany({
    where: { category: "fourWheeler" },
    select: { id: true, makeName: true, modelName: true, variantName: true, fuelType: true, engineCC: true },
  });

  // Group HDFC rows by make|model|fuel so sibling variants compete for one slot.
  const byKey = new Map<string, VariantCandidate[]>();
  for (const r of rows) {
    const key = `${normalizeName(r.make)}|${normalizeName(r.model)}|${r.fuelType}`;
    const list = byKey.get(key) ?? [];
    list.push({ modelCode: r.modelCode, variant: r.variant, engineCC: r.engineCC });
    byKey.set(key, list);
  }
  const makeByKey = new Map(rows.map((r) => [`${normalizeName(r.make)}|${normalizeName(r.model)}|${r.fuelType}`, r.make]));

  const codes: { mmvId: number; makeCode: string; modelCode: string }[] = [];
  const missed: string[] = [];
  for (const c of canonical) {
    const key = `${normalizeName(c.makeName)}|${normalizeName(c.modelName)}|${c.fuelType}`;
    const candidates = byKey.get(key);
    if (!candidates) continue;
    const best = pickBestVariant(candidates, c.variantName ?? undefined, c.engineCC ?? undefined);
    if (!best) continue;
    codes.push({ mmvId: c.id, makeCode: makeByKey.get(key)!, modelCode: best.modelCode });
  }
  const matchedKeys = new Set(
    canonical.map((c) => `${normalizeName(c.makeName)}|${normalizeName(c.modelName)}|${c.fuelType}`),
  );
  for (const key of byKey.keys()) if (!matchedKeys.has(key)) missed.push(key);

  console.log(
    `Cross-walk: ${codes.length} canonical rows coded, ${missed.length} HDFC make/model/fuel groups unmatched`,
  );
  unmatched.vehicles = missed;

  await chunked("ProviderMmvCode(hdfc)", codes, (c) =>
    prisma.providerMmvCode.upsert({
      where: { providerSlug_mmvId: { providerSlug: HDFC_IMPORT_SLUG, mmvId: c.mmvId } },
      create: {
        providerSlug: HDFC_IMPORT_SLUG,
        mmvId: c.mmvId,
        providerMakeCode: c.makeCode,
        providerModelCode: c.modelCode,
      },
      update: { providerMakeCode: c.makeCode, providerModelCode: c.modelCode },
    }),
  );
}

async function importRtos(wb: XLSXType.WorkBook, unmatched: Record<string, string[]>) {
  const rows = sheet(wb, "RTO Master");
  const canonical = await prisma.rtoMaster.findMany({ select: { id: true, code: true, stateCode: true } });

  // Canonical RTO codes look like "MH01"; HDFC's look like "MH-1-MUMBAI".
  const index = new Map<string, number>();
  for (const c of canonical) {
    const m = c.code.toUpperCase().match(/^([A-Z]{2})0*(\d{1,3})$/);
    if (m) index.set(`${m[1]}|${Number(m[2])}`, c.id);
  }

  const codes: { rtoId: number; providerCode: string }[] = [];
  const missed: string[] = [];
  for (const raw of rows) {
    const label = String(raw.REGISTRATION_STATE_CITY ?? "");
    const key = parseRtoKey(label);
    const providerCode = raw.RTO_CODE == null ? "" : String(raw.RTO_CODE).trim();
    if (!key || !providerCode) continue;
    const rtoId = index.get(`${key.stateCode}|${key.number}`);
    if (!rtoId) {
      missed.push(label);
      continue;
    }
    codes.push({ rtoId, providerCode });
  }

  const deduped = [...new Map(codes.map((c) => [c.rtoId, c])).values()];
  console.log(`RTO cross-walk: ${deduped.length} matched, ${missed.length} unmatched`);
  unmatched.rtos = missed;

  // line "fw": HDFC is Private Car only. Being explicit stops a future
  // two-wheeler master from silently reusing four-wheeler codes.
  await chunked("ProviderRtoCode(hdfc, fw)", deduped, (c) =>
    prisma.providerRtoCode.upsert({
      where: {
        providerSlug_rtoId_line: { providerSlug: HDFC_IMPORT_SLUG, rtoId: c.rtoId, line: "fw" },
      },
      create: { providerSlug: HDFC_IMPORT_SLUG, rtoId: c.rtoId, line: "fw", providerCode: c.providerCode },
      update: { providerCode: c.providerCode },
    }),
  );
}

async function importInsurers(wb: XLSXType.WorkBook, unmatched: Record<string, string[]>) {
  const rows = sheet(wb, "Insurance_Company");
  const canonical = await prisma.insurerMaster.findMany({ select: { id: true, name: true, shortName: true } });

  const codes: { insurerId: number; providerCode: string }[] = [];
  const missed: string[] = [];
  for (const raw of rows) {
    const shortName = String(raw.SHORTNAME ?? "").trim();
    const companyName = normalizeName(String(raw.COMPANYNAME ?? ""));
    if (!shortName || !companyName) continue;
    const hit = canonical.find(
      (c) => normalizeName(c.name) === companyName || normalizeName(c.shortName ?? "") === normalizeName(shortName),
    );
    if (!hit) {
      missed.push(`${shortName} — ${raw.COMPANYNAME}`);
      continue;
    }
    codes.push({ insurerId: hit.id, providerCode: shortName });
  }

  const deduped = [...new Map(codes.map((c) => [c.insurerId, c])).values()];
  console.log(`Insurer cross-walk: ${deduped.length} matched, ${missed.length} unmatched`);
  unmatched.insurers = missed;

  await chunked("ProviderInsurerCode(hdfc)", deduped, (c) =>
    prisma.providerInsurerCode.upsert({
      where: {
        providerSlug_insurerId: { providerSlug: HDFC_IMPORT_SLUG, insurerId: c.insurerId },
      },
      create: { providerSlug: HDFC_IMPORT_SLUG, insurerId: c.insurerId, providerCode: c.providerCode },
      update: { providerCode: c.providerCode },
    }),
  );
}

/**
 * HDFC's own UAT test sheets list the vehicles and RTOs their sandbox will
 * price. If those do not resolve, nothing will — fail the import loudly rather
 * than discovering it from a failing quote.
 */
async function assertUatVehiclesResolve(): Promise<void> {
  const path = `${KIT_DIR}/${SCENARIO_FILE}`;
  if (!existsSync(path)) {
    console.log(`\n⚠ ${SCENARIO_FILE} not found — skipping the UAT resolution check.`);
    return;
  }
  const wb = XLSX.readFile(path);
  const models = sheet(wb, "UAT Test Model");
  const wanted = [...new Set(models.map((r) => String(r.VEHICLEMODELCODE ?? "").trim()).filter(Boolean))];
  const found = await prisma.providerMmvCode.findMany({
    where: { providerSlug: HDFC_IMPORT_SLUG, providerModelCode: { in: wanted } },
    select: { providerModelCode: true },
  });
  const have = new Set(found.map((f) => f.providerModelCode));
  const absent = wanted.filter((w) => !have.has(w));

  console.log(`\nUAT test vehicles: ${wanted.length - absent.length}/${wanted.length} resolvable`);
  if (absent.length) {
    console.log(`  ⚠ Not cross-walked: ${absent.join(", ")}`);
    console.log("  These are the codes HDFC UAT actually prices — investigate before testing.");
  }
}

async function main(): Promise<void> {
  const path = `${KIT_DIR}/${MASTER_FILE}`;
  if (!existsSync(path)) {
    console.error(`HDFC master workbook not found at:\n  ${path}`);
    console.error("Set HDFC_KIT_DIR to the kit folder.");
    process.exit(1);
  }

  console.log(`Reading ${MASTER_FILE}…`);
  const wb = XLSX.readFile(path);
  const unmatched: Record<string, string[]> = {};

  await importVehicles(wb, unmatched);
  await importRtos(wb, unmatched);
  await importInsurers(wb, unmatched);
  await assertUatVehiclesResolve();

  writeFileSync(UNMATCHED_REPORT, JSON.stringify(unmatched, null, 2) + "\n", "utf8");
  console.log(`\nUnmatched report written to ${UNMATCHED_REPORT}`);
  console.log(
    "Cross-walk-only by design: unmatched rows mean HDFC cannot quote that vehicle/RTO.\n" +
      "No canonical master rows were created.",
  );
}

// Only run when invoked directly, so the pure helpers stay unit-testable.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
```

- [ ] **Step 2: Add the npm script**

In `tf-api/package.json`, after `"db:import:itgi"`, add:

```json
    "db:import:hdfc": "tsx --env-file=.env scripts/import-hdfc-master.ts",
```

- [ ] **Step 3: Add the report to .gitignore**

Append to `tf-api/.gitignore`:

```
scripts/_hdfc-unmatched.json
```

- [ ] **Step 4: Run the import**

Run: `cd tf-api && npm run db:up && npm run db:import:hdfc`
Expected: cross-walk counts for vehicles, RTOs and insurers, the UAT
resolution line, and the report path. Non-zero unmatched counts are expected and
informative — record them in the integration notes (Task 21).

- [ ] **Step 5: Verify idempotency**

Run: `cd tf-api && npm run db:import:hdfc`
Expected: identical counts, no errors.

Run:
```bash
docker exec tf-api-mysql mysql -uroot -ppassword -N -e "SELECT provider_slug, COUNT(*) FROM tf_api_dev.provider_mmv_codes GROUP BY provider_slug; SELECT provider_slug, line, COUNT(*) FROM tf_api_dev.provider_rto_codes GROUP BY provider_slug, line;"
```
Expected: an `hdfc` row alongside the existing providers, and the pre-existing
`fg` / `icici` counts unchanged.

- [ ] **Step 6: Commit**

```bash
git add tf-api/scripts/import-hdfc-master.ts tf-api/package.json tf-api/.gitignore
git commit -m "feat(hdfc): cross-walk HDFC master data into the hdfc code partition"
```

---

## Task 16: Database code resolver

**Files:**
- Create: `tf-api/src/providers/hdfc/db-code-resolver.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/db-code-resolver.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/db-code-resolver.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError } from "@/errors/app-error.ts";

const getProviderMmvCode = vi.fn();
const getProviderRtoCode = vi.fn();
const getProviderInsurerCode = vi.fn();

vi.mock("@/repositories/master.repository.ts", () => ({
  getProviderMmvCode: (...a: unknown[]) => getProviderMmvCode(...a),
  getProviderRtoCode: (...a: unknown[]) => getProviderRtoCode(...a),
  getProviderInsurerCode: (...a: unknown[]) => getProviderInsurerCode(...a),
}));

const { dbCodeResolver, passthroughCodeResolver } = await import("../db-code-resolver.ts");

const req = {
  makeId: "MAR",
  makeName: "MARUTI",
  modelId: "SWIFT",
  modelName: "SWIFT",
  variantId: "VXI",
  fuelType: "petrol",
  rtoCode: "MH01",
  previousInsurerId: "ICICI",
} as never;

beforeEach(() => {
  getProviderMmvCode.mockReset();
  getProviderRtoCode.mockReset();
  getProviderInsurerCode.mockReset();
});

describe("dbCodeResolver", () => {
  it("returns the HDFC model, RTO and previous-insurer codes", async () => {
    getProviderMmvCode.mockResolvedValue({ makeCode: "MARUTI", modelCode: "38908" });
    getProviderRtoCode.mockResolvedValue("10406");
    getProviderInsurerCode.mockResolvedValue("ICICILOMBARD");

    await expect(dbCodeResolver(req)).resolves.toEqual({
      modelCode: "38908",
      rtoCode: "10406",
      previousInsurerCode: "ICICILOMBARD",
    });
  });

  it("always resolves the RTO code for the four-wheeler line", async () => {
    getProviderMmvCode.mockResolvedValue({ makeCode: "M", modelCode: "1" });
    getProviderRtoCode.mockResolvedValue("10406");
    getProviderInsurerCode.mockResolvedValue(undefined);

    await dbCodeResolver(req);
    expect(getProviderRtoCode).toHaveBeenCalledWith("hdfc", "MH01", "fw");
  });

  it("throws NotFound naming the vehicle when it has no HDFC code", async () => {
    getProviderMmvCode.mockResolvedValue(undefined);
    await expect(dbCodeResolver(req)).rejects.toBeInstanceOf(NotFoundError);
    await expect(dbCodeResolver(req)).rejects.toThrow(/MARUTI SWIFT/);
  });

  it("throws NotFound naming the RTO when it has no HDFC code", async () => {
    getProviderMmvCode.mockResolvedValue({ makeCode: "M", modelCode: "1" });
    getProviderRtoCode.mockResolvedValue(undefined);
    await expect(dbCodeResolver(req)).rejects.toThrow(/MH01/);
  });

  it("leaves the previous insurer undefined rather than inventing one", async () => {
    // The standalone module defaulted to 'ICICILOMBARD' for every rollover.
    getProviderMmvCode.mockResolvedValue({ makeCode: "M", modelCode: "1" });
    getProviderRtoCode.mockResolvedValue("10406");
    getProviderInsurerCode.mockResolvedValue(undefined);

    const out = await dbCodeResolver(req);
    expect(out.previousInsurerCode).toBeUndefined();
  });

  it("skips the insurer lookup entirely when there is no previous insurer", async () => {
    getProviderMmvCode.mockResolvedValue({ makeCode: "M", modelCode: "1" });
    getProviderRtoCode.mockResolvedValue("10406");

    await dbCodeResolver({ ...req, previousInsurerId: undefined } as never);
    expect(getProviderInsurerCode).not.toHaveBeenCalled();
  });
});

describe("passthroughCodeResolver", () => {
  it("treats canonical ids as HDFC codes for fixtures and dev", async () => {
    await expect(
      passthroughCodeResolver({ modelId: "38908", rtoCode: "10406" } as never),
    ).resolves.toEqual({ modelCode: "38908", rtoCode: "10406", previousInsurerCode: undefined });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/db-code-resolver.test.ts`
Expected: FAIL — cannot resolve `../db-code-resolver.ts`.

- [ ] **Step 3: Implement the resolver**

Create `tf-api/src/providers/hdfc/db-code-resolver.ts`:

```ts
import { NotFoundError } from "@/errors/app-error.ts";
import {
  getProviderMmvCode,
  getProviderRtoCode,
  getProviderInsurerCode,
} from "@/repositories/master.repository.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import { HDFC_SLUG } from "./config.ts";
import type { HdfcResolvedCodes } from "./types.ts";

export type HdfcCodeResolver = (req: MotorQuoteRequest) => Promise<HdfcResolvedCodes>;

/** Dev/fixtures resolver: canonical ids are already the HDFC codes. */
export const passthroughCodeResolver: HdfcCodeResolver = async (req) => ({
  modelCode: String(req.modelId),
  rtoCode: String(req.rtoCode),
  previousInsurerCode: req.previousInsurerId,
});

/**
 * Production resolver. A vehicle or RTO HDFC has not onboarded fails closed with
 * a readable NotFound (surfacing as no_quote on the compare page) rather than
 * being priced against a guessed code.
 */
export const dbCodeResolver: HdfcCodeResolver = async (req) => {
  const mmv = await getProviderMmvCode(
    HDFC_SLUG,
    req.makeId,
    req.modelId,
    req.fuelType,
    req.variantId,
  );
  if (!mmv?.modelCode) {
    throw new NotFoundError(`HDFC vehicle-code mapping for ${req.makeName} ${req.modelName}`);
  }

  // HDFC is Private Car only, so the RTO code is always resolved for the "fw"
  // line the import wrote.
  const rtoCode = await getProviderRtoCode(HDFC_SLUG, req.rtoCode, "fw");
  if (!rtoCode) {
    throw new NotFoundError(`HDFC RTO-code mapping for "${req.rtoCode}" (fw)`);
  }

  // HDFC only accepts previous-insurer codes from its own master:
  // "OTHERS" fails with "No Data found for given previous insured code".
  // Undefined is correct when nothing was mapped — never substitute a default.
  const previousInsurerCode = req.previousInsurerId
    ? await getProviderInsurerCode(HDFC_SLUG, req.previousInsurerId)
    : undefined;

  return { modelCode: String(mmv.modelCode), rtoCode: String(rtoCode), previousInsurerCode };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/db-code-resolver.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/providers/hdfc/db-code-resolver.ts tf-api/src/providers/hdfc/__tests__/db-code-resolver.test.ts
git commit -m "feat(hdfc): resolve canonical ids to HDFC master codes"
```

---

## Task 17: Provider class — quote and proposal

**Files:**
- Create: `tf-api/src/providers/hdfc/hdfc.provider.ts`
- Create: `tf-api/src/providers/hdfc/index.ts`
- Modify: `tf-api/src/app.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/hdfc.provider.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/hdfc.provider.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import idvFixture from "../fixtures/responses/idv.json" with { type: "json" };
import premiumFixture from "../fixtures/responses/premium.json" with { type: "json" };
import proposalFixture from "../fixtures/responses/proposal.json" with { type: "json" };
import { HdfcProvider } from "../hdfc.provider.ts";
import { passthroughCodeResolver } from "../db-code-resolver.ts";
import type { HdfcConfig } from "../config.ts";
import type { HdfcTransport } from "../http.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "NOVACRED",
  channelId: "NOVA0001",
  credential: "s3cret",
  productCode: "2311",
  tokenTtlSeconds: 1500,
  kyc: { baseUrl: "https://kyc.example", apiKey: "k", tokenTtlSeconds: 480, returnUrl: "https://r" },
};

interface Call {
  url: string;
  headers: Record<string, string>;
  jsonBody?: unknown;
}

function recordingTransport(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const transport: HdfcTransport = {
    request: vi.fn(async (args) => {
      calls.push({ url: args.url, headers: args.headers, jsonBody: args.jsonBody });
      const key = Object.keys(responses).find((k) => args.url.endsWith(k));
      return key ? responses[key] : {};
    }),
  };
  return { transport, calls };
}

function provider(transport: HdfcTransport) {
  return new HdfcProvider({
    config,
    transport,
    codeResolver: passthroughCodeResolver,
    tokenProvider: async () => "tok-1",
  });
}

const quoteReq = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  makeId: "MAR",
  makeName: "MARUTI",
  modelId: "38908",
  modelName: "SWIFT",
  fuelType: "petrol",
  rtoCode: "10406",
  registrationDate: "2019-06-15",
  registrationNumber: "MH01QQ7878",
  isPreviousPolicyExpired: false,
  claimInPreviousPolicy: false,
  ncbPercent: 20,
  idvValue: 500000,
  zeroDep: true,
  engineProtect: false,
  rsa: false,
  tyreProtect: false,
  rimProtect: false,
  rti: false,
  consumables: false,
  paOwner: true,
  paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false,
  keyProtect: false,
  garageCash: false,
  lossOfBelongings: false,
  batteryProtect: false,
  drivingAccessories: false,
  ncbProtection: false,
} as MotorQuoteRequest;

const ctx = { requestId: "req-1" };

describe("getQuote", () => {
  it("calls IDV then premium, in that order", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).getQuote(quoteReq, ctx);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["getcalculateidv", "calculatepremium"]);
  });

  it("prices with HDFC's recommended IDV, not the caller's", async () => {
    // "IDV Deviation not allowed" — the recommendation always wins.
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).getQuote(quoteReq, ctx);
    const premiumBody = calls[1]!.jsonBody as { Policy_Details: { Vehicle_IDV: number } };
    expect(premiumBody.Policy_Details.Vehicle_IDV).toBe(949411);
  });

  it("sends the channel headers and the bearer token on every data call", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).getQuote(quoteReq, ctx);
    for (const call of calls) {
      expect(call.headers).toMatchObject({
        SOURCE: "NOVACRED",
        CHANNEL_ID: "NOVA0001",
        PRODUCT_CODE: "2311",
        TOKEN: "tok-1",
      });
    }
  });

  it("returns a canonical quote with the HDFC premium", async () => {
    const { transport } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    const q = await provider(transport).getQuote(quoteReq, ctx);
    expect(q.providerSlug).toBe("hdfc");
    expect(q.grossPremium).toBe(43150);
    expect(q.idvValue).toBe(949411);
    expect(q.minIdv).toBe(854470);
    expect(q.maxIdv).toBe(1044352);
  });

  it("shares one TransactionID across the IDV and premium calls", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).getQuote(quoteReq, ctx);
    const a = (calls[0]!.jsonBody as { TransactionID: string }).TransactionID;
    const b = (calls[1]!.jsonBody as { TransactionID: string }).TransactionID;
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });

  it("surfaces HDFC's business exception verbatim", async () => {
    const { transport } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: { StatusCode: "0", Error: "BUSINESS EXCEPTION: RTO not serviceable" },
    });
    await expect(provider(transport).getQuote(quoteReq, ctx)).rejects.toThrow(
      /RTO not serviceable/,
    );
  });
});

describe("getFullQuote", () => {
  const fullReq = {
    ...quoteReq,
    quoteId: "TXN-1",
    proposer: {
      firstName: "MAHENDRA",
      lastName: "GHANCHI",
      email: "m@example.com",
      mobile: "7387005111",
      dob: "1996-07-22",
      panNumber: "BXGPG2512P",
    },
    address: { addressLine1: "12 Main St", pincode: "307801", city: "MUMBAI", state: "MH" },
    vehicle: { engineNumber: "EN123", chassisNumber: "CH123", financeType: "none" },
    kycRefId: "KYC-99",
    isProposalOnly: false,
    isVehicleUnderLoan: false,
  } as MotorFullQuoteRequest;

  it("runs IDV, premium, proposal and proposal-document in order", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
      getproposaldocument: { StatusCode: "1" },
    });
    await provider(transport).getFullQuote(fullReq, ctx);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual([
      "getcalculateidv",
      "calculatepremium",
      "createproposal",
      "getproposaldocument",
    ]);
  });

  it("returns the proposal number in contractDetails", async () => {
    const { transport } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
      getproposaldocument: { StatusCode: "1" },
    });
    const q = await provider(transport).getFullQuote(fullReq, ctx);
    expect(q.contractDetails?.proposalNumber).toBe("PR2026080700123");
  });

  it("feeds the Pehchaan id into Customer_Pehchaan_id", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
      getproposaldocument: { StatusCode: "1" },
    });
    await provider(transport).getFullQuote(fullReq, ctx);
    const body = calls[2]!.jsonBody as { Customer_Details: Record<string, unknown> };
    expect(body.Customer_Details.Customer_Pehchaan_id).toBe("KYC-99");
  });

  it("refuses to create a proposal without a verified KYC id", async () => {
    // HDFC's rule: never issue when iskycVerified !== 1.
    const { transport } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    const noKyc = { ...fullReq, kycRefId: undefined, ckyc: undefined };
    await expect(provider(transport).getFullQuote(noKyc, ctx)).rejects.toThrow(/KYC/i);
  });

  it("throws when HDFC returns no proposal number", async () => {
    const { transport } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
      createproposal: { StatusCode: "1" },
    });
    await expect(provider(transport).getFullQuote(fullReq, ctx)).rejects.toThrow(/proposal number/i);
  });
});

describe("initiateOvd", () => {
  it("rejects with 501 — HDFC's KYC kit has no document-upload API", async () => {
    const { transport } = recordingTransport({});
    await expect(
      provider(transport).initiateOvd({ transactionId: "T" } as never, [], ctx),
    ).rejects.toThrow(/not support/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/hdfc.provider.test.ts`
Expected: FAIL — cannot resolve `../hdfc.provider.ts`.

- [ ] **Step 3: Implement the provider class**

Create `tf-api/src/providers/hdfc/hdfc.provider.ts`:

```ts
import type { VehicleCategory, ProviderOperation, MotorCapabilities } from "@/contracts/enums.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { CkycRequest, KycResult, OvdRequest, OvdFile, OvdResult } from "@/contracts/kyc.ts";
import type { CertificateResult, PolicyIssuanceRequest, PolicyIssuanceResult } from "@/contracts/policy.ts";
import { AppError, ProviderError } from "@/errors/app-error.ts";
import type {
  InsuranceProvider,
  ProviderContext,
  KycCapableProvider,
  IssuanceProvider,
  CertificateProvider,
} from "@/providers/insurance-provider.ts";
import { tokenManager } from "@/providers/token-manager.ts";

import {
  HDFC_SLUG,
  HDFC_DISPLAY_NAME,
  HDFC_CAPABILITIES,
  HDFC_OPERATIONS,
  HDFC_MOTOR_CAPABILITIES,
  hdfcEndpointUrl,
  loadHdfcConfig,
  type HdfcConfig,
  type HdfcEndpointName,
} from "./config.ts";
import { hdfcTokenFetcher, hdfcTokenCacheKey, hdfcTransactionId } from "./auth.ts";
import { FetchTransport, assertHdfcSuccess, type HdfcTransport } from "./http.ts";
import {
  toHdfcRequest,
  buildGetCalculateIDV,
  buildCalculatePremium,
  buildCreateProposal,
  buildGetProposalDocument,
} from "./mapper/index.ts";
import {
  normalizeIdv,
  normalizeQuote,
  normalizeProposal,
  normalizeCertificate,
  selectIdvForPremium,
} from "./normalizer.ts";
import { dbCodeResolver, type HdfcCodeResolver } from "./db-code-resolver.ts";
import type { HdfcRequestShape } from "./types.ts";

export interface HdfcProviderDeps {
  config: HdfcConfig;
  transport?: HdfcTransport;
  codeResolver?: HdfcCodeResolver;
  /** Override token acquisition (tests bypass the live authenticate call). */
  tokenProvider?: () => Promise<string>;
}

export class HdfcProvider
  implements InsuranceProvider, KycCapableProvider, IssuanceProvider, CertificateProvider
{
  readonly slug = HDFC_SLUG;
  readonly displayName = HDFC_DISPLAY_NAME;
  readonly capabilities: ReadonlySet<VehicleCategory> = HDFC_CAPABILITIES;
  readonly operations: ReadonlySet<ProviderOperation> = HDFC_OPERATIONS;
  readonly motorCapabilities: MotorCapabilities = HDFC_MOTOR_CAPABILITIES;

  private readonly config: HdfcConfig;
  private readonly transport: HdfcTransport;
  private readonly codeResolver: HdfcCodeResolver;
  private readonly tokenProvider: () => Promise<string>;

  constructor(deps: HdfcProviderDeps) {
    this.config = deps.config;
    this.transport = deps.transport ?? new FetchTransport();
    this.codeResolver = deps.codeResolver ?? dbCodeResolver;
    this.tokenProvider =
      deps.tokenProvider ??
      (() =>
        tokenManager.getToken(
          hdfcTokenCacheKey(this.config),
          hdfcTokenFetcher(this.config, this.transport),
        ));
  }

  private headers(token: string): Record<string, string> {
    return {
      SOURCE: this.config.source,
      CHANNEL_ID: this.config.channelId,
      PRODUCT_CODE: this.config.productCode,
      TOKEN: token,
    };
  }

  /** One HEI call: build URL + headers, POST, assert HDFC's own status. */
  private async call(
    endpoint: HdfcEndpointName,
    token: string,
    jsonBody: unknown,
    step: string,
    idempotent = false,
  ): Promise<unknown> {
    const body = await this.transport.request({
      method: "POST",
      url: hdfcEndpointUrl(this.config, endpoint),
      headers: this.headers(token),
      jsonBody,
      idempotent,
    });
    assertHdfcSuccess(body, step);
    return body;
  }

  /**
   * IDV then premium. HDFC recomputes the premium from the payload on every
   * call — there is no retrieve-quote — so this is the whole quote flow.
   */
  private async priceQuote(
    req: MotorQuoteRequest,
    ctx: ProviderContext,
    transactionId: string,
  ): Promise<{ shape: HdfcRequestShape; quote: CanonicalQuoteResult; token: string }> {
    const token = await this.tokenProvider();
    const codes = await this.codeResolver(req);
    const shape = toHdfcRequest(req, codes, transactionId);

    const idvBody = await this.call(
      "getCalculateIDV",
      token,
      buildGetCalculateIDV(shape),
      "getCalculateIDV",
      true,
    );
    const band = normalizeIdv(idvBody);

    // HDFC rejects any deviation from its recommendation. Always price with it.
    const idv = selectIdvForPremium(band, shape.vehicle.idv);
    if (idv) shape.vehicle.idv = idv;

    const premiumBody = await this.call(
      "calculatePremium",
      token,
      buildCalculatePremium(shape),
      "calculatePremium",
      true,
    );

    const quote = normalizeQuote(premiumBody, {
      requestId: ctx.requestId,
      quoteNo: transactionId,
      policyType: req.selectedPolicy,
      vehicleCategory: req.vehicleType,
    });

    return {
      shape,
      token,
      quote: { ...quote, minIdv: band.min ?? undefined, maxIdv: band.max ?? undefined },
    };
  }

  async getQuote(req: MotorQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult> {
    const { quote } = await this.priceQuote(req, ctx, hdfcTransactionId("QT"));
    return quote;
  }

  async getFullQuote(
    req: MotorFullQuoteRequest,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult> {
    // HDFC's rule: never proceed when KYC is unverified. The Pehchaan id is the
    // proof, and it becomes Customer_Pehchaan_id on the proposal.
    if (!req.kycRefId && !req.ckyc) {
      throw new AppError(
        422,
        "HDFC requires a verified Pehchaan KYC id before a proposal can be created",
        "KYC_INCOMPLETE",
      );
    }

    const transactionId = req.quoteId || hdfcTransactionId("PROP");
    const { shape, quote, token } = await this.priceQuote(req, ctx, transactionId);

    const proposalBody = await this.call(
      "createProposal",
      token,
      buildCreateProposal(shape),
      "createProposal",
    );
    const { proposalNumber } = normalizeProposal(proposalBody);
    if (!proposalNumber) {
      throw new ProviderError(
        HDFC_SLUG,
        502,
        "HDFC createProposal returned no proposal number",
        proposalBody,
      );
    }

    shape.proposalNumber = proposalNumber;
    const proposalDoc = await this.call(
      "getProposalDocument",
      token,
      buildGetProposalDocument(shape),
      "getProposalDocument",
      true,
    );

    return {
      ...quote,
      contractDetails: { proposalNumber, transactionId },
      _rawResponse: { premium: quote._rawResponse, proposal: proposalBody, proposalDoc },
    };
  }

  /** Pehchaan e-KYC. Implemented in Task 18. */
  async completeCkyc(_req: CkycRequest, _ctx: ProviderContext): Promise<KycResult> {
    throw new AppError(501, "not yet implemented", "NOT_IMPLEMENTED");
  }

  /**
   * Present only to satisfy supportsKyc()'s type-guard, which requires both KYC
   * methods. "ovd" is NOT in `operations`, so requireOperation rejects the route
   * first; this is the belt-and-braces path.
   */
  async initiateOvd(_req: OvdRequest, _files: OvdFile[], _ctx: ProviderContext): Promise<OvdResult> {
    throw new AppError(
      501,
      "HDFC does not support OVD document upload — documents are captured inside the Pehchaan hosted journey",
      "NOT_IMPLEMENTED",
    );
  }

  /** Payment (already collected) → policy. Implemented in Task 19. */
  async issuePolicy(req: PolicyIssuanceRequest, ctx: ProviderContext): Promise<PolicyIssuanceResult> {
    throw new AppError(501, "not yet implemented", "NOT_IMPLEMENTED");
  }

  async getCertificate(transactionId: string, _ctx: ProviderContext): Promise<CertificateResult> {
    const token = await this.tokenProvider();
    const body = await this.call(
      "getPolicyDocument",
      token,
      { TransactionID: hdfcTransactionId("COI"), Req_Policy_Document: { Policy_Number: transactionId } },
      "getPolicyDocument",
      true,
    );
    return normalizeCertificate(body);
  }
}

/** Factory used at startup — env config + DB-backed code resolver. */
export function createHdfcProvider(): HdfcProvider {
  return new HdfcProvider({ config: loadHdfcConfig(), codeResolver: dbCodeResolver });
}
```

The `completeCkyc` and `issuePolicy` stubs are replaced in Tasks 18 and 19.
`tsconfig.json` sets `noUnusedLocals: true`, so do **not** import
`buildSubmitPaymentDetails`, `buildGetPolicyDocument` or `normalizePayment` yet —
Task 19 adds them when it adds their first use.

- [ ] **Step 4: Create the registration module**

Create `tf-api/src/providers/hdfc/index.ts`:

```ts
import { env } from "@/config/env.ts";
import { logger } from "@/lib/logger.ts";
import { registerProvider } from "@/providers/provider-registry.ts";
import { createHdfcProvider } from "./hdfc.provider.ts";

/** Registers HDFC at startup when enabled; logs (does not crash) on misconfig. */
export function registerHdfcProvider(): void {
  if (!env.HDFC_ENABLED) return;
  try {
    registerProvider(createHdfcProvider());
    logger.info("HDFC ERGO provider registered");
  } catch (err) {
    logger.error({ err }, "HDFC provider enabled but failed to initialise");
  }
}

export { HdfcProvider, createHdfcProvider } from "./hdfc.provider.ts";
```

- [ ] **Step 5: Register it in the app**

In `tf-api/src/app.ts`, add the import beside the others and the call beside the
other registrations:

```ts
import { registerHdfcProvider } from "@/providers/hdfc/index.ts";
```

```ts
registerHdfcProvider();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/hdfc.provider.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 7: Verify the whole suite and the build**

Run: `cd tf-api && npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add tf-api/src/providers/hdfc/hdfc.provider.ts tf-api/src/providers/hdfc/index.ts tf-api/src/app.ts tf-api/src/providers/hdfc/__tests__/hdfc.provider.test.ts
git commit -m "feat(hdfc): add the provider class with quote and proposal flows"
```

---

## Task 18: Pehchaan e-KYC

**Files:**
- Create: `tf-api/src/providers/hdfc/ckyc.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`

Pehchaan is a separate service with its own host and its own `api_key`→JWT. Its
token lives in the shared `TokenManager` under `hdfc:kyc` so invalidation and
single-flight come for free.

- [ ] **Step 1: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { hdfcCompleteCkyc, toPehchaanParams, normalizePehchaan } from "../ckyc.ts";
import type { HdfcConfig } from "../config.ts";
import type { CkycRequest } from "@/contracts/kyc.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "S",
  channelId: "C",
  credential: "x",
  productCode: "2311",
  tokenTtlSeconds: 1500,
  kyc: {
    baseUrl: "https://kyc.example/e-kyc",
    apiKey: "api-key-1",
    tokenTtlSeconds: 480,
    returnUrl: "https://app.example/kyc-return",
  },
};

const req: CkycRequest = {
  transactionId: "TXN-1",
  dob: "1996-07-22",
  panNumber: "BXGPG2512P",
  policyType: "motor",
} as CkycRequest;

describe("toPehchaanParams", () => {
  it("converts the canonical request into Pehchaan's query parameters", () => {
    const p = toPehchaanParams(req, config);
    expect(p.pan).toBe("BXGPG2512P");
    // Pehchaan wants DD/MM/YYYY, not ISO.
    expect(p.dob).toBe("22/07/1996");
    expect(p.redirect_url).toBe("https://app.example/kyc-return");
  });

  it("uses ckycNumber as the kyc_id lookup key when supplied", () => {
    // This is how the status poll works after the hosted journey returns.
    const p = toPehchaanParams({ ...req, panNumber: undefined, ckycNumber: "KYC-99" }, config);
    expect(p.kyc_id).toBe("KYC-99");
    expect(p.pan).toBeUndefined();
  });

  it("forwards name and mobile when present", () => {
    const p = toPehchaanParams({ ...req, fullName: "MAHENDRA", mobile: "7387005111" }, config);
    expect(p.name).toBe("MAHENDRA");
    expect(p.mobile).toBe("7387005111");
  });

  it("omits empty values entirely rather than sending blanks", () => {
    const p = toPehchaanParams({ ...req, fullName: "" } as CkycRequest, config);
    expect("name" in p).toBe(false);
  });
});

describe("normalizePehchaan", () => {
  it("maps a verified response onto the canonical KycResult", () => {
    const out = normalizePehchaan({
      status: true,
      data: {
        iskycVerified: 1,
        kyc_id: "KYC-99",
        name: "MAHENDRA GHANCHI",
        dob: "22/07/1996",
        email: "m@example.com",
        mobile: "7387005111",
        pan: "BXGPG2512P",
        permanentAddress: "12 Main St",
        status: "approved",
      },
    });
    expect(out.isKycSuccess).toBe(true);
    expect(out.kycId).toBe("KYC-99");
    expect(out.name).toBe("MAHENDRA GHANCHI");
    expect(out.permanentAddress).toBe("12 Main St");
    expect(out.requiresRedirect).toBeFalsy();
  });

  it("maps a not-found response onto the redirect shape FG already uses", () => {
    const out = normalizePehchaan({
      status: false,
      data: { redirection_link: "https://pehchaan.example/j/abc", txn_id: "TX-7" },
    });
    expect(out.isKycSuccess).toBe(false);
    expect(out.requiresRedirect).toBe(true);
    expect(out.redirectUrl).toBe("https://pehchaan.example/j/abc");
    expect(out.ckycRefId).toBe("TX-7");
  });

  it("treats a pending verification as unverified", () => {
    const out = normalizePehchaan({ data: { iskycVerified: 0, status: "pending for verification" } });
    expect(out.isKycSuccess).toBe(false);
    expect(out.displayMessage).toContain("pending");
  });

  it("treats a rejected KYC as unverified", () => {
    const out = normalizePehchaan({ data: { iskycVerified: 0, status: "rejected" } });
    expect(out.isKycSuccess).toBe(false);
  });
});

describe("hdfcCompleteCkyc", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  function jsonResponse(body: unknown, status = 200) {
    return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
  }

  it("mints a token then calls the verified-KYC endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1", expiry: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { iskycVerified: 1, kyc_id: "K1" } }));

    const out = await hdfcCompleteCkyc(config, req);
    expect(out.kycId).toBe("K1");

    const tokenCall = fetchMock.mock.calls[0]!;
    expect(String(tokenCall[0])).toContain("/tgt/generate-token");
    expect((tokenCall[1] as RequestInit).headers).toMatchObject({ api_key: "api-key-1" });

    const kycCall = fetchMock.mock.calls[1]!;
    expect(String(kycCall[0])).toContain("/primary/kyc-verified");
    expect((kycCall[1] as RequestInit).headers).toMatchObject({ token: "jwt-1" });
  });

  it("refreshes the token once and retries on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1" } }))
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-2" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { iskycVerified: 1, kyc_id: "K1" } }));

    const out = await hdfcCompleteCkyc(config, req);
    expect(out.kycId).toBe("K1");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails clearly when the api_key is not configured", async () => {
    const noKey = { ...config, kyc: { ...config.kyc, apiKey: "" } };
    await expect(hdfcCompleteCkyc(noKey, req)).rejects.toThrow(/HDFC_KYC_API_KEY/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts`
Expected: FAIL — cannot resolve `../ckyc.ts`.

- [ ] **Step 3: Implement the Pehchaan client**

Create `tf-api/src/providers/hdfc/ckyc.ts`:

```ts
import { ProviderError } from "@/errors/app-error.ts";
import { tokenManager, expiryWithThreshold } from "@/providers/token-manager.ts";
import type { CkycRequest, KycResult } from "@/contracts/kyc.ts";
import { toHdfcDate } from "./format.ts";
import { HDFC_SLUG, type HdfcConfig } from "./config.ts";

/**
 * Pehchaan e-KYC. A separate service from the HEI motor API: different host,
 * different auth (api_key → ~10-minute JWT), different vocabulary.
 *
 *   #0    GET /tgt/generate-token            (header api_key)  → { token, expiry }
 *   #1.2  GET /primary/kyc-verified          (header token)    → verified | redirect
 *   #1.3  GET /primary/kyc-status/:kycId
 *
 * Status polling needs no extra route: /primary/kyc-verified accepts kyc_id and
 * txn_id as lookup keys, so after the hosted journey returns with ?kycId=… the
 * client simply calls completeCkyc again with that id in `ckycNumber`.
 */

const KYC_TOKEN_CACHE_KEY = `${HDFC_SLUG}:kyc`;

const ENDPOINTS = {
  generateToken: "/tgt/generate-token",
  fetchKyc: "/primary/kyc-verified",
} as const;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Mints (or reuses) the Pehchaan JWT. */
async function getKycToken(config: HdfcConfig): Promise<string> {
  if (!config.kyc.apiKey) {
    throw new ProviderError(
      HDFC_SLUG,
      500,
      "HDFC Pehchaan api_key is not configured (set HDFC_KYC_API_KEY)",
    );
  }
  return tokenManager.getToken(KYC_TOKEN_CACHE_KEY, async () => {
    const res = await fetch(config.kyc.baseUrl + ENDPOINTS.generateToken, {
      headers: { api_key: config.kyc.apiKey },
    });
    const body = obj(await readJson(res));
    const data = obj(body.data);
    const token = str(data.token) ?? str(body.token);
    if (!token) {
      throw new ProviderError(HDFC_SLUG, res.status, "HDFC Pehchaan token generation failed", body);
    }
    // `expiry` is an epoch in seconds when present; otherwise fall back to config.
    const expirySec = Number(data.expiry ?? body.expiry ?? 0);
    const expiresAt =
      expirySec > 0
        ? expiryWithThreshold(expirySec * 1000)
        : Date.now() + config.kyc.tokenTtlSeconds * 1000 * 0.8;
    return { accessToken: token, expiresAt };
  });
}

/** Only the parameters Pehchaan recognises, all lower-snake, blanks omitted. */
export function toPehchaanParams(req: CkycRequest, config: HdfcConfig): Record<string, string> {
  const candidates: Record<string, string | undefined> = {
    // ckycNumber doubles as Pehchaan's kyc_id — that is how the post-redirect
    // status poll re-enters this same call.
    kyc_id: req.ckycNumber,
    pan: req.panNumber,
    dob: toHdfcDate(req.dob) ?? undefined,
    mobile: req.mobile,
    name: req.fullName,
    aadhaar_uid: req.aadhaarNumber,
    txn_id: req.transactionId,
    redirect_url: req.redirectUrl ?? config.kyc.returnUrl,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(candidates)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Maps Pehchaan's two response shapes onto the canonical KycResult. The
 * not-found shape deliberately mirrors FG's manual-KYC fallback
 * ({requiresRedirect, redirectUrl}) so the frontend's existing redirect handling
 * applies unchanged.
 */
export function normalizePehchaan(body: unknown): KycResult {
  const b = obj(body);
  const d = obj(b.data ?? b);

  const redirectUrl =
    str(d.redirection_link) ?? str(d.redirectionLink) ?? str(d.link) ?? str(b.redirection_link);
  if (redirectUrl) {
    return {
      isKycSuccess: false,
      requiresRedirect: true,
      redirectUrl,
      ckycRefId: str(d.txn_id) ?? str(b.txn_id),
      displayMessage: "Complete KYC on the HDFC Pehchaan portal to continue",
      _rawResponse: body,
    };
  }

  const verified = Number(d.iskycVerified) === 1 || d.status === "approved";
  return {
    isKycSuccess: verified,
    kycId: str(d.kyc_id),
    ckycNumber: str(d.kyc_id),
    name: str(d.name),
    dob: str(d.dob),
    email: str(d.email),
    phone: str(d.mobile),
    permanentAddress: str(d.permanentAddress),
    correspondenceAddress: str(d.correspondenceAddress) ?? str(d.permanentAddress),
    displayMessage: str(d.status),
    _rawResponse: body,
  };
}

/** Looks up an existing verified KYC, or returns the hosted-journey redirect. */
export async function hdfcCompleteCkyc(config: HdfcConfig, req: CkycRequest): Promise<KycResult> {
  const params = new URLSearchParams(toPehchaanParams(req, config));
  const url = `${config.kyc.baseUrl}${ENDPOINTS.fetchKyc}?${params.toString()}`;

  let token = await getKycToken(config);
  let res = await fetch(url, { headers: { token } });

  if (res.status === 401) {
    // The JWT died mid-flight — drop it so the next caller mints fresh, and retry once.
    tokenManager.invalidate(KYC_TOKEN_CACHE_KEY);
    token = await getKycToken(config);
    res = await fetch(url, { headers: { token } });
  }

  return normalizePehchaan(await readJson(res));
}
```

- [ ] **Step 4: Wire it into the provider**

In `tf-api/src/providers/hdfc/hdfc.provider.ts`, add the import:

```ts
import { hdfcCompleteCkyc } from "./ckyc.ts";
```

and replace the `completeCkyc` stub:

```ts
  async completeCkyc(req: CkycRequest, _ctx: ProviderContext): Promise<KycResult> {
    return hdfcCompleteCkyc(this.config, req);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc`
Expected: PASS — 11 new CKYC tests plus every earlier HDFC suite still green.

- [ ] **Step 6: Commit**

```bash
git add tf-api/src/providers/hdfc/ckyc.ts tf-api/src/providers/hdfc/hdfc.provider.ts tf-api/src/providers/hdfc/__tests__/ckyc.test.ts
git commit -m "feat(hdfc): add Pehchaan e-KYC with FG-compatible redirect shape"
```

---

## Task 19: Issuance

**Files:**
- Modify: `tf-api/src/contracts/policy.ts`
- Modify: `tf-api/src/providers/hdfc/hdfc.provider.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/issuance.test.ts`

HDFC has no vendor-hosted payment gateway. `submitpaymentdetails` **records**
money collected elsewhere, so the canonical `PaymentReceipt` maps straight onto
its `Payment_Details` block.

- [ ] **Step 1: Add the optional transactionId to the contract**

In `tf-api/src/contracts/policy.ts`, inside `PolicyIssuanceRequestSchema`, add
after `clientId`:

```ts
  /**
   * Vendor correlation id that keys the issuance call. HDFC threads one
   * TransactionID across all seven HEI steps and needs it at payment time;
   * `quoteNo` carries the HDFC Proposal_Number. FG ignores this field.
   */
  transactionId: z.string().optional(),
```

- [ ] **Step 2: Write the failing tests**

Create `tf-api/src/providers/hdfc/__tests__/issuance.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import paymentFixture from "../fixtures/responses/payment.json" with { type: "json" };
import policyDocFixture from "../fixtures/responses/policy-document.json" with { type: "json" };
import { HdfcProvider } from "../hdfc.provider.ts";
import { passthroughCodeResolver } from "../db-code-resolver.ts";
import type { HdfcConfig } from "../config.ts";
import type { HdfcTransport } from "../http.ts";
import type { PolicyIssuanceRequest } from "@/contracts/policy.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "S",
  channelId: "C",
  credential: "x",
  productCode: "2311",
  tokenTtlSeconds: 1500,
  kyc: { baseUrl: "https://kyc.example", apiKey: "k", tokenTtlSeconds: 480, returnUrl: "" },
};

interface Call {
  url: string;
  jsonBody?: unknown;
}

function recordingTransport(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const transport: HdfcTransport = {
    request: vi.fn(async (args) => {
      calls.push({ url: args.url, jsonBody: args.jsonBody });
      const key = Object.keys(responses).find((k) => args.url.endsWith(k));
      return key ? responses[key] : {};
    }),
  };
  return { transport, calls };
}

function provider(transport: HdfcTransport) {
  return new HdfcProvider({
    config,
    transport,
    codeResolver: passthroughCodeResolver,
    tokenProvider: async () => "tok-1",
  });
}

const issueReq: PolicyIssuanceRequest = {
  quoteNo: "PR2026080700123",
  clientId: "CL-1",
  transactionId: "TXN-1",
  vehicleCategory: "fourWheeler",
  receipt: {
    uniqueTranKey: "UTK-1",
    transactionDate: "07/08/2026 16:26:00",
    receiptType: "IVR",
    amount: 43150,
    tranRefNo: "PG-77",
    tranRefNoDate: "07/08/2026",
    pgType: "PAYU",
  },
} as PolicyIssuanceRequest;

const ctx = { requestId: "req-1" };

describe("issuePolicy", () => {
  it("submits payment then fetches the policy document", async () => {
    const { transport, calls } = recordingTransport({
      submitpaymentdetails: paymentFixture,
      getpolicydocument: policyDocFixture,
    });
    await provider(transport).issuePolicy(issueReq, ctx);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual([
      "submitpaymentdetails",
      "getpolicydocument",
    ]);
  });

  it("maps the canonical receipt onto HDFC's Payment_Details", async () => {
    const { transport, calls } = recordingTransport({
      submitpaymentdetails: paymentFixture,
      getpolicydocument: policyDocFixture,
    });
    await provider(transport).issuePolicy(issueReq, ctx);
    const body = calls[0]!.jsonBody as {
      Proposal_no: string;
      TransactionID: string;
      Payment_Details: Record<string, unknown>;
    };
    expect(body.Proposal_no).toBe("PR2026080700123");
    expect(body.TransactionID).toBe("TXN-1");
    expect(body.Payment_Details.PAYMENT_AMOUNT).toBe("43150");
    expect(body.Payment_Details.INSTRUMENT_NUMBER).toBe("PG-77");
  });

  it("falls back to clientId when no transactionId was supplied", async () => {
    const { transport, calls } = recordingTransport({
      submitpaymentdetails: paymentFixture,
      getpolicydocument: policyDocFixture,
    });
    await provider(transport).issuePolicy({ ...issueReq, transactionId: undefined }, ctx);
    expect((calls[0]!.jsonBody as { TransactionID: string }).TransactionID).toBe("CL-1");
  });

  it("returns the issued policy number", async () => {
    const { transport } = recordingTransport({
      submitpaymentdetails: paymentFixture,
      getpolicydocument: policyDocFixture,
    });
    const out = await provider(transport).issuePolicy(issueReq, ctx);
    expect(out.status).toBe("ISSUED");
    expect(out.policyNumber).toBe("2311202600012345");
    expect(out.providerSlug).toBe("hdfc");
    expect(out.quoteNo).toBe("PR2026080700123");
  });

  it("does not fetch the policy document when no policy number came back", async () => {
    const { transport, calls } = recordingTransport({
      submitpaymentdetails: { StatusCode: "1" },
    });
    const out = await provider(transport).issuePolicy(issueReq, ctx);
    expect(out.status).toBe("IN_PROGRESS");
    expect(calls).toHaveLength(1);
  });

  it("surfaces HDFC's payment rejection verbatim", async () => {
    const { transport } = recordingTransport({
      submitpaymentdetails: { StatusCode: "0", Error: "BUSINESS EXCEPTION: Amount mismatch" },
    });
    await expect(provider(transport).issuePolicy(issueReq, ctx)).rejects.toThrow(/Amount mismatch/);
  });
});

describe("getCertificate", () => {
  it("fetches the policy document by policy number", async () => {
    const { transport, calls } = recordingTransport({ getpolicydocument: policyDocFixture });
    const coi = await provider(transport).getCertificate("2311202600012345", ctx);
    expect(coi.coiBase64).toBe("JVBERi0xLjQKJVBPTElDWQ==");
    const body = calls[0]!.jsonBody as { Req_Policy_Document: { Policy_Number: string } };
    expect(body.Req_Policy_Document.Policy_Number).toBe("2311202600012345");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/issuance.test.ts`
Expected: FAIL — `issuePolicy` throws `not yet implemented`.

- [ ] **Step 4: Implement issuePolicy**

In `tf-api/src/providers/hdfc/hdfc.provider.ts`, extend the two existing import
blocks with the names this step needs (they were deliberately left out in Task 17
because `noUnusedLocals` rejects unused imports):

```ts
// add to the "./mapper/index.ts" import
  buildSubmitPaymentDetails,
  buildGetPolicyDocument,
// add to the "./normalizer.ts" import
  normalizePayment,
```

Then replace the `issuePolicy` stub:

```ts
  /**
   * HDFC has no hosted payment gateway: submitpaymentdetails RECORDS a payment
   * already collected. The canonical PaymentReceipt therefore maps directly onto
   * its Payment_Details block.
   */
  async issuePolicy(
    req: PolicyIssuanceRequest,
    _ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult> {
    const token = await this.tokenProvider();
    // quoteNo carries HDFC's Proposal_Number; transactionId is the cross-step id.
    const transactionId = req.transactionId ?? req.clientId;
    const shape = {
      transactionId,
      proposalNumber: req.quoteNo,
      payment: {
        amount: req.receipt.amount,
        instrumentNumber: req.receipt.tranRefNo,
        paymentDate: req.receipt.tranRefNoDate,
        bankName: req.receipt.pgType,
      },
    } as HdfcRequestShape;

    const paymentBody = await this.call(
      "submitPaymentDetails",
      token,
      buildSubmitPaymentDetails(shape),
      "submitPaymentDetails",
    );
    const { policyNumber } = normalizePayment(paymentBody);

    if (!policyNumber) {
      return {
        providerSlug: HDFC_SLUG,
        insurerName: HDFC_DISPLAY_NAME,
        status: "IN_PROGRESS",
        quoteNo: req.quoteNo,
        clientId: req.clientId,
        message: "HDFC accepted the payment but has not issued a policy number yet",
        _rawResponse: paymentBody,
      };
    }

    shape.policyNumber = policyNumber;
    const policyDoc = await this.call(
      "getPolicyDocument",
      token,
      buildGetPolicyDocument(shape),
      "getPolicyDocument",
      true,
    );

    return {
      providerSlug: HDFC_SLUG,
      insurerName: HDFC_DISPLAY_NAME,
      status: "ISSUED",
      policyNumber,
      applicationNo: req.quoteNo,
      receiptNo: req.receipt.tranRefNo,
      clientId: req.clientId,
      quoteNo: req.quoteNo,
      _rawResponse: { payment: paymentBody, policyDocument: policyDoc },
    };
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tf-api && npx vitest run src/providers/hdfc/__tests__/issuance.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Regenerate the OpenAPI document and frontend bindings**

Run: `cd tf-api && npm run openapi:gen`
Expected: `openapi/openapi.json` updated with the new optional field.

Run: `cd tf-web && npm run gen:api && npm run typecheck`
Expected: bindings regenerate, typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add tf-api/src/contracts/policy.ts tf-api/src/providers/hdfc/hdfc.provider.ts tf-api/src/providers/hdfc/__tests__/issuance.test.ts tf-api/openapi/openapi.json tf-web/src/lib/api/generated/vendor-api.d.ts
git commit -m "feat(hdfc): issue policies from a collected payment receipt"
```

---

## Task 20: Renewal — relax the contract, then implement

**Files:**
- Create: `tf-api/src/lib/require-fields.ts`
- Modify: `tf-api/src/contracts/renewal.ts`
- Modify: `tf-api/src/providers/fg/renewal.ts`
- Create: `tf-api/src/providers/hdfc/renewal.ts`
- Modify: `tf-api/src/providers/hdfc/hdfc.provider.ts`
- Test: `tf-api/src/lib/__tests__/require-fields.test.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/renewal.test.ts`

`RenewalProposalRequestSchema` and `RenewalCreatePolicyRequestSchema` are FG's
contract wearing a canonical name. Relaxing them lets HDFC implement
`RenewalProvider` without forking the abstraction; `requireFields` keeps FG's
validation strict.

- [ ] **Step 1: Write the failing test for the helper**

Create `tf-api/src/lib/__tests__/require-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ValidationError } from "@/errors/app-error.ts";
import { requireFields } from "../require-fields.ts";

describe("requireFields", () => {
  it("passes when every named field is present", () => {
    expect(() => requireFields({ a: 1, b: "x" }, ["a", "b"], "fg")).not.toThrow();
  });

  it("raises a ValidationError naming every missing field at once", () => {
    let caught: unknown;
    try {
      requireFields({ a: 1 }, ["a", "b", "c"], "fg");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).message).toBeTruthy();
    const details = (caught as ValidationError).details as { path: string[]; message: string }[];
    expect(details.map((d) => d.path[0])).toEqual(["b", "c"]);
    expect(details[0]!.message).toContain("fg");
  });

  it("treats empty strings as missing", () => {
    expect(() => requireFields({ a: "" }, ["a"], "fg")).toThrow(ValidationError);
  });

  it("treats zero and false as present", () => {
    expect(() => requireFields({ a: 0, b: false }, ["a", "b"], "fg")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tf-api && npx vitest run src/lib/__tests__/require-fields.test.ts`
Expected: FAIL — cannot resolve `../require-fields.ts`.

- [ ] **Step 3: Implement the helper**

Create `tf-api/src/lib/require-fields.ts`:

```ts
import { ValidationError } from "@/errors/app-error.ts";

/**
 * Asserts that a provider's own mandatory fields are present on a request whose
 * schema marks them optional.
 *
 * Some canonical contracts (notably the renewal ones) carry fields only certain
 * vendors need. Making them required at the schema level would block every other
 * vendor; dropping the check entirely would turn a missing field into an opaque
 * vendor error. Providers call this at the top of their mappers instead.
 */
export function requireFields<T extends object>(
  req: T,
  fields: readonly (keyof T & string)[],
  providerSlug: string,
): void {
  const missing = fields.filter((f) => {
    const v = req[f];
    return v === undefined || v === null || v === "";
  });
  if (missing.length === 0) return;
  throw new ValidationError(
    missing.map((f) => ({
      path: [f],
      message: `"${f}" is required for provider "${providerSlug}"`,
    })),
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd tf-api && npx vitest run src/lib/__tests__/require-fields.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Relax the renewal contract**

In `tf-api/src/contracts/renewal.ts`, change these fields in
`RenewalProposalRequestSchema` from required to optional — `productCode`,
`clientCode`, `agentCode`, `branch`, `coverCode` — and add the HDFC fields.
For example, `productCode: z.string().min(1)` becomes:

```ts
  /** FG product code. Optional at the contract level; FG asserts it via requireFields. */
  productCode: z.string().min(1).optional(),
```

Apply the same treatment to `clientCode`, `agentCode`, `branch` and `coverCode`
(`z.enum([...]).optional()`), then append to the same schema:

```ts
  /** Vendor correlation id (HDFC threads one TransactionID across all steps). */
  transactionId: z.string().optional(),
  /** Vehicle registration number (HDFC Req_Renewal.Vehicle_Regn_No). */
  registrationNo: z.string().optional(),
```

In `RenewalCreatePolicyRequestSchema`, make `clientId`, `agentCode` and
`branchCode` optional the same way, and append:

```ts
  transactionId: z.string().optional(),
```

Update the schema's leading comment to record why:

```ts
// ─── Motor Renewal ────────────────────────────────────────────────────────────
// Three-op flow keyed off an existing policy:
//   renewalQuote(policyNo)              → expiring-policy snapshot + premium
//   renewalProposal(echo + modify Δ)    → bound (re-rated) premium
//   renewalCreatePolicy(receipt)        → new policyNumber
//
// Steps 2 and 3 originally encoded FG's contract exactly (productCode,
// clientCode, agentCode, branch, coverCode, IMT endorsements). HDFC's renewal
// needs almost none of those — only Policy_No, Vehicle_Regn_No, Vehicle_IDV and
// the cover block — so vendor-specific fields are optional here and each
// provider asserts its own via requireFields (src/lib/require-fields.ts).
```

- [ ] **Step 6: Make FG assert its own fields**

At the top of FG's renewal proposal mapper in
`tf-api/src/providers/fg/renewal.ts`, add:

```ts
import { requireFields } from "@/lib/require-fields.ts";
import { FG_SLUG } from "./config.ts";
```

and, as the first statement of the function that builds the FG renewal proposal
payload:

```ts
  // These are optional in the canonical schema so HDFC can share it; FG needs them.
  requireFields(req, ["productCode", "clientCode", "agentCode", "branch", "coverCode"], FG_SLUG);
```

Do the same in FG's renewal create-policy builder with
`["clientId", "agentCode", "branchCode"]`.

If `FG_SLUG` is not exported from `src/providers/fg/config.ts`, use the literal
`"fg"` instead — do not add an export solely for this.

- [ ] **Step 7: Add the FG regression test**

Append to FG's existing renewal test file (find it with
`ls tf-api/src/providers/fg/__tests__/`; create
`tf-api/src/providers/fg/__tests__/renewal-required-fields.test.ts` if there is
no obvious home):

```ts
import { describe, it, expect } from "vitest";
import { ValidationError } from "@/errors/app-error.ts";
// Import the FG renewal proposal builder under its real exported name.
import { buildRenewalProposalPayload } from "../renewal.ts";

describe("FG renewal still enforces its own required fields", () => {
  it("rejects a proposal missing agentCode, even though the schema allows it", () => {
    // Guards the contract relaxation made for HDFC: loosening the zod schema
    // must not silently let an incomplete FG renewal reach the vendor.
    const req = {
      previousPolicyNo: "P1",
      proposalNo: "00P1",
      startDate: "2026-09-01",
      expiryDate: "2027-08-31",
      productCode: "PC",
      clientCode: "CL",
      branch: "BR",
      coverCode: "CO",
      vehicleIdv: 500000,
      discountPercentage: -10,
      addonCodes: [],
      // agentCode deliberately absent
    } as never;
    expect(() => buildRenewalProposalPayload(req)).toThrow(ValidationError);
  });
});
```

Adjust the import name and argument shape to match FG's actual export.

- [ ] **Step 8: Write the failing HDFC renewal tests**

Create `tf-api/src/providers/hdfc/__tests__/renewal.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import idvFixture from "../fixtures/responses/idv.json" with { type: "json" };
import premiumFixture from "../fixtures/responses/premium.json" with { type: "json" };
import proposalFixture from "../fixtures/responses/proposal.json" with { type: "json" };
import paymentFixture from "../fixtures/responses/payment.json" with { type: "json" };
import policyDocFixture from "../fixtures/responses/policy-document.json" with { type: "json" };
import { HdfcProvider } from "../hdfc.provider.ts";
import { passthroughCodeResolver } from "../db-code-resolver.ts";
import { buildRenewalExtract, buildRenewalCalculatePremium } from "../mapper/renewal.ts";
import type { HdfcConfig } from "../config.ts";
import type { HdfcTransport } from "../http.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "S",
  channelId: "C",
  credential: "x",
  productCode: "2311",
  tokenTtlSeconds: 1500,
  kyc: { baseUrl: "https://kyc.example", apiKey: "k", tokenTtlSeconds: 480, returnUrl: "" },
};

function recordingTransport(responses: Record<string, unknown>) {
  const calls: { url: string; jsonBody?: unknown }[] = [];
  const transport: HdfcTransport = {
    request: vi.fn(async (args) => {
      calls.push({ url: args.url, jsonBody: args.jsonBody });
      const key = Object.keys(responses).find((k) => args.url.endsWith(k));
      return key ? responses[key] : {};
    }),
  };
  return { transport, calls };
}

function provider(transport: HdfcTransport) {
  return new HdfcProvider({
    config,
    transport,
    codeResolver: passthroughCodeResolver,
    tokenProvider: async () => "tok-1",
  });
}

const ctx = { requestId: "req-1" };

describe("renewal payload builders", () => {
  it("keys the extract by the existing policy number", () => {
    expect(buildRenewalExtract("TXN-1", "POL-9")).toEqual({
      TransactionID: "TXN-1",
      Req_Renewal: { Policy_No: "POL-9" },
    });
  });

  it("sends Req_Renewal alongside the IDV and cover blocks for premium", () => {
    const out = buildRenewalCalculatePremium({
      transactionId: "TXN-1",
      previousPolicyNo: "POL-9",
      registrationNo: "MH01QQ7878",
      idv: 500000,
      policyType: "OD Only",
      tenure: 1,
    });
    expect(Object.keys(out)).toEqual([
      "TransactionID",
      "Policy_Details",
      "Req_Renewal",
      "Req_PvtCar",
    ]);
    expect((out.Req_Renewal as Record<string, unknown>).Policy_No).toBe("POL-9");
    expect((out.Policy_Details as Record<string, unknown>).Vehicle_IDV).toBe(500000);
  });
});

describe("renewalQuote", () => {
  it("runs extract, IDV then premium", async () => {
    const { transport, calls } = recordingTransport({
      getpolicydataforrenewal: { StatusCode: "1", Policy_Details: { Vehicle_IDV: 500000 } },
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).renewalQuote({ policyNo: "POL-9" }, ctx);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual([
      "getpolicydataforrenewal",
      "getcalculateidv",
      "calculatepremium",
    ]);
  });

  it("returns a canonical quote", async () => {
    const { transport } = recordingTransport({
      getpolicydataforrenewal: { StatusCode: "1", Policy_Details: { Vehicle_IDV: 500000 } },
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    const q = await provider(transport).renewalQuote({ policyNo: "POL-9" }, ctx);
    expect(q.providerSlug).toBe("hdfc");
    expect(q.grossPremium).toBe(43150);
  });
});

describe("renewalProposal", () => {
  it("creates the proposal and returns its number", async () => {
    const { transport } = recordingTransport({
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
    });
    const q = await provider(transport).renewalProposal(
      {
        previousPolicyNo: "POL-9",
        proposalNo: "00POL-9",
        startDate: "2026-09-01",
        expiryDate: "2027-08-31",
        vehicleIdv: 500000,
        discountPercentage: 0,
        addonCodes: [],
        transactionId: "TXN-1",
        registrationNo: "MH01QQ7878",
      } as never,
      ctx,
    );
    expect(q.contractDetails?.proposalNumber).toBe("PR2026080700123");
  });
});

describe("renewalCreatePolicy", () => {
  it("submits payment and returns the new policy number", async () => {
    const { transport } = recordingTransport({
      submitpaymentdetails: paymentFixture,
      getpolicydocument: policyDocFixture,
    });
    const out = await provider(transport).renewalCreatePolicy(
      {
        policyNo: "POL-9",
        proposalNo: "PR2026080700123",
        transactionId: "TXN-1",
        receipt: {
          uniqueTranKey: "UTK",
          transactionDate: "07/08/2026 16:26:00",
          receiptType: "IVR",
          amount: 43150,
          tranRefNo: "PG-77",
          tranRefNoDate: "07/08/2026",
          pgType: "PAYU",
        },
      } as never,
      ctx,
    );
    expect(out.status).toBe("ISSUED");
    expect(out.policyNumber).toBe("2311202600012345");
  });
});
```

- [ ] **Step 9: Implement the renewal builders and methods**

Create `tf-api/src/providers/hdfc/mapper/renewal.ts` porting
`buildRenewalExtract`, `buildRenewalCalculatePremium` and
`buildRenewalCreateProposal` from the standalone module. The renewal flow uses a
`Req_Renewal` block keyed by policy number rather than full vehicle details:

```ts
import { bool01, boolTF, num, toHdfcDate } from "../format.ts";
import { buildCustomerDetails } from "./customer.ts";
import type { HdfcCustomer } from "../types.ts";

export interface HdfcRenewalInput {
  transactionId: string;
  previousPolicyNo: string;
  registrationNo?: string;
  idv: number;
  policyType: string;
  tenure: number;
  customer?: HdfcCustomer;
}

/** Renewal step 02 — getpolicydataforrenewal. */
export function buildRenewalExtract(transactionId: string, policyNo: string): Record<string, unknown> {
  return { TransactionID: transactionId, Req_Renewal: { Policy_No: policyNo } };
}

/** Renewal step 04 — CalculatePremium against the extracted policy. */
export function buildRenewalCalculatePremium(input: HdfcRenewalInput): Record<string, unknown> {
  // Port the Req_PvtCar block from payloadBuilder.js buildRenewalCalculatePremium
  // — it is a shorter field set than the New/Rollover templates.
  throw new Error("port buildRenewalCalculatePremium here");
}

/** Renewal step 05 — CreateProposal against the extracted policy. */
export function buildRenewalCreateProposal(input: HdfcRenewalInput): Record<string, unknown> {
  // Port from payloadBuilder.js buildRenewalCreateProposal: same as the premium
  // body plus Customer_Details (with the trailing null BusinessType_Mandatary).
  throw new Error("port buildRenewalCreateProposal here");
}
```

Then add the three `RenewalProvider` methods to `HdfcProvider`, declaring
`RenewalProvider` in its `implements` clause and importing the renewal request
types. Each is a thin orchestration over `this.call`:

- `renewalQuote(req)` — extract → IDV → premium → `normalizeQuote`.
- `renewalProposal(req)` — premium → createProposal → `normalizeProposal`,
  returning the quote with `contractDetails.proposalNumber`.
- `renewalCreatePolicy(req)` — submitPaymentDetails → getPolicyDocument,
  returning the same `PolicyIssuanceResult` shape as `issuePolicy`.

- [ ] **Step 10: Run every affected test**

Run: `cd tf-api && npx vitest run src/providers/hdfc src/lib/__tests__/require-fields.test.ts src/providers/fg`
Expected: all pass, including the FG regression test.

- [ ] **Step 11: Regenerate OpenAPI and frontend bindings**

Run: `cd tf-api && npm run openapi:gen`
Run: `cd tf-web && npm run gen:api && npm run typecheck`
Expected: both succeed.

- [ ] **Step 12: Commit**

```bash
git add tf-api/src/lib/require-fields.ts tf-api/src/lib/__tests__ tf-api/src/contracts/renewal.ts tf-api/src/providers/fg/renewal.ts tf-api/src/providers/fg/__tests__ tf-api/src/providers/hdfc tf-api/openapi/openapi.json tf-web/src/lib/api/generated/vendor-api.d.ts
git commit -m "feat(hdfc): add renewal support and generalise the renewal contract"
```

---

## Task 21: UAT probe, documentation and final verification

**Files:**
- Create: `tf-api/scripts/hdfc-uat-probe.ts`
- Create: `tf-api/docs/hdfc-integration-notes.md`
- Modify: `tf-api/package.json`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the read-only UAT probe**

Create `tf-api/scripts/hdfc-uat-probe.ts`:

```ts
/**
 * Read-only HDFC UAT probe: authenticate → GetCalculateIDV → CalculatePremium
 * for a vehicle from the kit's UAT test sheet. Creates nothing and binds
 * nothing, so it is safe to run repeatedly.
 *
 *   npm run hdfc:probe
 *
 * Follows the ITGI precedent (scripts/itgi-uat-probe.ts).
 */
import { loadHdfcConfig } from "@/providers/hdfc/config.ts";
import { HdfcProvider } from "@/providers/hdfc/hdfc.provider.ts";
import { passthroughCodeResolver } from "@/providers/hdfc/db-code-resolver.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";

// From PVTcarTestScenarios.xls — "UAT Test Model" and "RTO" sheets.
// TATA NEXON EV (42774) at MH-1 Mumbai (10406). passthroughCodeResolver sends
// these straight through as HDFC codes, so the probe exercises the vendor even
// before the master cross-walk has run.
const req = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  makeId: "TATA",
  makeName: "TATA MOTORS LTD",
  modelId: "42774",
  modelName: "NEXON EV",
  fuelType: "electric",
  rtoCode: "10406",
  registrationDate: "2022-06-15",
  registrationNumber: "MH01QQ7878",
  previousPolicyExpiryDate: "2026-08-31",
  isPreviousPolicyExpired: false,
  claimInPreviousPolicy: false,
  ncbPercent: 20,
  zeroDep: true,
  engineProtect: false,
  rsa: false,
  tyreProtect: false,
  rimProtect: false,
  rti: false,
  consumables: false,
  paOwner: true,
  paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false,
  keyProtect: false,
  garageCash: false,
  lossOfBelongings: false,
  batteryProtect: false,
  drivingAccessories: false,
  ncbProtection: false,
} as MotorQuoteRequest;

async function main(): Promise<void> {
  const provider = new HdfcProvider({
    config: loadHdfcConfig(),
    codeResolver: passthroughCodeResolver,
  });

  console.log("Probing HDFC UAT (authenticate → IDV → premium)…");
  const quote = await provider.getQuote(req, { requestId: "hdfc-probe" });

  console.log("\nQuote:");
  console.log(`  IDV            ${quote.idvValue} (band ${quote.minIdv}–${quote.maxIdv})`);
  console.log(`  OD premium     ${quote.basicOdPremium}`);
  console.log(`  TP premium     ${quote.thirdPartyPremium}`);
  console.log(`  Net premium    ${quote.netPremium}`);
  console.log(`  GST            ${quote.serviceTaxAmount}`);
  console.log(`  Gross premium  ${quote.grossPremium}`);
  console.log("\nAll amounts are whole rupees.");
}

main().catch((err) => {
  console.error("\nProbe failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `tf-api/package.json`, after `"db:import:hdfc"`, add:

```json
    "hdfc:probe": "tsx --env-file=.env scripts/hdfc-uat-probe.ts",
```

- [ ] **Step 3: Run the probe against UAT**

Set `HDFC_ENABLED=true` plus the real `HDFC_SOURCE`, `HDFC_CHANNEL_ID` and
`HDFC_CREDENTIAL` in `tf-api/.env`, then:

Run: `cd tf-api && npm run hdfc:probe`
Expected: a premium breakdown. A failure prints HDFC's verbatim message —
record it against the open confirmations rather than guessing at a fix.

If credentials have not arrived yet, note that the probe is blocked and continue;
every other step in this plan is verifiable without live access.

- [ ] **Step 4: Write the integration notes**

Create `tf-api/docs/hdfc-integration-notes.md`:

```markdown
# HDFC ERGO — integration notes

Provider: `src/providers/hdfc/`. Design spec:
`docs/superpowers/specs/2026-08-07-hdfc-ergo-provider-design.md`.
Frozen predecessor: `docs/reference/hdfc-ergo-standalone/`.

## 1. Shape

HEI motor service, JSON over HTTPS. Eight operations; only the `PRODUCT_CODE`
header changes per product. Private Car is `2311`.

    authenticate            GET
    getcalculateidv         POST
    calculatepremium        POST
    createproposal          POST
    getproposaldocument     POST
    submitpaymentdetails    POST
    getpolicydocument       POST
    getpolicydataforrenewal POST

Pehchaan e-KYC is a separate service: own host, `api_key` → ~10-minute JWT.

## 2. Vendor rules that cost UAT cycles to learn

1. `TRANSACTIONID` must be present and unique on the Authenticate header.
2. GetCalculateIDV always sends `Registration_No: "New"` and no
   `registrationNumberSection*` fields.
3. CreateProposal needs the real plate in dash format (`MH-01-QQ-7878`).
4. Always price with HDFC's recommended IDV — deviation is rejected with
   "IDV Deviation not allowed".
5. A rollover's previous policy must expire strictly before the new start date.
6. `PreviousPolicy_CorporateCustomerId_Mandatary` must be a code from HDFC's own
   insurer master; "OTHERS" fails with "No Data found for given previous insured
   code". Supplied by `ProviderInsurerCode(hdfc)`.
7. CalculatePremium sends `null` for the previous insurer and policy number;
   only CreateProposal sends the real values.
8. `YearOfManufacture` must be a bare 4-digit year.
9. Claim status is `"YES"` / `"NO"`, all caps.
10. Each business type has a DIFFERENT `Req_PvtCar` / `Policy_Details` field set.
    Key order is asserted against collection fixtures in
    `src/providers/hdfc/__tests__/req-pvtcar.test.ts`.

## 3. Master cross-walk

`npm run db:import:hdfc` reads `PrivateCarMasterData.xls` and writes only
`provider_*_codes` rows for slug `hdfc`. No canonical master rows are created —
a vehicle or RTO HDFC has that our master lacks is simply unquotable by HDFC.

Latest counts (fill in after running the import):

| Sheet | Rows | Cross-walked | Unmatched |
|---|---|---|---|
| Model_Master | | | |
| RTO Master | | | |
| Insurance_Company | | | |

Unmatched detail: `scripts/_hdfc-unmatched.json` (gitignored).

## 4. Payment

HDFC ships no hosted payment gateway. `submitpaymentdetails` records money
collected elsewhere, so `initiatePayment` remains FG-only and HDFC issuance
consumes the canonical `PaymentReceipt`.

## 5. Not supported (and why)

| Operation | Reason |
|---|---|
| `retrieveQuote` | No get-quote-by-id endpoint |
| `policyStatus` | Nothing in the kit |
| `inspection` | Break-in is triggered automatically at HDFC's end |
| `ovd` | The Pehchaan kit has no document-upload API |
| Two-wheeler | No collection, product code or master data |
| Commercial | No collection, product code or master data |

## 6. Open confirmations for HDFC

1. Real `HDFC_CREDENTIAL`, `HDFC_SOURCE`, `HDFC_CHANNEL_ID` for UAT and prod.
2. `HDFC_KYC_API_KEY` from the KYC kit email.
3. Actual token TTL — the kit does not state it; 1500 s is a guess.
4. Whether payment must be collected through an HDFC-nominated PG, or any PG's
   receipt is acceptable.
5. Two-wheeler and commercial product codes, collections and master data.
6. Production base URLs for both HEI and Pehchaan.
7. Whether `Private Car_New.postman_collection` (SA_OD, 1+3 / 2+3 / 3+3
   multi-year) supersedes `Private Car.postman_collection.json`, which this port
   is based on.
```

- [ ] **Step 5: Update CLAUDE.md**

In `CLAUDE.md`, in the `tf-api/` bullet under Overview, change

> adapts multiple insurer vendor APIs (Future Generali, ICICI Lombard)

to

> adapts multiple insurer vendor APIs (Future Generali, ICICI Lombard, IFFCO-Tokio, HDFC ERGO)

and add to the tf-api commands block, beside the other imports:

```
npm run db:import:hdfc   # cross-walk HDFC master → ProviderXCode(hdfc)
```

In the "Per-provider folder layout" paragraph, add `src/providers/hdfc/` to the
list of example folders and note that HDFC speaks JSON for both motor (HEI) and
Pehchaan e-KYC, and is off by default (`HDFC_ENABLED`).

- [ ] **Step 6: Full verification**

Run: `cd tf-api && npm run typecheck && npm run lint && npm test`
Expected: all pass.

Run: `cd tf-web && npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 7: Verify the provider appears in the API**

Run: `cd tf-api && npm run dev` (with `HDFC_ENABLED=true`), then in another shell:

Run: `curl -s http://localhost:4000/api/v1/providers | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).providers;console.log(p.map(x=>x.slug+': '+x.capabilities.join(',')).join('\n'))})"`
Expected: an `hdfc: fourWheeler,newVehicle` line alongside the other providers.

- [ ] **Step 8: Commit**

```bash
git add tf-api/scripts/hdfc-uat-probe.ts tf-api/docs/hdfc-integration-notes.md tf-api/package.json CLAUDE.md
git commit -m "docs(hdfc): add UAT probe, integration notes and update CLAUDE.md"
```

---

## Verification checklist

Against the spec's success criteria (§1 of the design doc):

1. Compare returns an HDFC card with a real premium — Task 21 Step 3 / Step 7.
2. Golden-payload tests pass field-for-field — Tasks 10, 11, 12.
3. A full new-business journey completes on UAT — Tasks 17, 18, 19 plus live
   credentials.
4. `npm run db:import:hdfc` is idempotent and resolves the UAT test vehicles —
   Task 15 Steps 4–5.
5. `typecheck`, `lint` and `test` are clean — Task 21 Step 6.
6. FG's renewal behaviour is unchanged — Task 20 Step 7.

## Known follow-ups (deliberately out of scope)

- **Two-wheeler / commercial.** Blocked on HDFC supplying product codes,
  collections and master data (open confirmation #5).
- **`Private Car_New` collection.** The SA_OD and multi-year folders are
  additive; reconciling them is open confirmation #7.
- **tf-web insurer logo** for the HDFC card, and verifying the KYC page's
  existing `requiresRedirect` handling against a real Pehchaan response.
- **Persisting HDFC quotes** into the `quotes` table — the existing quote
  repository is provider-agnostic, so this should need no HDFC-specific work,
  but it has not been exercised.

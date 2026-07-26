# ITGI Motor Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add IFFCO-Tokio (`itgi`) as the third motor provider in `tf-api`, covering the full lifecycle (quote → CKYC → proposal → payment → status → certificate) across comprehensive, standalone-TP, OD-renewal, new-vehicle and break-in paths.

**Architecture:** Mirror the FG/ICICI provider folder layout, plus an `itgi/policy-types/` folder where each policy path contributes only its payload *delta*. Hybrid transport: SOAP/XML for motor, REST/JSON for CKYC + policy download. No token manager (ITGI authenticates via `partnerCode` in the SOAP body and presumed IP-whitelisting).

**Tech Stack:** TypeScript (ESM, `.ts` import extensions, `@/*` → `src/*`), Express, zod contracts, Prisma/MySQL, vitest, `fast-xml-parser` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-07-24-itgi-provider-design.md`

---

## Key vendor facts (needed by nearly every task)

- **SOAP:** SOAP 1.1, `SOAPAction: ""` (empty), `Content-Type: text/xml; charset=utf-8`, empty `<soapenv:Header/>`.
- **Namespaces:** IDV/Premium → `http://premiumwrapper.motor.itgi.com`. Proposal/Payment/Status → ops `http://util.ptnr.itgi.com` (`util:`), data `http://wrapper.data.ptnr.itgi.com` (`wrap:`).
- **Vendor typos — reproduce verbatim:** `engineCpacity`, `regictrationCity`, `totalPremimAfterDiscLoad`, `erorMessage`.
- **Dates:** `MM/DD/YYYY` and `MM/DD/YYYY HH:mm:ss`. **Money:** whole rupees.
- **Success sentinels:** `SUCCESSFULLY_SUBMITTED_IN_P400`, `SUCCESSFULLY_UPDATED_IN_P400`, `PAYMENT_ACCEPTED_BREAK_IN`.
- **State chain:** we mint `uniqueQuoteId` (12–20 chars) → proposal returns `orderNo`+`traceNo` → payment returns `policyNumber`.
- **DB reality:** `ProviderMmvCode`/`ProviderRtoCode`/`ProviderInsurerCode` key on **`providerSlug`** (the `source` column lives on canonical master rows). `ProviderRtoCode` is line-aware (`line` ∈ `tw|fw|cv|all`).

**Credential placeholders:** ITGI has not yet issued our partner code, and CKYC auth is unconfirmed. Every credential is read from env with an empty-string default so the app boots; `ITGI_ENABLED` defaults to `false`. Where the vendor contract is genuinely unknown (RTO tokens), the code fails closed with a named error rather than guessing.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/providers/itgi/config.ts` | env → typed config, capability constants, coverage-name map |
| `src/providers/itgi/errors.ts` | `assertItgiSuccess`, error classification, unmapped-code errors |
| `src/providers/itgi/http.ts` | SOAP + JSON transports (injectable for tests) |
| `src/providers/itgi/mapper.ts` | base payload builders (idv/premium/proposal/payment/status/download) |
| `src/providers/itgi/policy-types/*.ts` | per-path payload deltas + selector |
| `src/providers/itgi/normalizer.ts` | vendor XML/JSON → canonical (dual-block selection) |
| `src/providers/itgi/ckyc.ts` | REST fetch / validate-OTP / create |
| `src/providers/itgi/proposal.ts` | `validateProposalRequest` |
| `src/providers/itgi/payment.ts` | `updatePaymentDetails` |
| `src/providers/itgi/policy-status.ts` | `getPolicyStatus` |
| `src/providers/itgi/certificate.ts` | `/policy/download` (Basic auth) |
| `src/providers/itgi/inspection.ts` | break-in create + status |
| `src/providers/itgi/renewal.ts` | OD-renewal lifecycle |
| `src/providers/itgi/db-code-resolver.ts` | canonical IDs → ITGI codes (strict RTO) |
| `src/providers/itgi/itgi.provider.ts` | the provider class |
| `src/providers/itgi/index.ts` | `registerItgiProvider()` |
| `scripts/import-itgi-master.ts` | idempotent master import (no RTO rows) |

---

## Task 1: Config, capabilities and env wiring

**Files:**
- Create: `tf-api/src/providers/itgi/config.ts`
- Modify: `tf-api/src/config/env.ts`
- Modify: `tf-api/.env.example`
- Test: `tf-api/src/providers/itgi/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/config.test.ts
import { describe, it, expect } from "vitest";
import {
  ITGI_SLUG,
  ITGI_DISPLAY_NAME,
  ITGI_CAPABILITIES,
  ITGI_OPERATIONS,
  ITGI_COVERAGE,
  itgiCoverageName,
} from "../config.ts";

describe("itgi config", () => {
  it("identifies the provider", () => {
    expect(ITGI_SLUG).toBe("itgi");
    expect(ITGI_DISPLAY_NAME).toBe("IFFCO-Tokio");
  });

  it("supports car, two-wheeler and new vehicle but not commercial", () => {
    expect(ITGI_CAPABILITIES.has("fourWheeler")).toBe(true);
    expect(ITGI_CAPABILITIES.has("twoWheeler")).toBe(true);
    expect(ITGI_CAPABILITIES.has("newVehicle")).toBe(true);
    expect(ITGI_CAPABILITIES.has("commercial")).toBe(false);
  });

  it("declares the lifecycle operations it implements, but not retrieveQuote", () => {
    for (const op of ["quote", "proposal", "ckyc", "ovd", "issuance", "renewal", "inspection", "policyStatus", "coi"]) {
      expect(ITGI_OPERATIONS.has(op as never), op).toBe(true);
    }
    expect(ITGI_OPERATIONS.has("retrieveQuote")).toBe(false);
  });

  it("uses the vendor's exact coverage name strings", () => {
    expect(ITGI_COVERAGE.IDV_BASIC).toBe("IDV Basic");
    expect(ITGI_COVERAGE.PA_OWNER_DRIVER).toBe("PA Owner / Driver");
    expect(ITGI_COVERAGE.TOWING).toBe("Towing & Related");
    expect(itgiCoverageName("zeroDep")).toBe("Depreciation Waiver");
    expect(itgiCoverageName("tyreProtect")).toBe("Tyre Protection");
    expect(itgiCoverageName("engineProtect")).toBe("Engine Gear Box Protection");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/config.test.ts`
Expected: FAIL — cannot resolve `../config.ts`.

- [ ] **Step 3: Add env variables**

In `tf-api/src/config/env.ts`, add to the zod schema (follow the existing FG/ICICI style; all default to `""` so the app boots without ITGI credentials):

```ts
  // ── ITGI (IFFCO-Tokio) ───────────────────────────────────────────────────
  ITGI_ENABLED: z.coerce.boolean().default(false),
  // Base hosts. UAT defaults are the vendor's published staging endpoints.
  ITGI_SOAP_BASE_URL: z.string().default("https://staging.iffcotokio.co.in/portaltest/services"),
  ITGI_REST_BASE_URL: z.string().default("https://staging.iffcotokio.co.in/partner-services"),
  // PLACEHOLDER: ITGI has not yet issued our partner code (see spec §7 blockers).
  ITGI_PARTNER_CODE: z.string().default(""),
  ITGI_PARTNER_BRANCH: z.string().default(""),
  ITGI_PARTNER_SUB_BRANCH: z.string().default(""),
  // Response URL echoed in the proposal payload.
  ITGI_RESPONSE_URL: z.string().default(""),
  // PLACEHOLDER: Basic-auth credentials for the policy-download REST API.
  ITGI_DOWNLOAD_USER: z.string().default(""),
  ITGI_DOWNLOAD_PASSWORD: z.string().default(""),
```

Append the same keys with blank values and a `# PLACEHOLDER — awaiting ITGI` comment to `tf-api/.env.example`.

- [ ] **Step 4: Write `config.ts`**

```ts
// src/providers/itgi/config.ts
import { env } from "@/config/env.ts";
import type { VehicleCategory, ProviderOperation, MotorCapabilities } from "@/contracts/enums.ts";

export const ITGI_SLUG = "itgi";
export const ITGI_DISPLAY_NAME = "IFFCO-Tokio";

/** Private car + two-wheeler + new vehicle. Commercial (CVI) is excluded: the
 *  vendor kit ships no CVI master data, so we cannot resolve its codes. */
export const ITGI_CAPABILITIES: ReadonlySet<VehicleCategory> = new Set([
  "fourWheeler",
  "twoWheeler",
  "newVehicle",
]);

/** ITGI has no "retrieve quote by id" operation (same as FG). */
export const ITGI_OPERATIONS: ReadonlySet<ProviderOperation> = new Set([
  "quote",
  "proposal",
  "ckyc",
  "ovd",
  "issuance",
  "renewal",
  "inspection",
  "policyStatus",
  "coi",
]);

/**
 * ITGI keys coverages by an exact NAME string, not a code. This vocabulary is a
 * small fixed set that changes only when the vendor revises its kit, so it lives
 * in code rather than a DB table (see spec §3.8).
 */
export const ITGI_COVERAGE = {
  IDV_BASIC: "IDV Basic",
  PA_OWNER_DRIVER: "PA Owner / Driver",
  PA_TO_PASSENGER: "PA to Passenger",
  TPPD: "TPPD",
  LL_DRIVER: "Legal Liability to Driver",
  LL_EMPLOYEE: "Legal Liability to Employee",
  NCB: "No Claim Bonus",
  ELECTRICAL_ACCESSORIES: "Electrical Accessories",
  COST_OF_ACCESSORIES: "Cost of Accessories",
  CNG_KIT: "CNG Kit",
  CNG_KIT_COMPANY_FIT: "CNG Kit Company Fit",
  VOLUNTARY_EXCESS: "Voluntary Excess",
  AAI_DISCOUNT: "AAI Discount",
  ANTI_THEFT: "Anti-Theft",
  DEPRECIATION_WAIVER: "Depreciation Waiver",
  TOWING: "Towing & Related",
  CONSUMABLE: "Consumable",
  ENGINE_GEAR_BOX: "Engine Gear Box Protection",
  RIM: "RIM",
  TYRE_PROTECTION: "Tyre Protection",
  HELMET: "HELMET",
  PAY_AS_YOU_DRIVE: "Pay As You Drive",
  PREFERRED_GARAGE: "Preferred Garage Opted cover",
} as const;

/** Canonical add-on flag (MotorQuoteRequest) → ITGI coverage name. */
const ADDON_TO_COVERAGE: Partial<Record<string, string>> = {
  zeroDep: ITGI_COVERAGE.DEPRECIATION_WAIVER,
  engineProtect: ITGI_COVERAGE.ENGINE_GEAR_BOX,
  tyreProtect: ITGI_COVERAGE.TYRE_PROTECTION,
  rimProtect: ITGI_COVERAGE.RIM,
  consumables: ITGI_COVERAGE.CONSUMABLE,
  rsa: ITGI_COVERAGE.TOWING,
  paOwner: ITGI_COVERAGE.PA_OWNER_DRIVER,
  paUnnamedPassenger: ITGI_COVERAGE.PA_TO_PASSENGER,
  legalLiabilityPaidDriver: ITGI_COVERAGE.LL_EMPLOYEE,
};

export function itgiCoverageName(addonKey: string): string | undefined {
  return ADDON_TO_COVERAGE[addonKey];
}

/** Allowed-value constraints the vendor enforces (kit master sheets). */
export const ITGI_ALLOWED = {
  ncbPercent: [20, 25, 35, 45, 50],
  voluntaryExcess: { fourWheeler: [2500, 5000, 7500, 15000], twoWheeler: [500, 750, 1000, 1500, 3000] },
  tppdSumInsured: { fourWheeler: 750000, twoWheeler: 100000 },
  helmetMaxSI: 50000,
  tyreMaxVehicleAgeYears: 4,
} as const;

export interface ItgiConfig {
  soapBaseUrl: string;
  restBaseUrl: string;
  partnerCode: string;
  partnerBranch: string;
  partnerSubBranch: string;
  responseUrl: string;
  downloadUser: string;
  downloadPassword: string;
}

export function itgiConfig(): ItgiConfig {
  return {
    soapBaseUrl: env.ITGI_SOAP_BASE_URL.replace(/\/$/, ""),
    restBaseUrl: env.ITGI_REST_BASE_URL.replace(/\/$/, ""),
    partnerCode: env.ITGI_PARTNER_CODE,
    partnerBranch: env.ITGI_PARTNER_BRANCH,
    partnerSubBranch: env.ITGI_PARTNER_SUB_BRANCH,
    responseUrl: env.ITGI_RESPONSE_URL,
    downloadUser: env.ITGI_DOWNLOAD_USER,
    downloadPassword: env.ITGI_DOWNLOAD_PASSWORD,
  };
}

/** Per-service endpoints (UAT paths from the vendor kit). */
export const ITGI_ENDPOINTS = {
  idv: (c: ItgiConfig) => `${c.soapBaseUrl}/IDVWebService`,
  premium: (c: ItgiConfig) => `${c.soapBaseUrl}/MotorPremiumWebserviceVA`,
  newVehiclePremium: (c: ItgiConfig) => `${c.soapBaseUrl}/NewVehiclePremiumWebserviceVA`,
  proposal: (c: ItgiConfig) => `${c.soapBaseUrl}/PartnerProposalRequest`,
  payment: (c: ItgiConfig) => `${c.soapBaseUrl}/PaymentUpdateWS`,
  policyStatus: (c: ItgiConfig) => `${c.soapBaseUrl}/CheckPolicyStatus`,
  kycFetch: (c: ItgiConfig) => `${c.restBaseUrl}/kyc/fetch`,
  kycValidateOtp: (c: ItgiConfig) => `${c.restBaseUrl}/kyc/fetch-validate-otp`,
  kycCreate: (c: ItgiConfig) => `${c.restBaseUrl}/kyc/create`,
  policyDownload: (c: ItgiConfig) => `${c.restBaseUrl}/policy/download`,
} as const;

export const ITGI_MOTOR_CAPABILITIES: MotorCapabilities = {
  fourWheeler: {
    planTypes: ["comprehensive", "thirdParty", "standAloneOD"],
    addons: ["zeroDep", "engineProtect", "tyreProtect", "rimProtect", "consumables", "rsa", "paOwner", "paUnnamedPassenger", "legalLiabilityPaidDriver"],
  },
  twoWheeler: {
    planTypes: ["comprehensive", "thirdParty", "standAloneOD"],
    // RIM/Tyre/Engine are valid for two-wheelers per the updated vendor kit.
    addons: ["zeroDep", "engineProtect", "tyreProtect", "rimProtect", "consumables", "rsa", "paOwner", "paUnnamedPassenger"],
  },
  newVehicle: {
    planTypes: ["comprehensive"],
    addons: ["zeroDep", "engineProtect", "tyreProtect", "rimProtect", "consumables", "rsa", "paOwner"],
  },
} as MotorCapabilities;
```

> If `MotorCapabilities`' exact shape differs, match the structure used in `src/providers/fg/config.ts` (`FG_MOTOR_CAPABILITIES`) — read it first and mirror it rather than forcing the literal above.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
cd tf-api && npm run typecheck
git add src/providers/itgi/config.ts src/providers/itgi/__tests__/config.test.ts src/config/env.ts .env.example
git commit -m "feat(itgi): add provider config, capabilities and env wiring"
```

---

## Task 2: Errors and fault classification

**Files:**
- Create: `tf-api/src/providers/itgi/errors.ts`
- Test: `tf-api/src/providers/itgi/__tests__/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/errors.test.ts
import { describe, it, expect } from "vitest";
import { assertItgiSuccess, classifyItgiError, ItgiUnmappedCodeError, isItgiSuccessMessage } from "../errors.ts";
import { ProviderError } from "@/errors/app-error.ts";

describe("itgi errors", () => {
  it("passes when no error field is present", () => {
    expect(() => assertItgiSuccess({ orderNo: "0001", traceNo: "12" }, "proposal")).not.toThrow();
  });

  it("detects the vendor's misspelled erorMessage field", () => {
    expect(() => assertItgiSuccess({ erorMessage: "Invalid RTO" }, "idv")).toThrow(ProviderError);
  });

  it("detects errorMessage and error", () => {
    expect(() => assertItgiSuccess({ errorMessage: "bad make" }, "premium")).toThrow(ProviderError);
    expect(() => assertItgiSuccess({ error: "boom" }, "premium")).toThrow(ProviderError);
  });

  it("ignores nil-valued error fields", () => {
    expect(() => assertItgiSuccess({ erorMessage: "", errorMessage: null }, "idv")).not.toThrow();
  });

  it("recognises the P400 success sentinels", () => {
    expect(isItgiSuccessMessage("SUCCESSFULLY_SUBMITTED_IN_P400")).toBe(true);
    expect(isItgiSuccessMessage("SUCCESSFULLY_UPDATED_IN_P400")).toBe(true);
    expect(isItgiSuccessMessage("PAYMENT_ACCEPTED_BREAK_IN")).toBe(true);
    expect(isItgiSuccessMessage("TRANCTION_DECLINED")).toBe(false);
  });

  it("classifies transient upstream faults as retryable", () => {
    expect(classifyItgiError("Read timed out")).toBe("UPSTREAM_UNAVAILABLE");
    expect(classifyItgiError("Service Unavailable")).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("classifies declines and validation faults", () => {
    expect(classifyItgiError("Vehicle make is declined")).toBe("REFERRAL_DECLINED");
    expect(classifyItgiError("KYC details not found")).toBe("KYC_INCOMPLETE");
    expect(classifyItgiError("Inspection is required for break-in")).toBe("INSPECTION_REQUIRED");
  });

  it("carries the unmapped-code error as a no-quote signal", () => {
    const err = new ItgiUnmappedCodeError("RTO", "MH12");
    expect(err.code).toBe("UNMAPPED_CODE");
    expect(err.message).toContain("MH12");
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/errors.test.ts`
Expected: FAIL — cannot resolve `../errors.ts`.

- [ ] **Step 3: Implement `errors.ts`**

```ts
// src/providers/itgi/errors.ts
import { ProviderError } from "@/errors/app-error.ts";
import { ITGI_SLUG } from "./config.ts";

/** Vendor sentinels meaning "accepted by the ITGI core (P400)". */
const SUCCESS_MESSAGES = new Set([
  "SUCCESSFULLY_SUBMITTED_IN_P400",
  "SUCCESSFULLY_UPDATED_IN_P400",
  "PAYMENT_ACCEPTED_BREAK_IN",
]);

export function isItgiSuccessMessage(message: string | undefined): boolean {
  return Boolean(message && SUCCESS_MESSAGES.has(message.trim().toUpperCase()));
}

/**
 * A canonical id has no ITGI counterpart in the Provider*Code tables. Treated as
 * "no quote" rather than an error so one unmapped vehicle/RTO never breaks the
 * whole comparison page.
 */
export class ItgiUnmappedCodeError extends Error {
  readonly code = "UNMAPPED_CODE";
  constructor(kind: string, value: string) {
    super(`ITGI has no ${kind} mapping for "${value}"`);
    this.name = "ItgiUnmappedCodeError";
  }
}

export function classifyItgiError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("timed out") || m.includes("timeout") || m.includes("unavailable") || m.includes("connection"))
    return "UPSTREAM_UNAVAILABLE";
  if (m.includes("inspection") || m.includes("break-in") || m.includes("breakin")) return "INSPECTION_REQUIRED";
  if (m.includes("kyc") || m.includes("iurn")) return "KYC_INCOMPLETE";
  if (m.includes("declined") || m.includes("not allowed") || m.includes("referral")) return "REFERRAL_DECLINED";
  if (m.includes("master") || m.includes("invalid") || m.includes("mandatory")) return "VALIDATION_FAILED";
  return "PROVIDER_ERROR";
}

function firstErrorText(root: Record<string, unknown>): string {
  // `erorMessage` is the vendor's own misspelling (IDV response) — keep it.
  for (const key of ["erorMessage", "errorMessage", "error", "Error"] as const) {
    const v = root[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * ITGI signals failure via `error` / `errorMessage` / `erorMessage` (sic). A nil
 * or empty value means success. Throws a ProviderError with a canonical code.
 */
export function assertItgiSuccess(root: Record<string, unknown>, context: string): void {
  const message = firstErrorText(root);
  if (!message) return;

  const code = classifyItgiError(message);
  const userMessage =
    code === "UPSTREAM_UNAVAILABLE"
      ? "IFFCO-Tokio's service is temporarily unavailable. Please try again in a moment."
      : `ITGI ${context} failed: ${message}`;
  throw new ProviderError(ITGI_SLUG, 200, userMessage, root, code);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/errors.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/itgi/errors.ts src/providers/itgi/__tests__/errors.test.ts
git commit -m "feat(itgi): add error classification and success sentinels"
```

---

## Task 3: SOAP + JSON transport

**Files:**
- Create: `tf-api/src/providers/itgi/http.ts`
- Test: `tf-api/src/providers/itgi/__tests__/http.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/http.test.ts
import { describe, it, expect } from "vitest";
import { parseItgiSoap, soapEnvelope, FetchItgiTransport } from "../http.ts";

describe("itgi soap helpers", () => {
  it("wraps a body in a SOAP 1.1 envelope with an empty header", () => {
    const xml = soapEnvelope("<getVehicleIdv/>", { prem: "http://premiumwrapper.motor.itgi.com" });
    expect(xml).toContain('xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"');
    expect(xml).toContain('xmlns:prem="http://premiumwrapper.motor.itgi.com"');
    expect(xml).toContain("<soapenv:Header/>");
    expect(xml).toContain("<getVehicleIdv/>");
  });

  it("unwraps the SOAP body and strips namespace prefixes", () => {
    const res = parseItgiSoap(`<?xml version="1.0"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body>
          <getVehicleIdvResponse xmlns="http://premiumwrapper.motor.itgi.com">
            <getVehicleIdvReturn><idv>415695</idv></getVehicleIdvReturn>
          </getVehicleIdvResponse>
        </soapenv:Body>
      </soapenv:Envelope>`) as Record<string, any>;
    expect(res.getVehicleIdvResponse.getVehicleIdvReturn.idv).toBe("415695");
  });

  it("keeps repeated elements as arrays", () => {
    const res = parseItgiSoap(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body><r>
          <getMotorPremiumReturn><autocoverage>false</autocoverage></getMotorPremiumReturn>
          <getMotorPremiumReturn><autocoverage>true</autocoverage></getMotorPremiumReturn>
        </r></soapenv:Body></soapenv:Envelope>`) as Record<string, any>;
    expect(Array.isArray(res.r.getMotorPremiumReturn)).toBe(true);
    expect(res.r.getMotorPremiumReturn).toHaveLength(2);
  });

  it("surfaces a soap fault as a provider error", async () => {
    const transport = new FetchItgiTransport(async () =>
      new Response("<soapenv:Envelope><soapenv:Body><soapenv:Fault><faultstring>boom</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>", { status: 500 }));
    await expect(transport.soap("http://x", "<a/>", { requestId: "r1" })).rejects.toThrow(/temporarily unavailable|500/i);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/http.test.ts`
Expected: FAIL — cannot resolve `../http.ts`.

- [ ] **Step 3: Implement `http.ts`**

```ts
// src/providers/itgi/http.ts
import { XMLParser } from "fast-xml-parser";
import { ProviderError } from "@/errors/app-error.ts";
import { ITGI_SLUG } from "./config.ts";

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false, // keep values as strings (preserve leading zeros)
  processEntities: true,
  trimValues: true,
  // The premium service returns two <getMotorPremiumReturn> siblings; without
  // this, a single-block response would parse to an object and a dual-block one
  // to an array. Force the ones we branch on to always be arrays.
  isArray: (name) => name === "getMotorPremiumReturn" || name === "coveragePremiumDetail",
});

/** Wraps a body fragment in a SOAP 1.1 envelope with the given prefix→uri map. */
export function soapEnvelope(body: string, namespaces: Record<string, string>): string {
  const ns = Object.entries(namespaces)
    .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
    .join("");
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"${ns}>` +
    `<soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`
  );
}

/** Unwraps <Envelope><Body> and returns the parsed body content. */
export function parseItgiSoap(text: string): unknown {
  const env = parser.parse(text) as Record<string, unknown>;
  const envelope = env?.Envelope as Record<string, unknown> | undefined;
  const body = envelope?.Body as Record<string, unknown> | undefined;
  return body ?? env;
}

export interface ItgiRequestOptions {
  requestId: string;
}

/** Injectable transport so tests drive fixtures without touching the network. */
export interface ItgiTransport {
  soap(url: string, xml: string, opts: ItgiRequestOptions): Promise<unknown>;
  json(url: string, body: unknown, opts: ItgiRequestOptions & { basicAuth?: { user: string; password: string } }): Promise<unknown>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class FetchItgiTransport implements ItgiTransport {
  constructor(private readonly doFetch: FetchLike = fetch) {}

  async soap(url: string, xml: string, _opts: ItgiRequestOptions): Promise<unknown> {
    const response = await this.doFetch(url, {
      method: "POST",
      headers: {
        // ITGI's WSDLs declare soapAction="" on every operation.
        SOAPAction: "",
        "Content-Type": "text/xml; charset=utf-8",
      },
      body: xml,
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw httpError(response.status, text);

    const parsed = parseItgiSoap(text) as Record<string, unknown>;
    const fault = parsed?.Fault as Record<string, unknown> | undefined;
    if (fault) {
      const detail = typeof fault.faultstring === "string" ? fault.faultstring : "SOAP fault";
      throw new ProviderError(ITGI_SLUG, 502, `ITGI request failed: ${detail}`, text.slice(0, 500), "PROVIDER_ERROR");
    }
    return parsed;
  }

  async json(
    url: string,
    body: unknown,
    opts: ItgiRequestOptions & { basicAuth?: { user: string; password: string } },
  ): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json", accept: "application/json" };
    if (opts.basicAuth) {
      const raw = `${opts.basicAuth.user}:${opts.basicAuth.password}`;
      headers.Authorization = `Basic ${Buffer.from(raw).toString("base64")}`;
    }
    const response = await this.doFetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw httpError(response.status, text);
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new ProviderError(ITGI_SLUG, response.status, "ITGI returned a non-JSON body", text.slice(0, 500));
    }
  }
}

function httpError(status: number, text: string): ProviderError {
  const transient = status >= 500;
  return new ProviderError(
    ITGI_SLUG,
    status,
    transient
      ? "IFFCO-Tokio's service is temporarily unavailable. Please try again in a moment."
      : `ITGI request failed [${status}]`,
    text.slice(0, 500),
    transient ? "UPSTREAM_UNAVAILABLE" : "PROVIDER_ERROR",
  );
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/http.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/itgi/http.ts src/providers/itgi/__tests__/http.test.ts
git commit -m "feat(itgi): add SOAP and JSON transports"
```

---

## Task 4: Shared formatting helpers

**Files:**
- Create: `tf-api/src/providers/itgi/format.ts`
- Test: `tf-api/src/providers/itgi/__tests__/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/format.test.ts
import { describe, it, expect } from "vitest";
import { toItgiDate, toItgiDateTime, splitRegistrationNumber, makeUniqueQuoteId, itgiContractType, xmlEscape } from "../format.ts";

describe("itgi formatting", () => {
  it("formats dates as MM/DD/YYYY", () => {
    expect(toItgiDate("2026-02-26")).toBe("02/26/2026");
  });

  it("formats datetimes as MM/DD/YYYY HH:mm:ss", () => {
    expect(toItgiDateTime("2026-02-26", "00:00:00")).toBe("02/26/2026 00:00:00");
    expect(toItgiDateTime("2027-02-25", "23:59:59")).toBe("02/25/2027 23:59:59");
  });

  it("splits a registration number into the vendor's four parts", () => {
    expect(splitRegistrationNumber("DL10AH4567")).toEqual({ p1: "DL", p2: "10", p3: "AH", p4: "4567" });
    expect(splitRegistrationNumber("MH-02-BF-1234")).toEqual({ p1: "MH", p2: "02", p3: "BF", p4: "1234" });
  });

  it("handles a single-letter series", () => {
    expect(splitRegistrationNumber("KA05A1234")).toEqual({ p1: "KA", p2: "05", p3: "A", p4: "1234" });
  });

  it("returns null for an unparseable registration number", () => {
    expect(splitRegistrationNumber("NEW")).toBeNull();
  });

  it("mints a unique quote id between 12 and 20 characters", () => {
    const id = makeUniqueQuoteId("req-abc");
    expect(id.length).toBeGreaterThanOrEqual(12);
    expect(id.length).toBeLessThanOrEqual(20);
  });

  it("maps vehicle categories to the vendor contract type", () => {
    expect(itgiContractType("fourWheeler")).toBe("PCP");
    expect(itgiContractType("twoWheeler")).toBe("TWP");
  });

  it("escapes XML special characters", () => {
    expect(xmlEscape("Towing & Related")).toBe("Towing &amp; Related");
    expect(xmlEscape("a<b>c")).toBe("a&lt;b&gt;c");
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/format.test.ts`
Expected: FAIL — cannot resolve `../format.ts`.

- [ ] **Step 3: Implement `format.ts`**

```ts
// src/providers/itgi/format.ts
import type { VehicleCategory } from "@/contracts/enums.ts";

/** ISO `YYYY-MM-DD` → ITGI `MM/DD/YYYY`. */
export function toItgiDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/** ISO date + clock → ITGI `MM/DD/YYYY HH:mm:ss`. */
export function toItgiDateTime(iso: string, time = "00:00:00"): string {
  return `${toItgiDate(iso)} ${time}`;
}

export interface RegistrationParts {
  p1: string;
  p2: string;
  p3: string;
  p4: string;
}

/**
 * ITGI splits the registration number across four tags, e.g. DL10AH4567 →
 * DL / 10 / AH / 4567. Returns null when the input cannot be parsed (e.g. "NEW"
 * for an unregistered vehicle).
 */
export function splitRegistrationNumber(reg: string): RegistrationParts | null {
  const clean = reg.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const m = /^([A-Z]{2})(\d{1,3})([A-Z]{0,3})(\d{1,4})$/.exec(clean);
  if (!m) return null;
  return { p1: m[1], p2: m[2], p3: m[3], p4: m[4] };
}

/**
 * ITGI requires a partner-unique quote id of 12–20 characters (break-in
 * proposals enforce the lower bound). Derived from our requestId so the vendor
 * id is traceable back to our logs.
 */
export function makeUniqueQuoteId(requestId: string): string {
  const alnum = requestId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const padded = (alnum + Date.now().toString()).slice(0, 20);
  return padded.padEnd(12, "0");
}

/** Canonical vehicle category → ITGI contract type. */
export function itgiContractType(category: VehicleCategory): "PCP" | "TWP" {
  return category === "twoWheeler" ? "TWP" : "PCP";
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Builds `<tag>escaped</tag>`; empty/undefined values render as `<tag/>`. */
export function tag(name: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return `<${name}/>`;
  return `<${name}>${xmlEscape(String(value))}</${name}>`;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/format.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/itgi/format.ts src/providers/itgi/__tests__/format.test.ts
git commit -m "feat(itgi): add date, registration and XML formatting helpers"
```

---

## Task 5: Policy-type delta modules

**Files:**
- Create: `tf-api/src/providers/itgi/policy-types/index.ts`
- Create: `tf-api/src/providers/itgi/policy-types/types.ts`
- Test: `tf-api/src/providers/itgi/__tests__/policy-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/policy-types.test.ts
import { describe, it, expect } from "vitest";
import { selectPolicyPath, isBreakIn } from "../policy-types/index.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";

const base = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  registrationDate: "2020-05-10",
  previousPolicyExpiryDate: "2026-07-01",
} as unknown as MotorQuoteRequest;

describe("itgi policy paths", () => {
  it("maps comprehensive to CO / CP", () => {
    const p = selectPolicyPath(base);
    expect(p.zcover).toBe("CO");
    expect(p.policyType).toBe("CP");
  });

  it("maps third party to AC / TP with IDV sum insured of 1", () => {
    const p = selectPolicyPath({ ...base, selectedPolicy: "thirdParty" });
    expect(p.zcover).toBe("AC");
    expect(p.policyType).toBe("TP");
    expect(p.idvSumInsuredOverride).toBe(1);
  });

  it("maps standalone OD to policy type OD and requires TP policy details", () => {
    const p = selectPolicyPath({ ...base, selectedPolicy: "standAloneOD" });
    expect(p.policyType).toBe("OD");
    expect(p.requiresTpPolicyDetails).toBe(true);
  });

  it("maps a new vehicle to BP and the dedicated premium endpoint", () => {
    const p = selectPolicyPath({ ...base, vehicleType: "newVehicle", businessType: "new" });
    expect(p.policyType).toBe("BP");
    expect(p.newVehicleFlag).toBe("Y");
    expect(p.usesNewVehicleEndpoint).toBe(true);
  });

  it("detects break-in from an expired previous policy", () => {
    const asOf = new Date("2026-07-24");
    expect(isBreakIn({ ...base, previousPolicyExpiryDate: "2026-07-01" }, asOf)).toBe(true);
    expect(isBreakIn({ ...base, previousPolicyExpiryDate: "2026-08-01" }, asOf)).toBe(false);
  });

  it("flags a break-in of more than 90 days", () => {
    const asOf = new Date("2026-07-24");
    const near = selectPolicyPath({ ...base, previousPolicyExpiryDate: "2026-07-01" }, asOf);
    expect(near.breakIn).toBe(true);
    expect(near.breakInMoreThan90Days).toBe("N");
    const far = selectPolicyPath({ ...base, previousPolicyExpiryDate: "2026-01-01" }, asOf);
    expect(far.breakInMoreThan90Days).toBe("Y");
  });

  it("shifts inception by three days for a break-in", () => {
    const asOf = new Date("2026-07-24");
    const p = selectPolicyPath({ ...base, previousPolicyExpiryDate: "2026-07-01" }, asOf);
    expect(p.inceptionOffsetDays).toBe(3);
  });

  it("does not shift inception when there is no break-in", () => {
    const p = selectPolicyPath({ ...base, previousPolicyExpiryDate: "2026-08-01" }, new Date("2026-07-24"));
    expect(p.inceptionOffsetDays).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/policy-types.test.ts`
Expected: FAIL — cannot resolve `../policy-types/index.ts`.

- [ ] **Step 3: Implement `policy-types/types.ts`**

```ts
// src/providers/itgi/policy-types/types.ts

/** The payload delta a policy path contributes to the premium/proposal payloads. */
export interface ItgiPolicyPath {
  /** Vendor cover mode: CO = comprehensive, AC = act-only/third-party. */
  zcover: "CO" | "AC";
  /** Vendor policy type: CP | TP | OD | BP. */
  policyType: "CP" | "TP" | "OD" | "BP";
  /** Act-only policies still send IDV Basic, but with sum insured 1. */
  idvSumInsuredOverride?: number;
  /** Standalone OD needs the running package (TP) policy's details. */
  requiresTpPolicyDetails: boolean;
  /** New vehicles use NewVehiclePremiumWebserviceVA and set newVehicleFlag. */
  usesNewVehicleEndpoint: boolean;
  newVehicleFlag?: "Y";
  /** Break-in modifier (composes onto any of the above). */
  breakIn: boolean;
  breakInMoreThan90Days: "Y" | "N";
  /** Break-in inception is read as today+3 when inspection is at ITGI's end. */
  inceptionOffsetDays: number;
}
```

- [ ] **Step 4: Implement `policy-types/index.ts`**

```ts
// src/providers/itgi/policy-types/index.ts
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import type { ItgiPolicyPath } from "./types.ts";

export type { ItgiPolicyPath } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A break-in exists when the previous policy already expired. */
export function isBreakIn(req: MotorQuoteRequest, asOf = new Date()): boolean {
  if (req.businessType === "new") return false;
  if (req.isPreviousPolicyExpired) return true;
  if (!req.previousPolicyExpiryDate) return false;
  return new Date(req.previousPolicyExpiryDate).getTime() < asOf.getTime();
}

function daysSinceExpiry(req: MotorQuoteRequest, asOf: Date): number {
  if (!req.previousPolicyExpiryDate) return 0;
  return Math.floor((asOf.getTime() - new Date(req.previousPolicyExpiryDate).getTime()) / DAY_MS);
}

/**
 * Resolves the canonical request onto ITGI's policy vocabulary. New vehicle is a
 * VehicleCategory (not a canonical PolicyType), and break-in is a modifier that
 * composes onto whichever base path applies.
 */
export function selectPolicyPath(req: MotorQuoteRequest, asOf = new Date()): ItgiPolicyPath {
  const isNewVehicle = req.vehicleType === "newVehicle" || req.businessType === "new";
  const breakIn = !isNewVehicle && isBreakIn(req, asOf);

  const base: ItgiPolicyPath = {
    zcover: "CO",
    policyType: "CP",
    requiresTpPolicyDetails: false,
    usesNewVehicleEndpoint: false,
    breakIn,
    breakInMoreThan90Days: breakIn && daysSinceExpiry(req, asOf) > 90 ? "Y" : "N",
    inceptionOffsetDays: breakIn ? 3 : 0,
  };

  if (isNewVehicle) {
    return { ...base, policyType: "BP", newVehicleFlag: "Y", usesNewVehicleEndpoint: true };
  }
  if (req.selectedPolicy === "thirdParty") {
    return { ...base, zcover: "AC", policyType: "TP", idvSumInsuredOverride: 1 };
  }
  if (req.selectedPolicy === "standAloneOD") {
    return { ...base, policyType: "OD", requiresTpPolicyDetails: true };
  }
  return base;
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/policy-types.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/providers/itgi/policy-types src/providers/itgi/__tests__/policy-types.test.ts
git commit -m "feat(itgi): add policy-path resolution with break-in modifier"
```

---

## Task 6: Code resolver (strict RTO)

**Files:**
- Create: `tf-api/src/providers/itgi/db-code-resolver.ts`
- Test: `tf-api/src/providers/itgi/__tests__/db-code-resolver.test.ts`

Read `src/repositories/master.repository.ts` first — reuse `getProviderMmvCode`, `getProviderRtoCode` / `selectRtoCodeForLine`, `getProviderInsurerCode`, `findMmvRow`, `getRtoByCode`. Do **not** add new repository functions unless one is genuinely missing.

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/db-code-resolver.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ItgiUnmappedCodeError } from "../errors.ts";

const mocks = vi.hoisted(() => ({
  findMmvRow: vi.fn(),
  getRtoByCode: vi.fn(),
  getProviderMmvCode: vi.fn(),
  getProviderRtoCode: vi.fn(),
  getProviderInsurerCode: vi.fn(),
}));
vi.mock("@/repositories/master.repository.ts", () => mocks);

import { itgiDbCodeResolver } from "../db-code-resolver.ts";

const req = {
  vehicleType: "fourWheeler",
  makeId: "1",
  modelId: "10",
  makeName: "MARUTI",
  modelName: "SWIFT",
  rtoCode: "DL01",
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMmvRow.mockResolvedValue({ id: 7, engineCC: 1197, seatingCapacity: 5 });
  mocks.getRtoByCode.mockResolvedValue({ id: 3, code: "DL01", city: "DELHI" });
  mocks.getProviderMmvCode.mockResolvedValue({ providerVariantCode: "MRSFT" });
  mocks.getProviderRtoCode.mockResolvedValue({ providerCode: "DELHI" });
  mocks.getProviderInsurerCode.mockResolvedValue(undefined);
});

describe("itgi code resolver", () => {
  it("resolves the MMV variant code and RTO token", async () => {
    const codes = await itgiDbCodeResolver(req);
    expect(codes.makeCode).toBe("MRSFT");
    expect(codes.rtoCity).toBe("DELHI");
  });

  it("throws an unmapped-code error when the RTO has no ITGI mapping", async () => {
    mocks.getProviderRtoCode.mockResolvedValue(undefined);
    await expect(itgiDbCodeResolver(req)).rejects.toThrow(ItgiUnmappedCodeError);
  });

  it("never derives an RTO token from the city name", async () => {
    // Strict by design: the vendor's RTO master is missing, so a miss must fail
    // closed rather than guess "DELHI" from the canonical city.
    mocks.getProviderRtoCode.mockResolvedValue(undefined);
    await expect(itgiDbCodeResolver(req)).rejects.toThrow(/RTO mapping/i);
  });

  it("throws an unmapped-code error when the vehicle has no ITGI mapping", async () => {
    mocks.getProviderMmvCode.mockResolvedValue(undefined);
    await expect(itgiDbCodeResolver(req)).rejects.toThrow(ItgiUnmappedCodeError);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/db-code-resolver.test.ts`
Expected: FAIL — cannot resolve `../db-code-resolver.ts`.

- [ ] **Step 3: Implement `db-code-resolver.ts`**

```ts
// src/providers/itgi/db-code-resolver.ts
import {
  findMmvRow,
  getRtoByCode,
  getProviderMmvCode,
  getProviderRtoCode,
  getProviderInsurerCode,
} from "@/repositories/master.repository.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import { ItgiUnmappedCodeError } from "./errors.ts";
import { ITGI_SLUG } from "./config.ts";

export interface ItgiCodes {
  /** ITGI's 5–6 char MAKE variant code (e.g. MRSFT) — the only MMV join key. */
  makeCode: string;
  /** ITGI's rtoCity token. Never derived: strictly from ProviderRtoCode. */
  rtoCity: string;
  engineCC?: number;
  seatingCapacity?: number;
  previousInsurerCode?: string;
}

export type ItgiCodeResolver = (req: MotorQuoteRequest) => Promise<ItgiCodes>;

/** Canonical vehicle category → the line ProviderRtoCode is partitioned by. */
function rtoLine(category: string): "tw" | "fw" {
  return category === "twoWheeler" ? "tw" : "fw";
}

/**
 * Production resolver. RTO resolution is STRICT: the vendor kit ships no RTO
 * master, so an unmapped RTO fails closed with ItgiUnmappedCodeError (surfaced
 * as no_quote) rather than guessing a token from the canonical city name.
 * Importing the real master later needs no code change.
 */
export const itgiDbCodeResolver: ItgiCodeResolver = async (req) => {
  const mmv = await findMmvRow(req.makeId, req.modelId);
  if (!mmv) throw new ItgiUnmappedCodeError("vehicle", `${req.makeName} ${req.modelName}`);

  const mmvCode = await getProviderMmvCode(ITGI_SLUG, mmv.id);
  const makeCode = mmvCode?.providerVariantCode ?? mmvCode?.providerModelCode;
  if (!makeCode) throw new ItgiUnmappedCodeError("vehicle", `${req.makeName} ${req.modelName}`);

  const rto = await getRtoByCode(req.rtoCode);
  if (!rto) throw new ItgiUnmappedCodeError("RTO", req.rtoCode);

  const rtoCode = await getProviderRtoCode(ITGI_SLUG, rto.id, rtoLine(req.vehicleType));
  if (!rtoCode?.providerCode) throw new ItgiUnmappedCodeError("RTO", req.rtoCode);

  const previousInsurerCode = req.previousInsurerId
    ? (await getProviderInsurerCode(ITGI_SLUG, Number(req.previousInsurerId)))?.providerCode
    : undefined;

  return {
    makeCode,
    rtoCity: rtoCode.providerCode,
    engineCC: req.engineCC ?? mmv.engineCC ?? undefined,
    seatingCapacity: req.seatingCapacity ?? mmv.seatingCapacity ?? undefined,
    previousInsurerCode,
  };
};

/** Dev/fixture resolver — passes canonical values straight through. */
export const passthroughItgiCodeResolver: ItgiCodeResolver = async (req) => ({
  makeCode: req.modelId,
  rtoCity: req.rtoCode,
  engineCC: req.engineCC,
  seatingCapacity: req.seatingCapacity,
  previousInsurerCode: req.previousInsurerId,
});
```

> Match the real signatures in `master.repository.ts` (e.g. whether `getProviderRtoCode` takes a line argument or you must call `selectRtoCodeForLine`). Adjust the calls, not the strictness.

- [ ] **Step 4: Run and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/db-code-resolver.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/itgi/db-code-resolver.ts src/providers/itgi/__tests__/db-code-resolver.test.ts
git commit -m "feat(itgi): add code resolver with strict RTO mapping"
```

---

## Task 7: Request mapper (IDV + premium)

**Files:**
- Create: `tf-api/src/providers/itgi/mapper.ts`
- Test: `tf-api/src/providers/itgi/__tests__/mapper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/mapper.test.ts
import { describe, it, expect } from "vitest";
import { buildIdvPayload, buildPremiumPayload } from "../mapper.ts";
import { selectPolicyPath } from "../policy-types/index.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";

const req = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  makeId: "1", makeName: "MARUTI", modelId: "10", modelName: "SWIFT",
  fuelType: "petrol", engineCC: 1197, seatingCapacity: 5,
  rtoCode: "DL01", registrationDate: "2023-10-20", registrationNumber: "DL10AH4567",
  policyStartDate: "2026-02-26", policyEndDate: "2027-02-25",
  previousPolicyExpiryDate: "2026-02-24",
  ncbPercent: 45, idvValue: 105665,
  zeroDep: false, tyreProtect: false, rimProtect: false, engineProtect: false,
  consumables: false, rsa: false, paOwner: true, paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false, claimInPreviousPolicy: false, isPreviousPolicyExpired: false,
} as unknown as MotorQuoteRequest;

const codes = { makeCode: "MRSFT", rtoCity: "DELHI", engineCC: 1197, seatingCapacity: 5 };
const partner = { partnerCode: "ITGIMOT999", partnerBranch: "TF", partnerSubBranch: "TF", responseUrl: "https://x/y" };

describe("itgi idv payload", () => {
  it("builds the composite makeCode as TYPE-MAKE-YEAR", () => {
    const xml = buildIdvPayload(req, codes, selectPolicyPath(req));
    expect(xml).toContain("<prem:makeCode>PCP-MRSFT-2023</prem:makeCode>");
  });

  it("sends the resolved rto token and MM/DD/YYYY dates", () => {
    const xml = buildIdvPayload(req, codes, selectPolicyPath(req));
    expect(xml).toContain("<prem:rtoCity>DELHI</prem:rtoCity>");
    expect(xml).toContain("<prem:dateOfRegistration>10/20/2023</prem:dateOfRegistration>");
  });
});

describe("itgi premium payload", () => {
  it("reproduces the vendor's misspelled tags verbatim", () => {
    const xml = buildPremiumPayload(req, codes, selectPolicyPath(req), partner);
    // These misspellings are the vendor's own; "fixing" them breaks the call.
    expect(xml).toContain("<engineCpacity>1197</engineCpacity>");
    expect(xml).toContain("<regictrationCity>DELHI</regictrationCity>");
    expect(xml).not.toContain("engineCapacity");
    expect(xml).not.toContain("registrationCity");
  });

  it("sends contract type, zcover and the partner block", () => {
    const xml = buildPremiumPayload(req, codes, selectPolicyPath(req), partner);
    expect(xml).toContain("<contractType>PCP</contractType>");
    expect(xml).toContain("<zcover>CO</zcover>");
    expect(xml).toContain("<partnerCode>ITGIMOT999</partnerCode>");
  });

  it("includes IDV Basic and NCB coverage items", () => {
    const xml = buildPremiumPayload(req, codes, selectPolicyPath(req), partner);
    expect(xml).toContain("<coverageId>IDV Basic</coverageId>");
    expect(xml).toContain("<sumInsured>105665</sumInsured>");
    expect(xml).toContain("<coverageId>No Claim Bonus</coverageId>");
  });

  it("sends opt-in add-ons with sum insured Y", () => {
    const withAddons = { ...req, tyreProtect: true, rimProtect: true, engineProtect: true };
    const xml = buildPremiumPayload(withAddons, codes, selectPolicyPath(withAddons), partner);
    expect(xml).toContain("<coverageId>Tyre Protection</coverageId>");
    expect(xml).toContain("<coverageId>RIM</coverageId>");
    expect(xml).toContain("<coverageId>Engine Gear Box Protection</coverageId>");
    expect(xml).toMatch(/<coverageId>RIM<\/coverageId>\s*<number\/>\s*<sumInsured>Y<\/sumInsured>/);
  });

  it("escapes the ampersand in Towing & Related", () => {
    const xml = buildPremiumPayload({ ...req, rsa: true }, codes, selectPolicyPath({ ...req, rsa: true } as never), partner);
    expect(xml).toContain("Towing &amp; Related");
  });

  it("sends act-only policies with zcover AC and IDV sum insured 1", () => {
    const tp = { ...req, selectedPolicy: "thirdParty" } as MotorQuoteRequest;
    const xml = buildPremiumPayload(tp, codes, selectPolicyPath(tp), partner);
    expect(xml).toContain("<zcover>AC</zcover>");
    expect(xml).toMatch(/<coverageId>IDV Basic<\/coverageId>\s*<number\/>\s*<sumInsured>1<\/sumInsured>/);
  });

  it("omits the NCB item when ncb is zero", () => {
    const xml = buildPremiumPayload({ ...req, ncbPercent: 0 }, codes, selectPolicyPath(req), partner);
    expect(xml).not.toContain("No Claim Bonus");
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/mapper.test.ts`
Expected: FAIL — cannot resolve `../mapper.ts`.

- [ ] **Step 3: Implement `mapper.ts`**

```ts
// src/providers/itgi/mapper.ts
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import type { ItgiCodes } from "./db-code-resolver.ts";
import type { ItgiPolicyPath } from "./policy-types/index.ts";
import { ITGI_COVERAGE, itgiCoverageName, ITGI_ALLOWED } from "./config.ts";
import { toItgiDate, toItgiDateTime, itgiContractType, tag, xmlEscape } from "./format.ts";

export interface ItgiPartnerDetails {
  partnerCode: string;
  partnerBranch: string;
  partnerSubBranch: string;
  responseUrl: string;
}

/** IDV request body (namespace prefix `prem:`). */
export function buildIdvPayload(req: MotorQuoteRequest, codes: ItgiCodes, path: ItgiPolicyPath): string {
  const contractType = itgiContractType(req.vehicleType);
  const year = new Date(req.registrationDate).getFullYear();
  const inception = req.policyStartDate ?? new Date().toISOString().slice(0, 10);
  return (
    `<prem:getVehicleIdv><prem:idvWebServiceRequest>` +
    `<prem:dateOfRegistration>${toItgiDate(req.registrationDate)}</prem:dateOfRegistration>` +
    `<prem:inceptionDate>${toItgiDateTime(inception)}</prem:inceptionDate>` +
    // Composite key the vendor expects: {contractType}-{MAKE}-{yearOfManufacture}
    `<prem:makeCode>${xmlEscape(`${contractType}-${codes.makeCode}-${year}`)}</prem:makeCode>` +
    `<prem:rtoCity>${xmlEscape(codes.rtoCity)}</prem:rtoCity>` +
    `</prem:idvWebServiceRequest></prem:getVehicleIdv>`
  );
}

interface CoverageItem {
  coverageId: string;
  sumInsured: string | number;
  number?: string | number;
}

/** Builds the coverage list the customer actually opted for. */
export function buildCoverageItems(req: MotorQuoteRequest, path: ItgiPolicyPath): CoverageItem[] {
  const items: CoverageItem[] = [];

  items.push({
    coverageId: ITGI_COVERAGE.IDV_BASIC,
    sumInsured: path.idvSumInsuredOverride ?? req.idvValue ?? 0,
  });

  // Act-only policies accept only a restricted cover set.
  if (path.zcover === "AC") {
    if (req.paOwner) items.push({ coverageId: ITGI_COVERAGE.PA_OWNER_DRIVER, sumInsured: "Y" });
    items.push({ coverageId: ITGI_COVERAGE.LL_DRIVER, sumInsured: "Y" });
    if (req.paUnnamedPassenger && req.unnamedPaSumInsured)
      items.push({ coverageId: ITGI_COVERAGE.PA_TO_PASSENGER, sumInsured: req.unnamedPaSumInsured });
    return items;
  }

  if (req.ncbPercent && ITGI_ALLOWED.ncbPercent.includes(req.ncbPercent))
    items.push({ coverageId: ITGI_COVERAGE.NCB, sumInsured: req.ncbPercent });
  if (req.paOwner) items.push({ coverageId: ITGI_COVERAGE.PA_OWNER_DRIVER, sumInsured: "Y" });
  if (req.paUnnamedPassenger && req.unnamedPaSumInsured)
    items.push({ coverageId: ITGI_COVERAGE.PA_TO_PASSENGER, sumInsured: req.unnamedPaSumInsured });
  if (req.legalLiabilityPaidDriver && req.numberOfDrivers)
    items.push({ coverageId: ITGI_COVERAGE.LL_EMPLOYEE, sumInsured: "Y", number: req.numberOfDrivers });
  if (req.electricalAccessoriesSI)
    items.push({ coverageId: ITGI_COVERAGE.ELECTRICAL_ACCESSORIES, sumInsured: req.electricalAccessoriesSI });
  if (req.nonElectricalAccessoriesSI)
    items.push({ coverageId: ITGI_COVERAGE.COST_OF_ACCESSORIES, sumInsured: req.nonElectricalAccessoriesSI });
  if (req.bifuelKitSI) items.push({ coverageId: ITGI_COVERAGE.CNG_KIT, sumInsured: req.bifuelKitSI });
  if (req.hasAntiTheftDevice) items.push({ coverageId: ITGI_COVERAGE.ANTI_THEFT, sumInsured: "Y" });
  if (req.voluntaryDeductible)
    items.push({ coverageId: ITGI_COVERAGE.VOLUNTARY_EXCESS, sumInsured: req.voluntaryDeductible });

  // Opt-in add-ons: the vendor takes a literal "Y" as the sum insured.
  for (const key of ["zeroDep", "engineProtect", "tyreProtect", "rimProtect", "consumables", "rsa"] as const) {
    if (!req[key]) continue;
    const name = itgiCoverageName(key);
    if (name) items.push({ coverageId: name, sumInsured: "Y" });
  }
  if (req.odometerReading)
    items.push({ coverageId: ITGI_COVERAGE.PAY_AS_YOU_DRIVE, sumInsured: "B01", number: req.odometerReading });

  return items;
}

function renderCoverage(items: CoverageItem[]): string {
  return items
    .map(
      (i) =>
        `<item>${tag("coverageId", i.coverageId)}${tag("number", i.number)}${tag("sumInsured", i.sumInsured)}</item>`,
    )
    .join("");
}

/**
 * Premium request body. NOTE: `engineCpacity` and `regictrationCity` are the
 * vendor's own misspellings — they must be sent exactly as written.
 */
export function buildPremiumPayload(
  req: MotorQuoteRequest,
  codes: ItgiCodes,
  path: ItgiPolicyPath,
  partner: ItgiPartnerDetails,
): string {
  const contractType = itgiContractType(req.vehicleType);
  const inception = req.policyStartDate ?? new Date().toISOString().slice(0, 10);
  const expiry = req.policyEndDate ?? inception;
  const year = new Date(req.registrationDate).getFullYear();

  const vehicle =
    `<vehicle>` +
    tag("capacity", codes.seatingCapacity ?? req.seatingCapacity) +
    tag("engineCpacity", codes.engineCC ?? req.engineCC) +
    tag("grossVehicleWt", 0) +
    tag("make", codes.makeCode) +
    tag("regictrationCity", codes.rtoCity) +
    tag("registrationDate", toItgiDate(req.registrationDate)) +
    tag("seatingCapacity", codes.seatingCapacity ?? req.seatingCapacity) +
    (path.newVehicleFlag ? tag("newVehicleFlag", path.newVehicleFlag) : "<newVehicleFlag/>") +
    (path.policyType === "OD" ? tag("type", "OD") : "<type/>") +
    tag("vehicleClass", contractType) +
    tag("vehicleSubclass", contractType) +
    `<vehicleCoverage>${renderCoverage(buildCoverageItems(req, path))}</vehicleCoverage>` +
    tag("yearOfManufacture", year) +
    tag("zcover", path.zcover) +
    `</vehicle>`;

  return (
    `<getMotorPremium>` +
    `<policy>` +
    tag("contractType", contractType) +
    tag("expiryDate", toItgiDateTime(expiry, "23:59:59")) +
    tag("inceptionDate", toItgiDateTime(inception)) +
    tag("previousPolicyEndDate", req.previousPolicyExpiryDate ? toItgiDateTime(req.previousPolicyExpiryDate) : undefined) +
    vehicle +
    `</policy>` +
    `<partner>` +
    tag("partnerBranch", partner.partnerBranch) +
    tag("partnerCode", partner.partnerCode) +
    tag("partnerSubBranch", partner.partnerSubBranch) +
    `</partner>` +
    `</getMotorPremium>`
  );
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/mapper.test.ts`
Expected: PASS (9 tests). If the coverage-order assertions fail, adjust the *test's* regex, not the vendor tag names.

- [ ] **Step 5: Commit**

```bash
git add src/providers/itgi/mapper.ts src/providers/itgi/__tests__/mapper.test.ts
git commit -m "feat(itgi): add IDV and premium request mappers"
```

---

## Task 8: Response normalizer (dual autocoverage blocks)

**Files:**
- Create: `tf-api/src/providers/itgi/normalizer.ts`
- Create: `tf-api/src/providers/itgi/fixtures/premium-twp-addons.json`
- Test: `tf-api/src/providers/itgi/__tests__/normalizer.test.ts`

The fixture is the real captured response from the vendor kit's curl sample (`Two Wheeler_EngineTyreRimTWP_curl.xml`). Save the **parsed** shape (run it through `parseItgiSoap`) so the test exercises the normalizer, not the parser.

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/normalizer.test.ts
import { describe, it, expect } from "vitest";
import { selectPremiumBlock, normalizeIdv, normalizeQuote } from "../normalizer.ts";

// Shape mirrors the vendor's real dual-block response (kit curl sample).
const dual = {
  getMotorPremiumResponse: {
    getMotorPremiumReturn: [
      {
        autocoverage: "false",
        coveragePremiumDetail: [
          { coverageName: "IDV Basic", odPremium: "1895", tpPremium: "1366" },
          { coverageName: "No Claim Bonus", odPremium: "-853" },
        ],
        discountLoading: "0", discountLoadingAmt: "0",
        premiumPayable: "2841.44", serviceTax: "433.44",
        totalODPremium: "1042", totalPremimAfterDiscLoad: "2408", totalTPPremium: "1366",
      },
      {
        autocoverage: "true",
        coveragePremiumDetail: [
          { coverageName: "IDV Basic", odPremium: "1895", tpPremium: "1366" },
          { coverageName: "No Claim Bonus", odPremium: "-853" },
          { coverageName: "Tyre Protection", coveragePremium: "100" },
          { coverageName: "RIM", coveragePremium: "100" },
          { coverageName: "Engine Gear Box Protection", coveragePremium: "264" },
        ],
        discountLoading: "0", discountLoadingAmt: "0",
        premiumPayable: "3388.96", serviceTax: "516.96",
        totalODPremium: "1042", totalPremimAfterDiscLoad: "2872", totalTPPremium: "1366",
      },
    ],
  },
};

describe("premium block selection", () => {
  it("picks the autocoverage block when add-ons were requested", () => {
    const block = selectPremiumBlock(dual, true);
    expect(block.autocoverage).toBe("true");
    expect(block.premiumPayable).toBe("3388.96");
  });

  it("picks the base block when no add-ons were requested", () => {
    const block = selectPremiumBlock(dual, false);
    expect(block.autocoverage).toBe("false");
    expect(block.premiumPayable).toBe("2841.44");
  });

  it("falls back to the only block when the vendor returns one", () => {
    const single = { getMotorPremiumResponse: { getMotorPremiumReturn: [dual.getMotorPremiumResponse.getMotorPremiumReturn[0]] } };
    expect(selectPremiumBlock(single, true).autocoverage).toBe("false");
  });
});

describe("quote normalization", () => {
  const ctx = { requestId: "req-1", quoteNo: "Q1", policyType: "comprehensive", vehicleCategory: "twoWheeler", idvValue: 105665 };

  it("maps totals into the canonical breakdown in whole rupees", () => {
    const q = normalizeQuote(dual, { ...ctx, hasAddons: true });
    expect(q.providerSlug).toBe("itgi");
    expect(q.basicOdPremium).toBe(1042);
    expect(q.thirdPartyPremium).toBe(1366);
    expect(q.serviceTaxAmount).toBe(517); // 516.96 rounded
    expect(q.grossPremium).toBe(3389);   // 3388.96 rounded
    expect(q.netPremium).toBe(2872);
  });

  it("maps add-on premiums from the combined coveragePremium field", () => {
    const q = normalizeQuote(dual, { ...ctx, hasAddons: true });
    expect(q.addonPremiums.tyreProtect).toBe(100);
    expect(q.addonPremiums.rimProtect).toBe(100);
    expect(q.addonPremiums.engineProtect).toBe(264);
    expect(q.totalAddonPremium).toBe(464);
  });

  it("maps the NCB discount as a positive amount", () => {
    const q = normalizeQuote(dual, { ...ctx, hasAddons: true });
    expect(q.discounts.ncbAmount).toBe(853);
  });

  it("reads idv bounds from the idv response", () => {
    const idv = normalizeIdv({ getVehicleIdvResponse: { getVehicleIdvReturn: { idv: "415695", minimumIdvAllowed: "376105", maximumIdvAllowed: "415695" } } });
    expect(idv).toEqual({ idv: 415695, minIdv: 376105, maxIdv: 415695 });
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/normalizer.test.ts`
Expected: FAIL — cannot resolve `../normalizer.ts`.

- [ ] **Step 3: Implement `normalizer.ts`**

```ts
// src/providers/itgi/normalizer.ts
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import { ITGI_SLUG, ITGI_COVERAGE, ITGI_DISPLAY_NAME } from "./config.ts";
import { assertItgiSuccess } from "./errors.ts";

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};
/** All canonical money is whole rupees. */
const rupees = (v: unknown): number => Math.round(num(v));

function firstValue(root: unknown, key: string): Record<string, unknown> | undefined {
  if (!root || typeof root !== "object") return undefined;
  const o = root as Record<string, unknown>;
  if (key in o) {
    const v = o[key];
    return Array.isArray(v) ? (v[0] as Record<string, unknown>) : (v as Record<string, unknown>);
  }
  for (const v of Object.values(o)) {
    const found = firstValue(v, key);
    if (found) return found;
  }
  return undefined;
}

function allValues(root: unknown, key: string): Record<string, unknown>[] {
  if (!root || typeof root !== "object") return [];
  const o = root as Record<string, unknown>;
  if (key in o) {
    const v = o[key];
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [v as Record<string, unknown>];
  }
  for (const v of Object.values(o)) {
    const found = allValues(v, key);
    if (found.length) return found;
  }
  return [];
}

export function normalizeIdv(body: unknown): { idv: number; minIdv: number; maxIdv: number } {
  const r = firstValue(body, "getVehicleIdvReturn") ?? {};
  assertItgiSuccess(r, "idv");
  return {
    idv: rupees(r.idv),
    minIdv: rupees(r.minimumIdvAllowed),
    maxIdv: rupees(r.maximumIdvAllowed),
  };
}

/**
 * The premium service returns one or two blocks: `autocoverage=false` (base) and
 * `autocoverage=true` (base + bundled add-ons). Pick the one matching what the
 * customer actually elected.
 */
export function selectPremiumBlock(body: unknown, hasAddons: boolean): Record<string, unknown> {
  const blocks = allValues(body, "getMotorPremiumReturn");
  if (blocks.length === 0) return {};
  if (blocks.length === 1) return blocks[0];
  const wanted = String(hasAddons);
  return blocks.find((b) => String(b.autocoverage).trim() === wanted) ?? blocks[0];
}

/** ITGI coverage name → canonical addonPremiums key. */
const COVERAGE_TO_ADDON: Record<string, string> = {
  [ITGI_COVERAGE.DEPRECIATION_WAIVER]: "zeroDep",
  [ITGI_COVERAGE.ENGINE_GEAR_BOX]: "engineProtect",
  [ITGI_COVERAGE.TYRE_PROTECTION]: "tyreProtect",
  [ITGI_COVERAGE.RIM]: "rimProtect",
  [ITGI_COVERAGE.CONSUMABLE]: "consumables",
  [ITGI_COVERAGE.TOWING]: "rsa",
  [ITGI_COVERAGE.PA_OWNER_DRIVER]: "paOwner",
  [ITGI_COVERAGE.PA_TO_PASSENGER]: "paUnnamedPassenger",
  [ITGI_COVERAGE.LL_EMPLOYEE]: "legalLiabilityPaidDriver",
};

export interface ItgiQuoteContext {
  requestId: string;
  quoteNo: string;
  policyType: string;
  vehicleCategory: string;
  idvValue: number;
  minIdv?: number;
  maxIdv?: number;
  hasAddons: boolean;
  policyStartDate?: string;
  policyEndDate?: string;
  isInspectionRequired?: boolean;
}

export function normalizeQuote(body: unknown, ctx: ItgiQuoteContext): CanonicalQuoteResult {
  const block = selectPremiumBlock(body, ctx.hasAddons);
  assertItgiSuccess(block, "premium");

  const covers = Array.isArray(block.coveragePremiumDetail)
    ? (block.coveragePremiumDetail as Record<string, unknown>[])
    : block.coveragePremiumDetail
      ? [block.coveragePremiumDetail as Record<string, unknown>]
      : [];

  const addonPremiums: Record<string, number> = {};
  const discounts: Record<string, number> = {};
  let totalAddonPremium = 0;

  for (const c of covers) {
    const name = String(c.coverageName ?? "").trim();
    if (name === ITGI_COVERAGE.NCB) {
      // NCB comes back as a negative OD premium; canonical discounts are positive.
      discounts.ncbAmount = Math.abs(rupees(c.odPremium));
      continue;
    }
    const key = COVERAGE_TO_ADDON[name];
    if (!key) continue;
    // Bundled add-ons report a single combined figure; base covers use od/tp.
    const premium = rupees(c.coveragePremium ?? num(c.odPremium) + num(c.tpPremium));
    if (!premium) continue;
    addonPremiums[key] = premium;
    totalAddonPremium += premium;
  }

  const discountLoadingAmt = Math.abs(rupees(block.discountLoadingAmt));
  if (discountLoadingAmt) discounts.ownDamageDiscount = discountLoadingAmt;

  return {
    quoteNo: ctx.quoteNo,
    transactionId: ctx.quoteNo,
    requestId: ctx.requestId,
    providerSlug: ITGI_SLUG,
    insurerName: ITGI_DISPLAY_NAME,
    policyType: ctx.policyType,
    vehicleCategory: ctx.vehicleCategory,
    idvValue: ctx.idvValue,
    minIdv: ctx.minIdv,
    maxIdv: ctx.maxIdv,
    policyStartDate: ctx.policyStartDate,
    policyEndDate: ctx.policyEndDate,
    isInspectionRequired: ctx.isInspectionRequired,
    basicOdPremium: rupees(block.totalODPremium),
    thirdPartyPremium: rupees(block.totalTPPremium),
    addonPremiums,
    discounts,
    totalAddonPremium,
    totalDiscount: (discounts.ncbAmount ?? 0) + (discounts.ownDamageDiscount ?? 0),
    // The vendor's own misspelling: totalPremimAfterDiscLoad.
    netPremium: rupees(block.totalPremimAfterDiscLoad),
    serviceTaxPercent: 18,
    serviceTaxAmount: rupees(block.serviceTax),
    grossPremium: rupees(block.premiumPayable),
    _rawResponse: body,
  } as CanonicalQuoteResult;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/normalizer.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/itgi/normalizer.ts src/providers/itgi/__tests__/normalizer.test.ts
git commit -m "feat(itgi): normalize premium responses incl. dual autocoverage blocks"
```

---

## Task 9: CKYC client (REST)

**Files:**
- Create: `tf-api/src/providers/itgi/ckyc.ts`
- Test: `tf-api/src/providers/itgi/__tests__/ckyc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/ckyc.test.ts
import { describe, it, expect, vi } from "vitest";
import { itgiKycFetch, itgiKycValidateOtp, itgiKycCreate, mapKycStatus } from "../ckyc.ts";
import type { ItgiTransport } from "../http.ts";

const cfg = {
  soapBaseUrl: "https://s/services", restBaseUrl: "https://s/partner-services",
  partnerCode: "P", partnerBranch: "B", partnerSubBranch: "SB",
  responseUrl: "", downloadUser: "", downloadPassword: "",
};
const stub = (response: unknown): ItgiTransport => ({
  soap: vi.fn(),
  json: vi.fn().mockResolvedValue(response),
});

describe("itgi ckyc", () => {
  it("returns the IURN when a record is found", async () => {
    const t = stub({ status: 200, result: { status: "SUCCESS", itgiUniqueReferenceId: "AOF3XL0PLU1MEH" } });
    const r = await itgiKycFetch(cfg, { firstName: "Tom", lastName: "Gage", dateofBirth: "01-01-1992", idType: "PAN", idNumber: "TESPA7100P", clientType: "IND", mobileNumber: "9876543210" }, t, "req-1");
    expect(r.iurn).toBe("AOF3XL0PLU1MEH");
    expect(r.status).toBe("SUCCESS");
  });

  it("surfaces OTPPending so the caller can prompt for the OTP", async () => {
    const t = stub({ status: 200, result: { status: "OTPPending", ckycRemarks: "consent sent" } });
    const r = await itgiKycFetch(cfg, { firstName: "T", dateofBirth: "01-01-1992", idType: "PAN", idNumber: "X", clientType: "IND", mobileNumber: "9" }, t, "req-1");
    expect(r.status).toBe("OTPPending");
    expect(r.requiresOtp).toBe(true);
  });

  it("validates an OTP", async () => {
    const t = stub({ status: 200, result: { status: "OTPValidation-Success" } });
    const r = await itgiKycValidateOtp(cfg, { itgiUniqueReferenceId: "VGFASCZUBI9CPA", otp: "123456" }, t, "req-1");
    expect(r.validated).toBe(true);
    expect(t.json).toHaveBeenCalledWith(
      expect.stringContaining("/kyc/fetch-validate-otp"),
      expect.objectContaining({ validateOTPFlag: "Y", cersaiDownloadOTP: "123456", resendOTPFlag: "N" }),
      expect.anything(),
    );
  });

  it("resends an OTP without setting the validate flag", async () => {
    const t = stub({ status: 200, result: { status: "OTPReTriggered-Success" } });
    const r = await itgiKycValidateOtp(cfg, { itgiUniqueReferenceId: "V", resend: true }, t, "req-1");
    expect(r.resent).toBe(true);
    expect(t.json).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ validateOTPFlag: "N", resendOTPFlag: "Y", cersaiDownloadOTP: "" }),
      expect.anything(),
    );
  });

  it("treats an existing record on create as success", async () => {
    const t = stub({ status: 200, result: { status: "EXISTING RECORD", itgiUniqueReferenceId: "X70QOPGSCU7IYK", recordCreated: "N" } });
    const r = await itgiKycCreate(cfg, { clientType: "IND", firstName: "Tom", lastName: "Gage", dateofBirth: "01-01-1992", mobileNumber: "9", emailAddress: "a@b.c", kycDocuments: [] } as never, t, "req-1");
    expect(r.iurn).toBe("X70QOPGSCU7IYK");
    expect(r.success).toBe(true);
  });

  it("reports a document-rule failure with a blank IURN", async () => {
    const t = stub({ status: 200, result: { status: "Either of PAN or Form60 is mandatory", itgiUniqueReferenceId: "", recordCreated: "N" } });
    const r = await itgiKycCreate(cfg, { clientType: "IND", firstName: "T", kycDocuments: [] } as never, t, "req-1");
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/PAN or Form60/i);
  });

  it("maps vendor statuses onto canonical kyc states", () => {
    expect(mapKycStatus("SUCCESS")).toBe("verified");
    expect(mapKycStatus("EXISTING RECORD")).toBe("verified");
    expect(mapKycStatus("OTPPending")).toBe("pending");
    expect(mapKycStatus("Either of PAN or Form60 is mandatory")).toBe("failed");
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/ckyc.test.ts`
Expected: FAIL — cannot resolve `../ckyc.ts`.

- [ ] **Step 3: Implement `ckyc.ts`**

```ts
// src/providers/itgi/ckyc.ts
import type { ItgiConfig } from "./config.ts";
import { ITGI_ENDPOINTS } from "./config.ts";
import type { ItgiTransport } from "./http.ts";

/**
 * ITGI's CKYC is REST/JSON and — per the vendor kit — carries NO auth header;
 * access is presumed to be IP-whitelisted (open confirmation with ITGI).
 */

export interface ItgiKycFetchRequest {
  clientType: "IND" | "LE";
  firstName: string;
  middleName?: string;
  lastName?: string;
  /** DD-MM-YYYY. */
  dateofBirth: string;
  gender?: "M" | "F" | "T";
  idType: string;
  idNumber: string;
  /** Mandatory for IND; must match the mobile on the CKYC record. */
  mobileNumber?: string;
}

export interface ItgiKycResult {
  status: string;
  iurn?: string;
  requiresOtp: boolean;
  success: boolean;
  message?: string;
}

type VendorEnvelope = { status?: number; result?: Record<string, unknown>; errors?: unknown[] };

function readResult(raw: unknown): Record<string, unknown> {
  const env = (raw ?? {}) as VendorEnvelope;
  return env.result ?? {};
}

export function mapKycStatus(status: string): "verified" | "pending" | "failed" {
  const s = status.trim().toUpperCase();
  if (s === "SUCCESS" || s === "EXISTING RECORD") return "verified";
  if (s.startsWith("OTP")) return s.includes("SUCCESS") ? "verified" : "pending";
  return "failed";
}

function toResult(result: Record<string, unknown>): ItgiKycResult {
  const status = String(result.status ?? "").trim();
  const iurn = String(result.itgiUniqueReferenceId ?? "").trim() || undefined;
  const mapped = mapKycStatus(status);
  return {
    status,
    iurn,
    requiresOtp: status === "OTPPending",
    success: mapped === "verified" && Boolean(iurn),
    message: (result.ckycRemarks as string | undefined) ?? (mapped === "failed" ? status : undefined),
  };
}

/** Step 1 — search CERSAI / ITGI for an existing KYC record. */
export async function itgiKycFetch(
  cfg: ItgiConfig,
  req: ItgiKycFetchRequest,
  transport: ItgiTransport,
  requestId: string,
): Promise<ItgiKycResult> {
  const raw = await transport.json(ITGI_ENDPOINTS.kycFetch(cfg), req, { requestId });
  return toResult(readResult(raw));
}

export interface ItgiKycOtpRequest {
  itgiUniqueReferenceId: string;
  otp?: string;
  resend?: boolean;
}

/** Step 2 — validate (or resend) the CERSAI download OTP. Exactly one action. */
export async function itgiKycValidateOtp(
  cfg: ItgiConfig,
  req: ItgiKycOtpRequest,
  transport: ItgiTransport,
  requestId: string,
): Promise<ItgiKycResult & { validated: boolean; resent: boolean }> {
  const resend = Boolean(req.resend);
  const body = {
    itgiUniqueReferenceId: req.itgiUniqueReferenceId,
    // The vendor rejects both flags being Y (or both N) in one call.
    validateOTPFlag: resend ? "N" : "Y",
    cersaiDownloadOTP: resend ? "" : (req.otp ?? ""),
    resendOTPFlag: resend ? "Y" : "N",
  };
  const raw = await transport.json(ITGI_ENDPOINTS.kycValidateOtp(cfg), body, { requestId });
  const result = readResult(raw);
  const status = String(result.status ?? "").trim();
  return {
    ...toResult(result),
    validated: status === "OTPValidation-Success",
    resent: status === "OTPReTriggered-Success",
  };
}

export interface ItgiKycDocument {
  idType: "IDENTITY_PROOF" | "ADDRESS_PROOF" | "OTHERS";
  idName: string;
  idNumber: string;
  fileName: string;
  fileExtension: "pdf" | "jpg" | "jpeg" | "tif" | "tiff";
  fileBase64: string;
}

export interface ItgiKycCreateRequest {
  clientType: "IND" | "LE";
  prefix?: string;
  firstName: string;
  middleName?: string;
  lastName?: string;
  gender?: "M" | "F" | "T";
  dateofBirth: string;
  relationshipType?: "Father" | "Spouse" | "Mother";
  relatedPersonPrefix?: string;
  relatedPersonFirstName?: string;
  relatedPersonMiddleName?: string;
  relatedPersonLastName?: string;
  mobileNumber: string;
  emailAddress: string;
  addressLine1: string;
  city: string;
  district: string;
  state: string;
  country: string;
  pinCode: string;
  correspondenceAddressLine1: string;
  correspondenceCity: string;
  correspondenceDistrict: string;
  correspondenceState: string;
  correspondenceCountry: string;
  correspondencePinCode: string;
  /** PAN or FORM60 required; ≥1 ADDRESS_PROOF; PHOTOGRAPH mandatory for IND. */
  kycDocuments: ItgiKycDocument[];
}

/** Step 3 — create the KYC record when no existing one was found. */
export async function itgiKycCreate(
  cfg: ItgiConfig,
  req: ItgiKycCreateRequest,
  transport: ItgiTransport,
  requestId: string,
): Promise<ItgiKycResult> {
  const raw = await transport.json(ITGI_ENDPOINTS.kycCreate(cfg), req, { requestId });
  return toResult(readResult(raw));
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/ckyc.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/itgi/ckyc.ts src/providers/itgi/__tests__/ckyc.test.ts
git commit -m "feat(itgi): add CKYC REST client (fetch, validate-otp, create)"
```

---

## Task 10: Proposal, payment, status and certificate

**Files:**
- Create: `tf-api/src/providers/itgi/proposal.ts`
- Create: `tf-api/src/providers/itgi/payment.ts`
- Create: `tf-api/src/providers/itgi/policy-status.ts`
- Create: `tf-api/src/providers/itgi/certificate.ts`
- Test: `tf-api/src/providers/itgi/__tests__/issuance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/issuance.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildProposalPayload, parseProposalResponse } from "../proposal.ts";
import { buildPaymentPayload, parsePaymentResponse } from "../payment.ts";
import { buildStatusPayload, parseStatusResponse } from "../policy-status.ts";
import { itgiDownloadPolicy } from "../certificate.ts";
import type { ItgiTransport } from "../http.ts";

describe("itgi proposal", () => {
  it("carries the IURN, unique quote id and premium totals", () => {
    const xml = buildProposalPayload(
      {
        uniqueQuoteId: "TFQ0000000001", iurn: "AOF3XL0PLU1MEH", product: "PCP",
        inceptionDate: "02/26/2026 00:00:00", expiryDate: "02/25/2027 23:59:59",
        grossPremium: 10604, netPremiumPayable: 12513, serviceTax: 1908,
        odSumDisLoad: 7907, tpSumDisLoad: 2697, totalSumInsured: 105665,
        odDiscountLoading: -20, odDiscountAmt: -1976,
        breakInofMorethan90days: "N", zCover: "CO", policyType: "CP",
        nominee: "Asha", nomineeRelationship: "Spouse",
        contact: { firstName: "Tom", lastName: "Gage", dob: "01/01/1992", mailId: "a@b.c", mobilePhone: "9876543210", addressLine1: "HNO 1", addressLine2: "Street", city: "DELHI", state: "DL", pinCode: "110001", salutation: "MR", sex: "M", married: "M", occupation: "OTHR", externalClientNo: "C1" },
        vehicle: { make: "MRSFT", engineNumber: "EN123", chassisNumber: "CH123", registrationDate: "10/20/2023", manufacturingYear: 2023, rtoCity: "DELHI", engineCapacity: 1197, seatingCapacity: 5, reg: { p1: "DL", p2: "10", p3: "AH", p4: "4567" } },
        coverages: [{ code: "IDV Basic", sumInsured: 105665, odPremium: 6075, tpPremium: 670 }],
      },
      { partnerCode: "ITGIMOT999", partnerBranch: "TF", partnerSubBranch: "TF", responseUrl: "https://x/y" },
    );
    expect(xml).toContain("<wrap:uniqueQuoteId>TFQ0000000001</wrap:uniqueQuoteId>");
    expect(xml).toContain("AOF3XL0PLU1MEH");
    expect(xml).toContain("<wrap:registrationNumber1>DL</wrap:registrationNumber1>");
    expect(xml).toContain("<wrap:registrationNumber4>4567</wrap:registrationNumber4>");
    expect(xml).toContain("<wrap:partnerCode>ITGIMOT999</wrap:partnerCode>");
    expect(xml).toContain("<wrap:externalServiceConsumer>ITGIMOT999</wrap:externalServiceConsumer>");
  });

  it("extracts orderNo and traceNo from the response", () => {
    const r = parseProposalResponse({
      validateProposalRequestResponse: {
        validateProposalRequestReturn: { amountPayable: "18318.79", orderNo: "000006AS5YSI", traceNo: "153852" },
      },
    });
    expect(r).toEqual({ orderNo: "000006AS5YSI", traceNo: "153852", amountPayable: 18319 });
  });
});

describe("itgi payment", () => {
  it("sends the order and trace numbers from the proposal", () => {
    const xml = buildPaymentPayload(
      { orderNumber: "000006AS5YSI", traceNumber: "153852", amount: 18318, authorizationCode: "833", authorizationStatus: "199" },
      "ITGIMOT999",
    );
    expect(xml).toContain("<util:orderNumber>000006AS5YSI</util:orderNumber>");
    expect(xml).toContain("<util:traceNumber>153852</util:traceNumber>");
    expect(xml).toContain("<util:authorizationDecision>Y</util:authorizationDecision>");
  });

  it("extracts the policy number and success sentinel", () => {
    const r = parsePaymentResponse({
      updatePaymentDetailsResponse: {
        updatePaymentDetailsReturn: { policyNumber: "M0003356", statusMessage: "SUCCESSFULLY_SUBMITTED_IN_P400", premiumPayable: "18318", orderNumber: "O1", traceNumber: "T1" },
      },
    });
    expect(r.policyNumber).toBe("M0003356");
    expect(r.success).toBe(true);
  });

  it("treats a break-in acceptance as success", () => {
    const r = parsePaymentResponse({
      updatePaymentDetailsResponse: { updatePaymentDetailsReturn: { policyNumber: "1522313725648", statusMessage: "PAYMENT_ACCEPTED_BREAK_IN" } },
    });
    expect(r.success).toBe(true);
    expect(r.isBreakInPending).toBe(true);
  });

  it("treats a declined transaction as failure", () => {
    const r = parsePaymentResponse({
      updatePaymentDetailsResponse: { updatePaymentDetailsReturn: { statusMessage: "TRANCTION_DECLINED" } },
    });
    expect(r.success).toBe(false);
  });
});

describe("itgi policy status", () => {
  it("is keyed by uniqueQuoteId", () => {
    const xml = buildStatusPayload({ uniqueQuoteId: "5120972487616", contractType: "PCP" }, "ITGIMOT999");
    expect(xml).toContain("<util:uniqueQuoteId>5120972487616</util:uniqueQuoteId>");
    expect(xml).toContain("<util:partnerCode>ITGIMOT999</util:partnerCode>");
  });

  it("maps authFlag Y to a paid, issued policy", () => {
    const r = parseStatusResponse({
      getPolicyStatusResponse: { getPolicyStatusReturn: { authFlag: "Y", policyNo: "MC897210", status: "SUCCESSFULLY_SUBMITTED_IN_P400", traceNo: "056129", amount: "17399.0000" } },
    });
    expect(r.policyNumber).toBe("MC897210");
    expect(r.isPaid).toBe(true);
  });

  it("maps a blank authFlag to no payment attempted", () => {
    const r = parseStatusResponse({ getPolicyStatusResponse: { getPolicyStatusReturn: { authFlag: "", policyNo: "" } } });
    expect(r.isPaid).toBe(false);
  });
});

describe("itgi certificate", () => {
  it("posts with basic auth and returns the download link", async () => {
    const transport: ItgiTransport = {
      soap: vi.fn(),
      json: vi.fn().mockResolvedValue({ policyDownloadLink: "https://x/p.pdf", statusMessage: "SUCCESS", error: null }),
    };
    const cfg = { soapBaseUrl: "", restBaseUrl: "https://s/partner-services", partnerCode: "P", partnerBranch: "", partnerSubBranch: "", responseUrl: "", downloadUser: "u", downloadPassword: "p" };
    const r = await itgiDownloadPolicy(cfg, { policyNumber: "MC897781", contractType: "TWP" }, transport, "req-1");
    expect(r.url).toBe("https://x/p.pdf");
    expect(transport.json).toHaveBeenCalledWith(
      expect.stringContaining("/policy/download"),
      expect.objectContaining({ policyDownloadNo: "MC897781" }),
      expect.objectContaining({ basicAuth: { user: "u", password: "p" } }),
    );
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/issuance.test.ts`
Expected: FAIL — cannot resolve `../proposal.ts`.

- [ ] **Step 3: Implement `proposal.ts`**

```ts
// src/providers/itgi/proposal.ts
import { tag } from "./format.ts";
import type { ItgiPartnerDetails } from "./mapper.ts";
import { assertItgiSuccess } from "./errors.ts";

export interface ItgiProposalContact {
  firstName: string; lastName: string; dob: string; mailId: string; mobilePhone: string;
  addressLine1: string; addressLine2?: string; city: string; state: string; pinCode: string;
  salutation: string; sex: string; married: string; occupation: string; externalClientNo: string;
  insuredPAN?: string; insuredAadhar?: string;
}

export interface ItgiProposalVehicle {
  make: string; engineNumber: string; chassisNumber: string; registrationDate: string;
  manufacturingYear: number; rtoCity: string; engineCapacity?: number; seatingCapacity?: number;
  reg: { p1: string; p2: string; p3: string; p4: string };
}

export interface ItgiProposalCoverage {
  code: string; sumInsured: string | number; odPremium?: number; tpPremium?: number; number?: string | number;
}

export interface ItgiProposalInput {
  uniqueQuoteId: string;
  /** CKYC reference — mandatory on every ITGI proposal. */
  iurn: string;
  product: "PCP" | "TWP";
  inceptionDate: string; expiryDate: string; createdDate?: string;
  grossPremium: number; netPremiumPayable: number; serviceTax: number;
  odSumDisLoad: number; tpSumDisLoad: number; totalSumInsured: number;
  odDiscountLoading: number; odDiscountAmt: number;
  breakInofMorethan90days: "Y" | "N";
  zCover: "CO" | "AC"; policyType: "CP" | "TP" | "OD" | "BP";
  nominee?: string; nomineeRelationship?: string;
  previousPolicyNo?: string; previousPolicyStartdate?: string; previousPolicyEnddate?: string; previousPolicyInsurer?: string;
  /** Single-year OD renewals must carry the running package policy. */
  tpPolicyNo?: string; tpInceptionDate?: string; tpExpiryDate?: string; tpInsurerName?: string;
  /** Break-in pre-inspection evidence. */
  inspectionNo?: string; inspectionDate?: string; inspectionStatus?: string; inspectionAgency?: string;
  validDrivingLicence?: "Y" | "N"; alternatePACover?: "Y" | "N"; newVehicleFlag?: "Y";
  contact: ItgiProposalContact;
  vehicle: ItgiProposalVehicle;
  coverages: ItgiProposalCoverage[];
}

const w = (name: string, value: string | number | undefined | null) => tag(`wrap:${name}`, value);

/** Builds the Partner-PG proposal body (`util:` ops + `wrap:` data namespaces). */
export function buildProposalPayload(input: ItgiProposalInput, partner: ItgiPartnerDetails): string {
  const c = input.contact;
  const v = input.vehicle;

  const contact =
    `<wrap:contact>` +
    w("addressLine1", c.addressLine1) + w("addressLine2", c.addressLine2) +
    w("addressType", "P") + w("city", c.city) + w("country", "IND") +
    w("dob", c.dob) + w("externalClientNo", c.externalClientNo) +
    w("firstName", c.firstName) + w("insuredAadhar", c.insuredAadhar) + w("insuredPAN", c.insuredPAN) +
    w("lastName", c.lastName) + w("mailId", c.mailId) + w("married", c.married) +
    w("mobilePhone", c.mobilePhone) + w("occupation", c.occupation) + w("otp", "Y") +
    w("pinCode", c.pinCode) + w("salutation", c.salutation) + w("sex", c.sex) + w("state", c.state) +
    // The CKYC reference (IURN) travels with the proposal.
    w("itgiUniqueReferenceId", input.iurn) +
    `</wrap:contact>`;

  const coverage =
    `<wrap:coverage>` +
    input.coverages
      .map(
        (cov) =>
          `<util:item>` +
          w("ODPremium", cov.odPremium) + w("TPPremium", cov.tpPremium) +
          w("code", cov.code) + w("number", cov.number) + w("sumInsured", cov.sumInsured) +
          `</util:item>`,
      )
      .join("") +
    `</wrap:coverage>`;

  const partnerDetail =
    `<wrap:partnerDetail>` +
    w("partnerBranch", partner.partnerBranch) + w("partnerCode", partner.partnerCode) +
    w("responseURL", partner.responseUrl) + w("subPartnerCode", partner.partnerSubBranch) +
    `</wrap:partnerDetail>`;

  const policy =
    `<wrap:policy>` +
    w("breakInofMorethan90days", input.breakInofMorethan90days) +
    w("createdDate", input.createdDate) + w("expiryDate", input.expiryDate) +
    w("externalBranch", partner.partnerBranch) +
    w("externalServiceConsumer", partner.partnerCode) +
    w("externalSubBranch", partner.partnerSubBranch) +
    w("grossPremium", input.grossPremium) + w("inceptionDate", input.inceptionDate) +
    w("netPremiumPayable", input.netPremiumPayable) +
    w("nominee", input.nominee) + w("nomineeRelationship", input.nomineeRelationship) +
    w("odDiscountAmt", input.odDiscountAmt) + w("odDiscountLoading", input.odDiscountLoading) +
    w("odSumDisLoad", input.odSumDisLoad) +
    w("previousPolicyEnddate", input.previousPolicyEnddate) +
    w("previousPolicyInsurer", input.previousPolicyInsurer) +
    w("previousPolicyNo", input.previousPolicyNo) +
    w("previousPolicyStartdate", input.previousPolicyStartdate) +
    w("product", input.product) + w("serviceTax", input.serviceTax) +
    w("totalSumInsured", input.totalSumInsured) + w("tpSumDisLoad", input.tpSumDisLoad) +
    w("uniqueQuoteId", input.uniqueQuoteId) +
    // OD-renewal only: the running package (TP) policy.
    w("tpPolicyNo", input.tpPolicyNo) + w("tpInceptionDate", input.tpInceptionDate) +
    w("tpExpiryDate", input.tpExpiryDate) + w("tpInsurerName", input.tpInsurerName) +
    `</wrap:policy>`;

  const vehicle =
    `<wrap:vehicle>` +
    w("chassisNumber", v.chassisNumber) + w("engineCapacity", v.engineCapacity) +
    w("engineNumber", v.engineNumber) + w("make", v.make) +
    w("manufacturingYear", v.manufacturingYear) + w("policyType", input.policyType) +
    w("registrationDate", v.registrationDate) +
    w("registrationNumber1", v.reg.p1) + w("registrationNumber2", v.reg.p2) +
    w("registrationNumber3", v.reg.p3) + w("registrationNumber4", v.reg.p4) +
    w("rtoCity", v.rtoCity) + w("seatingCapacity", v.seatingCapacity) +
    w("validDrivingLicence", input.validDrivingLicence) +
    w("alternatePACover", input.alternatePACover) +
    w("newVehicleFlag", input.newVehicleFlag) +
    w("zCover", input.zCover) +
    // Break-in pre-inspection evidence (omitted as empty tags otherwise).
    w("inspectionNo", input.inspectionNo) + w("inspectionDate", input.inspectionDate) +
    w("inspectionStatus", input.inspectionStatus) + w("inspectionAgency", input.inspectionAgency) +
    `</wrap:vehicle>`;

  return (
    `<util:validateProposalRequest><util:proposalInput>` +
    contact + coverage + partnerDetail + policy + vehicle +
    `</util:proposalInput></util:validateProposalRequest>`
  );
}

export interface ItgiProposalResult {
  orderNo: string;
  traceNo: string;
  amountPayable: number;
}

export function parseProposalResponse(body: unknown): ItgiProposalResult {
  const r = findReturn(body, "validateProposalRequestReturn");
  assertItgiSuccess(r, "proposal");
  return {
    orderNo: String(r.orderNo ?? "").trim(),
    traceNo: String(r.traceNo ?? "").trim(),
    amountPayable: Math.round(Number(r.amountPayable ?? 0)),
  };
}

/** Depth-first lookup of a `*Return` element regardless of envelope nesting. */
export function findReturn(root: unknown, key: string): Record<string, unknown> {
  if (!root || typeof root !== "object") return {};
  const o = root as Record<string, unknown>;
  if (key in o) {
    const v = o[key];
    return (Array.isArray(v) ? v[0] : v) as Record<string, unknown>;
  }
  for (const v of Object.values(o)) {
    const found = findReturn(v, key);
    if (Object.keys(found).length) return found;
  }
  return {};
}
```

- [ ] **Step 4: Implement `payment.ts`**

```ts
// src/providers/itgi/payment.ts
import { tag } from "./format.ts";
import { assertItgiSuccess, isItgiSuccessMessage } from "./errors.ts";
import { findReturn } from "./proposal.ts";

export interface ItgiPaymentInput {
  orderNumber: string;
  traceNumber: string;
  amount: number;
  /** Values originate from our own payment gateway's authorisation response. */
  authorizationCode: string;
  authorizationStatus: string;
  authorizationDecision?: "Y" | "N";
}

const u = (name: string, value: string | number | undefined) => tag(`util:${name}`, value);

/** Binds a collected payment to the proposal created by validateProposalRequest. */
export function buildPaymentPayload(input: ItgiPaymentInput, partnerCode: string): string {
  return (
    `<util:updatePaymentDetails><util:input>` +
    u("amount", input.amount) +
    u("authorizationCode", input.authorizationCode) +
    u("authorizationDecision", input.authorizationDecision ?? "Y") +
    u("authorizationStatus", input.authorizationStatus) +
    u("orderNumber", input.orderNumber) +
    u("partnerCode", partnerCode) +
    u("traceNumber", input.traceNumber) +
    `</util:input></util:updatePaymentDetails>`
  );
}

export interface ItgiPaymentResult {
  policyNumber: string;
  statusMessage: string;
  premiumPayable: number;
  success: boolean;
  /** Break-in policies are accepted but only issued after inspection approval. */
  isBreakInPending: boolean;
}

export function parsePaymentResponse(body: unknown): ItgiPaymentResult {
  const r = findReturn(body, "updatePaymentDetailsReturn");
  assertItgiSuccess(r, "payment");
  const statusMessage = String(r.statusMessage ?? "").trim();
  return {
    policyNumber: String(r.policyNumber ?? "").trim(),
    statusMessage,
    premiumPayable: Math.round(Number(r.premiumPayable ?? 0)),
    success: isItgiSuccessMessage(statusMessage),
    isBreakInPending: statusMessage.toUpperCase() === "PAYMENT_ACCEPTED_BREAK_IN",
  };
}
```

- [ ] **Step 5: Implement `policy-status.ts`**

```ts
// src/providers/itgi/policy-status.ts
import { tag } from "./format.ts";
import { assertItgiSuccess } from "./errors.ts";
import { findReturn } from "./proposal.ts";

export interface ItgiStatusInput {
  uniqueQuoteId: string;
  contractType: "PCP" | "TWP";
  messageId?: string;
}

const u = (name: string, value: string | number | undefined) => tag(`util:${name}`, value);

export function buildStatusPayload(input: ItgiStatusInput, partnerCode: string): string {
  return (
    `<util:getPolicyStatus><util:input>` +
    u("contractType", input.contractType) +
    u("messageId", input.messageId ?? "") +
    u("partnerCode", partnerCode) +
    u("uniqueQuoteId", input.uniqueQuoteId) +
    `</util:input></util:getPolicyStatus>`
  );
}

export interface ItgiStatusResult {
  policyNumber: string;
  status: string;
  traceNo: string;
  amount: number;
  /** authFlag: Y = payment confirmed, N = failed, blank = never attempted. */
  isPaid: boolean;
}

export function parseStatusResponse(body: unknown): ItgiStatusResult {
  const r = findReturn(body, "getPolicyStatusReturn");
  assertItgiSuccess(r, "policy-status");
  return {
    policyNumber: String(r.policyNo ?? "").trim(),
    status: String(r.status ?? "").trim(),
    traceNo: String(r.traceNo ?? "").trim(),
    amount: Math.round(Number(r.amount ?? 0)),
    isPaid: String(r.authFlag ?? "").trim().toUpperCase() === "Y",
  };
}
```

- [ ] **Step 6: Implement `certificate.ts`**

```ts
// src/providers/itgi/certificate.ts
import type { ItgiConfig } from "./config.ts";
import { ITGI_ENDPOINTS } from "./config.ts";
import type { ItgiTransport } from "./http.ts";

export interface ItgiDownloadInput {
  policyNumber: string;
  contractType: "PCP" | "TWP";
}

export interface ItgiDownloadResult {
  url?: string;
  status: string;
  success: boolean;
}

/**
 * Policy download is the only ITGI call using HTTP Basic auth. NOTE: staging
 * returns a placeholder PDF, so any non-empty link with statusMessage SUCCESS is
 * treated as success.
 */
export async function itgiDownloadPolicy(
  cfg: ItgiConfig,
  input: ItgiDownloadInput,
  transport: ItgiTransport,
  requestId: string,
): Promise<ItgiDownloadResult> {
  const raw = (await transport.json(
    ITGI_ENDPOINTS.policyDownload(cfg),
    {
      contractType: input.contractType,
      policyDownloadNo: input.policyNumber,
      partnerDetail: { partnerCode: cfg.partnerCode },
    },
    { requestId, basicAuth: { user: cfg.downloadUser, password: cfg.downloadPassword } },
  )) as Record<string, unknown>;

  const url = String(raw.policyDownloadLink ?? "").trim() || undefined;
  const status = String(raw.statusMessage ?? "").trim();
  return { url, status, success: Boolean(url) && status.toUpperCase() === "SUCCESS" };
}
```

- [ ] **Step 7: Run and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/issuance.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 8: Commit**

```bash
git add src/providers/itgi/proposal.ts src/providers/itgi/payment.ts src/providers/itgi/policy-status.ts src/providers/itgi/certificate.ts src/providers/itgi/__tests__/issuance.test.ts
git commit -m "feat(itgi): add proposal, payment, status and certificate calls"
```

---

## Task 11: Provider class and registration

**Files:**
- Create: `tf-api/src/providers/itgi/itgi.provider.ts`
- Create: `tf-api/src/providers/itgi/inspection.ts`
- Create: `tf-api/src/providers/itgi/renewal.ts`
- Create: `tf-api/src/providers/itgi/index.ts`
- Modify: `tf-api/src/app.ts`
- Test: `tf-api/src/providers/itgi/__tests__/provider.test.ts`

Read `src/providers/fg/fg.provider.ts` and `src/providers/fg/index.ts` first and mirror their construction/registration style (dependency injection of transport + code resolver, `registerXProvider()` guarded by the enabled flag).

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/itgi/__tests__/provider.test.ts
import { describe, it, expect, vi } from "vitest";
import { ItgiProvider } from "../itgi.provider.ts";
import { ItgiUnmappedCodeError } from "../errors.ts";
import type { ItgiTransport } from "../http.ts";

const idvResponse = { getVehicleIdvResponse: { getVehicleIdvReturn: { idv: "105665", minimumIdvAllowed: "95098", maximumIdvAllowed: "116231" } } };
const premiumResponse = {
  getMotorPremiumResponse: {
    getMotorPremiumReturn: [{
      autocoverage: "false",
      coveragePremiumDetail: [{ coverageName: "IDV Basic", odPremium: "1895", tpPremium: "1366" }],
      premiumPayable: "2841.44", serviceTax: "433.44",
      totalODPremium: "1042", totalPremimAfterDiscLoad: "2408", totalTPPremium: "1366",
      discountLoading: "0", discountLoadingAmt: "0",
    }],
  },
};

const req = {
  vehicleType: "twoWheeler", selectedPolicy: "comprehensive", businessType: "rollover",
  makeId: "1", makeName: "HERO", modelId: "10", modelName: "SPLENDOR",
  fuelType: "petrol", engineCC: 100, seatingCapacity: 2,
  rtoCode: "DL01", registrationDate: "2023-10-20", registrationNumber: "DL10AH4567",
  policyStartDate: "2026-02-26", policyEndDate: "2027-02-25",
  ncbPercent: 0, idvValue: 105665, paOwner: true,
  zeroDep: false, engineProtect: false, tyreProtect: false, rimProtect: false,
  consumables: false, rsa: false, paUnnamedPassenger: false, legalLiabilityPaidDriver: false,
  claimInPreviousPolicy: false, isPreviousPolicyExpired: false,
} as never;

function makeProvider(overrides: Partial<{ transport: ItgiTransport; resolver: unknown }> = {}) {
  const transport: ItgiTransport = overrides.transport ?? {
    soap: vi.fn().mockImplementation(async (url: string) => (url.includes("IDV") ? idvResponse : premiumResponse)),
    json: vi.fn(),
  };
  return new ItgiProvider({
    transport,
    resolveCodes: (overrides.resolver as never) ?? (async () => ({ makeCode: "HHSPL", rtoCity: "DELHI", engineCC: 100, seatingCapacity: 2 })),
  });
}

describe("ItgiProvider", () => {
  it("declares its identity and capabilities", () => {
    const p = makeProvider();
    expect(p.slug).toBe("itgi");
    expect(p.capabilities.has("twoWheeler")).toBe(true);
  });

  it("returns a canonical quote from IDV + premium", async () => {
    const p = makeProvider();
    const q = await p.getQuote(req, { requestId: "req-1" });
    expect(q.providerSlug).toBe("itgi");
    expect(q.grossPremium).toBe(2841);
    expect(q.idvValue).toBe(105665);
    expect(q.minIdv).toBe(95098);
  });

  it("propagates an unmapped RTO so compare can skip the provider", async () => {
    const p = makeProvider({
      resolver: async () => {
        throw new ItgiUnmappedCodeError("RTO", "DL01");
      },
    });
    await expect(p.getQuote(req, { requestId: "req-1" })).rejects.toThrow(ItgiUnmappedCodeError);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/provider.test.ts`
Expected: FAIL — cannot resolve `../itgi.provider.ts`.

- [ ] **Step 3: Implement `inspection.ts` and `renewal.ts`**

Both are thin wrappers over calls already built. `inspection.ts` records the break-in inspection evidence that Task 10's proposal payload accepts, and polls `getPolicyStatus`:

```ts
// src/providers/itgi/inspection.ts
import type { InspectionRequest, InspectionResult } from "@/contracts/inspection.ts";

/**
 * ITGI performs break-in inspection at its own end: the proposal is submitted
 * with PAYMENT_ACCEPTED_BREAK_IN and their agency inspects, then the policy is
 * issued automatically on approval. There is no "create inspection" endpoint —
 * we record the evidence the proposal carries and poll policy status.
 *
 * OPEN WITH VENDOR: approval is notified by email; no callback/webhook is
 * documented, so completion cannot be fully automated yet (spec §7).
 */
export function buildInspectionEvidence(req: {
  inspectionReportNumber?: string;
  inspectionDate?: string;
}): { inspectionNo?: string; inspectionDate?: string; inspectionStatus?: string; inspectionAgency?: string } {
  if (!req.inspectionReportNumber) return {};
  return {
    inspectionNo: req.inspectionReportNumber,
    inspectionDate: req.inspectionDate,
    inspectionStatus: "APPROVED",
    inspectionAgency: "ITGI",
  };
}

export function inspectionPendingResult(refId: string): InspectionResult {
  return { referenceId: refId, status: "pending", message: "Inspection is being carried out by IFFCO-Tokio's agency." } as InspectionResult;
}
```

> Match `InspectionResult`'s real fields from `src/contracts/inspection.ts`; adjust the literal above to satisfy the type.

`renewal.ts` reuses the OD-renewal path: `renewalQuote` → `getQuote` with `selectedPolicy: "standAloneOD"`, `renewalProposal` → `getFullQuote`, `renewalCreatePolicy` → `issuePolicy`. Implement as thin delegations rather than duplicating logic.

- [ ] **Step 4: Implement `itgi.provider.ts`**

Compose everything built so far. Key requirements:

- Constructor takes `{ transport, resolveCodes }` so tests inject fakes (mirror FG's `FgProviderDeps`).
- `getQuote`: resolve codes → `selectPolicyPath` → `buildIdvPayload` → `soap(ITGI_ENDPOINTS.idv)` → `normalizeIdv` → `buildPremiumPayload` (with the resolved IDV) → `soap(premium | newVehiclePremium per `path.usesNewVehicleEndpoint`)` → `normalizeQuote`. `hasAddons` = any of zeroDep/engineProtect/tyreProtect/rimProtect/consumables/rsa.
- `getFullQuote`: run the premium call, then `buildProposalPayload` + `parseProposalResponse`; return a `CanonicalQuoteResult` whose `contractDetails` carries `{ uniqueQuoteId, orderNo, traceNo }` so `issuePolicy` can recover the chain.
- `issuePolicy`: `buildPaymentPayload` + `parsePaymentResponse`; map `policyNumber` and the break-in-pending flag into `PolicyIssuanceResult`.
- `completeCkyc` / `initiateOvd`: delegate to `ckyc.ts` (fetch → validate-otp → create).
- `getPolicyStatus`, `getCertificate`, `createInspection`, `getInspectionStatus`, `renewal*`: delegate to their modules.
- Every method that calls the vendor must pass `ctx.requestId` through.

- [ ] **Step 5: Implement `index.ts` and register in `app.ts`**

```ts
// src/providers/itgi/index.ts
import { env } from "@/config/env.ts";
import { registerProvider } from "../provider-registry.ts";
import { ItgiProvider } from "./itgi.provider.ts";
import { FetchItgiTransport } from "./http.ts";
import { itgiDbCodeResolver } from "./db-code-resolver.ts";

/** ITGI is off by default; enable with ITGI_ENABLED=true once credentials land. */
export function registerItgiProvider(): void {
  if (!env.ITGI_ENABLED) return;
  registerProvider(new ItgiProvider({ transport: new FetchItgiTransport(), resolveCodes: itgiDbCodeResolver }));
}
```

In `src/app.ts`, import and call `registerItgiProvider()` next to the FG/ICICI registrations (match the existing call style exactly).

- [ ] **Step 6: Run the full suite**

Run: `cd tf-api && npm test`
Expected: all suites pass, including the new `provider.test.ts` (3 tests).

- [ ] **Step 7: Typecheck, lint and commit**

```bash
cd tf-api && npm run typecheck && npm run lint
git add src/providers/itgi src/app.ts
git commit -m "feat(itgi): add provider class, lifecycle wiring and registration"
```

---

## Task 12: Master data import script

**Files:**
- Create: `tf-api/scripts/import-itgi-master.ts`
- Modify: `tf-api/package.json` (add `db:import:itgi`)
- Test: `tf-api/src/providers/itgi/__tests__/import-itgi-master.test.ts`

Read `scripts/import-icici-master.ts` first — mirror its structure (xlsx parsing, source tagging, idempotent upserts, summary logging).

- [ ] **Step 1: Write the failing test for the row parser**

```ts
// src/providers/itgi/__tests__/import-itgi-master.test.ts
import { describe, it, expect } from "vitest";
import { normalizeItgiFuel, toItgiLine, parseMakeRow } from "../../../scripts/import-itgi-master.ts";

describe("itgi master import", () => {
  it("normalizes the vendor's inconsistent fuel labels", () => {
    expect(normalizeItgiFuel("BATTERY")).toBe("electric");
    expect(normalizeItgiFuel("Electric")).toBe("electric");
    expect(normalizeItgiFuel("HYBRID")).toBe("hybrid");
    expect(normalizeItgiFuel("Hybrid Electric")).toBe("hybrid");
    expect(normalizeItgiFuel("Petrol + CNG")).toBe("cng");
    expect(normalizeItgiFuel("Petrol")).toBe("petrol");
  });

  it("maps the contract type to a vehicle line", () => {
    expect(toItgiLine("PCP")).toBe("fw");
    expect(toItgiLine("TWP")).toBe("tw");
  });

  it("parses a MAKE sheet row into an importable record", () => {
    const row = parseMakeRow({
      MAKE: "KNE6PZ", MANUFACTURE: "KAWASAKI", MODEL: "NINJA",
      VARIANT: "KAWASAKI NINJA ER 6N", CC: "649", SEATING_CAPACITY: "2",
      FUEL_TYPE: "Petrol", CONTRACT_TYPE: "TWP",
    });
    expect(row).toEqual({
      variantCode: "KNE6PZ", make: "KAWASAKI", model: "NINJA",
      variant: "KAWASAKI NINJA ER 6N", engineCC: 649, seatingCapacity: 2,
      fuelType: "petrol", line: "tw",
    });
  });

  it("skips a row with no MAKE code", () => {
    expect(parseMakeRow({ MAKE: "", MANUFACTURE: "X" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/import-itgi-master.test.ts`
Expected: FAIL — cannot resolve the script module.

- [ ] **Step 3: Implement the script**

Export the three pure helpers above so they are unit-testable, then add the import routine:

```ts
// scripts/import-itgi-master.ts  (pure helpers — the importable core)
export function normalizeItgiFuel(raw: string): string {
  const f = raw.trim().toLowerCase();
  if (f.includes("battery") || f.includes("electric")) return f.includes("hybrid") ? "hybrid" : "electric";
  if (f.includes("hybrid")) return "hybrid";
  if (f.includes("cng")) return "cng";
  if (f.includes("lpg")) return "lpg";
  if (f.includes("diesel")) return "diesel";
  return "petrol";
}

export function toItgiLine(contractType: string): "fw" | "tw" {
  return contractType.trim().toUpperCase() === "TWP" ? "tw" : "fw";
}

export interface ItgiMakeRow {
  variantCode: string; make: string; model: string; variant: string;
  engineCC: number; seatingCapacity: number; fuelType: string; line: "fw" | "tw";
}

export function parseMakeRow(row: Record<string, unknown>): ItgiMakeRow | null {
  const variantCode = String(row.MAKE ?? "").trim();
  if (!variantCode) return null;
  return {
    variantCode,
    make: String(row.MANUFACTURE ?? "").trim(),
    model: String(row.MODEL ?? "").trim(),
    variant: String(row.VARIANT ?? "").trim(),
    engineCC: Number(row.CC ?? 0),
    seatingCapacity: Number(row.SEATING_CAPACITY ?? 0),
    fuelType: normalizeItgiFuel(String(row.FUEL_TYPE ?? "")),
    line: toItgiLine(String(row.CONTRACT_TYPE ?? "")),
  };
}
```

The import routine must:
- Read the MAKE sheet from `ITGI_Motor Data_Updated_01032024.xlsx`, match each row to an existing `MmvMaster` row (by make/model/variant/CC, same strategy as the ICICI cross-walk), and **upsert** `ProviderMmvCode` with `providerSlug: "itgi"`, `providerVariantCode: variantCode`.
- Upsert `ProviderInsurerCode` from the previous-insurers list by normalized name match.
- **Write no `ProviderRtoCode` rows** — log a clear warning that the ITGI RTO master is missing and ITGI quotes will return no_quote until it is supplied.
- Never delete another provider's rows; print a summary of matched/unmatched counts.

- [ ] **Step 4: Run and confirm it passes**

Run: `cd tf-api && npx vitest run src/providers/itgi/__tests__/import-itgi-master.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the npm script**

In `tf-api/package.json` scripts, add:

```json
"db:import:itgi": "tsx scripts/import-itgi-master.ts"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/import-itgi-master.ts src/providers/itgi/__tests__/import-itgi-master.test.ts package.json
git commit -m "feat(itgi): add master data import (no RTO rows until vendor supplies master)"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `cd tf-api && npm test`
Expected: all suites pass. Investigate any failure — do not skip tests.

- [ ] **Step 2: Typecheck and lint**

Run: `cd tf-api && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Confirm the provider stays off by default**

Run: `cd tf-api && node -e "process.env.ITGI_ENABLED=''; console.log('boots without itgi credentials')"`
Then start the dev server (`npm run dev`) and confirm it boots with no ITGI env set and no ITGI provider registered.

- [ ] **Step 4: Regenerate OpenAPI only if a contract changed**

If nothing under `src/contracts/` changed, skip. Otherwise: `npm run openapi:gen` in `tf-api`, then `npm run gen:api` in `tf-web`.

- [ ] **Step 5: Update the notes doc**

In `tf-api/docs/itgi-integration-notes.md` §8, mark which gaps are now code-ready versus still vendor-blocked, and note that the adapter is implemented but unverified against live ITGI.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(itgi): verify suite, typecheck and lint after provider integration"
```

---

## Self-review notes

- **Spec coverage:** §3.1 capabilities → Task 1; §3.2 method map → Tasks 7–11; §3.3 policy paths → Task 5; §3.4 transport → Task 3; §3.5 coverages → Tasks 1+7; §3.6 normalization → Task 8; §3.7 codes/masters → Tasks 6+12; §3.8 persistence → Task 11 (`contractDetails`); §3.9 config/registration → Tasks 1+11; §4 errors → Task 2; §5 testing → every task.
- **Deliberate deferrals** (spec §1 out-of-scope, not gaps): tf-web wiring, CKYC `/kyc/update`, CVI, break-in completion.
- **Credential placeholders:** all ITGI env vars default to `""` and `ITGI_ENABLED` defaults to `false`, so the app boots and the suite passes without vendor credentials. The RTO gap fails closed by design rather than using a placeholder value.

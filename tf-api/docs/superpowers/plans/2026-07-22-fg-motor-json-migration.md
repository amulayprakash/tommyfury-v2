# FG Motor Adapter SOAP → JSON Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Future Generali (Generali Central) motor new-business adapter's SOAP/XML transport with JSON against the rebranded `/MotorAPI/1.0.0` endpoints, deleting the SOAP path entirely (no feature flag).

**Architecture:** The canonical `Root` payload tree the mapper already builds is unchanged — it is now serialized as a JSON body instead of XML-in-CDATA. The shared `FgTransport` gains a JSON branch (motor uses it; the FG *health* line keeps SOAP through the same transport, so `parseSoapResponse` stays). GetQuote/CreateProposal responses are `{"Root":{Client,Receipt,Policy}}`; IssueProposal responds bare (`{Client,Receipt,Policy}`) — the normalizer's `extractRoot` already unwraps both. Auth, `resolveContract`, cover/fuel/addon maps, and the whole-rupee money convention are untouched.

**Tech Stack:** TypeScript (ESM, explicit `.ts` extensions, `@/*` → `src/*` alias), Express, Zod contracts, Vitest, `undici` global `fetch`/`Response` (Node 18+). Provider mapper/normalizer/transport tests use JSON fixtures + `passthroughCodeResolver` with a fake transport — no live vendor calls and no DB.

> **Execution order (cross-plan):** This plan MUST run **FIRST** — before the contract-changing FG plans (CKYC touch-ups, renewal rewrite, payment v1.41) — because Task 5's "openapi unchanged" check only holds against a clean contract baseline; if a later plan has already edited `src/contracts/*`, the regenerated `openapi.json` will diff and the check will misfire. Apply every `env.ts` / `config.ts` / `fg.provider.ts` / `mapper.ts` / `normalizer.ts` / `http.ts` edit by **matching the quoted block text**, not by trusting the stated line numbers — the line numbers drift as sibling plans land. Coordination across the five FG plans is tracked in `docs/superpowers/plans/2026-07-22-fg-migration-execution-order.md`.

---

## Background: exact deltas encoded by this plan

- **Endpoints** (host already `FG_BASE_URL` default `…apigw.generalicentralinsurance.com:8243`):
  `POST /MotorAPI/1.0.0/GetQuote`, `/MotorAPI/1.0.0/CreateProposal`, `/MotorAPI/1.0.0/IssueProposal` (issuance op **renamed** from SOAP `PolicyIssuance` / `PolicyIssuance_Vendors`).
- **Headers** (motor JSON): `accept: */*`, `Content-Type: application/json`, `Authorization: Bearer <token>`. All values are JSON strings; dates `dd/MM/yyyy`.
- **Body** = the same `Root` tree, serialized as JSON. `METHOD` = `ENQ` (quote) / `CRT` (proposal).
- **Casing gotcha:** CreateProposal PolicyHeader key is `strpolicyquoteNumber` (lower `p`); IssueProposal key is `strPolicyQuoteNumber` (upper `P`). GetQuote omits it (an empty `strpolicyquoteNumber` is tolerated).
- **IssueProposal request is MINIMAL** — `{Uid, VendorCode, PolicyHeader{strPolicyQuoteNumber, PolicyStartDate, PolicyEndDate, ClientID}, Receipt{…}}`. No `VendorUserId`, no `Client`/`Risk`.
- **Response envelope inconsistency:** GetQuote + CreateProposal are `{"Root":{…}}`; IssueProposal is bare `{Client,Receipt,Policy}`.
- **Extraction:** quote no = `Root.Client.QuotationNo`; client id = `Root.Client.ClientId`; IDV = `Policy.VehicleIDV` (may still carry commas in JSON — keep comma-stripping); premium = `Policy.NewDataSet.Table1[]` keyed by `Code`+`Type(OD|TP)`+`BOValue`; final policy = `Policy.PolicyNo`, `Receipt.ReceiptNo`, `Policy.ApplicationNo`. Business failures arrive at HTTP 200 → detect via block `Status`/`ErrorMessage` (existing `assertFgSuccess`).
- **Auth UNCHANGED** — WSO2 password grant via existing `auth.ts`/`token-manager.ts`, cache key `fg:default`; keep the 401-retry (`withAuthRetry`).
- **`Client.CKYCNo` becomes MANDATORY at CreateProposal** — throw a typed `KYC_INCOMPLETE` error when empty while building the CRT payload.
- **Deletions (motor only):** SOAP envelope builder `buildSoapEnvelope`, `SOAP_METHODS`, `SOAP_ACTIONS`, `FgOperation`, the `XMLBuilder` import, `soap.test.ts`, and the `*Result` unwrap keys in `extractRoot`.

### ⚠ Deviation from the raw spec (deliberate, load-bearing)

The migration brief says "delete `parseSoapResponse` and the `text/xml`/`SOAPAction` handling". **`http.ts` is shared with the FG health line of business** (`src/providers/fg/health/*`), which is SOAP/XML and **out of scope**. `fg.provider.ts` `healthCall()` (≈ line 378) calls `this.transport.request({ …, xmlBody: buildHealthSoapEnvelope(…), soapAction })`, and `health/__tests__/provider.test.ts` asserts `call.xmlBody`. Therefore:

- `FgTransport.request` keeps `xmlBody?`/`soapAction?` **and** gains `jsonBody?`. `FetchTransport` branches on `jsonBody !== undefined`: JSON mode for motor, SOAP mode (via `parseSoapResponse`) for health.
- `parseSoapResponse` **stays** in `http.ts`. Only the **motor** SOAP path (the mapper's envelope builder and the provider's `xmlBody`/`soapAction` calls) is deleted. This satisfies "delete the SOAP path" for motor while keeping health green.

---

## File Structure

| File | Create/Modify/Delete | Responsibility after this plan |
|---|---|---|
| `tf-api/src/providers/fg/http.ts` | Modify | `FgTransport` interface + `FetchTransport`: **JSON branch** (motor) and SOAP branch (health, via retained `parseSoapResponse`). `assertFgSuccess`/`extractFgError`/`classifyFgError` unchanged. |
| `tf-api/src/providers/fg/normalizer.ts` | Modify | `extractRoot` unwraps `{"Root":…}` and bare `{Client,Policy,Receipt}`; drops the SOAP `*Result` keys. Premium/IDV/issuance parsing unchanged. |
| `tf-api/src/providers/fg/mapper.ts` | Modify | Emits JSON payloads. `endpoints` → `/MotorAPI/1.0.0/*` (`IssueProposal`). Casing fix (`strpolicyquoteNumber`/`strPolicyQuoteNumber`). CKYCNo validation. Minimal IssueProposal body. **SOAP builder deleted.** `resolveContract`/maps/`toFgDate` unchanged. |
| `tf-api/src/providers/fg/fg.provider.ts` | Modify | Motor `getQuote`/`getFullQuote`/`issuePolicy` pass `jsonBody: payload`; drop SOAP imports. Health path untouched. |
| `tf-api/src/config/env.ts` | Modify | Comment fix only (`/MotorNB/1.0.0` → `/MotorAPI/1.0.0`). No schema/default change. |
| `tf-api/src/providers/fg/fixtures/quote.response.json` | Modify | Real kit F13 GetQuote response (`Root`-wrapped). |
| `tf-api/src/providers/fg/fixtures/proposal.response.json` | Modify | Real kit F13 CreateProposal response (`Root`-wrapped). |
| `tf-api/src/providers/fg/fixtures/issuance.response.json` | Modify | Real kit F13 IssueProposal response (bare, un-wrapped). |
| `tf-api/src/providers/fg/__tests__/http.test.ts` | Create | JSON transport (headers/body/parse/401) + `assertFgSuccess` JSON business-failure coverage (moved off SOAP) + a `parseSoapResponse` round-trip test (preserves the health-critical unwrap coverage lost when `soap.test.ts` is deleted). |
| `tf-api/src/providers/fg/__tests__/normalizer.test.ts` | Modify | Assert against real JSON fixtures + JSON `extractRoot` + issuance normalize. |
| `tf-api/src/providers/fg/__tests__/mapper.test.ts` | Modify | New URLs, casing, CKYCNo present/absent, minimal issuance body. |
| `tf-api/src/providers/fg/__tests__/soap.test.ts` | Delete | Motor SOAP is gone. |

Not touched: `auth.ts`, `config.ts` (contract/fuel/addon maps), `token-manager.ts`, `db-code-resolver.ts`, `contract.test.ts`, the health subtree, and all `src/contracts/*` (so `openapi:gen` is **not** required — verified in the final task).

---

## Task 1: JSON transport branch in `http.ts`

Add a JSON request/response path to the shared transport without disturbing the SOAP path health depends on. Move the SOAP-coupled `assertFgSuccess` coverage onto plain JSON so no coverage is lost when `soap.test.ts` is deleted in Task 4.

**Files:**
- Modify: `tf-api/src/providers/fg/http.ts:9-17` (interface), `:52-80` (`FetchTransport.request`)
- Test: `tf-api/src/providers/fg/__tests__/http.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tf-api/src/providers/fg/__tests__/http.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { FetchTransport, assertFgSuccess } from "../http.ts";

afterEach(() => vi.unstubAllGlobals());

describe("FetchTransport — JSON mode (motor)", () => {
  it("POSTs a JSON body with bearer + json headers and parses the JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ Root: { Client: { QuotationNo: "0000925782" } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const body = await new FetchTransport().request({
      method: "POST",
      url: "https://gw.example.com/MotorAPI/1.0.0/GetQuote",
      token: "tok-123",
      jsonBody: { Uid: "req-1", VendorCode: "Webagg" },
    });

    expect(body).toEqual({ Root: { Client: { QuotationNo: "0000925782" } } });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://gw.example.com/MotorAPI/1.0.0/GetQuote");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok-123");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.accept).toBe("*/*");
    expect(JSON.parse(init.body as string)).toEqual({ Uid: "req-1", VendorCode: "Webagg" });
  });

  it("throws a ProviderError carrying the upstream status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    await expect(
      new FetchTransport().request({ method: "POST", url: "https://gw/x", token: "t", jsonBody: {} }),
    ).rejects.toMatchObject({ upstreamStatus: 401, providerSlug: "fg" });
  });
});

describe("assertFgSuccess — JSON business failures (HTTP 200)", () => {
  it("passes when every block Status is Successful", () => {
    const root = {
      Client: { Status: "Successful", QuotationNo: "0000925782" },
      Receipt: { Status: "Successful" },
      Policy: { Status: "Successful" },
    };
    expect(() => assertFgSuccess(root, "get-quote")).not.toThrow();
  });

  it("surfaces the vendor-validation failure with a VENDOR_CONFIG code", () => {
    const root = {
      Policy: { Status: "Fail" },
      Error: "Vendor Validation Failed",
      ErrorMessage: "VendorCode and VendorUserId must be same",
    };
    try {
      assertFgSuccess(root, "get-quote");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/VendorCode and VendorUserId must be same/);
      expect((err as { code?: string }).code).toBe("VENDOR_CONFIG");
    }
  });

  it("unwraps a nested CKYC error and classifies it as KYC_INCOMPLETE", () => {
    const root = {
      Client: {},
      Policy: { Status: "Fail" },
      Error: "CKYC error",
      ErrorMessage:
        '{"Success":false,"Final_Status":"0","message":"No record exist.","Proposal_ID":"PR_4UTNLVSSP87"}',
    };
    try {
      assertFgSuccess(root, "create-proposal");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toBe("FG create-proposal failed: CKYC error: No record exist.");
      expect((err as { code?: string }).code).toBe("KYC_INCOMPLETE");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/http.test.ts`
Expected: FAIL — the "JSON mode" tests fail because `FetchTransport` ignores `jsonBody` (sends `Content-Type: text/xml`, `body: undefined`, and calls `parseSoapResponse` on a JSON string). The `assertFgSuccess` block should already PASS (that function is unchanged).

- [ ] **Step 3: Add `jsonBody` to the transport interface**

In `tf-api/src/providers/fg/http.ts`, replace the `FgTransport` interface (lines 9-17):

```ts
/**
 * Injectable transport so tests can supply a fake FG backend driven by recorded
 * fixtures without touching the network. Motor uses `jsonBody` (JSON gateway);
 * the health line still uses `xmlBody`/`soapAction` (SOAP) through this same
 * transport, so both shapes are supported.
 */
export interface FgTransport {
  request(args: {
    method: "GET" | "POST";
    url: string;
    token: string;
    /** Motor JSON body (application/json). Presence selects JSON mode. */
    jsonBody?: unknown;
    /** Health SOAP body (text/xml). */
    xmlBody?: string;
    soapAction?: string;
  }): Promise<unknown>;
}
```

- [ ] **Step 4: Branch `FetchTransport.request` on `jsonBody`**

Replace the `FetchTransport` class body (lines 51-80) with:

```ts
/** Default transport backed by global fetch: JSON for motor, SOAP/XML for health. */
export class FetchTransport implements FgTransport {
  async request(args: {
    method: "GET" | "POST";
    url: string;
    token: string;
    jsonBody?: unknown;
    xmlBody?: string;
    soapAction?: string;
  }): Promise<unknown> {
    const isJson = args.jsonBody !== undefined;
    const headers: Record<string, string> = isJson
      ? {
          Authorization: `Bearer ${args.token}`,
          "Content-Type": "application/json",
          accept: "*/*",
        }
      : {
          Authorization: `Bearer ${args.token}`,
          "Content-Type": "text/xml",
          accept: "application/json",
        };
    if (args.soapAction) headers["SOAPAction"] = args.soapAction;

    const body = isJson ? JSON.stringify(args.jsonBody) : args.xmlBody;
    const response = await fetch(args.url, { method: args.method, headers, body });
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      throw new ProviderError(
        FG_SLUG,
        response.status,
        `FG request failed [${response.status}]`,
        text.slice(0, 500),
      );
    }

    if (isJson) {
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        throw new ProviderError(FG_SLUG, response.status, "FG returned a non-JSON body", text.slice(0, 500));
      }
    }
    return parseSoapResponse(text);
  }
}
```

Leave `parseSoapResponse`, `extractFgError`, `classifyFgError`, and `assertFgSuccess` exactly as they are — health still uses `parseSoapResponse`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/http.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Confirm the health provider suite still passes (shared transport)**

Run: `cd tf-api && npx vitest run src/providers/fg/health/__tests__/provider.test.ts`
Expected: PASS — health injects a fake transport and asserts `call.xmlBody`; the added optional `jsonBody` field does not affect it.

- [ ] **Step 7: Keep direct coverage on the retained `parseSoapResponse`**

Deleting `soap.test.ts` in Task 4 removes the only unit test that exercised `parseSoapResponse`, but that function is retained for the live health SOAP path. Add a round-trip test here so it keeps direct coverage.

First extend the import at the top of `tf-api/src/providers/fg/__tests__/http.test.ts` to pull in the function:

```ts
import { FetchTransport, assertFgSuccess, parseSoapResponse } from "../http.ts";
```

Then append this describe block to `tf-api/src/providers/fg/__tests__/http.test.ts`:

```ts
describe("parseSoapResponse — retained health SOAP path", () => {
  it("unwraps a SOAP envelope's escaped inner <Root> into the business object", () => {
    const envelope =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
      "<soap:Body>" +
      '<GetQuoteResponse xmlns="http://tempuri.org/">' +
      "<GetQuoteResult>" +
      "&lt;Root&gt;&lt;Client&gt;&lt;QuotationNo&gt;0000925782&lt;/QuotationNo&gt;&lt;/Client&gt;&lt;/Root&gt;" +
      "</GetQuoteResult>" +
      "</GetQuoteResponse>" +
      "</soap:Body>" +
      "</soap:Envelope>";

    const root = parseSoapResponse(envelope) as { Client: { QuotationNo: string } };
    expect(root.Client.QuotationNo).toBe("0000925782");
  });
});
```

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/http.test.ts`
Expected: PASS (all 6 tests) — `parseSoapResponse` is unchanged, so this passes immediately and locks in the health-critical coverage before `soap.test.ts` is deleted.

- [ ] **Step 8: Commit**

```bash
git add tf-api/src/providers/fg/http.ts tf-api/src/providers/fg/__tests__/http.test.ts
git commit -m "feat(fg): add JSON transport branch for motor MotorAPI endpoints"
```

---

## Task 2: `extractRoot` handles the JSON envelopes (drop SOAP `*Result` keys)

`extractRoot` must unwrap `{"Root":{…}}` (GetQuote/CreateProposal) and pass a bare `{Client,Receipt,Policy}` (IssueProposal) through. Remove the SOAP `*Result` unwrap keys.

**Files:**
- Modify: `tf-api/src/providers/fg/normalizer.ts:34-53` (`extractRoot`)
- Test: `tf-api/src/providers/fg/__tests__/normalizer.test.ts:62-73` (the `extractRoot` describe block)

- [ ] **Step 1: Write the failing test**

Replace the `describe("extractRoot", …)` block (lines 62-73) of `tf-api/src/providers/fg/__tests__/normalizer.test.ts` with:

```ts
describe("extractRoot", () => {
  it("unwraps a { Root: … } JSON envelope (quote/proposal)", () => {
    const wrapped = { Root: { Client: { QuotationNo: "9" }, Policy: {} } };
    const root = extractRoot(wrapped);
    expect((root.Client as Record<string, unknown>).QuotationNo).toBe("9");
  });

  it("returns a bare { Client, Receipt, Policy } issuance body unchanged", () => {
    const flat = { Client: { ClientId: "1" }, Receipt: { ReceiptNo: "R1" }, Policy: {} };
    expect(extractRoot(flat)).toBe(flat);
  });

  it("parses a JSON-stringified body", () => {
    const root = extractRoot(JSON.stringify({ Root: { Client: { QuotationNo: "7" } } }));
    expect((root.Client as Record<string, unknown>).QuotationNo).toBe("7");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/normalizer.test.ts -t extractRoot`
Expected: FAIL — the current `extractRoot` still references removed SOAP keys is fine, but the "bare … unchanged" test fails only if logic regresses; in practice this step is a guard. If all three already pass against the current code, proceed to Step 3 anyway to remove the dead SOAP keys (the code change is still required and the tests must stay green).

- [ ] **Step 3: Simplify `extractRoot` to JSON-only envelopes**

Replace `extractRoot` (lines 34-53) of `tf-api/src/providers/fg/normalizer.ts` with:

```ts
/**
 * Unwraps FG's JSON response envelopes to the business object. GetQuote and
 * CreateProposal are wrapped `{ "Root": { Client, Receipt, Policy } }`;
 * IssueProposal is bare `{ Client, Receipt, Policy }`. A JSON-encoded string
 * body is parsed defensively.
 */
export function extractRoot(body: unknown): Json {
  let cur: unknown = body;
  if (typeof cur === "string") cur = tryParse(cur);

  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const c = cur as Json;
    if ("Policy" in c || "Client" in c || "Receipt" in c) return c;
    const next = c.Root ?? c.d ?? undefined;
    if (next === undefined) break;
    cur = typeof next === "string" ? tryParse(next) : next;
  }
  return obj(cur);
}
```

(`tryParse`, `obj`, `Json`, `num`, `str`, `asArray` remain as-is above/below.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/normalizer.test.ts -t extractRoot`
Expected: PASS (3 tests). (The fixture-based `normalizeQuote`/`normalizeProposal` blocks in this file still reference the OLD fixtures and will be updated in Task 3 — do not run the whole file green yet.)

- [ ] **Step 5: Commit**

```bash
git add tf-api/src/providers/fg/normalizer.ts tf-api/src/providers/fg/__tests__/normalizer.test.ts
git commit -m "refactor(fg): unwrap JSON Root/bare envelopes, drop SOAP *Result keys"
```

---

## Task 3: Replace fixtures with real kit JSON + fixture-based normalizer tests

Swap the three SOAP-shaped fixtures for the real Generali Central F13 JSON bodies (from the kit's *Contract Wise* sample logs) and assert the normalizer against them, including the bare issuance envelope.

**Files:**
- Modify: `tf-api/src/providers/fg/fixtures/quote.response.json` (full replace)
- Modify: `tf-api/src/providers/fg/fixtures/proposal.response.json` (full replace)
- Modify: `tf-api/src/providers/fg/fixtures/issuance.response.json` (full replace)
- Test: `tf-api/src/providers/fg/__tests__/normalizer.test.ts:1-60` (`normalizeQuote`/`normalizeProposal` + new issuance block)

- [ ] **Step 1: Replace the GetQuote fixture with the real Root-wrapped kit response**

Overwrite `tf-api/src/providers/fg/fixtures/quote.response.json`:

```json
{
  "Root": {
    "Client": { "Status": "Successful", "ClientId": "", "QuotationNo": "0000925782", "ErrorMessage": null },
    "Receipt": { "Status": "Successful", "ReceiptNo": "", "ErrorMessage": null },
    "Policy": {
      "Status": "Successful",
      "PolicyNo": "",
      "ErrorMessage": "Success",
      "NewDataSet": {
        "Table": { "LdrErrLvl": "0", "PolNo": "Successful" },
        "Table1": [
          { "RskNo": "1", "Code": "IDV", "Description": "IDV", "Type": "OD", "BOValue": "18802.69", "DBValue": "0" },
          { "RskNo": "1", "Code": "PrmDue", "Description": "PrmDue", "Type": "OD", "BOValue": "12591.8862", "DBValue": "0" },
          { "RskNo": "1", "Code": "ZDCNS", "Description": "Zero Dep. + Consumable", "Type": "OD", "BOValue": "2233.64", "DBValue": "0" },
          { "RskNo": "1", "Code": "OD", "Description": "Less : Total Special Discount", "Type": "OD", "BOValue": "11281.62", "DBValue": "0" },
          { "RskNo": "1", "Code": "STNCB", "Description": "NCB Protection", "Type": "OD", "BOValue": "916.37", "DBValue": "0" },
          { "RskNo": "1", "Code": "OD", "Description": "Total Basic OD Premium", "Type": "OD", "BOValue": "7521.08", "DBValue": "0" },
          { "RskNo": "1", "Code": "PrmDue", "Description": "PrmDue", "Type": "TP", "BOValue": "14059.7", "DBValue": "0" },
          { "RskNo": "1", "Code": "Gross Premium", "Description": "Gross Premium", "Type": "OD", "BOValue": "10671.09", "DBValue": "0" },
          { "RskNo": "1", "Code": "ServTax", "Description": "ServTax", "Type": "OD", "BOValue": "1920.7962", "DBValue": "0" },
          { "RskNo": "1", "Code": "TP", "Description": "Total Basic TP  Premium (TP)", "Type": "TP", "BOValue": "10640.00", "DBValue": "0" },
          { "RskNo": "1", "Code": "CPA", "Description": "CPA", "Type": "TP", "BOValue": "750.00", "DBValue": "0" },
          { "RskNo": "1", "Code": "IMT16", "Description": "Total Unnamed Passenger PA Premium (IMT16)", "Type": "TP", "BOValue": "375.00", "DBValue": "0" },
          { "RskNo": "1", "Code": "IMT28", "Description": "Total LL for paid driver and / or cleaner Premium (IMT28)", "Type": "TP", "BOValue": "150.00", "DBValue": "0" },
          { "RskNo": "1", "Code": "Gross Premium", "Description": "Gross Premium", "Type": "TP", "BOValue": "11915.00", "DBValue": "0" },
          { "RskNo": "1", "Code": "ServTax", "Description": "ServTax", "Type": "TP", "BOValue": "2144.7", "DBValue": "0" },
          { "RskNo": "1", "Code": "TOTALADDON", "Description": "Total ADDON Premium", "Type": "OD", "BOValue": "3150.01", "DBValue": "0" },
          { "RskNo": "1", "Code": "DISCPERC", "Description": "DISCPERC", "Type": "OD", "BOValue": "-60.00", "DBValue": "0" }
        ]
      },
      "VehicleIDV": "572729",
      "AppliedDiscount": "",
      "ProductUINNo": ""
    }
  }
}
```

- [ ] **Step 2: Replace the CreateProposal fixture with the real Root-wrapped kit response**

Overwrite `tf-api/src/providers/fg/fixtures/proposal.response.json`:

```json
{
  "Root": {
    "Client": { "Status": "Successful", "ClientId": "80036976", "QuotationNo": "0000112799", "ErrorMessage": null },
    "Receipt": { "Status": "Successful", "ReceiptNo": "", "ErrorMessage": null },
    "Policy": {
      "Status": "Successful",
      "PolicyNo": "",
      "ErrorMessage": "",
      "NewDataSet": {
        "Table": { "LdrErrLvl": "0", "PolNo": "Successful" },
        "Table1": [
          { "RskNo": "1", "Code": "IDV", "Description": "IDV", "Type": "OD", "BOValue": "18802.69", "DBValue": "0" },
          { "RskNo": "1", "Code": "ZDCNS", "Description": "Zero Dep. + Consumable", "Type": "OD", "BOValue": "2233.63", "DBValue": "0" },
          { "RskNo": "1", "Code": "OD", "Description": "Less: Total Special Discount", "Type": "OD", "BOValue": "11281.62", "DBValue": "0" },
          { "RskNo": "1", "Code": "OD", "Description": "Total Basic OD Premium", "Type": "OD", "BOValue": "7521.08", "DBValue": "0" },
          { "RskNo": "1", "Code": "STNCB", "Description": "Premium for Protection of NCB(CV15)", "Type": "OD", "BOValue": "916.37", "DBValue": "0" },
          { "RskNo": "1", "Code": "TOTALADDON", "Description": "Total ADDON Premium", "Type": "OD", "BOValue": "3150", "DBValue": "0" },
          { "RskNo": "1", "Code": "Gross Premium", "Description": "Gross Premium", "Type": "OD", "BOValue": "10671.07", "DBValue": "0" },
          { "RskNo": "1", "Code": "ServTax", "Description": "ServTax", "Type": "OD", "BOValue": "1920.7925999999998", "DBValue": "0" },
          { "RskNo": "1", "Code": "TP", "Description": "Total Basic TP  Premium (TP)", "Type": "TP", "BOValue": "10640.01", "DBValue": "0" },
          { "RskNo": "1", "Code": "CPA", "Description": "CPA", "Type": "TP", "BOValue": "750", "DBValue": "0" },
          { "RskNo": "1", "Code": "IMT16", "Description": "Add: Total Unnamed Passenger PA Premium (IMT16)", "Type": "TP", "BOValue": "375", "DBValue": "0" },
          { "RskNo": "1", "Code": "IMT28", "Description": "Add: Total LL for paid driver and / or cleaner Premium (IMT28)", "Type": "TP", "BOValue": "150", "DBValue": "0" },
          { "RskNo": "1", "Code": "Gross Premium", "Description": "Gross Premium", "Type": "TP", "BOValue": "11915.01", "DBValue": "0" },
          { "RskNo": "1", "Code": "ServTax", "Description": "ServTax", "Type": "TP", "BOValue": "2144.7018", "DBValue": "0" },
          { "RskNo": "1", "Code": "DISCPERC", "Description": "DISCPERC", "Type": "OD", "BOValue": "-60", "DBValue": "0" }
        ]
      },
      "VehicleIDV": "572,729",
      "AppliedDiscount": "",
      "ProductUINNo": ""
    }
  }
}
```

(Note the `VehicleIDV` here is comma-grouped `"572,729"` even in JSON — this proves the normalizer's comma-stripping must stay.)

- [ ] **Step 3: Replace the IssueProposal fixture with the real BARE kit response**

Overwrite `tf-api/src/providers/fg/fixtures/issuance.response.json`:

```json
{
  "Client": { "Status": "Successful", "ClientId": "80036976", "ErrorMessage": "" },
  "Receipt": { "Status": "Successful", "ReceiptNo": "54/26/FGI/16/0001247", "Message": "" },
  "Policy": {
    "Status": "Successful",
    "ApplicationNo": "54/26/FGI/16/0001247",
    "InwardNo": "",
    "PolicyNo": "132/14/11/0529/MTP/2410002509",
    "ErrorMessage": "",
    "NewDataSet": {
      "Table": { "LdrErrLvl": "0", "PolNo": "132/14/11/0529/MTP/2410002509" },
      "Table1": []
    },
    "VehicleIDV": ""
  }
}
```

- [ ] **Step 4: Rewrite the fixture-based normalizer tests**

Replace the top of `tf-api/src/providers/fg/__tests__/normalizer.test.ts` (lines 1-60, i.e. everything above the `describe("extractRoot", …)` block edited in Task 2) with:

```ts
import { describe, it, expect } from "vitest";
import { normalizeQuote, normalizeProposal, normalizeIssuance, extractRoot } from "../normalizer.ts";
import quoteFixture from "../fixtures/quote.response.json";
import proposalFixture from "../fixtures/proposal.response.json";
import issuanceFixture from "../fixtures/issuance.response.json";

const ctx = {
  requestId: "req-1",
  policyType: "comprehensive",
  vehicleCategory: "fourWheeler" as const,
};

describe("normalizeQuote (Root-wrapped JSON)", () => {
  const r = normalizeQuote(quoteFixture, ctx);

  it("captures the quotation number as quoteNo + transactionId", () => {
    expect(r.quoteNo).toBe("0000925782");
    expect(r.transactionId).toBe("0000925782");
  });

  it("reads VehicleIDV (plain, no commas)", () => {
    expect(r.idvValue).toBe(572729);
  });

  it("extracts basic OD + TP + total addon premiums", () => {
    expect(r.basicOdPremium).toBe(7521.08);
    expect(r.thirdPartyPremium).toBe(10640);
    expect(r.totalAddonPremium).toBe(3150.01);
  });

  it("treats FG 'Gross Premium' as pre-tax net; gross = net + ServTax", () => {
    expect(r.netPremium).toBeCloseTo(22586.09, 2);
    expect(r.serviceTaxAmount).toBeCloseTo(4065.4962, 2);
    expect(r.grossPremium).toBeCloseTo(26651.5862, 2);
  });

  it("maps known FG line codes to canonical add-on premiums", () => {
    expect(r.addonPremiums.ncbProtection).toBe(916.37);
    expect(r.addonPremiums.paOwner).toBe(750);
    expect(r.addonPremiums.paUnnamedPassenger).toBe(375);
    expect(r.addonPremiums.legalLiabilityPaidDriver).toBe(150);
  });

  it("captures the OD special discount and DISCPERC (absolute)", () => {
    expect(r.discounts.ownDamageDiscount).toBe(11281.62);
    expect(r.odDiscountPercent).toBe(60);
  });
});

describe("normalizeProposal (Root-wrapped JSON)", () => {
  it("captures the quote number, IDV and ClientId", () => {
    const r = normalizeProposal(proposalFixture, ctx);
    expect(r.quoteNo).toBe("0000112799");
    expect(r.idvValue).toBe(572729);
    expect(r.contractDetails?.clientId).toBe("80036976");
  });
});

describe("normalizeIssuance (bare JSON envelope)", () => {
  const r = normalizeIssuance(issuanceFixture, { quoteNo: "0000112799" });

  it("binds the issued policy number and marks it ISSUED", () => {
    expect(r.status).toBe("ISSUED");
    expect(r.policyNumber).toBe("132/14/11/0529/MTP/2410002509");
    expect(r.applicationNo).toBe("54/26/FGI/16/0001247");
    expect(r.receiptNo).toBe("54/26/FGI/16/0001247");
    expect(r.clientId).toBe("80036976");
    expect(r.quoteNo).toBe("0000112799");
  });
});
```

(The `describe("extractRoot", …)` block from Task 2 remains below this.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/normalizer.test.ts`
Expected: PASS (all blocks, including `extractRoot` from Task 2). No DB needed — pure fixtures.

- [ ] **Step 6: Commit**

```bash
git add tf-api/src/providers/fg/fixtures/quote.response.json tf-api/src/providers/fg/fixtures/proposal.response.json tf-api/src/providers/fg/fixtures/issuance.response.json tf-api/src/providers/fg/__tests__/normalizer.test.ts
git commit -m "test(fg): replace fixtures with real MotorAPI JSON bodies + issuance normalize"
```

---

## Task 4: Motor JSON cutover — mapper + provider (delete SOAP), CKYCNo validation

This is the cutover. The mapper stops building SOAP and emits JSON payloads at the new endpoints with the correct key casing; the provider passes `jsonBody`; the motor SOAP code is deleted; and CKYCNo is enforced at CreateProposal. Mapper + provider change together because deleting the SOAP exports breaks the provider's imports — so the tree compiles only at the task boundary, not mid-task. `soap.test.ts` is deleted in this task too.

**Files:**
- Modify: `tf-api/src/providers/fg/mapper.ts:1` (import), `:31-68` (delete SOAP block), `:403-425` (`policyHeader`), `:456-529` (CreateProposal), `:531-567` (IssueProposal)
- Modify: `tf-api/src/providers/fg/fg.provider.ts:45-54` (imports), `:217-299` (motor ops)
- Modify: `tf-api/src/providers/fg/__tests__/mapper.test.ts` (URLs, casing, CKYCNo, issuance)
- Delete: `tf-api/src/providers/fg/__tests__/soap.test.ts`

- [ ] **Step 1: Update the mapper tests for the new URLs, casing, CKYCNo and minimal issuance body**

Apply these edits to `tf-api/src/providers/fg/__tests__/mapper.test.ts`.

(a) Extend the imports (line 3-9) to pull in the issuance builder and the issuance request type:

```ts
import {
  buildGetQuotePayload,
  buildCreateProposalPayload,
  buildIssueProposalPayload,
  toFgDate,
  type FgResolvedCodes,
  type FgPayloadMeta,
} from "../mapper.ts";
import { PolicyIssuanceRequestSchema } from "@/contracts/policy.ts";
```

(b) Add `ckyc` to the `fullQuote` helper so existing CRT cases satisfy the new validation. Change the `fullQuote` object (inside the `MotorFullQuoteRequestSchema.parse({ … })`) to include:

```ts
    vehicle: { engineNumber: "ENG123", chassisNumber: "CHS123" },
    idvValue: 738908,
    ckyc: "10097186172315",
    ...over,
```

(c) Change the ENQ URL assertion (line 64):

```ts
    expect(p.url).toBe("/MotorAPI/1.0.0/GetQuote");
```

(d) Change the CRT URL + quote-number assertions (lines 148-150) to the new path and lower-`p` casing:

```ts
    expect(p.url).toBe("/MotorAPI/1.0.0/CreateProposal");
    expect(header(p).METHOD).toBe("CRT");
    expect(header(p).strpolicyquoteNumber).toBe("0000771450");
```

(e) Append two new tests at the end of `describe("buildCreateProposalPayload", …)` (before its closing `});`):

```ts
  it("throws KYC_INCOMPLETE when CKYCNo is missing at proposal", () => {
    expect(() => buildCreateProposalPayload(fullQuote({ ckyc: "" }), codes, meta, "r")).toThrowError(
      /CKYC/i,
    );
    try {
      buildCreateProposalPayload(fullQuote({ ckyc: "" }), codes, meta, "r");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("KYC_INCOMPLETE");
    }
  });

  it("carries the CKYCNo into the Client block", () => {
    const p = buildCreateProposalPayload(fullQuote(), codes, meta, "r");
    expect((p.payload.Client as Record<string, unknown>).CKYCNo).toBe("10097186172315");
  });
```

(f) Add a new describe block for the minimal issuance body at the end of the file (after `describe("toFgDate", …)`):

```ts
describe("buildIssueProposalPayload", () => {
  const issuanceReq = () =>
    PolicyIssuanceRequestSchema.parse({
      quoteNo: "0000112799",
      clientId: "80036976",
      vehicleCategory: "fourWheeler",
      policyStartDate: "2026-05-14",
      policyEndDate: "2029-05-13",
      receipt: {
        uniqueTranKey: "PB1436423646497",
        transactionDate: "14/05/2026",
        receiptType: "IVR",
        amount: 26652,
        tranRefNo: "PB814363724334018",
        tranRefNoDate: "14/05/2026",
        pgType: "PAYU",
      },
    });

  it("targets IssueProposal with a minimal body (no VendorUserId, no Client/Risk)", () => {
    const p = buildIssueProposalPayload(issuanceReq(), meta, "req-9");
    expect(p.url).toBe("/MotorAPI/1.0.0/IssueProposal");
    expect(p.payload).not.toHaveProperty("VendorUserId");
    expect(p.payload).not.toHaveProperty("Risk");
    expect(p.payload).not.toHaveProperty("Client");
    const ph = p.payload.PolicyHeader as Record<string, unknown>;
    expect(ph.strPolicyQuoteNumber).toBe("0000112799");
    expect(ph.ClientID).toBe("80036976");
    expect((p.payload.Receipt as Record<string, unknown>).Amount).toBe("26652");
  });
});
```

> Schema reference (verified against `tf-api/src/contracts/policy.ts`): `PolicyIssuanceRequestSchema` requires `quoteNo`, `clientId`, `vehicleCategory`; `policyType`/`policyStartDate`/`policyEndDate` are optional; `receipt` (`PaymentReceiptSchema`) requires `uniqueTranKey`, `transactionDate`, `amount` (positive number), `tranRefNo`, `tranRefNoDate` (`receiptType` defaults `IVR`, `pgType` defaults `PAYU`; `tcsAmount`/`checkType`/`bsbCode` optional). There is no `providerSlug` on the request.

(g) Pin the emitted `FuelType`. The kit JSON samples send the full word (`"PETROL"`), but `FUEL_MAP` (in `config.ts`) emits the coded `"P"` and this plan keeps that mapping. Add a test to the end of `describe("buildGetQuotePayload", …)` (before its closing `});`) that pins the coded value, so the coded-vs-full-word decision is explicit and reversible in exactly one place (`FUEL_MAP`) if live MotorAPI rejects the code:

```ts
  it("pins the emitted Vehicle.FuelType to the FG code (coded, not the full word)", () => {
    const p = buildGetQuotePayload(baseQuote({ fuelType: "petrol" }), codes, meta, "r");
    expect(vehicle(p).FuelType).toBe("P");
  });
```

- [ ] **Step 2: Run the mapper test to verify it fails**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/mapper.test.ts`
Expected: FAIL — URL assertions expect `/MotorAPI/1.0.0/*` but the mapper still emits `/MotorNB/1.0.0/*`; `strpolicyquoteNumber` is absent (still upper-P); `buildIssueProposalPayload` still emits `VendorUserId`; CKYCNo throw not implemented.

- [ ] **Step 3: Point the endpoints at MotorAPI and delete the motor SOAP block**

In `tf-api/src/providers/fg/mapper.ts`:

Change the import on line 1 from:

```ts
import { XMLBuilder } from "fast-xml-parser";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { PolicyIssuanceRequest } from "@/contracts/policy.ts";
import { FUEL_MAP, resolveContract } from "./config.ts";
```

to:

```ts
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { PolicyIssuanceRequest } from "@/contracts/policy.ts";
import { AppError } from "@/errors/app-error.ts";
import { FUEL_MAP, resolveContract } from "./config.ts";
```

Then replace the entire SOAP block (lines 31-68 — the `// ─── Endpoints + SOAP envelope …` comment through the end of `buildSoapEnvelope`) with the JSON endpoints only:

```ts
// ─── Endpoints (JSON gateway) ────────────────────────────────────────────────
// Generali Central motor new-business is JSON on /MotorAPI/1.0.0. The Root
// payload is sent as the JSON request body (was XML-in-CDATA under SOAP).

export const endpoints = {
  getQuote: () => `/MotorAPI/1.0.0/GetQuote`,
  createProposal: () => `/MotorAPI/1.0.0/CreateProposal`,
  issueProposal: () => `/MotorAPI/1.0.0/IssueProposal`,
};
```

This deletes `SOAP_METHODS`, `SOAP_ACTIONS`, `FgOperation`, `xmlBuilder`, and `buildSoapEnvelope`.

- [ ] **Step 4: Fix the PolicyHeader key casing (CreateProposal / GetQuote)**

In `policyHeader()` (around lines 411-424), rename the quote-number key to lower `p` (CRT + ENQ both use lower `p`; the upper-`P` variant lives only in the issuance builder). Change:

```ts
    strPolicyQuoteNumber: opts.quoteNo ?? "",
```

to:

```ts
    strpolicyquoteNumber: opts.quoteNo ?? "",
```

- [ ] **Step 5: Enforce CKYCNo at CreateProposal**

In `buildCreateProposalPayload` (starts ~line 456), immediately after `const { proposer, address, vehicle } = req;` add the guard:

```ts
  const { proposer, address, vehicle } = req;
  if (!req.ckyc || !req.ckyc.trim()) {
    throw new AppError(
      422,
      "FG requires a completed CKYC before proposal. Complete KYC and resubmit with the CKYC number.",
      "KYC_INCOMPLETE",
    );
  }
```

- [ ] **Step 6: Make the IssueProposal body minimal**

Replace the payload construction in `buildIssueProposalPayload` (the `const payload = { … }` block, ~lines 548-565) so it drops `VendorUserId` (the kit issuance body carries only `Uid`, `VendorCode`, `PolicyHeader`, `Receipt`):

```ts
  const r = req.receipt;
  const payload = {
    Uid: requestId,
    VendorCode: meta.vendorCode,
    PolicyHeader: policyHeader,
    Receipt: {
      UniqueTranKey: r.uniqueTranKey,
      CheckType: r.checkType ?? "",
      BSBCode: r.bsbCode ?? "",
      TransactionDate: r.transactionDate,
      ReceiptType: r.receiptType,
      Amount: String(r.amount),
      TCSAmount: r.tcsAmount ?? "",
      TranRefNo: r.tranRefNo,
      TranRefNoDate: r.tranRefNoDate,
      PGType: r.pgType,
    },
  };
  return { url: endpoints.issueProposal(), payload };
```

The local `policyHeader` object above it already uses `strPolicyQuoteNumber` (upper `P`) — leave that as-is; it is correct for IssueProposal.

- [ ] **Step 7: Rewire the provider to JSON transport, drop SOAP imports**

In `tf-api/src/providers/fg/fg.provider.ts`, change the mapper import block (lines 45-53) from:

```ts
import {
  buildGetQuotePayload,
  buildCreateProposalPayload,
  buildIssueProposalPayload,
  buildSoapEnvelope,
  SOAP_ACTIONS,
  type FgResolvedCodes,
  type FgPayloadMeta,
} from "./mapper.ts";
```

to:

```ts
import {
  buildGetQuotePayload,
  buildCreateProposalPayload,
  buildIssueProposalPayload,
  type FgResolvedCodes,
  type FgPayloadMeta,
} from "./mapper.ts";
```

Then change the three motor transport calls to pass `jsonBody` instead of `xmlBody`/`soapAction`.

`getQuote` (lines 221-229):

```ts
    const body = await this.withAuthRetry(this.motorToken, (token) =>
      this.transport.request({
        method: "POST",
        url: this.url(url),
        token,
        jsonBody: payload,
      }),
    );
```

`getFullQuote` (lines 261-269):

```ts
    const body = await this.withAuthRetry(this.motorToken, (token) =>
      this.transport.request({
        method: "POST",
        url: this.url(url),
        token,
        jsonBody: payload,
      }),
    );
```

`issuePolicy` (lines 287-295):

```ts
    const body = await this.withAuthRetry(this.motorToken, (token) =>
      this.transport.request({
        method: "POST",
        url: this.url(url),
        token,
        jsonBody: payload,
      }),
    );
```

Leave the health `healthCall()` (`xmlBody`/`soapAction`) and `buildHealthSoapEnvelope` import untouched.

- [ ] **Step 8: Delete the motor SOAP test**

```bash
git rm tf-api/src/providers/fg/__tests__/soap.test.ts
```

(Its `assertFgSuccess` / vendor-validation / KYC-classification coverage was re-created against plain JSON in `http.test.ts` in Task 1, and its `parseSoapResponse` round-trip coverage was re-created there too — Task 1 Step 7 — so nothing is lost by this deletion.)

- [ ] **Step 9: Run the mapper test to verify it passes**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/mapper.test.ts`
Expected: PASS (including the new CKYCNo-missing throw, the CKYCNo-in-Client assertion, and the minimal IssueProposal body).

- [ ] **Step 10: Run the whole FG provider directory to confirm the cutover compiles + passes**

Run: `cd tf-api && npx vitest run src/providers/fg/`
Expected: PASS — no remaining references to `buildSoapEnvelope`/`SOAP_ACTIONS`; `soap.test.ts` is gone; health suite still green. (If a repository-touching FG suite errors on a missing DB, start MySQL with `npm run db:up` first; the mapper/normalizer/http tests themselves need no DB.)

- [ ] **Step 11: Commit**

```bash
git add tf-api/src/providers/fg/mapper.ts tf-api/src/providers/fg/fg.provider.ts tf-api/src/providers/fg/__tests__/mapper.test.ts
git commit -m "feat(fg): cut motor over to JSON MotorAPI, enforce CKYCNo, delete SOAP path"
```

---

## Task 5: Cleanup, full FG suite, typecheck, contract-freshness check

Fix the stale `/MotorNB/1.0.0` comment, prove the whole FG suite + typecheck are green, and confirm no contract changed (so `openapi:gen` is unnecessary).

**Files:**
- Modify: `tf-api/src/config/env.ts:37` (comment only)

- [ ] **Step 1: Fix the stale env comment**

In `tf-api/src/config/env.ts`, change the comment on line 37 from:

```ts
  /** API gateway base (SOAP motor endpoints live under /MotorNB/1.0.0). */
```

to:

```ts
  /** API gateway base (JSON motor endpoints live under /MotorAPI/1.0.0). */
```

No default/schema change — `FG_BASE_URL` already points at `…apigw.generalicentralinsurance.com:8243`, and the per-product token wiring (`fg:default` motor subscription via `FG_CLIENT_BASIC`) is unchanged by the JSON migration.

- [ ] **Step 2: Run the full FG suite**

Run: `cd tf-api && npx vitest run src/providers/fg/`
Expected: PASS. (Bring MySQL up with `npm run db:up` if a repository-backed FG suite requires it.)

- [ ] **Step 3: Typecheck the whole backend**

Run: `cd tf-api && npm run typecheck`
Expected: PASS — no dangling imports of the deleted SOAP symbols, no unused `XMLBuilder`, `AppError` imported where used.

- [ ] **Step 4: Confirm this migration changed no contract (openapi:gen adds no delta)**

⚠ **Do not** use `git status --porcelain openapi/openapi.json` for this check: the working tree **already carries an unrelated, uncommitted `openapi/openapi.json` modification** (from in-flight KYC work that also touches `src/contracts/kyc.ts`), so `git status` will never be empty and the check would misfire. Instead, assert that running `openapi:gen` introduces **no further delta on top of the current working-tree file** — that is what proves *this* migration touched no `src/contracts/*` schema:

```bash
cd tf-api
before=$(sha256sum openapi/openapi.json | cut -d' ' -f1)
npm run openapi:gen
after=$(sha256sum openapi/openapi.json | cut -d' ' -f1)
[ "$before" = "$after" ] && echo "OK: openapi:gen introduced no delta" || echo "FAIL: a contract changed unexpectedly"
```

Expected: prints `OK: openapi:gen introduced no delta`. Because the hashes match, the regenerated `openapi.json` is byte-identical to what was already on disk, so this migration added no contract change and `tf-web`'s `gen:api` is not required. If it prints `FAIL`, `openapi:gen` rewrote the file — a contract was touched unexpectedly; stop and reconcile before committing. (The pre-existing KYC-driven `openapi.json`/`kyc.ts` diff vs `HEAD` is expected and stays out of scope — see Step 5.)

- [ ] **Step 5: Commit — motor source only, no openapi/kyc smuggling**

The only file this task modified is `env.ts` (the motor source files — `http.ts`, `normalizer.ts`, `mapper.ts`, the fixtures, `fg.provider.ts`, and the deleted `soap.test.ts` — were committed in Tasks 1–4). Add **only** `env.ts`. Do **not** `git add openapi/openapi.json`: it carries a pre-existing, unrelated KYC diff (alongside `src/contracts/kyc.ts`) that must **not** ride into this FG commit — leave both files untouched in the working tree for their own change to land separately.

```bash
git add tf-api/src/config/env.ts
git commit -m "chore(fg): refresh MotorAPI env comment"
```

Verify nothing else was staged before committing: `git status --porcelain` should show `openapi/openapi.json` and `src/contracts/kyc.ts` still as unstaged `M` (out of scope), and only `src/config/env.ts` staged.

---

## Out of scope / follow-on

This plan covers **only** the FG motor new-business SOAP → JSON transport migration. The remaining Generali Central rebranding work is tracked in the intel doc `tf-api/docs/fg-rebranding-notes.md` (§8 gap list) and belongs in separate plans:

1. **Renewal rewrite** — 3-op `Renewal/1.0.0/RenewalModify` full-JSON flow, `Internal-Key` header, echo-then-modify semantics, new host/subscription (§5).
2. **Payment update** — v1.41 GC hosts, SOAP `FetchTRNDetails` recon step, `.NET` 11-field checksum + DES-decrypt decision (§4).
3. **CKYC touch-ups** — repoint host to `generalicentralinsurance.com`, implement `UploadDocBytes`, self-host jQuery in the redirect bridge, confirm `GCKYC` 3.0.0 vs 2.1.0 (§3).
4. **Masters re-import** — idempotent `db:import:fg` from the rebranded workbook, PASIA_CODE parity check (§7). Never override the shared master/provider-code tables to pass a test.

**Pre-go-live open confirmations** (from §10, relevant to *this* migration):
- **MotorAPI subscription / auth** — this plan assumes auth is **fully unchanged** (cache key `fg:default`, same WSO2 subscription, `withAuthRetry` on 401). It is **unconfirmed** whether the JSON `MotorAPI/1.0.0` product needs a **new consumer key** distinct from the current `MotorNB` subscription, and whether the login-issued `sess_map` cookie must be echoed on the motor calls. Verify on UAT that the existing subscription actually authorizes the `MotorAPI` context (a real GetQuote returns 200, not a 403/subscription error) before cutover; if it needs a separate key/cookie, extend `config.ts`/`auth.ts` in a follow-on.
- Motor JSON **error-response envelope** — **no JSON error sample exists in the kit**; `assertFgSuccess` is modeled on the SOAP-era failure shape (per-block `Status` + `Error`/`ErrorMessage`). If FG's JSON error envelope differs (e.g. a flat `{ errorCode, message }` with no block `Status`), the failure will slip through undetected as a false success. Capture a **real JSON error** from UAT (e.g. force a declined RTO/MMV) and add defensive detection for its actual shape then.
- **FuelType format** — the kit JSON samples send the full word `"PETROL"`, but this plan keeps the existing `FUEL_MAP` (coded `"P"`) unchanged per the locked scope; Task 4 Step 1(g) pins the emitted `Vehicle.FuelType` to `"P"` so the decision is explicit and reversible in one place. This coded value **must be validated against live `MotorAPI` UAT before cutover** — if MotorAPI only accepts the full word, every quote is rejected; flip `FUEL_MAP` to the full words and re-pin the test (intel §10 #6).
- **CV / Passenger JSON** — only PVT car (F13/FPV) has rebranded JSON samples; GCV/PCV JSON endpoints + samples are still pending from GCI (§2.6).
- **Production hosts** for motor API + token (kit is UAT-only); whether the `-internal-` gateway is externally reachable / needs IP whitelisting.
```

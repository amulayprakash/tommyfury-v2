# FG CKYC Touch-ups (Generali Central rebrand) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the small, isolated FG CKYC (`GCKYC/3.0.0`) work left by the Future Generali → Generali Central rebrand: make the CKYC host env-verifiable (not hardcoded), implement the new `UploadDocBytes` document-upload API (replacing the `initiateOvd` 501 stub), and produce a self-hosted CKYC redirect bridge with no external CDN.

**Architecture:** FG's CKYC lives in `tf-api/src/providers/fg/ckyc.ts` (raw `fetch`, its own WSO2 product token cache key `fg-ckyc:default`, optional `Token` subscription header). `VerifyCKYC` and `GetKycStatus` are already live-verified and MUST NOT change. We add a third function `fgUploadDocBytes` in the same module, wire it into `FgProvider.initiateOvd` through the existing `KycCapableProvider` OVD path (`kyc.service.ts` → `requireOperation(provider, "ovd")`), extend the canonical KYC contract (`src/contracts/kyc.ts`) with the `proposalId` correlation key, and add a pure HTML-builder module for the redirect bridge. The CKYC host stays a config/env value with an operator live-verification script — no host is hardcoded, and the `futuregenerali.in` fallback capability is preserved.

**Tech Stack:** Express + TypeScript (ESM, explicit `.ts` import extensions, `@/*` → `src/*` alias), zod contracts, Vitest (node env), Prisma/MySQL (not touched here), `tsx` for scripts. Tests use fixture JSON inlined in the spec of `ckyc.test.ts` via a stubbed global `fetch` — no live vendor calls.

---

## Execution ordering (cross-plan — read before starting)

This plan is part of the FG → Generali Central migration and shares files with sibling plans. See `docs/superpowers/plans/2026-07-22-fg-migration-execution-order.md` for the full coordination matrix. Key constraints:

- **This plan runs AFTER motor and payment** (recommended order: motor → payment → **ckyc** → renewal → masters). It mutates `src/contracts/kyc.ts` and regenerates `openapi.json` + the tf-web bindings — the same generated files the renewal plan touches.
- **Reconcile pre-existing uncommitted changes FIRST.** The working tree already carries unrelated uncommitted edits to `src/contracts/kyc.ts` and `openapi/openapi.json`. Commit or stash those **before** editing `kyc.ts` in Task 2, so this plan's diff stays clean and its `openapi:gen` doesn't entangle the unrelated diff into an FG commit.
- **The final `openapi:gen` + `gen:api` happen ONCE, after BOTH this and the renewal plan land.** CKYC and renewal both flow their contract changes into the same generated `openapi.json` / `vendor-api.d.ts`. Treat this plan's Task 3 regeneration as **provisional** — the last contract-changing plan (renewal) performs the single authoritative `npm run openapi:gen` (tf-api) + `npm run gen:api` (tf-web) that captures both. Never regenerate with another plan's contract edits half-applied.
- **Apply the `env.ts` / `config.ts` edits by MATCHING THE QUOTED BLOCK TEXT, not the stated line numbers.** Line numbers drift as sibling plans land; the anchored code blocks below are the source of truth.

---

## Background facts (encode these; do not re-derive)

Source intel: `tf-api/docs/fg-rebranding-notes.md` §3 (CKYC) + §9 (creds). Kit docs: `dock boyz/FG API Kit/TCS Motor API KIT - JSON Latest Revised Rebranding/…/TCS Motor KIT - JSON/CKYC Process docs & latest API/` (`FGI-CKYC-API-DOC.docx`, `GC-CKYCAPI URL UAT - OTP For Normal Partner.postman_collection.json`, `fg_kyc_redirection bnets 3.html`).

- **Product/endpoints (unchanged):** `GCKYC/3.0.0`, POST, headers `Content-Type: application/json`, `accept: */*`, `Authorization: Bearer <token>`, plus optional static `Token: <subscriptionToken>` header.
  - `…/GCKYC/3.0.0/Web/VerifyCKYC` — already implemented (`fgVerifyCkyc`). DO NOT CHANGE.
  - `…/GCKYC/3.0.0/Verify/GetKycStatus` — already implemented (`fgGetCkycStatus`). DO NOT CHANGE.
  - `…/GCKYC/3.0.0/Verify/UploadDocBytes` — **NEW**, this plan.
  - A prod postman shows a `GCKYC/2.1.0` variant at `apigw.generalicentralinsurance.com`. **Do NOT change the version blindly** — listed as an open confirmation only.
- **CKYC host caveat (critical):** The live `.env` (line 35) currently sets `FG_CKYC_BASE_URL=https://uat-internal-apigw.futuregenerali.in:8243/GCKYC/3.0.0` (the **futuregenerali.in** host). The `env.ts` **default** is already `…generalicentralinsurance.com…:8243/GCKYC/3.0.0`. Project memory records that the **live-verified working UAT CKYC host was `futuregenerali.in`**, not the rebranded host. Therefore repointing is a **config/env change gated by a verification step** (mint a CKYC-product token → call `VerifyCKYC` → expect HTTP 200), **never a hardcode**, and the operator confirms which host answers on UAT before flipping `.env`. The `futuregenerali.in` fallback capability must NOT be deleted (it stays reachable by simply setting the env var).
- **UploadDocBytes request** (exact, from `FGI-CKYC-API-DOC.docx` §4):
  ```json
  { "req_id": "1212312312", "proposal_id": "2132323232", "doc_type": "pdf", "doc_base64": "JVBERi0xLjQK…" }
  ```
  `doc_type` accepted values seen: `"pdf"` (request example) / `"aadhar"` (response echo). Kept configurable; the exact enum is an open confirmation.
- **UploadDocBytes response** (exact, success example from the doc):
  ```json
  {
    "extracted_data": { "name": "BIRESHWAR", "dob": "17-01-2001", "aadhar_id": "", "gender": "",
      "address": "DETAILS C-38/…", "address_details": { "State": "", "City": "", "PIN": "" },
      "aadhar_masked_no": "", "father_spouse_name": "" },
    "doc_type": "aadhar", "image_quality": "good", "req_id": "1212312312",
    "success": true, "error_message": "",
    "verify_data": { "status": false, "code": 422, "message": "Invalid Aadhaar Number" },
    "proposal_id": "2132323232"
  }
  ```
  Semantics: `success` = document recognition/extraction succeeded; `verify_data.status` (boolean) = whether the document actually **verified** (`false` + `code: 422` = rejected). The **CKYC number is NOT returned here** — after a verified upload the caller polls `GetKycStatus` (`finalStatus` `1` or `3` = success) for the number. So OVD success = `success === true && verify_data.status === true`.
- **Redirect bridge** (vendor `fg_kyc_redirection bnets 3.html`): auto-submitting `<form method="post">` whose `action` is the eKYC portal access URL (`https://ekyc-uat.fggeneral.in/kyc-v2-verification?access=<token>` — this is exactly `VerifyCKYC` `response.url`), carrying hidden fields `VISoF_KYC_Req_No` (= proposal_id), `IC_KYC_No` (= proposal_id), and `VISoF_Return_URL` (= our return URL; the vendor sample is a placeholder). The vendor page loads **jQuery from Google CDN** (`ajax.googleapis.com`) — under our CSP that is blocked, so we build a **self-hosted vanilla-JS** version.
- **Correlation key:** `proposal_id` (`PR_xxx`) threads `VerifyCKYC` → redirect/upload → `GetKycStatus`. There is no query-param callback of the CKYC number.

---

## File Structure

**Modified**

- `tf-api/src/config/env.ts` — document the two candidate CKYC hosts + caveat on `FG_CKYC_BASE_URL`; add `FG_CKYC_RETURN_URL` (Task 4).
- `tf-api/src/providers/fg/config.ts` — add `"ovd"` to `FG_BASE_OPERATIONS`; add `returnUrl?` to `FgProductAuth` and populate `ckyc.returnUrl` from env.
- `tf-api/src/providers/fg/ckyc.ts` — make the private `postJson` generic (type-only, no behaviour change); add `fgUploadDocBytes` + `fgCkycDocType` + their request/response/result types. (VerifyCKYC / GetKycStatus logic untouched.)
- `tf-api/src/providers/fg/fg.provider.ts` — replace the `initiateOvd` 501 stub with a real UploadDocBytes call; extend the ckyc.ts import.
- `tf-api/src/contracts/kyc.ts` — add `proposalId` to `OvdRequestSchema` (input correlation key) and to `OvdResultSchema` (echo).
- `tf-api/src/providers/fg/__tests__/ckyc.test.ts` — add `FG UploadDocBytes` + provider-wiring tests (inline fixtures, matching the file's existing style).

**Created**

- `tf-api/src/providers/fg/ckyc-redirect-bridge.ts` — pure `buildKycRedirectHtml()` builder (no external CDN).
- `tf-api/src/providers/fg/__tests__/ckyc-redirect-bridge.test.ts` — asserts no external CDN + correct hidden fields/action/auto-submit.
- `tf-api/scripts/verify-fg-ckyc-host.ts` — OPERATOR-RUN live host-verification script (never in CI; commits no secrets).

**Regenerated (Task 3, no hand edits)**

- `tf-api/openapi/openapi.json` via `npm run openapi:gen`.
- `tf-web/src/lib/api/generated/vendor-api.d.ts` via `npm run gen:api` (run in `tf-web`).

**Not touched:** `VerifyCKYC`/`GetKycStatus` request/response handling; token-manager; the `fg-ckyc:default` cache key; any motor/renewal/health/payment code.

---

## Task 1: CKYC host — env-verifiable repoint (config + operator script, NO hardcode)

**Files:**
- Create: `tf-api/scripts/verify-fg-ckyc-host.ts`
- Modify: `tf-api/src/config/env.ts:59-69` (comment on `FG_CKYC_BASE_URL`)

> This task ships **no vitest test** — it is a config-doc change plus a **live, operator-run** verification script (the spec's required "mint token + call VerifyCKYC and confirm 200" step). The script must never run in CI and commits no secrets. Verification = the operator running it against each candidate host.

- [ ] **Step 1: Document the caveat on `FG_CKYC_BASE_URL` in `env.ts`**

Replace the existing comment block above `FG_CKYC_BASE_URL` (`tf-api/src/config/env.ts`, currently lines 59-63):

```ts
  // ── FG CKYC (GCKYC/3.0.0) — separate WSO2 product (own client subscription) ──
  /** CKYC gateway base (e.g. …/GCKYC/3.0.0). */
  FG_CKYC_BASE_URL: z
    .string()
    .default("https://uat-internal-apigw.generalicentralinsurance.com:8243/GCKYC/3.0.0"),
```

with:

```ts
  // ── FG CKYC (GCKYC/3.0.0) — separate WSO2 product (own client subscription) ──
  /**
   * CKYC gateway base (…/GCKYC/3.0.0). ENV-DRIVEN — never hardcode the host.
   * Two UAT candidates exist post-rebrand and only ONE answers on UAT:
   *   - rebranded (default here): uat-internal-apigw.generalicentralinsurance.com:8243/GCKYC/3.0.0
   *   - legacy/live-verified:     uat-internal-apigw.futuregenerali.in:8243/GCKYC/3.0.0
   * Memory records the live-verified working UAT CKYC host as futuregenerali.in,
   * so the current live .env points there. Before flipping .env to the rebranded
   * host, the operator MUST confirm which one answers:
   *   npx tsx --env-file=.env scripts/verify-fg-ckyc-host.ts
   *   npx tsx --env-file=.env scripts/verify-fg-ckyc-host.ts --host <candidate>
   * The legacy host stays reachable simply by setting this env var — do not
   * remove that capability.
   */
  FG_CKYC_BASE_URL: z
    .string()
    .default("https://uat-internal-apigw.generalicentralinsurance.com:8243/GCKYC/3.0.0"),
```

- [ ] **Step 2: Create the operator verification script**

Create `tf-api/scripts/verify-fg-ckyc-host.ts`:

```ts
/**
 * OPERATOR-RUN, LIVE. Not a vitest test — never runs in CI, commits no secrets.
 * Confirms which UAT CKYC host actually answers before flipping FG_CKYC_BASE_URL.
 *
 * Reads creds from process.env (populate .env first). Usage from tf-api/:
 *   npx tsx --env-file=.env scripts/verify-fg-ckyc-host.ts
 *   npx tsx --env-file=.env scripts/verify-fg-ckyc-host.ts \
 *     --host https://uat-internal-apigw.futuregenerali.in:8243/GCKYC/3.0.0
 *
 * Mints a CKYC-product token (WSO2 password grant) then POSTs VerifyCKYC. HTTP
 * 200 (apiStatus Success/Failed) => the host answers; connection error / 404 =>
 * it does not. Compare both candidates, then set FG_CKYC_BASE_URL in .env to the
 * one that answers. Do NOT hardcode the host in source.
 *
 * CKYC-specific resource-owner creds: intel §9 lists distinct CKYC UAT creds
 * (GCCKYC_Dev / GCKYC@dev26) separate from the shared motor FG_USERNAME/FG_PASSWORD.
 * If the CKYC WSO2 product rejects the shared creds (mint 401s), probe with the
 * §9 creds by setting FG_CKYC_USERNAME / FG_CKYC_PASSWORD in .env — they override
 * FG_USERNAME / FG_PASSWORD here and nowhere else.
 */
const hostArg = process.argv.indexOf("--host");
const baseUrl = (hostArg > -1 ? process.argv[hostArg + 1] : process.env.FG_CKYC_BASE_URL)?.replace(/\/$/, "");
const tokenUrl = process.env.FG_CKYC_TOKEN_URL ?? process.env.FG_TOKEN_URL;
const basic = process.env.FG_CKYC_CLIENT_BASIC ?? process.env.FG_CLIENT_BASIC;
const username = process.env.FG_CKYC_USERNAME ?? process.env.FG_USERNAME;
const password = process.env.FG_CKYC_PASSWORD ?? process.env.FG_PASSWORD;
const subToken = process.env.FG_CKYC_SUBSCRIPTION_TOKEN;
const systemName = process.env.FG_VENDOR_CODE ?? "Webagg";

if (!baseUrl || !tokenUrl || !basic || !username || !password) {
  console.error(
    "Missing env. Need FG_CKYC_BASE_URL (or --host), FG_CKYC_TOKEN_URL/FG_TOKEN_URL, " +
      "FG_CKYC_CLIENT_BASIC/FG_CLIENT_BASIC, and resource-owner creds " +
      "(FG_CKYC_USERNAME/FG_USERNAME + FG_CKYC_PASSWORD/FG_PASSWORD).",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  console.log(`[verify] token host : ${tokenUrl}`);
  const tokenRes = await fetch(tokenUrl!, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", username: username!, password: password! }),
  });
  const tokenText = await tokenRes.text();
  console.log(`[verify] token status: ${tokenRes.status}`);
  if (!tokenRes.ok) {
    console.error(tokenText.slice(0, 400));
    process.exit(1);
  }
  const token = (JSON.parse(tokenText) as { access_token?: string }).access_token;
  if (!token) {
    console.error("No access_token in token response");
    process.exit(1);
  }

  const url = `${baseUrl}/Web/VerifyCKYC`;
  console.log(`[verify] VerifyCKYC   : ${url}`);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "*/*",
    Authorization: `Bearer ${token}`,
  };
  if (subToken) headers.Token = subToken;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      req_id: `VERIFY_${Date.now()}`,
      proposal_id: "",
      id_type: "PAN",
      id_num: "AYDPM5057B",
      dob: "14-01-1989",
      mobile: "",
      otp: "",
      full_name: "GANESH MISAL",
      gender: "M",
      url_type: "",
      customer_type: "I",
      redirect_url: "",
      system_name: systemName,
    }),
  });
  const body = await res.text();
  console.log(`[verify] VerifyCKYC status: ${res.status}`);
  console.log(body.slice(0, 600));
  console.log(
    res.ok
      ? "[verify] HOST ANSWERS — safe to point FG_CKYC_BASE_URL here after review."
      : "[verify] host did NOT return 200 — try the other candidate host.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck (the only automated check for this task)**

Run: `cd tf-api && npm run typecheck`
Expected: PASS (no type errors introduced by the new script or the comment change).

- [ ] **Step 4: Operator live-verification (MANUAL — do not automate, do not run in CI)**

With a populated `.env`, the operator runs both candidates and records which returns HTTP 200:

```bash
cd tf-api
npx tsx --env-file=.env scripts/verify-fg-ckyc-host.ts
npx tsx --env-file=.env scripts/verify-fg-ckyc-host.ts --host https://uat-internal-apigw.futuregenerali.in:8243/GCKYC/3.0.0
```

Expected: exactly one prints `HOST ANSWERS`. The operator then sets `FG_CKYC_BASE_URL` in `.env` to that host (a config change — no source edit). If the answering host is `futuregenerali.in`, `.env` keeps line 35 as-is. **`.env` is never committed.**

- [ ] **Step 5: Commit (code + docs only, no secrets)**

```bash
cd tf-api
git add src/config/env.ts scripts/verify-fg-ckyc-host.ts
git commit -m "chore(fg-ckyc): document CKYC host caveat + add operator host-verification script"
```

---

## Task 2: Implement `UploadDocBytes` (mapper + normalizer + provider wiring)

**Files:**
- Modify: `tf-api/src/contracts/kyc.ts` (add `proposalId` to `OvdRequestSchema` + `OvdResultSchema`)
- Modify: `tf-api/src/providers/fg/ckyc.ts` (generic `postJson`; add `fgUploadDocBytes` + `fgCkycDocType` + types)
- Modify: `tf-api/src/providers/fg/config.ts` (add `"ovd"` to `FG_BASE_OPERATIONS`)
- Modify: `tf-api/src/providers/fg/fg.provider.ts` (real `initiateOvd`; extend ckyc.ts import)
- Test: `tf-api/src/providers/fg/__tests__/ckyc.test.ts`

- [ ] **Step 1: Add the contract fields UploadDocBytes needs**

In `tf-api/src/contracts/kyc.ts`, add `proposalId` to `OvdRequestSchema`. Replace:

```ts
export const OvdRequestSchema = z.object({
  transactionId: z.string().min(1),
  proofOfIdentityType: OvdDocTypeSchema,
  proofOfAddressType: OvdDocTypeSchema,
  policyType: z.enum(["motor", "health", "travel", "sme"]).default("motor"),
});
```

with:

```ts
export const OvdRequestSchema = z.object({
  transactionId: z.string().min(1),
  proofOfIdentityType: OvdDocTypeSchema,
  proofOfAddressType: OvdDocTypeSchema,
  policyType: z.enum(["motor", "health", "travel", "sme"]).default("motor"),
  /**
   * FG CKYC correlation key (`PR_xxx`) returned by VerifyCKYC. FG's UploadDocBytes
   * requires it to attach the document to the pending KYC case; other vendors ignore it.
   */
  proposalId: z.string().optional(),
});
```

And add `proposalId` to `OvdResultSchema`. Replace:

```ts
export const OvdResultSchema = z.object({
  kycId: z.string().optional(),
  customerName: z.string().optional(),
  isKycSuccess: z.boolean(),
  /** Vendor's verbatim reason when the uploaded documents were rejected. */
  displayMessage: z.string().optional(),
  _rawResponse: z.unknown().optional(),
});
```

with:

```ts
export const OvdResultSchema = z.object({
  kycId: z.string().optional(),
  customerName: z.string().optional(),
  isKycSuccess: z.boolean(),
  /** Vendor's verbatim reason when the uploaded documents were rejected. */
  displayMessage: z.string().optional(),
  /** FG CKYC proposal id echoed back so the caller can poll GetKycStatus for the number. */
  proposalId: z.string().optional(),
  _rawResponse: z.unknown().optional(),
});
```

- [ ] **Step 2: Write the failing test (UploadDocBytes function + provider wiring)**

Append to `tf-api/src/providers/fg/__tests__/ckyc.test.ts`. First extend the top-of-file import (currently `import { fgVerifyCkyc, fgGetCkycStatus } from "../ckyc.ts";`) to:

```ts
import { fgVerifyCkyc, fgGetCkycStatus, fgUploadDocBytes, fgCkycDocType } from "../ckyc.ts";
import type { OvdRequest, OvdFile } from "@/contracts/kyc.ts";
```

Then append these describe blocks at the end of the file:

```ts
describe("FG UploadDocBytes", () => {
  it("posts {req_id, proposal_id, doc_type, doc_base64} to /Verify/UploadDocBytes", async () => {
    const fetchMock = mockFetch({
      extracted_data: { name: "BIRESHWAR", dob: "17-01-2001", address: "C-38 …" },
      doc_type: "aadhar",
      image_quality: "good",
      req_id: "REQ_1",
      success: true,
      error_message: "",
      verify_data: { status: true, code: 200, message: "" },
      proposal_id: "PR_OX61LYNZVO",
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await fgUploadDocBytes(
      config,
      { reqId: "REQ_1", proposalId: "PR_OX61LYNZVO", docType: "pdf", docBase64: "JVBERi0=" },
      "tok",
    );

    const calls = (fetchMock as unknown as { mock: { calls: [string, { body: string; headers: Record<string, string> }][] } }).mock.calls;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://uat.example.com:8243/GCKYC/3.0.0/Verify/UploadDocBytes");
    expect(init.headers.Token).toBe("sub-token");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      req_id: "REQ_1",
      proposal_id: "PR_OX61LYNZVO",
      doc_type: "pdf",
      doc_base64: "JVBERi0=",
    });
    expect(r.isVerified).toBe(true);
    expect(r.extractedName).toBe("BIRESHWAR");
    expect(r.imageQuality).toBe("good");
    expect(r.proposalId).toBe("PR_OX61LYNZVO");
  });

  it("treats a rejected document (verify_data.status false, code 422) as not verified", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        extracted_data: { name: null },
        doc_type: "aadhar",
        image_quality: null,
        req_id: "REQ_2",
        success: true,
        error_message: "",
        verify_data: { status: false, code: 422, message: "Invalid Aadhaar Number" },
        proposal_id: "PR_2",
      }),
    );
    const r = await fgUploadDocBytes(
      config,
      { reqId: "REQ_2", proposalId: "PR_2", docType: "aadhar", docBase64: "AAAA" },
      "tok",
    );
    expect(r.isVerified).toBe(false);
    expect(r.message).toBe("Invalid Aadhaar Number");
    expect(r.proposalId).toBe("PR_2");
  });

  it("fgCkycDocType maps pdf mime to 'pdf' and Aadhaar image to 'aadhar'", () => {
    expect(fgCkycDocType("application/pdf", "AADHAAR")).toBe("pdf");
    expect(fgCkycDocType("image/jpeg", "AADHAAR")).toBe("aadhar");
    expect(fgCkycDocType("image/png", "PAN")).toBe("pan");
  });
});

describe("FgProvider.initiateOvd", () => {
  const ovdReq: OvdRequest = {
    transactionId: "0000771450",
    proofOfIdentityType: "AADHAAR",
    proofOfAddressType: "AADHAAR",
    policyType: "motor",
    proposalId: "PR_OX61LYNZVO",
  } as OvdRequest;

  const file: OvdFile = {
    fieldName: "proofOfIdentity",
    originalName: "aadhaar.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("hello-doc"),
  };

  it("uploads the document base64 and maps a verified result to isKycSuccess", async () => {
    const fetchMock = mockFetch({
      extracted_data: { name: "John Doe" },
      doc_type: "aadhar",
      image_quality: "good",
      req_id: "test",
      success: true,
      error_message: "",
      verify_data: { status: true, code: 200, message: "" },
      proposal_id: "PR_OX61LYNZVO",
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new FgProvider({ config, ckycTokenProvider: async () => "tok" });
    const r = await provider.initiateOvd(ovdReq, [file], { requestId: "test" } as ProviderContext);

    const calls = (fetchMock as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://uat.example.com:8243/GCKYC/3.0.0/Verify/UploadDocBytes");
    const sent = JSON.parse(init.body);
    expect(sent.proposal_id).toBe("PR_OX61LYNZVO");
    expect(sent.doc_type).toBe("pdf");
    expect(sent.doc_base64).toBe(Buffer.from("hello-doc").toString("base64"));
    expect(r.isKycSuccess).toBe(true);
    expect(r.customerName).toBe("John Doe");
    expect(r.proposalId).toBe("PR_OX61LYNZVO");
    expect(r.kycId).toBe("PR_OX61LYNZVO");
  });

  it("rejects when the CKYC proposalId is missing", async () => {
    const provider = new FgProvider({ config, ckycTokenProvider: async () => "tok" });
    await expect(
      provider.initiateOvd({ ...ovdReq, proposalId: undefined } as OvdRequest, [file], {
        requestId: "test",
      } as ProviderContext),
    ).rejects.toThrow(/proposalId/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/ckyc.test.ts`
Expected: FAIL — `fgUploadDocBytes`/`fgCkycDocType` are not exported from `../ckyc.ts` (and `initiateOvd` still throws 501 / `proposalId` unknown), e.g. `"fgUploadDocBytes" is not exported` or `AppError 501`.

- [ ] **Step 4: Make `postJson` generic (type-only) and add `fgUploadDocBytes` + `fgCkycDocType`**

In `tf-api/src/providers/fg/ckyc.ts`, change the `postJson` signature so it can return the upload shape without touching VerifyCKYC behaviour. Replace:

```ts
async function postJson(url: string, token: string, subscriptionToken: string | undefined, body: unknown) {
```

with:

```ts
async function postJson<T = VerifyCkycResponse>(
  url: string,
  token: string,
  subscriptionToken: string | undefined,
  body: unknown,
): Promise<T> {
```

and change its final parse-return from:

```ts
  try {
    return JSON.parse(text) as VerifyCkycResponse;
  } catch {
```

to:

```ts
  try {
    return JSON.parse(text) as T;
  } catch {
```

(The existing `fgVerifyCkyc` call `await postJson(...)` still infers `T = VerifyCkycResponse` via the default — no behaviour change.)

Then append to the end of `ckyc.ts`:

```ts
// ─── UploadDocBytes (GCKYC/3.0.0 /Verify/UploadDocBytes) ──────────────────────
// Manual document-upload path for the CKYC-miss case where the redirect URL is
// unusable: POST a base64 document; Arya OCR extracts + verifies it. The CKYC
// number is NOT returned here — poll GetKycStatus (finalStatus 1 or 3) after a
// verified upload. Spec: FGI-CKYC-API-DOC.docx §4 UploadDocBytes.

export interface FgUploadDocRequest {
  /** Unique request id for this upload (we pass the provider requestId). */
  reqId: string;
  /** VerifyCKYC proposal_id (`PR_xxx`) the document is attached to. */
  proposalId: string;
  /** Document kind hint — "pdf" (file is a PDF) or an ID type like "aadhar". */
  docType: string;
  /** Base64 of the document bytes (no data: prefix). */
  docBase64: string;
}

interface UploadDocResponse {
  extracted_data?:
    | ({
        name?: string | null;
        dob?: string | null;
        aadhar_id?: string | null;
        gender?: string | null;
        address?: string | null;
        aadhar_masked_no?: string | null;
        father_spouse_name?: string | null;
      } & Record<string, unknown>)
    | null;
  doc_type?: string;
  image_quality?: string | null;
  req_id?: string;
  success?: boolean;
  error_message?: string | null;
  verify_data?: { status?: boolean; code?: number; message?: string | null } | null;
  proposal_id?: string;
}

export interface FgUploadDocResult {
  /** True only when recognition AND verification both passed. */
  isVerified: boolean;
  extractedName?: string;
  imageQuality?: string;
  proposalId?: string;
  message?: string;
  raw: unknown;
}

/** Chooses FG's `doc_type` from the uploaded file's mime + declared ID type. */
export function fgCkycDocType(mimeType: string, idType: string): string {
  if (mimeType === "application/pdf") return "pdf";
  return idType === "AADHAAR" ? "aadhar" : idType.toLowerCase();
}

/** Uploads one document to FG's CKYC OCR/verify endpoint and maps the outcome. */
export async function fgUploadDocBytes(
  config: FgConfig,
  req: FgUploadDocRequest,
  token: string,
): Promise<FgUploadDocResult> {
  const json = await postJson<UploadDocResponse>(
    `${config.ckyc.baseUrl}/Verify/UploadDocBytes`,
    token,
    config.ckyc.subscriptionToken,
    {
      req_id: req.reqId,
      proposal_id: req.proposalId,
      doc_type: req.docType,
      doc_base64: req.docBase64,
    },
  );

  const isVerified = json.success === true && json.verify_data?.status === true;
  return {
    isVerified,
    extractedName: json.extracted_data?.name ?? undefined,
    imageQuality: json.image_quality ?? undefined,
    proposalId: json.proposal_id ?? req.proposalId,
    message: json.error_message || json.verify_data?.message || undefined,
    raw: json,
  };
}
```

- [ ] **Step 5: Declare the `ovd` operation on FG**

In `tf-api/src/providers/fg/config.ts`, replace the comment **and** the array in one edit (the comment above `FG_BASE_OPERATIONS` is now stale — it omits the newly-wired `ovd`). Replace:

```ts
/**
 * Quote, proposal, CKYC and issuance are wired. policyStatus / COI remain
 * deferred — declaring an operation here without an implementation would make
 * the capability type-guards lie (see insurance-provider.ts).
 */
const FG_BASE_OPERATIONS: ProviderOperation[] = [
  "quote",
  "proposal",
  "ckyc",
  "issuance",
  "renewal",
  "inspection",
];
```

with:

```ts
/**
 * Quote, proposal, CKYC, OVD (UploadDocBytes) and issuance are wired.
 * policyStatus / COI remain deferred — declaring an operation here without an
 * implementation would make the capability type-guards lie (see
 * insurance-provider.ts).
 */
const FG_BASE_OPERATIONS: ProviderOperation[] = [
  "quote",
  "proposal",
  "ckyc",
  "ovd",
  "issuance",
  "renewal",
  "inspection",
];
```

(`kyc.service.initiateOvd` calls `requireOperation(provider, "ovd")`; now that `initiateOvd` is implemented, declaring the op no longer makes the capability guard lie.)

- [ ] **Step 6: Replace the `initiateOvd` 501 stub in the provider**

In `tf-api/src/providers/fg/fg.provider.ts`, extend the ckyc import. Replace:

```ts
import { fgVerifyCkyc, fgGetCkycStatus } from "./ckyc.ts";
```

with:

```ts
import { fgVerifyCkyc, fgGetCkycStatus, fgUploadDocBytes, fgCkycDocType } from "./ckyc.ts";
```

Then replace the whole `initiateOvd` method:

```ts
  initiateOvd(_req: OvdRequest, _files: OvdFile[], _ctx: ProviderContext): Promise<OvdResult> {
    // FG has no document-upload API; manual KYC is a hosted redirect surfaced by
    // completeCkyc (KycResult.redirectUrl). "ovd" is not in FG_OPERATIONS.
    throw new AppError(501, "FG does not support OVD document upload", "NOT_IMPLEMENTED");
  }
```

with:

```ts
  async initiateOvd(req: OvdRequest, files: OvdFile[], ctx: ProviderContext): Promise<OvdResult> {
    // FG's manual-KYC document upload (GCKYC/3.0.0 UploadDocBytes) — used when the
    // redirect URL cannot be shown. The document is attached to the pending CKYC
    // case via its VerifyCKYC proposalId; the CKYC number arrives later via
    // GetKycStatus, so a verified upload just unblocks that poll.
    const file = files.find((f) => f.fieldName === "proofOfIdentity") ?? files[0];
    if (!file) {
      throw new AppError(422, "FG CKYC document upload requires a document file", "OVD_FILE_REQUIRED");
    }
    if (!req.proposalId) {
      throw new AppError(
        422,
        "FG CKYC document upload requires the CKYC proposalId from VerifyCKYC",
        "OVD_PROPOSAL_REQUIRED",
      );
    }
    // Derive doc_type from the CHOSEN file's role, not always proofOfIdentity: the
    // fallback (files[0]) can be the proofOfAddress file, whose declared kind is
    // proofOfAddressType — using proofOfIdentityType there would mislabel the doc.
    const idType =
      file.fieldName === "proofOfAddress" ? req.proofOfAddressType : req.proofOfIdentityType;
    const result = await this.withAuthRetry(this.ckycToken, (token) =>
      fgUploadDocBytes(
        this.config,
        {
          reqId: ctx.requestId,
          proposalId: req.proposalId!,
          docType: fgCkycDocType(file.mimeType, idType),
          docBase64: file.buffer.toString("base64"),
        },
        token,
      ),
    );
    return {
      kycId: result.proposalId,
      proposalId: result.proposalId,
      customerName: result.extractedName,
      isKycSuccess: result.isVerified,
      displayMessage: result.message,
      _rawResponse: result.raw,
    };
  }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/ckyc.test.ts`
Expected: PASS — all `FG VerifyCKYC`, `FG GetKycStatus`, `FG token 401 retry`, `FG UploadDocBytes`, and `FgProvider.initiateOvd` cases green.

- [ ] **Step 8: Commit**

```bash
cd tf-api
git add src/contracts/kyc.ts src/providers/fg/ckyc.ts src/providers/fg/config.ts src/providers/fg/fg.provider.ts src/providers/fg/__tests__/ckyc.test.ts
git commit -m "feat(fg-ckyc): implement UploadDocBytes and wire it into initiateOvd"
```

---

## Task 3: Regenerate OpenAPI + tf-web bindings for the new CKYC OVD fields

**Files:**
- Regenerate: `tf-api/openapi/openapi.json` (via `npm run openapi:gen` — do not hand-edit)
- Regenerate (in tf-web): `tf-web/src/lib/api/generated/vendor-api.d.ts` (via `npm run gen:api` — do not hand-edit)

> The kyc.ts contract changed in Task 2 (`OvdRequest.proposalId`, `OvdResult.proposalId`), so the generated OpenAPI doc and the tf-web typed bindings must be regenerated to stay in sync (per CLAUDE.md: after changing any `src/contracts/`, run `openapi:gen` then `gen:api`).
>
> **Provisional regen (cross-plan):** per the "Execution ordering" note above and `docs/superpowers/plans/2026-07-22-fg-migration-execution-order.md`, the renewal plan also mutates `src/contracts` and flows into the **same** `openapi.json` / `vendor-api.d.ts`. Treat this task's regeneration as provisional — the single authoritative `npm run openapi:gen` (tf-api) + `npm run gen:api` (tf-web) is run **once** by whichever of {this, renewal} lands **last**. If renewal has not yet landed, this regen is a checkpoint, not the final artifact; do not treat a later re-regen as a conflict.

- [ ] **Step 1: Regenerate the OpenAPI document**

Run: `cd tf-api && npm run openapi:gen`
Expected: exits 0; `tf-api/openapi/openapi.json` updated.

- [ ] **Step 2: Verify the new fields landed in the OpenAPI doc**

Do **not** use `grep -c proposalId` — that is a false positive: `proposalId` already appears in the `KycResult` schema + `/kyc` path response *before* this change (baseline count is 2), so a bare count passes even if the OVD regen silently failed. Anchor the check to the `OvdResult` schema specifically:

Run: `cd tf-api && node -e "const s=require('./openapi/openapi.json').components.schemas; process.exit(s.OvdResult && s.OvdResult.properties.proposalId ? 0 : 1)"`
Expected: exits 0 — the `OvdResult` schema block itself gained the `proposalId` property. Non-zero exit means the regen didn't pick up the Task 2 `kyc.ts` edits; re-check them and rerun Step 1.

(Equivalently, assert the total count rose: `grep -c proposalId openapi/openapi.json` should now report **≥ 4** — the pre-existing 2 plus one each on the OVD request body and `OvdResult`. A bare "≥ 1" cannot detect a failed OvdRequest/OvdResult regen.)

- [ ] **Step 3: Regenerate the tf-web bindings**

Run: `cd tf-web && npm run gen:api`
Expected: exits 0; `tf-web/src/lib/api/generated/vendor-api.d.ts` regenerated from `../tf-api/openapi/openapi.json`.

- [ ] **Step 4: Typecheck tf-web (bindings still compile against consumers)**

Run: `cd tf-web && npm run typecheck`
Expected: PASS. (The added fields are optional, so existing OVD callers are unaffected; this just confirms the regenerated `.d.ts` is consistent.)

- [ ] **Step 5: Commit (both repos' generated artifacts)**

```bash
cd tf-api && git add openapi/openapi.json && git commit -m "chore(openapi): regenerate for CKYC OVD proposalId fields"
cd ../tf-web && git add src/lib/api/generated/vendor-api.d.ts && git commit -m "chore(gen:api): regenerate vendor bindings for CKYC OVD proposalId fields"
```

---

## Task 4: Self-hosted CKYC redirect bridge (no external CDN)

**Files:**
- Create: `tf-api/src/providers/fg/ckyc-redirect-bridge.ts`
- Create: `tf-api/src/providers/fg/__tests__/ckyc-redirect-bridge.test.ts`
- Modify: `tf-api/src/config/env.ts` (add `FG_CKYC_RETURN_URL`)
- Modify: `tf-api/src/providers/fg/config.ts` (add `returnUrl?` to `FgProductAuth`; populate `ckyc.returnUrl`)

> The vendor `fg_kyc_redirection*.html` loads jQuery from `ajax.googleapis.com` and hardcodes a placeholder return URL — both blocked/wrong under our CSP. We ship a pure builder that emits an equivalent form with a vanilla-JS auto-submit and our real return URL. The eKYC access URL is exactly `VerifyCKYC` `response.url` (already surfaced as `KycResult.redirectUrl`); `proposalId` fills both `VISoF_KYC_Req_No` and `IC_KYC_No`.

- [ ] **Step 1: Write the failing test**

Create `tf-api/src/providers/fg/__tests__/ckyc-redirect-bridge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildKycRedirectHtml } from "../ckyc-redirect-bridge.ts";

const params = {
  actionUrl: "https://ekyc-uat.fggeneral.in/kyc-v2-verification?access=abc123",
  proposalId: "PR_4UT0K13BMJR",
  returnUrl: "https://app.example.com/vehicle/kyc/return",
};

describe("buildKycRedirectHtml", () => {
  it("loads no external CDN / no external script", () => {
    const html = buildKycRedirectHtml(params);
    expect(html).not.toMatch(/googleapis\.com/i);
    expect(html).not.toMatch(/jquery/i);
    // No <script src="..."> pulling anything remote.
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });

  it("sets the form action to the eKYC access URL", () => {
    const html = buildKycRedirectHtml(params);
    expect(html).toContain('action="https://ekyc-uat.fggeneral.in/kyc-v2-verification?access=abc123"');
    expect(html).toContain('method="post"');
  });

  it("emits the three hidden fields with the proposalId and our return URL", () => {
    const html = buildKycRedirectHtml(params);
    expect(html).toContain('name="VISoF_KYC_Req_No" value="PR_4UT0K13BMJR"');
    expect(html).toContain('name="IC_KYC_No" value="PR_4UT0K13BMJR"');
    expect(html).toContain('name="VISoF_Return_URL" value="https://app.example.com/vehicle/kyc/return"');
  });

  it("auto-submits the form and degrades to a button without JS", () => {
    const html = buildKycRedirectHtml(params);
    expect(html).toMatch(/\.submit\(\)/);
    expect(html).toMatch(/<noscript>/i);
  });

  it("HTML-escapes attribute values to prevent injection", () => {
    const html = buildKycRedirectHtml({
      ...params,
      proposalId: 'PR"><script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/ckyc-redirect-bridge.test.ts`
Expected: FAIL — module `../ckyc-redirect-bridge.ts` does not exist (`Cannot find module`).

- [ ] **Step 3: Implement the builder**

Create `tf-api/src/providers/fg/ckyc-redirect-bridge.ts`:

```ts
/**
 * Self-hosted CKYC redirect bridge. Replaces FG's vendor fg_kyc_redirection*.html
 * (which loads jQuery from Google's CDN — blocked under our CSP) with an
 * equivalent form that auto-submits via vanilla JS and carries OUR real return
 * URL. The form POSTs to the eKYC portal access URL that VerifyCKYC returns
 * (KycResult.redirectUrl); proposalId fills both VISoF_KYC_Req_No and IC_KYC_No.
 */

export interface KycRedirectParams {
  /** eKYC portal access URL from VerifyCKYC response.url (carries ?access=<token>). */
  actionUrl: string;
  /** VerifyCKYC proposal_id (PR_xxx) — used for VISoF_KYC_Req_No and IC_KYC_No. */
  proposalId: string;
  /** Absolute URL the eKYC portal returns the browser to (env FG_CKYC_RETURN_URL). */
  returnUrl: string;
}

/** Escapes a value for safe inclusion inside a double-quoted HTML attribute. */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Builds the self-hosted CKYC redirect HTML (no external CDN; vanilla-JS auto-submit). */
export function buildKycRedirectHtml(params: KycRedirectParams): string {
  const action = escapeHtmlAttr(params.actionUrl);
  const proposalId = escapeHtmlAttr(params.proposalId);
  const returnUrl = escapeHtmlAttr(params.returnUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redirecting to KYC portal…</title>
</head>
<body>
<p><strong>You are being redirected to the KYC portal.</strong></p>
<p>Please wait… (do not press Refresh or Back)</p>
<form id="kycRedirectionForm" method="post" action="${action}">
<input type="hidden" name="VISoF_KYC_Req_No" value="${proposalId}">
<input type="hidden" name="IC_KYC_No" value="${proposalId}">
<input type="hidden" name="VISoF_Return_URL" value="${returnUrl}">
<noscript><button type="submit">Continue to KYC</button></noscript>
</form>
<script>document.getElementById("kycRedirectionForm").submit();</script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/ckyc-redirect-bridge.test.ts`
Expected: PASS — all five cases green.

- [ ] **Step 5: Add the return-URL env var**

In `tf-api/src/config/env.ts`, immediately after the `FG_CKYC_SUBSCRIPTION_TOKEN` line (currently line 69), add:

```ts
  /** Absolute URL the eKYC portal returns the browser to after manual KYC (redirect bridge VISoF_Return_URL). */
  FG_CKYC_RETURN_URL: z.string().optional(),
```

- [ ] **Step 6: Thread the return URL through FG config**

In `tf-api/src/providers/fg/config.ts`, add `returnUrl` to the CKYC product-auth type. Replace:

```ts
/** Per-product gateway credentials (motor / CKYC / renewal each have their own). */
export interface FgProductAuth {
  baseUrl: string;
  tokenUrl: string;
  clientBasic: string;
  /** Optional static gateway subscription key (CKYC `Token` header). */
  subscriptionToken?: string;
}
```

with:

```ts
/** Per-product gateway credentials (motor / CKYC / renewal each have their own). */
export interface FgProductAuth {
  baseUrl: string;
  tokenUrl: string;
  clientBasic: string;
  /** Optional static gateway subscription key (CKYC `Token` header). */
  subscriptionToken?: string;
  /** CKYC-only: return URL for the self-hosted redirect bridge (VISoF_Return_URL). */
  returnUrl?: string;
}
```

And populate it in `loadFgConfig()`. Replace the `ckyc:` block:

```ts
    ckyc: {
      baseUrl: env.FG_CKYC_BASE_URL.replace(/\/$/, ""),
      tokenUrl: env.FG_CKYC_TOKEN_URL ?? env.FG_TOKEN_URL,
      clientBasic: env.FG_CKYC_CLIENT_BASIC ?? env.FG_CLIENT_BASIC!,
      subscriptionToken: env.FG_CKYC_SUBSCRIPTION_TOKEN,
    },
```

with:

```ts
    ckyc: {
      baseUrl: env.FG_CKYC_BASE_URL.replace(/\/$/, ""),
      tokenUrl: env.FG_CKYC_TOKEN_URL ?? env.FG_TOKEN_URL,
      clientBasic: env.FG_CKYC_CLIENT_BASIC ?? env.FG_CLIENT_BASIC!,
      subscriptionToken: env.FG_CKYC_SUBSCRIPTION_TOKEN,
      returnUrl: env.FG_CKYC_RETURN_URL,
    },
```

> **Call-site note (no code change here):** the bridge is a pure builder so it stays unit-testable. Whoever renders the manual-KYC step (a tf-api route serving `text/html`, or the tf-web KYC page) calls `buildKycRedirectHtml({ actionUrl: kycResult.redirectUrl, proposalId: kycResult.proposalId, returnUrl: config.ckyc.returnUrl })`. `KycResult` already carries `redirectUrl` + `proposalId` from `completeCkyc`. Wiring the HTTP surface is out of scope for these CKYC touch-ups and is tracked as an open item.

- [ ] **Step 7: Typecheck**

Run: `cd tf-api && npm run typecheck`
Expected: PASS (new env var + optional `returnUrl` field compile; nothing else references them yet).

- [ ] **Step 8: Commit**

```bash
cd tf-api
git add src/providers/fg/ckyc-redirect-bridge.ts src/providers/fg/__tests__/ckyc-redirect-bridge.test.ts src/config/env.ts src/providers/fg/config.ts
git commit -m "feat(fg-ckyc): self-hosted redirect bridge (no external CDN) + FG_CKYC_RETURN_URL"
```

---

## Task 5: Suite green + typecheck + final commit

**Files:** none (verification only)

- [ ] **Step 1: Run the full FG CKYC test file**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/ckyc.test.ts`
Expected: PASS — VerifyCKYC, GetKycStatus, token-401-retry, UploadDocBytes, and initiateOvd suites all green.

- [ ] **Step 2: Run the redirect-bridge test file**

Run: `cd tf-api && npx vitest run src/providers/fg/__tests__/ckyc-redirect-bridge.test.ts`
Expected: PASS.

- [ ] **Step 3: Typecheck the whole backend**

Run: `cd tf-api && npm run typecheck`
Expected: PASS (no `tsc --noEmit` errors).

- [ ] **Step 4: Lint the changed FG files**

Run: `cd tf-api && npm run lint`
Expected: PASS (no eslint errors in the touched files).

- [ ] **Step 5: Full backend test run (regression check — DB must be up for repository suites)**

Run: `cd tf-api && npm test`
Expected: PASS. If DB-backed suites are skipped/failing only due to no MySQL, that is pre-existing and unrelated to this change — the CKYC and redirect-bridge suites (which touch no DB) must pass regardless.

- [ ] **Step 6: Final commit (if lint/typecheck produced any fixups)**

```bash
cd tf-api
git add -A
git commit -m "chore(fg-ckyc): finalize CKYC touch-ups (tests green, typecheck + lint clean)" || echo "nothing to finalize"
```

---

## Open confirmations for FG/GCI (CKYC-specific — surface before go-live)

These are NOT blockers for this plan (the code is env-driven / defensively mapped), but must be confirmed with FG:

1. **CKYC host on UAT** — does `generalicentralinsurance.com` or `futuregenerali.in` actually answer? (Task 1 operator script decides; memory says the live-verified host was `futuregenerali.in`.)
2. **IP whitelisting** — the `-internal-` gateway hostnames suggest network restriction; confirm our egress IPs are allowed for CKYC.
3. **OAuth2 grant type** — CKYC docs show both `password` and `client_credentials`; current code uses `password` (per `fgProductTokenFetcher`). Confirm.
4. **`system_name` canonical value** — doc says pass `"Webagg"` for UAT redirect functionality; postman uses `"KYCWEBAGG"` and `"binary"`; current code sends `config.vendorCode` (`"Webagg"`). Confirm the required value.
5. **DOB format** — `VerifyCKYC` doc specifies `dd-mm-yyyy`; our contract/code send `YYYY-MM-DD` (unchanged by design). Confirm which FG accepts (do NOT change VerifyCKYC without confirmation).
6. **Product version** — UAT uses `GCKYC/3.0.0`; a prod postman shows `GCKYC/2.1.0` at `apigw.generalicentralinsurance.com`. Confirm the prod version/host (do NOT bump blindly).
7. **`GetKycStatus` finalStatus** — doc states BOTH `1` and `3` mean "KYC Successful / move to policy creation"; `0`/null = re-upload. Confirm whether `1` vs `3` carry distinct meaning for downstream handling.
8. **`UploadDocBytes` doc_type enum** — request example uses `"pdf"`; response echoes recognized types (`"aadhar"`, etc.). Confirm the full accepted request `doc_type` set (Task 2 maps pdf-mime→`"pdf"`, else the lowercased ID type).
9. **Return URL registration** — the eKYC portal likely allowlists `VISoF_Return_URL`; register our real `FG_CKYC_RETURN_URL` with FG.
10. **Multi-document uploads** — the redirect flow's failure payload shows an `UPLOAD` array (POI + POA); confirm whether `UploadDocBytes` must be called once per document and how POA is attached (this plan uploads the `proofOfIdentity` file; POA handling is deferred).

---

## Self-review notes (spec coverage)

- Host repoint as config/env + verification, no hardcode, fallback preserved → **Task 1** ✅
- `UploadDocBytes` request/response mapper + normalizer + provider wiring replacing the 501 stub, fixture test, no live calls → **Task 2** ✅
- Contract change in `kyc.ts` (`proposalId`) + `openapi:gen` + tf-web `gen:api` → **Task 2 (contract) + Task 3 (regen)** ✅
- Self-hosted redirect bridge (no external CDN, correct hidden fields, our return URL from env) with a test asserting no CDN + fields → **Task 4** ✅
- VerifyCKYC/GetKycStatus logic left unchanged (only `postJson` made generic, type-only) → honoured across Tasks 2/5 ✅
- Suite green + typecheck + commit → **Task 5** ✅
- CKYC open confirmations enumerated → **Open confirmations** section ✅

---

**Plan complete and saved to `tf-api/docs/superpowers/plans/2026-07-22-fg-ckyc-touchups.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

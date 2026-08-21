# HDFC — Restore Green and Finish Pehchaan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take HDFC's certification pack from 4 failures to 0, and build the three Pehchaan e-KYC endpoints the kit specifies but we never implemented — including the entire corporate KYC journey.

**Architecture:** Two independent workstreams inside the existing HDFC provider adapter. Workstream A repairs `mapper/policy-details.ts`, where a live vendor behaviour change broke New Business and Roll Over quoting, and diagnoses two unexplained `500`s on the break-in path. Workstream B extends `providers/hdfc/ckyc.ts` with three new Pehchaan routes, routing corporate callers to `/partner/corporate/kyc` through the same canonical `KycCapableProvider.completeCkyc` seam every other vendor uses. Nothing structural moves; no new layer is introduced.

**Tech Stack:** TypeScript (ESM, `.ts` import extensions, `@/*` → `src/*`), Express, zod contracts, Vitest, Prisma/MySQL. Live vendor calls run through `tsx --env-file=.env`.

**Source spec:** [2026-08-21-hdfc-integration-completion-design.md](../specs/2026-08-21-hdfc-integration-completion-design.md)

---

## Execution status — 2026-08-21

| Task | State |
| --- | --- |
| 1 — Verify the `Registration_No` claim on live UAT | ✅ done, spec-reviewed |
| 2 — Confirm the fix; reclassify New Business 1+3 | ✅ done |
| 3 — Break-in loading + accessory cap (**reframed**) | ✅ done, review in progress |
| 4 — Corporate fields on the canonical CKYC contract | ✅ done, re-reviewed and APPROVED |
| 5 — Corporate Pehchaan params builder | ✅ done |
| 6 — Corporate response normalization | ✅ done |
| 7 — Route corporate callers to the corporate endpoint | ✅ done |
| 8 — The two KYC status-poll endpoints | ✅ done |
| 9 — Prove corporate e-KYC on live UAT | in progress |

**Verified state:** `tf-api` 61 files / 873 passed / 3 skipped; `tf-web` 15 files /
111 passed. Typecheck and lint clean in both. Nothing committed — the whole change
sits in the working tree, per the standing git rule below.

**Certification pack: 96 PASS / 0 FAIL** / 96 VENDOR_DATA / 11 BLOCKED / 2 MANUAL.

Zero failures attributable to us, which was the goal. The PASS count is below this
plan's original 113 target for a reason outside our control: **HDFC's UAT sandbox
changed four rating behaviours between 13/08 and 21/08** — `Registration_No`
became mandatory, `POLICY_TENURE=1` on New Business became refused, break-in
loading went to zero at every lapse window, and the 25%-of-IDV accessory cap
stopped being enforced. Conditions that passed a week ago now fail on HDFC's side.
Each is evidenced and raised as a blocker; none is a defect of ours.

---

## Before you start

**Read these first.** You will not be able to make correct decisions without them:

1. [tf-api/docs/hdfc-integration-notes.md](../../../tf-api/docs/hdfc-integration-notes.md) — especially §2 ("Vendor rules that cost UAT cycles to learn") and the Pehchaan section at the end.
2. [tf-api/docs/hdfc-vendor-blockers.md](../../../tf-api/docs/hdfc-vendor-blockers.md) — what is already known to be HDFC's fault.
3. `tf-api/src/providers/hdfc/ckyc.ts` — 150 lines, read it whole.

**Standing rule on git.** In this repository **commits and pushes belong to the user**. Every task below ends with a "Checkpoint" step that names the exact files changed and a suggested commit message. **Do not run `git add`, `git commit` or `git push`.** Leave the work in the working tree and report it as ready.

**There is already uncommitted work in the tree.** `src/providers/hdfc/mapper/policy-details.ts` and `src/providers/hdfc/__tests__/policy-details.test.ts` carry a complete, tested fix for the `Registration_No` regression. Task 1 verifies the claim it rests on; Task 2 confirms it works. Do not revert it.

**Baseline to preserve.** `npx vitest run src/providers/hdfc` → 16 files, 319 tests, all passing. Any task that reduces this number has broken something.

---

## File Structure

### Workstream A — restore green

| File | Responsibility |
| --- | --- |
| `tf-api/scripts/_hdfc-regno-sweep.ts` | **Create.** Throwaway live probe proving the `Registration_No` claim. Underscore prefix marks it as a probe, matching `_hdfc-term-probe.ts` and friends. |
| `tf-api/src/providers/hdfc/mapper/policy-details.ts` | **Already modified.** Holds `premiumRegistrationNo()`. |
| `tf-api/src/providers/hdfc/__tests__/policy-details.test.ts` | **Already modified.** Asserts the dashed plate and the `"New"` fallback. |
| `tf-api/scripts/_hdfc-breakin-500.ts` | **Create.** Isolation probe for the two unexplained `500`s. |

### Workstream B — Pehchaan

| File | Responsibility |
| --- | --- |
| `tf-api/src/contracts/kyc.ts` | **Modify.** Add optional corporate fields to `CkycRequestObjectSchema`. |
| `tf-api/src/providers/hdfc/ckyc.ts` | **Modify.** Three new endpoints, a corporate params builder, a corporate normalizer, and route selection. |
| `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts` | **Modify.** Tests for all of the above. |

`ckyc.ts` is ~150 lines today and will land at ~260. That is within the size the other provider files in this folder sit at (`mapper/req-pvtcar.ts` is larger), so it stays one file. Splitting individual/corporate into two modules would separate two things that share a token, a transport, a retry rule and a normalizer shape — they change together, so they live together.

---

# Workstream A — Restore green

## Task 1: Prove the `Registration_No` claim on live UAT

The in-tree fix rests entirely on a claim recorded only in a code comment: that null now fails, and that the dashed plate and the literal `"New"` price *identically*. If the second half is wrong, the `"New"` fallback silently mis-prices every new-vehicle quote. Verify before trusting.

**Files:**
- Create: `tf-api/scripts/_hdfc-regno-sweep.ts`

- [ ] **Step 1: Write the probe**

Create `tf-api/scripts/_hdfc-regno-sweep.ts`:

```ts
/**
 * Isolation probe for the Registration_No regression (spec 2026-08-21, §1).
 *
 * Fires CalculatePremium three times at live UAT, varying Policy_Details
 * .Registration_No ALONE and holding every other field constant:
 *
 *   null            expected: refused, "Vehicle Registration number is mandatory"
 *   "MH-01-QQ-7878" expected: prices
 *   "New"           expected: prices, to the rupee the same as the plate
 *
 * Read-only. Never calls CreateProposal.
 */
import { loadHdfcConfig } from "@/providers/hdfc/config.ts";
import { HdfcProvider } from "@/providers/hdfc/hdfc.provider.ts";
import { passthroughCodeResolver } from "@/providers/hdfc/db-code-resolver.ts";

const config = loadHdfcConfig();

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The probe vehicle from scripts/hdfc-uat-probe.ts: Maruti Swift ZXI at Mumbai. */
function baseRequest(registrationNo: string | undefined) {
  return {
    businessType: "rollover" as const,
    vehicleCategory: "fourWheeler" as const,
    selectedPolicy: "comprehensive" as const,
    modelId: "12798",
    rtoCode: "10406",
    manufactureYear: new Date().getFullYear() - 1,
    registrationDate: isoOffset(-365),
    previousPolicyExpiryDate: isoOffset(10),
    ncbPercent: 20,
    isClaimedLastYear: false,
    policyStartDate: isoOffset(11),
    vehicle: { registrationNo },
  };
}

async function main(): Promise<void> {
  const provider = new HdfcProvider(config, passthroughCodeResolver);

  for (const [label, plate] of [
    ["null", undefined],
    ["plate", "MH-01-QQ-7878"],
    ["New", "New"],
  ] as const) {
    try {
      const quote = await provider.getQuote(baseRequest(plate) as never, {
        requestId: `hdfc-regno-${label}`,
      });
      console.log(`${label.padEnd(6)} PRICED  gross=${quote.grossPremium} idv=${quote.idv}`);
    } catch (err) {
      console.log(`${label.padEnd(6)} REFUSED ${(err as Error).message}`);
    }
  }
}

void main();
```

**Note on the `null` case:** `premiumRegistrationNo()` falls back to `"New"` when there is no plate, so passing `undefined` produces `"New"`, not `null`. To test the true null you must temporarily edit `policy-details.ts` to return `null`, run, then revert. Do that as a deliberate two-run comparison and say so in your report — do not leave the edit in place.

- [ ] **Step 2: Run it against live UAT**

```bash
cd tf-api && npx tsx --env-file=.env scripts/_hdfc-regno-sweep.ts
```

Expected:
```
null   REFUSED HDFC calculatePremium failed: Vehicle Registration number is mandatory
plate  PRICED  gross=<N> idv=<M>
New    PRICED  gross=<N> idv=<M>      <- the SAME N and M as the plate row
```

- [ ] **Step 3: Judge the result**

- **All three as expected** → the fix is sound. Record the three numbers in the task report and go to Task 2.
- **`"New"` prices differently from the plate** → **stop.** The `"New"` fallback is mis-pricing new vehicles. Report the discrepancy; do not proceed to Task 2 until it is resolved.
- **HDFC UAT is unreachable** → **stop and say so, with the error.** Do not work around it and do not substitute a fixture. This is a standing rule for this repository.

- [ ] **Step 4: Checkpoint**

Files: `tf-api/scripts/_hdfc-regno-sweep.ts` (new; `scripts/_*` is a probe convention, keep it).

Suggested message: `chore(hdfc): probe proving Registration_No is validated but not rated`

---

## Task 2: Confirm the regression fix closes conditions 1 and 7

**Files:**
- Modify (already modified in tree): `tf-api/src/providers/hdfc/mapper/policy-details.ts`
- Modify (already modified in tree): `tf-api/src/providers/hdfc/__tests__/policy-details.test.ts`

- [ ] **Step 1: Run the HDFC unit suite**

```bash
cd tf-api && npx vitest run src/providers/hdfc
```

Expected: `Test Files 16 passed (16)`, `Tests 319 passed (319)`.

If `policy-details.test.ts` fails, the in-tree fix is incomplete — read the failure and finish it before continuing.

> ### ⚠ REVISED 2026-08-21 after Task 1 — a SECOND vendor regression
>
> Task 1's probe proved, on live UAT, that HDFC has **also** stopped accepting
> `POLICY_TENURE = 1` on New Business private car. Every New Business 1+3 shape
> is refused with **`Policy period cannot be less than 3 years`**, while the same
> vehicle at 3+3 prices normally.
>
> Isolated by direct experiment — six payloads, one variable at a time
> (`scripts/_hdfc-regno-sweep.json`, 12 call records):
>
> | Shape | `POLICY_TENURE` | Result |
> | --- | ---: | --- |
> | row 1 verbatim (1+3, addons off) | 1 | refused, term |
> | row 2 verbatim (1+3, **all** addons) | 1 | refused, term |
> | row 1 + `registrationDate` 13/08/2026 | 1 | refused, term |
> | row 3 shape (1+3, reg −100d) | 1 | refused, term |
> | row 1 + `CPA_Tenure` 1→3 | 1 | refused, term |
> | control 3+3 | 3 | **prices** — gross 27,453 |
>
> Ruled out: the add-on set, vehicle age, and `CPA_Tenure`. `POLICY_TENURE` is
> the only input whose value changes the outcome. Rows 2 and 3 **passed on
> 13/08** at these exact shapes, so this is new vendor behaviour, not our defect.
>
> HDFC validates `Registration_No` *before* the term, which is why the 19/08 run
> surfaced only the plate error. **The `Registration_No` fix is necessary but not
> sufficient**: New Business 1+3 rows now fail on the term instead.
>
> **Do not "fix" this in code.** Forcing `POLICY_TENURE` to 3 would sell the
> customer a three-year own-damage leg they did not ask for. 1+3 is the
> market-standard new private car term and HDFC's own pack specifies it for rows
> 1–3. This is a vendor blocker.

- [ ] **Step 2: Run the failing conditions against live UAT**

```bash
cd tf-api && npm run hdfc:scenarios -- --sheet=new-rollover
```

Expected, given the revision above:

- Row 7 (`Create policy without cover (1+1)`, Roll Over) → **PASS**. Roll Over is a
  different business type and Task 1's rollover round prices fine at tenure 1.
  This row is the one the `Registration_No` fix actually closes.
- Row 1 (`Create policy without cover (1+3)`, New Business) → **still fails**, but
  now with `Policy period cannot be less than 3 years`, not the plate message.
  Confirm the message changed — that is the evidence the fix worked and a
  different, vendor-side wall is behind it.

- [ ] **Step 3: Reclassify the New Business 1+3 rows and confirm the total**

Rows 1, 2 and 3 of `new-rollover` are New Business 1+3 and are now all blocked by
the term. Reclassify them `VENDOR_DATA` in `scripts/hdfc-uat-scenarios.ts`,
carrying HDFC's verbatim message and a pointer to `scripts/_hdfc-regno-sweep.json`
for the isolation evidence. Follow exactly how the existing 2+3 and 2+0
`VENDOR_DATA` rows are written — do not invent a new verdict or a new field.

Expected for `new-rollover` afterwards: **26 PASS, 0 FAIL, 3 VENDOR_DATA**,
5 BLOCKED, 2 MANUAL (36 total).

**This is a net loss of one PASS against the 19/08 baseline, and that is the
honest number.** The pack does not go up this task; two failures become one pass
and three vendor refusals. Do not massage it. Record the drop and the reason.

- [ ] **Step 3b: Raise it as a vendor blocker**

Add to [hdfc-vendor-blockers.md](../../../tf-api/docs/hdfc-vendor-blockers.md) as
a new numbered item, in the same evidenced style as the existing ten: what we
observe, HDFC's verbatim message, the six-payload isolation table above, and what
we need. State plainly that 1+3 is the ordinary new-car term — this is a more
serious refusal than the exotic 2+3 and 2+0 gaps already listed, because it
blocks the common case rather than an edge one.

- [ ] **Step 4: Checkpoint**

Files: `tf-api/src/providers/hdfc/mapper/policy-details.ts`, `tf-api/src/providers/hdfc/__tests__/policy-details.test.ts`.

Suggested message: `fix(hdfc): send Registration_No at premium time, which UAT now requires`

---

## Task 3: Break-in loading and the accessory cap  — ✅ DONE 2026-08-21

> **REFRAMED DURING EXECUTION.** This task was written as *"diagnose the two
> break-in `500`s"*. Those `500`s were transient and had vanished by the time the
> task ran, replaced by a broader symptom. What follows is what was actually
> investigated and done, kept as the record.

### What was actually wrong

Six rows were failing, in two clusters:

| Row | Symptom |
| --- | --- |
| `break-in` #2, #3, #4 | `BreakInLoadingPercent=0, BreakIN_Premium=0` at 3-day, 60-day and >90-day lapses. Returned 15% / ₹220 and 15% / ₹1,000 on 13/08. |
| `new-rollover` #9, #12 | Same — break-in loading gone. |
| `new-rollover` #25 | ₹4L of accessories on a ~₹5.6L IDV was **quoted** at ₹13,258. HDFC refused it on 13/08. |

### Thread 1 — break-in loading: vendor drift, our change exonerated

The concern was that our own `Registration_No` change (null → dashed plate or
`"New"`) landed in the same window and might have suppressed the loading. It did
not. Proven with a clean discriminator an earlier attempt missed: the field takes
*two* live values, so fire the same 60-day break-in shape with each.

    plate MH-01-QQ-7878   BreakInLoadingPercent=0  BreakIN_Premium=0  NCB%=25  Total=5715
    literal New           BreakInLoadingPercent=0  BreakIN_Premium=0  NCB%=25  Total=5715

Byte-identical. A lapse sweep at 1/3/30/44/45/46/60/90/120/200 days returns 0
everywhere — the threshold has not moved, the loading is simply gone. A second,
independent exoneration: `Current_NCB_Per` still re-rates on the lapse (25 up to
60 days, 0 from 90, OD ₹1,469 → ₹8,261), so the previous-policy end date reaches
HDFC's rules engine intact. Only the loading is missing.

Evidence: `scripts/_hdfc-breakin-sweep.ts` / `.json` / `.log` (gitignored).

**A pack assertion was deliberately NOT flipped.** HDFC's channel deck says
loading applies only beyond a 45-day break, which would make `break-in` row 2's
3-day expectation wrong. But git history of `docs/hdfc-uat-scenario-results.md`
shows UAT itself returned 15% / ₹220 at a 3-day lapse on both 10/08 and 13/08 —
the pack described real behaviour and the deck is what UAT contradicted. Flipping
row 2 would have gone green because the loading engine is silent everywhere, not
because 3 days is inside a grace period, and **that green would have hidden the
regression**. The deck-versus-pack conflict is raised with HDFC instead.

Classified `VENDOR_DATA` via a new `vendorBehaviour()` wrapper — the
value-assertion twin of `VENDOR_DATA_PATTERNS`, which can only classify rows HDFC
*refused*. Rows 3/4's NCB half runs first and unwrapped, so it is still genuinely
tested. Blocker item 12 records it.

### Thread 2 — the accessory cap is now ours to enforce

`docs/hdfc-integration-notes.md` already lists rules "HDFC silently accepts, so
they are ours to enforce" (the RTI ≤3-year ceiling, the anti-theft discount,
own-damage add-ons on a TP-only policy). The 25% accessory cap has joined them.

`assertAccessorySiWithinCap()` in `mapper/canonical.ts`, called from
`hdfc.provider.ts` between GetCalculateIDV and CalculatePremium — a
`MotorQuoteRequest` usually carries no IDV, so HDFC's recommendation is the first
moment there is a vehicle SI to measure against.

**Measured against the base `Vehicle_IDV`, not vehicle + accessories**, on the
strength of HDFC's own historic refusal message: *"Total optional covers SI should
not be more than 25% of Vehicle Base Value!"* It is also the stricter reading.

**It refuses rather than clamping** — a deviation from the silent-drop pattern of
its siblings, taken deliberately: an accessory sum insured is a value the customer
declared and expects insured, so clamping would quote materially less cover
without saying so. `compare.service.ts` uses `Promise.allSettled`, so a refusal
costs only the HDFC card.

### Outcome

| Sheet | Before | After |
| --- | --- | --- |
| New and Rollover (36) | 23 P / **3 F** / 3 VD / 5 B / 2 M | 24 P / **0 F** / 5 VD / 5 B / 2 M |
| Break In (5) | 2 P / **3 F** | 2 P / **0 F** / 3 VD |
| **All 205** | 95 P / **6 F** | **96 P / 0 F** / 96 VD / 11 B / 2 M |

`npm test` 850 passed / 3 skipped; typecheck and lint clean.

---


# Workstream B — Finish Pehchaan

Independent of Workstream A. Can run in parallel.

## Task 4: Add corporate fields to the canonical CKYC contract

The corporate kit takes entity-shaped inputs (`ent_pan`, `ent_cin`, `ent_ckycnum`, `doi`, `ent_type`) that the individual one does not. These go on the existing `CkycRequestObjectSchema` as optional fields rather than into a new contract, following the precedent already set in that file — *"FG VerifyCKYC mandates these; other vendors ignore them."* One canonical seam, vendors read what they understand.

**Files:**
- Modify: `tf-api/src/contracts/kyc.ts:7-28`
- Test: `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`:

```ts
import { CkycRequestSchema } from "@/contracts/kyc.ts";

describe("corporate CKYC contract", () => {
  it("accepts a corporate request keyed by entity PAN and date of incorporation", () => {
    const parsed = CkycRequestSchema.parse({
      transactionId: "TXN-1",
      dob: "2007-11-20",
      customerType: "corporate",
      entityPan: "AADCC2489H",
      dateOfIncorporation: "2007-11-20",
      entityType: "company",
    });
    expect(parsed.entityPan).toBe("AADCC2489H");
    expect(parsed.entityType).toBe("company");
  });

  it("rejects a corporate request that names no entity identifier", () => {
    expect(() =>
      CkycRequestSchema.parse({
        transactionId: "TXN-2",
        dob: "2007-11-20",
        customerType: "corporate",
        entityType: "company",
        dateOfIncorporation: "2007-11-20",
      }),
    ).toThrow(/entityPan, entityCin or entityCkycNumber/);
  });

  it("still accepts an individual request with no corporate fields", () => {
    const parsed = CkycRequestSchema.parse({
      transactionId: "TXN-3",
      dob: "1990-01-01",
      panNumber: "ABCPD1234E",
    });
    expect(parsed.customerType).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts
```

Expected: FAIL — `Unrecognized key(s) in object: 'customerType', 'entityPan'…` or the corporate parse succeeding when it should throw.

- [ ] **Step 3: Extend the contract**

In `tf-api/src/contracts/kyc.ts`, add to `CkycRequestObjectSchema` (after `redirectUrl`):

```ts
  // ─── Corporate (non-individual) KYC ─────────────────────────────────────────
  // HDFC Pehchaan ships a separate corporate kit (/partner/corporate/kyc) taking
  // entity-shaped inputs. Optional here so the individual path is unchanged and
  // other vendors ignore them, exactly as they ignore the FG-only fields above.
  customerType: z.enum(["individual", "corporate"]).optional(),
  /** PAN of the entity. */
  entityPan: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/).optional(),
  /** Corporate Identity Number. */
  entityCin: z.string().optional(),
  /** CKYC number of the entity. */
  entityCkycNumber: z.string().optional(),
  /** Date of incorporation, YYYY-MM-DD. Pehchaan wants DD/MM/YYYY; the mapper converts. */
  dateOfIncorporation: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  entityType: z
    .enum([
      "company",
      "partnershipFirm",
      "trust",
      "unincorporatedInstitution",
      "properietor",
      "huf",
      "llp",
      "societyOrEducationalInstitute",
      "governmentEntity",
      "foreignEmbassy",
    ])
    .optional(),
```

**`properietor` is spelled that way deliberately** — it is HDFC's spelling in the kit, and it is the wire value. Do not correct it.

Then add a third refinement to `CkycRequestSchema`, after the existing two:

```ts
.refine(
  (d) =>
    d.customerType !== "corporate" ||
    (d.entityPan ?? d.entityCin ?? d.entityCkycNumber),
  { message: "A corporate request needs one of entityPan, entityCin or entityCkycNumber" },
)
.refine((d) => d.customerType !== "corporate" || d.dateOfIncorporation, {
  message: "dateOfIncorporation is required for a corporate request",
})
.refine((d) => d.customerType !== "corporate" || d.entityType, {
  message: "entityType is required for a corporate request",
});
```

- [ ] **Step 4: Run the test**

```bash
cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Regenerate the OpenAPI contract**

```bash
cd tf-api && npm run openapi:gen
cd ../tf-web && npm run gen:api
```

The contract is the seam to the frontend; leaving it stale is how the two projects drift.

- [ ] **Step 6: Verify nothing else broke**

```bash
cd tf-api && npx vitest run && npm run typecheck
```

Expected: all green. Watch particularly for FG and ICICI KYC tests — they share this schema.

- [ ] **Step 7: Checkpoint**

Files: `tf-api/src/contracts/kyc.ts`, `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`, `tf-api/openapi/openapi.json`, `tf-web/src/lib/api/generated/vendor-api.d.ts`.

Suggested message: `feat(kyc): add optional corporate fields to the canonical CKYC contract`

---

## Task 5: Build the corporate Pehchaan params builder

**Files:**
- Modify: `tf-api/src/providers/hdfc/ckyc.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`

- [ ] **Step 1: Write the failing test**

**The test file already declares `config` at module scope** (`__tests__/ckyc.test.ts:7-20`) with `kyc.returnUrl = "https://app.example/kyc-return"`. Reuse it — do **not** redeclare it. Add `toCorporatePehchaanParams` to the existing import on line 2.

```ts
describe("toCorporatePehchaanParams", () => {
  it("sends entity PAN, DOI in DD/MM/YYYY, entity type, txn id and redirect url", () => {
    expect(
      toCorporatePehchaanParams(
        {
          transactionId: "TXN-1",
          dob: "2007-11-20",
          customerType: "corporate",
          entityPan: "AADCC2489H",
          dateOfIncorporation: "2007-11-20",
          entityType: "company",
        } as never,
        config,
      ),
    ).toEqual({
      ent_pan: "AADCC2489H",
      doi: "20/11/2007",
      ent_type: "company",
      txn_id: "TXN-1",
      redirect_url: "https://app.example/kyc-return",
    });
  });

  it("sends the CIN when that is the identifier supplied", () => {
    const params = toCorporatePehchaanParams(
      {
        transactionId: "TXN-2",
        dob: "2015-12-18",
        customerType: "corporate",
        entityCin: "U40100GJ2015PLC085448",
        dateOfIncorporation: "2015-12-18",
        entityType: "company",
      } as never,
      config,
    );
    expect(params.ent_cin).toBe("U40100GJ2015PLC085448");
    expect(params.ent_pan).toBeUndefined();
  });

  it("prefers an explicit redirectUrl over the configured return url", () => {
    const params = toCorporatePehchaanParams(
      {
        transactionId: "TXN-3",
        dob: "2015-12-18",
        customerType: "corporate",
        entityCkycNumber: "12345678901234",
        dateOfIncorporation: "2015-12-18",
        entityType: "llp",
        redirectUrl: "https://app.example/custom",
      } as never,
      config,
    );
    expect(params.redirect_url).toBe("https://app.example/custom");
    expect(params.ent_ckycnum).toBe("12345678901234");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts
```

Expected: FAIL — `toCorporatePehchaanParams is not a function`.

- [ ] **Step 3: Implement it**

In `tf-api/src/providers/hdfc/ckyc.ts`, add below `toPehchaanParams`:

```ts
/**
 * Corporate Pehchaan parameters (kit doc 1.2.1, /partner/corporate/kyc).
 *
 * The kit lists three accepted key pairs — PAN+DOI (preferred), CIN+DOI and
 * CKYC+DOI — and mandates ent_type, redirect_url and txn_id on top of whichever
 * pair is used. All parameter names are lowercase.
 */
export function toCorporatePehchaanParams(
  req: CkycRequest,
  config: HdfcConfig,
): Record<string, string> {
  const candidates: Record<string, string | undefined> = {
    ent_pan: req.entityPan,
    ent_cin: req.entityCin,
    ent_ckycnum: req.entityCkycNumber,
    doi: toHdfcDate(req.dateOfIncorporation) ?? undefined,
    ent_type: req.entityType,
    txn_id: req.transactionId,
    redirect_url: req.redirectUrl ?? config.kyc.returnUrl,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(candidates)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run the test**

```bash
cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Files: `tf-api/src/providers/hdfc/ckyc.ts`, `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`.

Suggested message: `feat(hdfc): build corporate Pehchaan query parameters`

---

## Task 6: Normalize the corporate response

The corporate response differs from the individual one in three ways: the identity field is `fullName` (not `name`), the date field is `doi` (not `dob`), and the city and pincode arrive as separate fields — `permanentCity` being an **array**. `normalizePehchaan` reads none of these.

**Files:**
- Modify: `tf-api/src/providers/hdfc/ckyc.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`

- [ ] **Step 1: Write the failing test**

Use the kit's own verbatim UAT response (doc 1.2.1, positive case 1):

```ts
import { normalizePehchaan } from "../ckyc.ts";

describe("normalizePehchaan — corporate shape", () => {
  const corporateBody = {
    success: true,
    data: {
      permanentAddress:
        "ADANI CORPORATE HOUSE,SHANTIGRAM,NEAR VAISHNO DEVI CIRCLE,S.G.HIGHWAY,KHODIYAR,AHMEDABAD, GANDHI NAGAR, ZUNDAL, pincode - 382421",
      permanentCity: ["ZUNDAL"],
      permanentPincode: "382421",
      correspondenceAddress:
        "ADANI CORPORATE HOUSE,SHANTIGRAM,NEAR VAISHNO DEVI CIRCLE,S.G.HIGHWAY,KHODIYAR,AHMEDABAD, GANDHI NAGAR, ZUNDAL, pincode - 382421",
      correspondenceCity: ["ZUNDAL"],
      correspondencePincode: "382421",
      fullName: "ADANI POWER (JHARKHAND) LIMITED",
      email: "deepak.pandya@adani.com",
      doi: "18/12/2015",
      kyc_id: "6PCT4QLC11",
      iskycVerified: 1,
      txn_id: "8563457",
    },
  };

  it("reads the entity name from fullName", () => {
    expect(normalizePehchaan(corporateBody).name).toBe("ADANI POWER (JHARKHAND) LIMITED");
  });

  it("reads the date of incorporation into dob", () => {
    expect(normalizePehchaan(corporateBody).dob).toBe("18/12/2015");
  });

  it("marks it verified and carries the Pehchaan id", () => {
    const result = normalizePehchaan(corporateBody);
    expect(result.isKycSuccess).toBe(true);
    expect(result.kycId).toBe("6PCT4QLC11");
    expect(result.ckycNumber).toBe("6PCT4QLC11");
  });

  it("still reads an individual response unchanged", () => {
    const result = normalizePehchaan({
      data: { iskycVerified: 1, name: "UTKARSH VIKAS CHANDEL", mobile: "7666919245", dob: "24/12/1997", kyc_id: "ZCT0BOQ7SH" },
    });
    expect(result.name).toBe("UTKARSH VIKAS CHANDEL");
    expect(result.dob).toBe("24/12/1997");
    expect(result.phone).toBe("7666919245");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts
```

Expected: FAIL — `expected undefined to be 'ADANI POWER (JHARKHAND) LIMITED'`.

- [ ] **Step 3: Widen the normalizer**

In `tf-api/src/providers/hdfc/ckyc.ts`, inside `normalizePehchaan`, change the two lines that read the name and the date:

```ts
    // Individual responses carry `name` and `dob`; corporate ones carry
    // `fullName` and `doi` (kit doc 1.2.1). Same canonical slots either way.
    name: str(d.name) ?? str(d.fullName),
    dob: str(d.dob) ?? str(d.doi),
```

Leave every other field alone. `permanentCity` and `permanentPincode` are deliberately **not** mapped: `KycResult` has no slot for them, the address string already contains both, and inventing fields to hold data nothing consumes is the kind of speculative widening this codebase avoids.

- [ ] **Step 4: Run the test**

```bash
cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts
```

Expected: PASS, including the individual-unchanged case.

- [ ] **Step 5: Checkpoint**

Files: `tf-api/src/providers/hdfc/ckyc.ts`, `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`.

Suggested message: `feat(hdfc): read corporate fullName/doi in the Pehchaan normalizer`

---

## Task 7: Route corporate callers to the corporate endpoint

**Files:**
- Modify: `tf-api/src/providers/hdfc/ckyc.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`

- [ ] **Step 1: Write the failing test**

Follow the existing fetch-stubbing style already used in this test file:

```ts
import { hdfcCompleteCkyc } from "../ckyc.ts";
import { tokenManager } from "@/providers/token-manager.ts";

describe("hdfcCompleteCkyc — endpoint selection", () => {
  beforeEach(() => {
    tokenManager.invalidate("hdfc:kyc");
    vi.restoreAllMocks();
  });

  function stubFetch(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/tgt/generate-token")) {
        return new Response(JSON.stringify({ token: "jwt", expiry: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { iskycVerified: 1, kyc_id: "K1" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("calls /partner/corporate/kyc for a corporate request", async () => {
    const fetchMock = stubFetch();
    await hdfcCompleteCkyc(config, {
      transactionId: "TXN-1",
      dob: "2007-11-20",
      customerType: "corporate",
      entityPan: "AADCC2489H",
      dateOfIncorporation: "2007-11-20",
      entityType: "company",
    } as never);

    const called = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(called).toContain("/partner/corporate/kyc");
    expect(called).toContain("ent_pan=AADCC2489H");
    expect(called).toContain("ent_type=company");
  });

  it("calls /primary/kyc-verified for an individual request", async () => {
    const fetchMock = stubFetch();
    await hdfcCompleteCkyc(config, {
      transactionId: "TXN-2",
      dob: "1990-01-01",
      panNumber: "ABCPD1234E",
    } as never);

    const called = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(called).toContain("/primary/kyc-verified");
    expect(called).not.toContain("/corporate/");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts
```

Expected: FAIL — the corporate assertion finds `/primary/kyc-verified`.

- [ ] **Step 3: Implement the branch**

In `tf-api/src/providers/hdfc/ckyc.ts`, add to `ENDPOINTS`:

```ts
  fetchCorporateKyc: "/partner/corporate/kyc",
```

Then change `hdfcCompleteCkyc`'s first two lines to select the route:

```ts
export async function hdfcCompleteCkyc(config: HdfcConfig, req: CkycRequest): Promise<KycResult> {
  // A corporate proposer goes through Pehchaan's separate corporate kit, which
  // takes entity-shaped parameters (kit doc 1.2.1). Everything downstream —
  // token, retry-once-on-401, normalization — is identical.
  const isCorporate = req.customerType === "corporate";
  const endpoint = isCorporate ? ENDPOINTS.fetchCorporateKyc : ENDPOINTS.fetchKyc;
  const params = new URLSearchParams(
    isCorporate ? toCorporatePehchaanParams(req, config) : toPehchaanParams(req, config),
  );
  const url = `${config.kyc.baseUrl}${endpoint}?${params.toString()}`;
```

Leave the rest of the function — token, 401 retry, `normalizePehchaan` — exactly as it is.

Update the docblock at the top of the file to list the new route.

- [ ] **Step 4: Run the test**

```bash
cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Files: `tf-api/src/providers/hdfc/ckyc.ts`, `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`.

Suggested message: `feat(hdfc): route corporate proposers to Pehchaan's corporate KYC endpoint`

---

## Task 8: Add the two status-check endpoints

The kit specifies `GET /primary/kyc-status/:kycId` (doc 1.3) and `GET /primary/kyc-status/transaction-id/:txnId` (doc 1.4). Both return a small `{ iskycVerified, status }` body. The current file's docblock argues these are unnecessary because `/primary/kyc-verified` accepts `kyc_id` — that reasoning holds for *fetching an identity*, but not for *polling a pending verification*, which is what these two are for and which is the documented way to discover a **rejected** KYC.

**Files:**
- Modify: `tf-api/src/providers/hdfc/ckyc.ts`
- Test: `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`

- [ ] **Step 1: Write the failing test**

Uses the kit's own verbatim responses (doc 1.3 and 1.4):

```ts
import { hdfcKycStatusByKycId, hdfcKycStatusByTxnId, normalizeKycStatus } from "../ckyc.ts";

describe("normalizeKycStatus", () => {
  it("reads an approved status", () => {
    const r = normalizeKycStatus({ data: { iskycVerified: 1, status: "approved" } }, "ZCT0BOQ7SH");
    expect(r.isKycSuccess).toBe(true);
    expect(r.kycId).toBe("ZCT0BOQ7SH");
    expect(r.displayMessage).toBe("approved");
  });

  it("reads a pending status as not-yet-successful", () => {
    const r = normalizeKycStatus({ data: { iskycVerified: 0, status: "pending for verification" } }, "L6W5IHEKZP");
    expect(r.isKycSuccess).toBe(false);
    expect(r.displayMessage).toBe("pending for verification");
  });

  it("reads a rejected status as not-successful", () => {
    const r = normalizeKycStatus({ data: { iskycVerified: 0, status: "rejected" } }, "RWZG58N4DP");
    expect(r.isKycSuccess).toBe(false);
    expect(r.displayMessage).toBe("rejected");
  });

  it("carries the transaction id back when the response names one", () => {
    const r = normalizeKycStatus(
      { data: { iskycVerified: 1, status: "approved", txn_id: "HEGI_0019281" } },
      undefined,
    );
    expect(r.ckycRefId).toBe("HEGI_0019281");
  });
});

describe("status endpoints", () => {
  beforeEach(() => {
    tokenManager.invalidate("hdfc:kyc");
    vi.restoreAllMocks();
  });

  it("polls by kyc id at /primary/kyc-status/:kycId", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/tgt/generate-token")
        ? new Response(JSON.stringify({ token: "jwt" }), { status: 200 })
        : new Response(JSON.stringify({ data: { iskycVerified: 1, status: "approved" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await hdfcKycStatusByKycId(config, "ZCT0BOQ7SH");
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("/primary/kyc-status/ZCT0BOQ7SH");
    expect(r.isKycSuccess).toBe(true);
  });

  it("polls by transaction id at /primary/kyc-status/transaction-id/:txnId", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/tgt/generate-token")
        ? new Response(JSON.stringify({ token: "jwt" }), { status: 200 })
        : new Response(JSON.stringify({ data: { iskycVerified: 0, status: "rejected", txn_id: "HEGI_0988117" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await hdfcKycStatusByTxnId(config, "HEGI_0988117");
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      "/primary/kyc-status/transaction-id/HEGI_0988117",
    );
    expect(r.isKycSuccess).toBe(false);
    expect(r.displayMessage).toBe("rejected");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts
```

Expected: FAIL — `normalizeKycStatus is not a function`.

- [ ] **Step 3: Implement**

In `tf-api/src/providers/hdfc/ckyc.ts`, add to `ENDPOINTS`:

```ts
  kycStatus: "/primary/kyc-status",
  kycStatusByTxn: "/primary/kyc-status/transaction-id",
```

Then add, below `normalizePehchaan`:

```ts
/**
 * The status endpoints (kit docs 1.3, 1.4) return only { iskycVerified, status }
 * — no identity. They exist to poll a verification that is still in progress,
 * and they are the documented way to learn that one was REJECTED, which
 * /primary/kyc-verified does not tell you.
 */
export function normalizeKycStatus(body: unknown, kycId: string | undefined): KycResult {
  const d = obj(obj(body).data ?? body);
  return {
    isKycSuccess: Number(d.iskycVerified) === 1,
    kycId,
    ckycNumber: kycId,
    ckycRefId: str(d.txn_id),
    displayMessage: str(d.status),
    _rawResponse: body,
  };
}

/** Shared transport for the two status polls: token, GET, retry once on 401. */
async function getWithToken(config: HdfcConfig, url: string): Promise<unknown> {
  let token = await getKycToken(config);
  let res = await fetch(url, { headers: { token } });
  if (res.status === 401) {
    tokenManager.invalidate(KYC_TOKEN_CACHE_KEY);
    token = await getKycToken(config);
    res = await fetch(url, { headers: { token } });
  }
  return readJson(res);
}

/** Polls a Pehchaan KYC by its own id (kit doc 1.3). */
export async function hdfcKycStatusByKycId(config: HdfcConfig, kycId: string): Promise<KycResult> {
  const url = `${config.kyc.baseUrl}${ENDPOINTS.kycStatus}/${encodeURIComponent(kycId)}`;
  return normalizeKycStatus(await getWithToken(config, url), kycId);
}

/** Polls a Pehchaan KYC by the transaction id we sent (kit doc 1.4). */
export async function hdfcKycStatusByTxnId(config: HdfcConfig, txnId: string): Promise<KycResult> {
  const url = `${config.kyc.baseUrl}${ENDPOINTS.kycStatusByTxn}/${encodeURIComponent(txnId)}`;
  return normalizeKycStatus(await getWithToken(config, url), undefined);
}
```

Then **refactor `hdfcCompleteCkyc` to use `getWithToken`**, deleting its now-duplicated token/retry block. That block is the only reason `getWithToken` is shared rather than inlined; leaving both would be the duplication this step exists to avoid.

- [ ] **Step 4: Run the test**

```bash
cd tf-api && npx vitest run src/providers/hdfc/__tests__/ckyc.test.ts
```

Expected: PASS — including the pre-existing `hdfcCompleteCkyc` tests, which must still pass after the refactor.

- [ ] **Step 5: Checkpoint**

Files: `tf-api/src/providers/hdfc/ckyc.ts`, `tf-api/src/providers/hdfc/__tests__/ckyc.test.ts`.

Suggested message: `feat(hdfc): add Pehchaan KYC status polling by kyc id and transaction id`

---

## Task 9: Prove corporate KYC on live UAT

The kit ships working UAT test identities. Use them — a unit test proves our mapping, only a live call proves HDFC accepts it.

**Files:**
- Create: `tf-api/scripts/_hdfc-corporate-kyc-probe.ts`

- [ ] **Step 1: Write the probe**

Create `tf-api/scripts/_hdfc-corporate-kyc-probe.ts`:

```ts
/**
 * First live call to Pehchaan's CORPORATE e-KYC (/partner/corporate/kyc).
 *
 * Uses the two positive test cases the kit itself documents (doc 1.2.1). The
 * individual endpoint was found on 2026-08-13 to return identities unrelated to
 * the PAN submitted; whether the corporate one does the same is exactly what
 * this probe is for. Report what it does, not what it should do.
 */
import { loadHdfcConfig } from "@/providers/hdfc/config.ts";
import { hdfcCompleteCkyc } from "@/providers/hdfc/ckyc.ts";
import type { CkycRequest } from "@/contracts/kyc.ts";

const config = loadHdfcConfig();

const CASES: Array<{ label: string; req: CkycRequest }> = [
  {
    label: "CIN + DOI (kit case 1)",
    req: {
      transactionId: "12363",
      dob: "2021-10-26",
      customerType: "corporate",
      entityCin: "U74999DL2021PTC388965",
      dateOfIncorporation: "2021-10-26",
      entityType: "company",
      policyType: "motor",
    } as CkycRequest,
  },
  {
    label: "PAN + DOI (kit case 2)",
    req: {
      transactionId: "12364",
      dob: "2007-11-20",
      customerType: "corporate",
      entityPan: "AADCC2489H",
      dateOfIncorporation: "2007-11-20",
      entityType: "company",
      policyType: "motor",
    } as CkycRequest,
  },
];

async function main(): Promise<void> {
  for (const { label, req } of CASES) {
    console.log(`\n═══ ${label} ═══`);
    try {
      const r = await hdfcCompleteCkyc(config, req);
      console.log(
        `isKycSuccess=${r.isKycSuccess} kycId=${r.kycId ?? "-"} ` +
          `requiresRedirect=${r.requiresRedirect ?? false}`,
      );
      console.log(`name=${r.name ?? "-"}  dob/doi=${r.dob ?? "-"}  status=${r.displayMessage ?? "-"}`);
      console.log(`address=${r.permanentAddress ?? "-"}`);
      console.log("raw:", JSON.stringify(r._rawResponse, null, 2));
    } catch (err) {
      console.log(`FAILED ${(err as Error).message}`);
    }
  }
}

void main();
```

**`dob` is required by `CkycRequestSchema` even for a corporate request** — it is set to the same value as `dateOfIncorporation` above, because the individual field is mandatory on the shared schema and Pehchaan's corporate endpoint never receives it (`toCorporatePehchaanParams` does not emit `dob`). If that redundancy proves annoying in the frontend later, relaxing it is a contract change, not a probe change.

- [ ] **Step 2: Run it**

```bash
cd tf-api && npx tsx --env-file=.env scripts/_hdfc-corporate-kyc-probe.ts
```

Expected: both return `isKycSuccess=true` with a `kyc_id`, case 2 naming `CPP ASSISTANCE SERVICES PRIVATE LIMITED`.

- [ ] **Step 3: Record what UAT actually did**

Append a dated section to
[tf-api/docs/hdfc-integration-notes.md](../../../tf-api/docs/hdfc-integration-notes.md),
alongside the existing "Pehchaan e-KYC — first live UAT behaviour (2026-08-13)".

Report what you observed, not what you hoped for. The individual endpoint was found to return identities unrelated to the PAN submitted; if the corporate one does the same, say so plainly. If either case returns a `redirection_link` instead, that exercises `normalizePehchaan`'s redirect branch for the first time — note it, because that branch has never been proven.

- [ ] **Step 4: Full verification**

```bash
cd tf-api && npx vitest run && npm run typecheck && npm run lint
cd ../tf-web && npx vitest run && npm run typecheck
```

Expected: all green. `tf-api` HDFC tests should now number roughly 340 (319 + ~21 new).

- [ ] **Step 5: Checkpoint**

Files: `tf-api/scripts/_hdfc-corporate-kyc-probe.ts`, `tf-api/docs/hdfc-integration-notes.md`.

Suggested message: `docs(hdfc): record live UAT behaviour of corporate Pehchaan e-KYC`

---

## Done when

- [ ] `npm run hdfc:scenarios` reports **0 FAIL** across all four sheets.
- [ ] `new-rollover` reports 26 PASS / 0 FAIL / 3 VENDOR_DATA (was 27 PASS / 2 FAIL).
      **Revised down from the original target of 29** — see the boxed revision in
      Task 2. The New Business 1+3 term regression found on 2026-08-21 costs three
      rows that nothing on our side can recover.
- [ ] `break-in` reports 0 FAIL, with rows 1–2 either passing or reclassified `VENDOR_DATA` with verbatim evidence.
- [ ] All five Pehchaan endpoints in the kit are implemented: token, `kyc-verified`, `kyc-status/:kycId`, `kyc-status/transaction-id/:txnId`, `partner/corporate/kyc`.
- [ ] Corporate e-KYC is proven against live UAT and the result recorded in the integration notes.
- [ ] `npm test` green in both projects; `openapi.json` and `vendor-api.d.ts` regenerated.
- [ ] Everything left **uncommitted** in the working tree, reported as ready.

---

## Remaining plans

This plan is one of four decomposed from the spec. The other three, in dependency order:

| Plan | Workstreams | Depends on |
| --- | --- | --- |
| 2 — Master cross-walk repair | F: make aliases, insurer aliases, `FinancierMaster` + `ProviderFinancierCode` | none |
| 3 — Break-in and payment seams | C, E: `BreakinAdapter`, the three break-in tags, the gateway behind `PaymentReceipt` | Plan 1 Task 3 |
| 4 — Harness, certification pass and vendor pack | G, D, H: `/hdfc` inputs, proposal-capable runner, refreshed blockers | Plans 1–3 |

Plan 2 is independent of this one and can run in parallel.

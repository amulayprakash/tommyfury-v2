/**
 * The HDFC certification harness's own attribution logic.
 *
 * These four helpers decide what gets blamed on HDFC and what gets blamed on us
 * in `docs/hdfc-uat-scenario-results.md` — a document HDFC receives as
 * certification evidence. An inversion in any of them would launder one of our
 * defects into a vendor excuse (or the reverse), silently and in front of the
 * vendor, so they are unit-tested rather than trusted to the live run that
 * happens to exercise them.
 *
 * Importing the runner is safe: `scripts/hdfc-uat-scenarios.ts` only calls
 * `main()` when it is the process entry point (`import.meta.url` vs
 * `pathToFileURL(process.argv[1])`), so nothing here touches HDFC UAT.
 */
import { describe, it, expect, vi } from "vitest";
import {
  both,
  vendorBehaviour,
  breakInLoadingAbsent,
  type Assertion,
  type Resp,
} from "../hdfc-uat-scenarios.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";

/** The harness passes the canonical quote as the second argument; these helpers ignore it. */
const QUOTE = {} as CanonicalQuoteResult;
const run = (a: ReturnType<typeof both>, r: Resp = {}): Assertion => a!(r, QUOTE);

const passing = (detail: string) => (): Assertion => ({ ok: true, detail });
const failing = (detail: string) => (): Assertion => ({ ok: false, detail });
const failingTagged =
  (detail: string, vendorData: string) =>
  (): Assertion => ({ ok: false, detail, vendorData });

describe("both()", () => {
  it("evaluates BOTH halves even when the first one fails", () => {
    // The reason this matters: when the break-in loading was withdrawn, the raw
    // half of rows 9 and 12 started failing, and a short-circuiting both() meant
    // their flaggedForInspection half stopped being evaluated at all — the pack's
    // only live check of isInspectionRequired vanished with nothing saying so.
    const first = vi.fn(failing("first failed"));
    const second = vi.fn(passing("second ran"));

    const out = run(both(first, second));

    expect(second).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    expect(out.detail).toBe("first failed; second ran");
  });

  it("reports both details when both halves pass", () => {
    const out = run(both(passing("a=1"), passing("b=2")));
    expect(out).toEqual({ ok: true, detail: "a=1; b=2" });
  });

  it("lets an UNTAGGED failure beat a tagged one, whichever side it is on", () => {
    // An untagged failure is our defect. If a vendorData tag sitting beside it
    // could carry the row, every one of our defects would only need a vendor
    // excuse in the other half to disappear from the FAIL list.
    const taggedFirst = run(both(failingTagged("raw", "HDFC withdrew it"), failing("canonical")));
    expect(taggedFirst.ok).toBe(false);
    expect(taggedFirst.vendorData).toBeUndefined();

    const taggedSecond = run(both(failing("canonical"), failingTagged("raw", "HDFC withdrew it")));
    expect(taggedSecond.ok).toBe(false);
    expect(taggedSecond.vendorData).toBeUndefined();
  });

  it("keeps the tag when every failing half carries one, taking the first", () => {
    const out = run(
      both(failingTagged("raw", "first reason"), failingTagged("canonical", "second reason")),
    );
    expect(out.ok).toBe(false);
    expect(out.vendorData).toBe("first reason");
    expect(out.detail).toBe("raw; canonical");
  });

  it("keeps a tag carried only by the half that actually failed", () => {
    const out = run(both(passing("raw ok"), failingTagged("canonical", "HDFC withdrew it")));
    expect(out.ok).toBe(false);
    expect(out.vendorData).toBe("HDFC withdrew it");
  });
});

describe("vendorBehaviour()", () => {
  const why = "isolated live on 21/08/2026";

  it("does NOT tag the failure when confirms() returns false", () => {
    // This is the whole point of confirms: the sentence about one afternoon on
    // UAT must not outlive the behaviour it describes. If the response no longer
    // shows the isolated signature, the failure is ours again.
    const confirms = vi.fn(() => false);
    const out = run(vendorBehaviour(failing("expected 0 but got 220"), why, confirms), {
      BreakIN_Premium: 220,
    });

    expect(confirms).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    expect(out.vendorData).toBeUndefined();
    expect(out.detail).toBe("expected 0 but got 220");
  });

  it("tags the failure when confirms() returns true", () => {
    const out = run(vendorBehaviour(failing("expected > 0 but got 0"), why, () => true));
    expect(out.ok).toBe(false);
    expect(out.vendorData).toBe(why);
  });

  it("never tags a PASSING assertion, and does not even ask confirms()", () => {
    const confirms = vi.fn(() => true);
    const out = run(vendorBehaviour(passing("BreakIN_Premium=220"), why, confirms));
    expect(out).toEqual({ ok: true, detail: "BreakIN_Premium=220" });
    expect(confirms).not.toHaveBeenCalled();
  });
});

describe("breakInLoadingAbsent()", () => {
  it("is true only when HDFC returned both fields AND both are zero", () => {
    expect(breakInLoadingAbsent({ BreakInLoadingPercent: 0, BreakIN_Premium: 0 })).toBe(true);
    expect(breakInLoadingAbsent({ BreakInLoadingPercent: "0", BreakIN_Premium: "0" })).toBe(true);
  });

  it("distinguishes ABSENT from zero, in both fields", () => {
    // n() maps a missing field to 0, so without the explicit presence checks a
    // renamed or dropped HDFC field would read as the vendor's withdrawn loading
    // rather than as our normalizer reading the wrong key — which is what it
    // would actually be.
    expect(breakInLoadingAbsent({})).toBe(false);
    expect(breakInLoadingAbsent({ BreakInLoadingPercent: 0 })).toBe(false);
    expect(breakInLoadingAbsent({ BreakIN_Premium: 0 })).toBe(false);
    expect(breakInLoadingAbsent({ BreakInLoadingPercent: undefined, BreakIN_Premium: 0 })).toBe(
      false,
    );
  });

  it("is false while HDFC is still charging a loading", () => {
    expect(breakInLoadingAbsent({ BreakInLoadingPercent: 15, BreakIN_Premium: 220 })).toBe(false);
    expect(breakInLoadingAbsent({ BreakInLoadingPercent: 15, BreakIN_Premium: 0 })).toBe(false);
    expect(breakInLoadingAbsent({ BreakInLoadingPercent: 0, BreakIN_Premium: 1000 })).toBe(false);
  });
});

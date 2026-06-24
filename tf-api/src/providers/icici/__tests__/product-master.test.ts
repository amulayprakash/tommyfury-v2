import { describe, it, expect } from "vitest";
import { resolveProductCode } from "../config.ts";

/**
 * Locks resolveProductCode to the ICICI partner-doc Product Master tables
 * ("Generic 2W/4W" PDFs). The key correction vs. the original draft is that
 * third-party uses the dedicated "2W TP" (26) / "4W TP" (29) codes — NOT the
 * 24/25 "Roll Over" rows. ⚠️ Confirm 26/29 against a live UAT TP quote.
 */
describe("resolveProductCode — ICICI Product Master", () => {
  it("maps 4-wheeler products", () => {
    expect(resolveProductCode({ line: "fw", business: "new", policyType: "comprehensive", tenureYears: 1 })).toBe(20);
    expect(resolveProductCode({ line: "fw", business: "rollover", policyType: "comprehensive", tenureYears: 1 })).toBe(21);
    expect(resolveProductCode({ line: "fw", business: "rollover", policyType: "standAloneOD", tenureYears: 1 })).toBe(22);
    expect(resolveProductCode({ line: "fw", business: "rollover", policyType: "thirdParty", tenureYears: 1 })).toBe(29);
    expect(resolveProductCode({ line: "fw", business: "rollover", policyType: "comprehensive", tenureYears: 2 })).toBe(36);
    expect(resolveProductCode({ line: "fw", business: "rollover", policyType: "comprehensive", tenureYears: 3 })).toBe(53);
  });

  it("maps 2-wheeler products", () => {
    expect(resolveProductCode({ line: "tw", business: "new", policyType: "comprehensive", tenureYears: 1 })).toBe(10);
    expect(resolveProductCode({ line: "tw", business: "rollover", policyType: "comprehensive", tenureYears: 1 })).toBe(13);
    expect(resolveProductCode({ line: "tw", business: "rollover", policyType: "standAloneOD", tenureYears: 1 })).toBe(16);
    expect(resolveProductCode({ line: "tw", business: "rollover", policyType: "thirdParty", tenureYears: 1 })).toBe(26);
    expect(resolveProductCode({ line: "tw", business: "rollover", policyType: "comprehensive", tenureYears: 2 })).toBe(14);
    expect(resolveProductCode({ line: "tw", business: "rollover", policyType: "comprehensive", tenureYears: 3 })).toBe(15);
  });

  it("treats renewal like rollover (ICICI has no separate renewal product)", () => {
    expect(resolveProductCode({ line: "fw", business: "renewal", policyType: "comprehensive", tenureYears: 1 })).toBe(21);
    expect(resolveProductCode({ line: "tw", business: "renewal", policyType: "thirdParty", tenureYears: 1 })).toBe(26);
  });

  it("returns undefined for an unsupported journey", () => {
    expect(resolveProductCode({ line: "fw", business: "new", policyType: "standAloneOD", tenureYears: 1 })).toBeUndefined();
  });
});

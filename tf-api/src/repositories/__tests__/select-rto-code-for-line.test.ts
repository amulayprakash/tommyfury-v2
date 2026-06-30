import { describe, it, expect } from "vitest";
import { selectRtoCodeForLine } from "../master.repository.ts";

/**
 * Line-aware RTO code selection. ICICI uses DIFFERENT RTO codes per vehicle line for
 * the same city (e.g. Pune 4W=9, 2W=634), so a single RTO carries one ProviderRtoCode
 * row per line. The resolver must pick the code matching the request's line — never a
 * wrong-line code — which is what broke when one shared code served all lines.
 */
describe("selectRtoCodeForLine", () => {
  const pune = [
    { line: "fw", providerCode: "9" },
    { line: "tw", providerCode: "634" },
  ];

  it("returns the code for the requested line (4W vs 2W in the same RTO)", () => {
    expect(selectRtoCodeForLine(pune, "fw")).toBe("9");
    expect(selectRtoCodeForLine(pune, "tw")).toBe("634");
  });

  it("returns undefined for a line the RTO has no code for (honest miss, not a wrong code)", () => {
    // No "cv" row and no "all" fallback → must NOT return the fw or tw code.
    expect(selectRtoCodeForLine(pune, "cv")).toBeUndefined();
  });

  it("falls back to a line-agnostic 'all' code when the exact line is absent", () => {
    const withAll = [...pune, { line: "all", providerCode: "999" }];
    expect(selectRtoCodeForLine(withAll, "cv")).toBe("999"); // falls back to "all"
    expect(selectRtoCodeForLine(withAll, "fw")).toBe("9"); // exact still preferred over "all"
  });

  it("is line-agnostic when no line is requested (prefers 'all', else first)", () => {
    expect(selectRtoCodeForLine([{ line: "all", providerCode: "999" }, ...pune])).toBe("999");
    expect(selectRtoCodeForLine(pune)).toBe("9"); // no "all" → first row
  });

  it("returns undefined when there are no codes", () => {
    expect(selectRtoCodeForLine([], "fw")).toBeUndefined();
    expect(selectRtoCodeForLine([])).toBeUndefined();
  });
});

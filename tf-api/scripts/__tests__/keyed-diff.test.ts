import { describe, it, expect } from "vitest";
import { diffKeyed } from "../lib/keyed-diff.ts";

describe("diffKeyed", () => {
  type Row = { name: string; gvw: string };
  const wb = new Map<string, Row>([
    ["A", { name: "Audi", gvw: "0" }], // unchanged
    ["B", { name: "Bmw", gvw: "1500" }], // changed gvw
    ["C", { name: "Cadillac", gvw: "0" }], // added (not in db)
  ]);
  const db = new Map<string, Row>([
    ["A", { name: "Audi", gvw: "0" }],
    ["B", { name: "Bmw", gvw: "1200" }],
    ["Z", { name: "Zeta", gvw: "0" }], // removed (not in wb)
  ]);

  it("classifies added / removed / changed / unchanged", () => {
    const d = diffKeyed(wb, db, ["name", "gvw"]);
    expect(d.added).toEqual(["C"]);
    expect(d.removed).toEqual(["Z"]);
    expect(d.changed).toEqual([{ key: "B", field: "gvw", from: "1200", to: "1500" }]);
    expect(d.unchanged).toBe(1);
  });

  it("only diffs the requested fields", () => {
    const d = diffKeyed(wb, db, ["name"]); // ignore gvw → B is now unchanged
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(2); // A and B
  });

  it("treats null/undefined and missing as empty-string-equal", () => {
    const a = new Map([["K", { name: "x", gvw: "" }]]);
    const b = new Map([["K", { name: "x", gvw: undefined as unknown as string }]]);
    expect(diffKeyed(a, b, ["gvw"]).changed).toEqual([]);
  });
});

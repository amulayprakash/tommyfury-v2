import { describe, expect, it } from "vitest";

import {
  isAddonSelectable,
  standaloneOdTpIssue,
  toggleAddonSelection,
} from "../addon-selection";
import type { ProviderAddon } from "../api/vehicle-api";

const addon = (code: string, label: string, requiresZeroDep = false): ProviderAddon => ({
  code,
  label,
  requiresZeroDep,
});

/** Mirrors FG's real four-wheeler catalog: combo packages + zero-dep-gated extras. */
const CATALOG: ProviderAddon[] = [
  addon("STRSA", "Road Side Assistance"),
  addon("STZDP", "Zero Depreciation + RSA + Personal Belonging + Key Loss"),
  addon("ZDCNE", "Zero Dep + RSA + Personal Belonging + Key Loss + Consumable + Engine Protector"),
  addon("STNCB", "NCB Protection", true),
  addon("STINC", "Inconvenience Allowance", true),
];

/**
 * FG's add-on codes are self-contained COMBO packages that overlap — STZDP already
 * contains RSA, so sending it alongside STRSA is rejected at CreateProposal with
 * "Invalid AddON Selected" (live-verified 2026-08-07). GetQuote happily prices the
 * overlap, so only a proposal round-trip catches it: the selection must be
 * constrained in the UI instead.
 */
describe("toggleAddonSelection", () => {
  it("replaces the selected cover package when another package is picked", () => {
    expect(toggleAddonSelection(CATALOG, ["STRSA"], "STZDP", true)).toEqual(["STZDP"]);
  });

  it("keeps only one package even across several switches", () => {
    const afterFirst = toggleAddonSelection(CATALOG, [], "STZDP", true);
    const afterSecond = toggleAddonSelection(CATALOG, afterFirst, "ZDCNE", true);
    expect(afterSecond).toEqual(["ZDCNE"]);
  });

  it("allows a zero-dep extra alongside a package that provides zero dep", () => {
    expect(toggleAddonSelection(CATALOG, ["STZDP"], "STNCB", true)).toEqual(["STZDP", "STNCB"]);
  });

  it("refuses a zero-dep extra when the selected package has no zero dep", () => {
    expect(toggleAddonSelection(CATALOG, ["STRSA"], "STNCB", true)).toEqual(["STRSA"]);
  });

  it("drops zero-dep extras when switching to a package without zero dep", () => {
    expect(toggleAddonSelection(CATALOG, ["STZDP", "STNCB"], "STRSA", true)).toEqual(["STRSA"]);
  });

  it("removes a code when toggled off", () => {
    expect(toggleAddonSelection(CATALOG, ["STZDP", "STNCB"], "STNCB", false)).toEqual(["STZDP"]);
  });
});

describe("isAddonSelectable", () => {
  it("blocks a zero-dep extra while no zero-dep package is selected", () => {
    expect(isAddonSelectable(CATALOG, ["STRSA"], CATALOG[3]!)).toBe(false);
  });

  it("allows a zero-dep extra once a zero-dep package is selected", () => {
    expect(isAddonSelectable(CATALOG, ["STZDP"], CATALOG[3]!)).toBe(true);
  });

  it("always allows cover packages", () => {
    expect(isAddonSelectable(CATALOG, ["STZDP"], CATALOG[0]!)).toBe(true);
  });
});

/**
 * Standalone OD runs a full year from the risk start; FG rejects the proposal with
 * "OD Policy Expiry cannot be after TP policy expiry date" when the existing TP lapses
 * first. Risk start mirrors the backend: previous expiry + 1 day for a live rollover,
 * otherwise today.
 */
describe("standaloneOdTpIssue", () => {
  const today = "2026-08-07";

  it("asks for the TP expiry when it is missing", () => {
    const issue = standaloneOdTpIssue({ previousPolicyExpiryDate: "2026-08-29", today });
    expect(issue).toMatch(/third-party/i);
  });

  it("rejects a TP that lapses before the OD year ends", () => {
    const issue = standaloneOdTpIssue({
      previousPolicyExpiryDate: "2026-08-29",
      tpExpiryDate: "2027-05-15",
      today,
    });
    expect(issue).toContain("29/08/2027");
  });

  it("accepts a TP that runs to exactly the OD end date", () => {
    expect(
      standaloneOdTpIssue({
        previousPolicyExpiryDate: "2026-08-29",
        tpExpiryDate: "2027-08-29",
        today,
      }),
    ).toBeNull();
  });

  it("accepts a TP that outlasts the OD year", () => {
    expect(
      standaloneOdTpIssue({
        previousPolicyExpiryDate: "2026-08-29",
        tpExpiryDate: "2028-12-31",
        today,
      }),
    ).toBeNull();
  });

  it("starts the OD year today when the previous policy has already expired", () => {
    // break-in: start = today (2026-08-07), so the OD year ends 2026-08-06 + 1yr.
    expect(
      standaloneOdTpIssue({
        previousPolicyExpiryDate: "2025-01-01",
        tpExpiryDate: "2027-08-06",
        today,
      }),
    ).toBeNull();
    expect(
      standaloneOdTpIssue({
        previousPolicyExpiryDate: "2025-01-01",
        tpExpiryDate: "2027-08-05",
        today,
      }),
    ).toContain("06/08/2027");
  });
});

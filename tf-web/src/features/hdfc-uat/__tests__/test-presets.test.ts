import { describe, expect, it } from "vitest";

import { HDFC_PRESETS, presetById } from "../test-presets";

describe("HDFC certification presets", () => {
  it("covers the six scenarios Plan 1 bound as real UAT policies", () => {
    expect(HDFC_PRESETS.map((p) => p.id)).toEqual([
      "rollover-bare", "rollover-all-covers", "new-business-1-3",
      "saod", "liability", "break-in",
    ]);
  });

  it("gives every preset a unique id and a human label", () => {
    const ids = HDFC_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of HDFC_PRESETS) expect(p.label.length).toBeGreaterThan(0);
  });

  it("never lets a rollover preset start already lapsed, which HDFC refuses as a break-in", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const p of HDFC_PRESETS) {
      if (p.id === "break-in") continue;
      if (p.conditions.businessType !== "rollover") continue;
      expect(p.conditions.isPreviousPolicyExpired).toBe(false);
      expect(p.conditions.previousPolicyExpiryDate! >= today).toBe(true);
    }
  });

  it("names a previous insurer on the standalone OD preset", () => {
    expect(presetById("saod")!.conditions.previousInsurerId).toBeTruthy();
  });

  it("uses a nominee relation from HDFC's RELATION MASTER", () => {
    // HDFC matches this master case-sensitively; "spouse" was rejected live.
    const MASTER = ["Brother", "Child", "Daughter", "Father", "Husband", "Mother",
      "Sister", "Son", "Wife", "Spouse", "Partner", "Police Holder"];
    for (const p of HDFC_PRESETS) {
      if (!p.proposerOverrides?.nomineeRelation) continue;
      expect(MASTER).toContain(p.proposerOverrides.nomineeRelation);
    }
  });

  it("warns on the break-in preset that HDFC cannot issue it", () => {
    expect(presetById("break-in")!.warning).toMatch(/break-in id/i);
  });

  it("finds a preset by id and returns undefined for an unknown one", () => {
    expect(presetById("saod")?.id).toBe("saod");
    expect(presetById("nope")).toBeUndefined();
  });
});

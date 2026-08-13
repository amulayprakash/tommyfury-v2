import { describe, expect, it } from "vitest";

import type { FgConditions } from "../fg-uat-store";
import { FG_TEST_PRESETS, applyPreset } from "../test-presets";

const base: FgConditions = {
  makeId: "", makeName: "", modelId: "", modelName: "", fuelType: "petrol",
  rtoCode: "", registrationNumber: "", registrationDate: "", engineNumber: "",
  chassisNumber: "", businessType: "rollover", planType: "comprehensive", paOwner: true,
  previousInsurerName: "", previousPolicyNumber: "", isPreviousPolicyExpired: false,
  ncbPercent: 0, claimInPreviousPolicy: false,
};

describe("FG_TEST_PRESETS", () => {
  it("gives every preset a unique id and a non-empty label", () => {
    const ids = FG_TEST_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of FG_TEST_PRESETS) expect(p.label.length).toBeGreaterThan(0);
  });

  it("pins no vehicle — presets set conditions, never a make or model", () => {
    for (const p of FG_TEST_PRESETS) {
      expect(p.patch.makeId).toBeUndefined();
      expect(p.patch.modelId).toBeUndefined();
      expect(p.patch.registrationNumber).toBeUndefined();
    }
  });
});

describe("applyPreset", () => {
  it("sets a break-in scenario as an expired previous policy", () => {
    const out = applyPreset(base, "TC_16");
    expect(out.isPreviousPolicyExpired).toBe(true);
    expect(out.businessType).toBe("rollover");
  });

  it("zeroes NCB when the case has a claim in the previous policy", () => {
    const out = applyPreset(base, "TC_21");
    expect(out.claimInPreviousPolicy).toBe(true);
    expect(out.ncbPercent).toBe(0);
  });

  it("selects standalone OD for the standalone-OD case", () => {
    expect(applyPreset(base, "TC_02").planType).toBe("standAloneOD");
  });

  it("selects new business for the new-car case", () => {
    expect(applyPreset(base, "TC_01").businessType).toBe("new");
  });

  it("leaves conditions untouched for an unknown id", () => {
    expect(applyPreset(base, "NOPE")).toEqual(base);
  });

  it("does not mutate the conditions it was given", () => {
    const before = { ...base };
    applyPreset(base, "TC_16");
    expect(base).toEqual(before);
  });
});

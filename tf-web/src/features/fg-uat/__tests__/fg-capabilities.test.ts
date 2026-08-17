import { describe, expect, it } from "vitest";

import type { ProviderInfo } from "../../vehicle/api/types";
import { fgCategories, fgPlanTypes, CATEGORY_LABELS } from "../fg-capabilities";

/** Mirrors what GET /providers returns for FG today: no two-wheeler, no TP on private car. */
const fg: ProviderInfo = {
  slug: "fg",
  displayName: "Future Generali",
  capabilities: ["fourWheeler", "commercial", "newCommercial"],
  operations: ["quote", "proposal", "issuance"],
  motorCapabilities: {
    fourWheeler: { policyTypes: ["comprehensive", "standAloneOD"], addons: [] },
    commercial: { policyTypes: ["comprehensive", "thirdParty"], addons: [] },
    newCommercial: { policyTypes: ["comprehensive", "thirdParty"], addons: [] },
  },
};

describe("fgCategories", () => {
  it("lists the categories FG declares, in journey order", () => {
    expect(fgCategories(fg)).toEqual(["fourWheeler", "commercial", "newCommercial"]);
  });

  it("omits two-wheeler because FG does not declare it", () => {
    expect(fgCategories(fg)).not.toContain("twoWheeler");
  });

  it("includes two-wheeler if FG ever declares it", () => {
    const withTw: ProviderInfo = { ...fg, capabilities: [...fg.capabilities, "twoWheeler"] };
    expect(fgCategories(withTw)).toContain("twoWheeler");
  });

  it("returns nothing when the provider is absent", () => {
    expect(fgCategories(undefined)).toEqual([]);
  });
});

describe("fgPlanTypes", () => {
  it("returns the plan types declared for a category", () => {
    expect(fgPlanTypes(fg, "fourWheeler")).toEqual(["comprehensive", "standAloneOD"]);
  });

  it("excludes third party for private car (blocked for this channel)", () => {
    expect(fgPlanTypes(fg, "fourWheeler")).not.toContain("thirdParty");
  });

  it("returns an empty list for a category FG does not sell", () => {
    expect(fgPlanTypes(fg, "twoWheeler")).toEqual([]);
  });

  it("returns an empty list when the provider is absent", () => {
    expect(fgPlanTypes(undefined, "fourWheeler")).toEqual([]);
  });
});

describe("CATEGORY_LABELS", () => {
  it("has a human label for every category FG declares", () => {
    for (const c of fgCategories(fg)) expect(CATEGORY_LABELS[c]).toBeTruthy();
  });
});

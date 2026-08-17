import { describe, expect, it } from "vitest";

import { hdfcCategories, hdfcPlanTypes, CATEGORY_LABELS } from "../hdfc-capabilities";
import type { ProviderInfo } from "../../vehicle/api/types";

const provider = {
  slug: "hdfc",
  capabilities: ["fourWheeler"],
  motorCapabilities: {
    fourWheeler: { policyTypes: ["comprehensive", "thirdParty", "standAloneOD"], addons: [] },
  },
} as unknown as ProviderInfo;

describe("hdfcCategories", () => {
  it("offers only the categories HDFC declares", () => {
    expect(hdfcCategories(provider)).toEqual(["fourWheeler"]);
  });

  it("offers nothing when the provider is absent", () => {
    expect(hdfcCategories(undefined)).toEqual([]);
  });

  it("never invents a category HDFC does not declare", () => {
    const twoWheelerOnly = { ...provider, capabilities: ["twoWheeler"] } as unknown as ProviderInfo;
    expect(hdfcCategories(twoWheelerOnly)).not.toContain("fourWheeler");
  });

  it("labels private car", () => {
    expect(CATEGORY_LABELS.fourWheeler).toBe("Private Car");
  });
});

describe("hdfcPlanTypes", () => {
  it("reads the plan types the provider declares for a category", () => {
    expect(hdfcPlanTypes(provider, "fourWheeler")).toEqual([
      "comprehensive", "thirdParty", "standAloneOD",
    ]);
  });

  it("returns nothing for a category HDFC does not sell", () => {
    expect(hdfcPlanTypes(provider, "commercial")).toEqual([]);
  });
});

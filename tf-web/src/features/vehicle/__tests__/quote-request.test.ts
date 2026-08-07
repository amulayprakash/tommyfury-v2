import { describe, expect, it } from "vitest";

import { buildQuoteRequest } from "../vehicle-quote-store";

const vehicle = {
  category: "fourWheeler",
  businessType: "new",
  makeId: "HYUNDAI",
  makeName: "HYUNDAI",
  modelId: "HY1580",
  modelName: "VENUE N LINE",
  variantName: "N8 1.0 TURBO DCT",
  fuelType: "petrol",
  engineCC: 998,
  rtoCode: "MH12",
  registrationDate: "2026-08-06",
} as never;

type Inputs = Parameters<typeof buildQuoteRequest>[0];

const base = {
  vehicle,
  planType: "comprehensive",
  idvValue: undefined,
  ncbPercent: 0,
  claimInPreviousPolicy: false,
  addons: {},
  previousTp: {},
} as unknown as Inputs;

/**
 * FG prices add-ons ONLY from the provider cover codes (`providerAddonCodes`) —
 * the generic boolean flags are deliberately never derived from (see the FG
 * mapper's `buildAddons`). The compare step passed the codes but the proposal did
 * not, so FG re-rated the proposal with NO add-ons: the review page quoted
 * ₹68,081 (Zero Dep + RSA + NCB Protection) and the payment page asked for
 * ₹39,707. Every request built from journey state must carry the codes.
 */
describe("buildQuoteRequest — provider add-on codes", () => {
  it("forwards the selected provider add-on codes", () => {
    const req = buildQuoteRequest({ ...base, providerAddonCodes: ["ZD", "RSA", "STNCB"] });
    expect(req?.providerAddonCodes).toEqual(["ZD", "RSA", "STNCB"]);
  });

  it("omits the field when no add-ons are selected", () => {
    const req = buildQuoteRequest({ ...base, providerAddonCodes: [] });
    expect(req?.providerAddonCodes).toBeUndefined();
  });
});

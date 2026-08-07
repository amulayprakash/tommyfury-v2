import { describe, it, expect } from "vitest";
import newPremium from "../fixtures/collection/new-premium.json" with { type: "json" };
import rolloverPremium from "../fixtures/collection/rollover-premium.json" with { type: "json" };
import usedPremium from "../fixtures/collection/used-premium.json" with { type: "json" };
import {
  policyDetailsNew,
  policyDetailsRollover,
  policyDetailsUsed,
  policyDetailsFor,
} from "../mapper/policy-details.ts";
import type { HdfcRequestShape } from "../types.ts";

function shape(overrides: Partial<HdfcRequestShape> = {}): HdfcRequestShape {
  return {
    transactionId: "T",
    businessType: "New Vehicle",
    isElectric: false,
    vehicle: {
      modelCode: "38908",
      rtoCode: "10406",
      registrationNo: "MH01QQ7878",
      registrationDate: "2019-06-15",
      manufactureYear: "2019-06-15",
      idv: 949411,
    },
    policy: { startDate: "2024-03-19", proposalDate: "2024-03-18", tenure: 1, policyType: "OD Plus TP" },
    previousPolicy: {
      insurerCode: "ICICILOMBARD",
      policyNo: "PP-1",
      endDate: "2024-03-18",
      ncbPercentage: 20,
      claim: false,
    },
    addons: {} as HdfcRequestShape["addons"],
    ev: {},
    ...overrides,
  };
}

describe("Policy_Details field parity with the collection", () => {
  it("New Business emits exactly the collection's keys, in order", () => {
    expect(Object.keys(policyDetailsNew(shape()))).toEqual(Object.keys(newPremium.Policy_Details));
  });

  it("Roll Over emits exactly the collection's keys, in order", () => {
    const out = policyDetailsRollover(shape({ businessType: "Roll Over" }));
    expect(Object.keys(out)).toEqual(Object.keys(rolloverPremium.Policy_Details));
  });

  it("Used Car emits exactly the collection's keys, in order", () => {
    const out = policyDetailsUsed(shape({ businessType: "Used Car" }));
    expect(Object.keys(out)).toEqual(Object.keys(usedPremium.Policy_Details));
  });
});

describe("value rules", () => {
  it("formats dates as DD/MM/YYYY", () => {
    const out = policyDetailsNew(shape());
    expect(out.PolicyStartDate).toBe("19/03/2024");
    expect(out.ProposalDate).toBe("18/03/2024");
  });

  it("emits YearOfManufacture as a bare year", () => {
    // "2019-06-15" would crash HDFC's Blaze engine if sent whole.
    expect(policyDetailsNew(shape()).YearOfManufacture).toBe("2019");
  });

  it("sends Registration_No as null at premium time", () => {
    // The collection's premium samples use null; a real plate makes HDFC demand
    // the registrationNumberSection* fields.
    expect(policyDetailsNew(shape()).Registration_No).toBeNull();
    expect(policyDetailsRollover(shape({ businessType: "Roll Over" })).Registration_No).toBeNull();
  });

  it("omits the previous insurer and policy number at premium time", () => {
    const out = policyDetailsRollover(shape({ businessType: "Roll Over" }));
    expect(out.PreviousPolicy_CorporateCustomerId_Mandatary).toBeNull();
    expect(out.PreviousPolicy_PolicyNo).toBeNull();
  });

  it("includes the previous insurer and policy number for the proposal", () => {
    const out = policyDetailsRollover(shape({ businessType: "Roll Over" }), { forProposal: true });
    expect(out.PreviousPolicy_CorporateCustomerId_Mandatary).toBe("ICICILOMBARD");
    expect(out.PreviousPolicy_PolicyNo).toBe("PP-1");
  });

  it("emits claim status in ALL CAPS", () => {
    const yes = policyDetailsRollover(
      shape({ businessType: "Roll Over", previousPolicy: { ncbPercentage: 0, claim: true } }),
      { forProposal: true },
    );
    expect(yes.PreviousPolicy_PolicyClaim).toBe("YES");
  });

  it("carries the IDV through", () => {
    expect(policyDetailsNew(shape()).Vehicle_IDV).toBe(949411);
  });

  it("does not invent a previous insurer when none was resolved", () => {
    // The standalone module hard-coded 'ICICILOMBARD' here for every rollover.
    const out = policyDetailsRollover(
      shape({ businessType: "Roll Over", previousPolicy: { ncbPercentage: 0, claim: false } }),
      { forProposal: true },
    );
    expect(out.PreviousPolicy_CorporateCustomerId_Mandatary).toBeNull();
  });
});

describe("policyDetailsFor", () => {
  it("dispatches on the business type", () => {
    expect(policyDetailsFor(shape()).BusinessType_Mandatary).toBe("New Vehicle");
    expect(policyDetailsFor(shape({ businessType: "Roll Over" })).BusinessType_Mandatary).toBe(
      "Roll Over",
    );
    expect(policyDetailsFor(shape({ businessType: "Used Car" })).BusinessType_Mandatary).toBe(
      "Used Car",
    );
  });
});

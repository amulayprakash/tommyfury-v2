import { describe, it, expect } from "vitest";
import newPremium from "../fixtures/collection/new-premium.json" with { type: "json" };
import rolloverPremium from "../fixtures/collection/rollover-premium.json" with { type: "json" };
import usedPremium from "../fixtures/collection/used-premium.json" with { type: "json" };
import saodNewPremium from "../fixtures/collection/saod-new-premium.json" with { type: "json" };
import saodRolloverShort from "../fixtures/collection/saod-rollover-premium-short.json" with { type: "json" };
import saodRollover1y from "../fixtures/collection/saod-rollover-premium-1y.json" with { type: "json" };
import saodRolloverLong from "../fixtures/collection/saod-rollover-premium-long.json" with { type: "json" };
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

  it("sends a dashed Registration_No at premium time", () => {
    // This asserted null until 17/08/2026, when UAT began rejecting the null
    // with "Vehicle Registration number is mandatory". Holding every other
    // field constant, the dashed plate prices and null does not — and the plate
    // returns the same premium the literal "New" does, so HDFC validates this
    // field without rating on it. See premiumRegistrationNo.
    expect(policyDetailsNew(shape()).Registration_No).toBe("MH-01-QQ-7878");
    expect(policyDetailsRollover(shape({ businessType: "Roll Over" })).Registration_No).toBe(
      "MH-01-QQ-7878",
    );
    // All THREE templates go through premiumRegistrationNo. Used Car is asserted
    // by value here and not only by key order, because the key-order test above
    // passes just as happily with a `null` in this slot — which is exactly the
    // value UAT began refusing on 17/08/2026.
    expect(policyDetailsUsed(shape({ businessType: "Used Car" })).Registration_No).toBe(
      "MH-01-QQ-7878",
    );
  });

  it("falls back to 'New' at premium time when the vehicle has no plate yet", () => {
    // A brand-new vehicle is quoted before it is registered. "New" is what
    // HDFC's own IDV sample sends, and it prices.
    const noPlate = shape();
    noPlate.vehicle.registrationNo = undefined;
    expect(policyDetailsNew(noPlate).Registration_No).toBe("New");
    expect(policyDetailsUsed({ ...noPlate, businessType: "Used Car" }).Registration_No).toBe("New");
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

/**
 * The multi-year standalone-OD term. Each rule names the vendor behaviour it
 * encodes; the live figures come from HDFC UAT on 2026-08-10 (model 12798, RTO
 * 10406, policy starting 10/08/2026).
 */
describe("PolicyEndDate — the standalone-OD term", () => {
  const saod = (over: Partial<HdfcRequestShape["policy"]> = {}, rest: Partial<HdfcRequestShape> = {}) =>
    shape({ policy: { startDate: "2026-08-10", proposalDate: "2026-08-10", tenure: 3, policyType: "OD Only", ...over }, ...rest });

  it("is absent from a one-year standalone OD, so the proven key sets are untouched", () => {
    // The parity tests above pin New / Roll Over / Used to the older collection's
    // premium samples, none of which carries a PolicyEndDate — and HDFC's Blaze
    // engine rejects payloads carrying keys the sample for that business type
    // does not send. Every row that passes the certification pack today is a
    // one-year row, so one year must keep emitting exactly what it emits now.
    expect(Object.keys(policyDetailsNew(saod({ tenure: 1 })))).toEqual(
      Object.keys(newPremium.Policy_Details),
    );
    expect(
      Object.keys(policyDetailsRollover(saod({ tenure: 1 }, { businessType: "Roll Over" }))),
    ).toEqual(Object.keys(rolloverPremium.Policy_Details));
  });

  it("is absent from a multi-year OD-Plus-TP or TP-Only policy", () => {
    // On the package and TP-only products the term IS carried by POLICY_TENURE
    // (PrivateCarDataDictionary.xlsx, "03 CalculatePremium Request" row 40), and
    // neither product's sample sends a PolicyEndDate.
    expect(policyDetailsNew(saod({ policyType: "OD Plus TP" }))).not.toHaveProperty("PolicyEndDate");
    expect(policyDetailsNew(saod({ policyType: "TP Only" }))).not.toHaveProperty("PolicyEndDate");
  });

  it("appears for a multi-year standalone OD, immediately after PolicyStartDate", () => {
    // Every SA_OD sample in the newer collection puts it there — New Business
    // and Roll Over alike — so that is where it goes in both templates.
    for (const fixture of [saodNewPremium, saodRolloverShort, saodRollover1y, saodRolloverLong]) {
      const keys = Object.keys(fixture.Policy_Details);
      expect(keys[keys.indexOf("PolicyStartDate") + 1]).toBe("PolicyEndDate");
    }

    const nb = Object.keys(policyDetailsNew(saod()));
    expect(nb[nb.indexOf("PolicyStartDate") + 1]).toBe("PolicyEndDate");
    const ro = Object.keys(policyDetailsRollover(saod({}, { businessType: "Roll Over" })));
    expect(ro[ro.indexOf("PolicyStartDate") + 1]).toBe("PolicyEndDate");
  });

  it("adds exactly one key and disturbs nothing else about the template", () => {
    const withEnd = Object.keys(policyDetailsNew(saod()));
    expect(withEnd.filter((k) => k !== "PolicyEndDate")).toEqual(
      Object.keys(newPremium.Policy_Details),
    );
    const ro = Object.keys(policyDetailsRollover(saod({}, { businessType: "Roll Over" })));
    expect(ro.filter((k) => k !== "PolicyEndDate")).toEqual(
      Object.keys(rolloverPremium.Policy_Details),
    );
  });

  it("runs to the day before the Nth anniversary of inception", () => {
    // The market's standard inclusive term, and what HDFC's dated Roll Over
    // SA_OD samples show: 19/06/2025 → 18/06/2026 for a year, 19/06/2025 →
    // 18/09/2025 for a quarter.
    expect(policyDetailsNew(saod({ tenure: 3 })).PolicyEndDate).toBe("09/08/2029");
    expect(policyDetailsNew(saod({ tenure: 2 })).PolicyEndDate).toBe("09/08/2028");
  });

  it("carries the term into CreateProposal as well as CalculatePremium", () => {
    // HDFC's SA_OD samples send PolicyEndDate at both steps, and a proposal that
    // dropped it would bind a one-year policy against a multi-year quote.
    const out = policyDetailsRollover(saod({}, { businessType: "Roll Over" }), { forProposal: true });
    expect(out.PolicyEndDate).toBe("09/08/2029");
  });

  it("fills the Used Car template's existing PolicyEndDate rather than adding a key", () => {
    // Used Car already sends the key — HDFC's used sample sends it null — so the
    // key set is identical either way and only the value changes.
    const oneYear = policyDetailsUsed(saod({ tenure: 1 }, { businessType: "Used Car" }));
    expect(Object.keys(oneYear)).toEqual(Object.keys(usedPremium.Policy_Details));
    expect(oneYear.PolicyEndDate).toBeNull();

    const threeYear = policyDetailsUsed(saod({}, { businessType: "Used Car" }));
    expect(Object.keys(threeYear)).toEqual(Object.keys(usedPremium.Policy_Details));
    expect(threeYear.PolicyEndDate).toBe("09/08/2029");
  });

  it("is omitted when there is no inception date to count from", () => {
    // Better to send the one-year payload HDFC accepts than a PolicyEndDate
    // derived from today, which would silently quote a term nobody asked for.
    expect(policyDetailsNew(saod({ startDate: undefined }))).not.toHaveProperty("PolicyEndDate");
  });

  it("does not read the term from POLICY_TENURE, because HDFC does not either", () => {
    // Proven live: with no PolicyEndDate, an "OD Only" quote priced identically
    // at POLICY_TENURE 1, 2 and 3 (New Business gross ₹9,775) with IdvYear2 and
    // IdvYear3 both 0. Sending PolicyEndDate = 10/08/2028 flipped the same
    // request to gross ₹8,070 with IdvYear1 664050 / IdvYear2 559200, and did so
    // at every one of those three tenure values. HDFC's own SA_OD samples agree:
    // all four send POLICY_TENURE: 1 and differ only in PolicyEndDate.
    for (const fixture of [saodNewPremium, saodRolloverShort, saodRollover1y, saodRolloverLong]) {
      expect(fixture.Req_PvtCar.POLICY_TENURE).toBe(1);
      expect(fixture.Req_PvtCar.POLICY_TYPE).toBe("OD Only");
    }
    const spans = [saodRolloverShort, saodRollover1y, saodRolloverLong].map(
      (f) => f.Policy_Details.PolicyEndDate,
    );
    expect(new Set(spans).size).toBe(3);
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

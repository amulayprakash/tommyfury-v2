import { describe, it, expect } from "vitest";
import { normalizeQuote, normalizeProposal, extractRoot } from "../normalizer.ts";
import quoteFixture from "../fixtures/quote.response.json";
import proposalFixture from "../fixtures/proposal.response.json";

const ctx = {
  requestId: "req-1",
  policyType: "comprehensive",
  vehicleCategory: "fourWheeler" as const,
};

describe("normalizeQuote", () => {
  const r = normalizeQuote(quoteFixture, ctx);

  it("captures the quotation number as quoteNo + transactionId", () => {
    expect(r.quoteNo).toBe("0000621254");
    expect(r.transactionId).toBe("0000621254");
  });

  it("strips comma grouping from VehicleIDV", () => {
    expect(r.idvValue).toBe(562818);
  });

  it("extracts basic OD + TP premiums", () => {
    expect(r.basicOdPremium).toBe(7390.93);
    expect(r.thirdPartyPremium).toBe(10640.01);
    expect(r.totalAddonPremium).toBe(7958.84);
  });

  it("treats FG 'Gross Premium' as pre-tax net; gross = net + ServTax", () => {
    expect(r.netPremium).toBeCloseTo(29988.05, 2);
    expect(r.serviceTaxAmount).toBeCloseTo(5397.849, 2);
    expect(r.grossPremium).toBeCloseTo(35385.899, 2);
  });

  it("maps known FG codes to canonical add-on premiums", () => {
    expect(r.addonPremiums.zeroDep).toBe(3658.33);
    expect(r.addonPremiums.ncbProtection).toBe(900.51);
    expect(r.addonPremiums.paOwner).toBe(890);
    expect(r.addonPremiums.paUnnamedPassenger).toBe(1500);
    expect(r.addonPremiums.legalLiabilityPaidDriver).toBe(150);
  });

  it("captures the OD special discount", () => {
    expect(r.discounts.ownDamageDiscount).toBe(11086.39);
  });

  it("stashes the ClientId in contractDetails", () => {
    expect(r.contractDetails?.clientId).toBe("59181900");
  });
});

describe("normalizeProposal", () => {
  it("unwraps the CreateProposalResult envelope and captures ClientId", () => {
    const r = normalizeProposal(proposalFixture, ctx);
    expect(r.quoteNo).toBe("0000771450");
    expect(r.idvValue).toBe(738908);
    expect(r.contractDetails?.clientId).toBe("72590187");
  });
});

describe("extractRoot", () => {
  it("unwraps a JSON-stringified Result → Root envelope", () => {
    const wrapped = { GetQuoteResult: JSON.stringify({ Root: { Client: { QuotationNo: "9" } } }) };
    const root = extractRoot(wrapped);
    expect((root.Client as Record<string, unknown>).QuotationNo).toBe("9");
  });

  it("returns a flat root unchanged", () => {
    const flat = { Client: { QuotationNo: "1" }, Policy: {} };
    expect(extractRoot(flat)).toBe(flat);
  });
});

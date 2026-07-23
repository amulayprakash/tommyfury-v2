import { describe, it, expect } from "vitest";
import { normalizeQuote, normalizeProposal, normalizeIssuance, extractRoot } from "../normalizer.ts";
import quoteFixture from "../fixtures/quote.response.json";
import proposalFixture from "../fixtures/proposal.response.json";
import issuanceFixture from "../fixtures/issuance.response.json";

const ctx = {
  requestId: "req-1",
  policyType: "comprehensive",
  vehicleCategory: "fourWheeler" as const,
};

describe("normalizeQuote (Root-wrapped JSON)", () => {
  const r = normalizeQuote(quoteFixture, ctx);

  it("captures the quotation number as quoteNo + transactionId", () => {
    expect(r.quoteNo).toBe("0000925782");
    expect(r.transactionId).toBe("0000925782");
  });

  it("reads VehicleIDV (plain, no commas)", () => {
    expect(r.idvValue).toBe(572729);
  });

  it("extracts basic OD + TP + total addon premiums", () => {
    expect(r.basicOdPremium).toBe(7521.08);
    expect(r.thirdPartyPremium).toBe(10640);
    expect(r.totalAddonPremium).toBe(3150.01);
  });

  it("treats FG 'Gross Premium' as pre-tax net; gross = net + ServTax", () => {
    expect(r.netPremium).toBeCloseTo(22586.09, 2);
    expect(r.serviceTaxAmount).toBeCloseTo(4065.4962, 2);
    expect(r.grossPremium).toBeCloseTo(26651.5862, 2);
  });

  it("maps known FG line codes to canonical add-on premiums", () => {
    expect(r.addonPremiums.zeroDep).toBe(2233.64); // ZDCNS = Zero Dep + Consumable combo
    expect(r.addonPremiums.ncbProtection).toBe(916.37);
    expect(r.addonPremiums.paOwner).toBe(750);
    expect(r.addonPremiums.paUnnamedPassenger).toBe(375);
    expect(r.addonPremiums.legalLiabilityPaidDriver).toBe(150);
  });

  it("captures the OD special discount and DISCPERC (absolute)", () => {
    expect(r.discounts.ownDamageDiscount).toBe(11281.62);
    expect(r.odDiscountPercent).toBe(60);
  });
});

describe("normalizeProposal (Root-wrapped JSON)", () => {
  it("captures the quote number, IDV and ClientId", () => {
    const r = normalizeProposal(proposalFixture, ctx);
    expect(r.quoteNo).toBe("0000112799");
    expect(r.idvValue).toBe(572729);
    expect(r.contractDetails?.clientId).toBe("80036976");
  });
});

describe("normalizeIssuance (bare JSON envelope)", () => {
  const r = normalizeIssuance(issuanceFixture, { quoteNo: "0000112799" });

  it("binds the issued policy number and marks it ISSUED", () => {
    expect(r.status).toBe("ISSUED");
    expect(r.policyNumber).toBe("132/14/11/0529/MTP/2410002509");
    expect(r.applicationNo).toBe("54/26/FGI/16/0001247");
    expect(r.receiptNo).toBe("54/26/FGI/16/0001247");
    expect(r.clientId).toBe("80036976");
    expect(r.quoteNo).toBe("0000112799");
  });
});

describe("extractRoot", () => {
  it("unwraps a { Root: … } JSON envelope (quote/proposal)", () => {
    const wrapped = { Root: { Client: { QuotationNo: "9" }, Policy: {} } };
    const root = extractRoot(wrapped);
    expect((root.Client as Record<string, unknown>).QuotationNo).toBe("9");
  });

  it("returns a bare { Client, Receipt, Policy } issuance body unchanged", () => {
    const flat = { Client: { ClientId: "1" }, Receipt: { ReceiptNo: "R1" }, Policy: {} };
    expect(extractRoot(flat)).toBe(flat);
  });

  it("parses a JSON-stringified body", () => {
    const root = extractRoot(JSON.stringify({ Root: { Client: { QuotationNo: "7" } } }));
    expect((root.Client as Record<string, unknown>).QuotationNo).toBe("7");
  });
});

import { describe, it, expect } from "vitest";
import {
  normalizeHealthQuote,
  normalizeHealthIssuance,
  extractHealthRoot,
} from "../normalizer.ts";
import quoteFixture from "../fixtures/quote.response.json";
import issuanceFixture from "../fixtures/issuance.response.json";

const ctx = {
  requestId: "req-h1",
  product: "healthAbsolute" as const,
  line: "indemnity" as const,
  policyTermYears: 1,
};

describe("normalizeHealthQuote", () => {
  const r = normalizeHealthQuote(quoteFixture, ctx);

  it("reads the OutputRes premium breakdown", () => {
    expect(r.basePremium).toBe(8555);
    expect(r.netPremium).toBe(8555);
    expect(r.serviceTaxPercent).toBe(18);
    expect(r.serviceTaxAmount).toBeCloseTo(1539.9, 2);
    expect(r.grossPremium).toBe(10095);
  });

  it("sums member sum insured and surfaces per-member premium", () => {
    expect(r.sumInsured).toBe(500000);
    expect(r.members).toHaveLength(1);
    expect(r.members[0]).toMatchObject({
      memberId: 1,
      relation: "SELF",
      sumInsured: 500000,
      coverType: "Classic",
      perPersonPremium: 8555,
    });
  });

  it("falls back to the requestId when FG returns no quotation number", () => {
    expect(r.quoteNo).toBe("req-h1");
    expect(r.product).toBe("healthAbsolute");
    expect(r.line).toBe("indemnity");
  });
});

describe("normalizeHealthIssuance", () => {
  const r = normalizeHealthIssuance(issuanceFixture, { requestId: "req-h1" });

  it("binds the real PolicyNo + ApplicationNo + ClientId + ReceiptNo", () => {
    expect(r.status).toBe("ISSUED");
    expect(r.policyNumber).toBe("VIT-10-24-0000445-00-000");
    expect(r.applicationNo).toBe("G0081816");
    expect(r.clientId).toBe("72596801");
    expect(r.receiptNo).toBe("Z2231823");
  });
});

describe("extractHealthRoot", () => {
  it("unwraps a CreatePolicyResult string envelope", () => {
    const wrapped = { CreatePolicyResult: JSON.stringify({ Policy: { PolicyNo: "X" } }) };
    const root = extractHealthRoot(wrapped);
    expect((root.Policy as Record<string, unknown>).PolicyNo).toBe("X");
  });
});

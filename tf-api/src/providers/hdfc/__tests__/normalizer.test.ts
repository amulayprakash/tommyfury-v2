import { describe, it, expect } from "vitest";
import idvFixture from "../fixtures/responses/idv.json" with { type: "json" };
import premiumFixture from "../fixtures/responses/premium.json" with { type: "json" };
import proposalFixture from "../fixtures/responses/proposal.json" with { type: "json" };
import paymentFixture from "../fixtures/responses/payment.json" with { type: "json" };
import policyDocFixture from "../fixtures/responses/policy-document.json" with { type: "json" };
import {
  normalizeIdv,
  normalizeQuote,
  normalizeProposal,
  normalizePayment,
  normalizeCertificate,
  selectIdvForPremium,
} from "../normalizer.ts";

describe("normalizeIdv", () => {
  it("reads the recommended, min and max IDV", () => {
    expect(normalizeIdv(idvFixture)).toEqual({
      recommended: 949411,
      min: 854470,
      max: 1044352,
    });
  });

  it("returns nulls for an empty body rather than throwing", () => {
    expect(normalizeIdv({})).toEqual({ recommended: null, min: null, max: null });
  });
});

describe("selectIdvForPremium", () => {
  // HDFC rejects any deviation from its recommendation: "IDV Deviation not allowed".
  it("always prefers HDFC's recommended IDV over the caller's", () => {
    expect(selectIdvForPremium({ recommended: 949411, min: 800000, max: 1000000 }, 900000)).toBe(
      949411,
    );
  });

  it("falls back to a caller IDV inside the band when there is no recommendation", () => {
    expect(selectIdvForPremium({ recommended: null, min: 800000, max: 1000000 }, 900000)).toBe(
      900000,
    );
  });

  it("rejects a caller IDV outside the band", () => {
    expect(selectIdvForPremium({ recommended: null, min: 800000, max: 1000000 }, 500000)).toBeNull();
  });

  it("returns null when there is neither a recommendation nor a usable caller value", () => {
    expect(selectIdvForPremium({ recommended: null, min: null, max: null }, 0)).toBeNull();
  });
});

describe("normalizeQuote", () => {
  const ctx = {
    requestId: "req-1",
    quoteNo: "TXN-1",
    policyType: "comprehensive",
    vehicleCategory: "fourWheeler" as const,
  };

  it("reads the premium breakdown from Resp_PvtCar", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.basicOdPremium).toBe(18450);
    expect(q.thirdPartyPremium).toBe(7890);
    expect(q.netPremium).toBe(36568);
    expect(q.serviceTaxAmount).toBe(6582);
    expect(q.grossPremium).toBe(43150);
    expect(q.idvValue).toBe(949411);
  });

  it("maps HDFC cover premiums onto canonical add-on keys", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.addonPremiums.zeroDep).toBe(4200);
    expect(q.addonPremiums.tyreProtect).toBe(1800);
    expect(q.addonPremiums.ncbProtection).toBe(950);
    expect(q.addonPremiums.rti).toBe(1600);
    expect(q.addonPremiums.consumables).toBe(700);
    expect(q.addonPremiums.rsa).toBe(350);
    expect(q.addonPremiums.paOwner).toBe(375);
    // A zero premium means "not selected" — omit rather than report 0.
    expect(q.addonPremiums.engineProtect).toBeUndefined();
  });

  it("reads the NCB discount", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.discounts.ncbAmount).toBe(3200);
    expect(q.discounts.ncbPercent).toBe(20);
  });

  it("stamps identity fields", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.providerSlug).toBe("hdfc");
    expect(q.insurerName).toBe("HDFC ERGO");
    expect(q.quoteNo).toBe("TXN-1");
    expect(q.transactionId).toBe("TXN-1");
    expect(q.requestId).toBe("req-1");
  });

  it("reports amounts in whole rupees, not paise", () => {
    // The whole stack is rupees end to end; a paise conversion here would show
    // a 100x premium on the compare card.
    expect(normalizeQuote(premiumFixture, ctx).grossPremium).toBe(43150);
  });
});

describe("normalizeProposal", () => {
  it("reads the proposal number", () => {
    expect(normalizeProposal(proposalFixture).proposalNumber).toBe("PR2026080700123");
  });

  it("returns undefined when HDFC returned no proposal number", () => {
    expect(normalizeProposal({ StatusCode: "1" }).proposalNumber).toBeUndefined();
  });
});

describe("normalizePayment", () => {
  it("reads the policy number from PolicyNumber", () => {
    expect(normalizePayment(paymentFixture).policyNumber).toBe("2311202600012345");
  });

  it("accepts the Policy_Number spelling too", () => {
    expect(
      normalizePayment({ Policy_Details: { Policy_Number: "X1" } }).policyNumber,
    ).toBe("X1");
  });
});

describe("normalizeCertificate", () => {
  it("reads the base64 policy document", () => {
    const c = normalizeCertificate(policyDocFixture);
    expect(c.coiBase64).toBe("JVBERi0xLjQKJVBPTElDWQ==");
    expect(c.policyNumber).toBe("2311202600012345");
  });
});

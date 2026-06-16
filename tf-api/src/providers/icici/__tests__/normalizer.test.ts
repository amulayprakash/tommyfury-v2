import { describe, it, expect } from "vitest";
import {
  normalizeQuote,
  normalizeProposal,
  normalizeCkyc,
  normalizeOvd,
  normalizePolicyStatus,
  normalizeCertificate,
  mapPolicyStatus,
} from "../normalizer.ts";
import { CanonicalQuoteResultSchema } from "@/contracts/quote-result.ts";

import quoteFixture from "../fixtures/quote.response.json";
import proposalFixture from "../fixtures/proposal.response.json";
import ckycFixture from "../fixtures/ckyc.response.json";
import ovdFixture from "../fixtures/ovd.response.json";
import policyStatusFixture from "../fixtures/policy-status.response.json";
import coiFixture from "../fixtures/coi.response.json";

const ctx = { requestId: "req-1", policyType: "comprehensive", vehicleCategory: "fourWheeler" as const };

describe("normalizeQuote", () => {
  const result = normalizeQuote(quoteFixture, ctx);

  it("satisfies the canonical schema", () => {
    expect(CanonicalQuoteResultSchema.safeParse(result).success).toBe(true);
  });

  it("maps premium, IDV and identity fields", () => {
    expect(result.providerSlug).toBe("icici");
    expect(result.quoteNo).toBe("epn_4kmbJzdvQtrANuxnme");
    expect(result.transactionId).toBe("epn_4kmbJzdvQtrANuxnme");
    expect(result.netPremium).toBe(10053);
    expect(result.grossPremium).toBe(11863);
    expect(result.serviceTaxAmount).toBe(1810);
    expect(result.idvValue).toBe(510498);
    expect(result.minIdv).toBe(456761);
    expect(result.maxIdv).toBe(605606);
  });

  it("extracts addon premiums and discounts from MotorPremium", () => {
    expect(result.addonPremiums.rsa).toBe(499);
    expect(result.addonPremiums.zeroDep).toBe(1200);
    expect(result.addonPremiums.paOwner).toBe(330);
    expect(result.discounts.ncbAmount).toBe(6034);
    expect(result.discounts.payU).toBe(737);
  });

  it("reads the misspelled PolicyEndtDate key", () => {
    expect(result.policyStartDate).toBe("2024-10-02T00:00:00");
    expect(result.policyEndDate).toBe("2025-10-01T23:59:59");
    expect(result.isInspectionRequired).toBe(false);
  });
});

describe("normalizeProposal", () => {
  it("extracts policy number, payment link and status", () => {
    const overlay = normalizeProposal(proposalFixture);
    expect(overlay.policyNumber).toBe("3005/52846255/00/B00");
    expect(overlay.paymentUrl).toContain("janus.icicilombard.com");
    expect(overlay.status).toBe("ISSUED");
    expect(overlay.contractDetails.isKycSuccess).toBe(true);
  });
});

describe("normalizeCkyc / normalizeOvd", () => {
  it("maps CKYC result", () => {
    const r = normalizeCkyc(ckycFixture);
    expect(r.kycId).toBe("kyc_5ferAmAMVXClJFKnXnWPa");
    expect(r.isKycSuccess).toBe(true);
    expect(r.name).toBe("fhgf gft hjgyu");
  });

  it("maps OVD result", () => {
    const r = normalizeOvd(ovdFixture);
    expect(r.kycId).toBe("kyc_5k4grUGluqgq7VB29pLCh");
    expect(r.isKycSuccess).toBe(true);
  });
});

describe("normalizePolicyStatus", () => {
  it("maps status onto the canonical enum", () => {
    const r = normalizePolicyStatus(policyStatusFixture);
    expect(r.status).toBe("ISSUED");
    expect(r.policyNumber).toBe("3001/52846255/00/B00");
  });

  it("maps known and unknown raw statuses", () => {
    expect(mapPolicyStatus("IN PROGRESS")).toBe("IN_PROGRESS");
    expect(mapPolicyStatus("INSPECTION_PENDING")).toBe("INSPECTION_PENDING");
    expect(mapPolicyStatus("weird")).toBe("UNKNOWN");
    expect(mapPolicyStatus(undefined)).toBe("UNKNOWN");
  });
});

describe("normalizeCertificate", () => {
  it("extracts the base64 COI", () => {
    const r = normalizeCertificate(coiFixture);
    expect(r.coiBase64).toBe("JVBERi0xLjMKJeLjz9MKMTAgMCBvYmo8PC9QIDEx");
    expect(r.status).toBe("ISSUED");
  });
});

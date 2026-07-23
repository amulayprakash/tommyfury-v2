import { describe, it, expect, afterEach } from "vitest";
import { renewalProposal } from "@/services/renewal.service.ts";
import { registerProvider, clearRegistry } from "@/providers/provider-registry.ts";
import type { RenewalProvider } from "@/providers/insurance-provider.ts";
import type { RenewalProposalRequest } from "@/contracts/renewal.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";

const sampleReq: RenewalProposalRequest = {
  productCode: "FPV",
  previousPolicyNo: "VD731720",
  proposalNo: "00VD731720",
  clientCode: "72782626",
  startDate: "2025-03-31",
  expiryDate: "2026-03-30",
  agentCode: "60081262",
  branch: "12",
  coverCode: "CO",
  vehicleIdv: 603000,
  discountPercentage: -80,
  addonCodes: [],
};

function fakeRenewalProvider(): RenewalProvider {
  return {
    slug: "fake",
    displayName: "Fake",
    capabilities: new Set(),
    operations: new Set(["renewal"]),
    motorCapabilities: {},
    getQuote: async () => ({}) as CanonicalQuoteResult,
    getFullQuote: async () => ({}) as CanonicalQuoteResult,
    renewalQuote: async () => ({}) as CanonicalQuoteResult,
    renewalProposal: async (req: RenewalProposalRequest) =>
      ({ quoteNo: req.proposalNo, providerSlug: "fake" }) as CanonicalQuoteResult,
    renewalCreatePolicy: async () => ({ providerSlug: "fake", status: "ISSUED" }),
  } as unknown as RenewalProvider;
}

afterEach(() => clearRegistry());

describe("renewal.service renewalProposal", () => {
  it("dispatches to the provider's renewalProposal", async () => {
    registerProvider(fakeRenewalProvider());
    const result = await renewalProposal("fake", sampleReq);
    expect(result.quoteNo).toBe("00VD731720");
  });

  it("rejects a provider that does not support renewal", async () => {
    await expect(renewalProposal("missing", sampleReq)).rejects.toBeTruthy();
  });
});

import { describe, it, expect, vi } from "vitest";
import { FgProvider } from "../../fg.provider.ts";
import type { FgConfig } from "../../config.ts";
import type { FgTransport } from "../../http.ts";
import { passthroughHealthResolver } from "../db-code-resolver.ts";
import { HealthQuoteRequestSchema } from "@/contracts/health/health-quote-request.ts";
import { HealthIssuanceRequestSchema } from "@/contracts/health/health-policy.ts";
import quoteFixture from "../fixtures/quote.response.json";
import issuanceFixture from "../fixtures/issuance.response.json";

const config = {
  vendorCode: "webagg",
  credentialSetId: "test",
  health: {
    baseUrl: "https://uat.example.com/Health/1.0.0/BO/Service.svc",
    tokenUrl: "https://uat.example.com/oauth2/token",
    clientBasic: "x",
    agentCode: "60000272",
    branchCode: "10",
  },
} as unknown as FgConfig;

function makeProvider(response: unknown): { provider: FgProvider; transport: FgTransport } {
  const transport: FgTransport = { request: vi.fn().mockResolvedValue(response) };
  const provider = new FgProvider({
    config,
    transport,
    healthTokenProvider: async () => "test-token",
    healthCodeResolver: passthroughHealthResolver,
  });
  return { provider, transport };
}

const quoteReq = HealthQuoteRequestSchema.parse({
  product: "healthAbsolute",
  members: [
    { relation: "self", name: "shiv dayal kumawat", dob: "1993-08-16", gender: "M", sumInsured: 500000 },
  ],
});

describe("FgProvider health line", () => {
  it("advertises the health products it supports", () => {
    const { provider } = makeProvider(quoteFixture);
    expect(provider.healthCapabilities.healthAbsolute).toBeDefined();
    expect(provider.healthCapabilities.personalAccident?.line).toBe("pa");
  });

  it("getHealthQuote sends a SOAP body and normalizes the premium", async () => {
    const { provider, transport } = makeProvider(quoteFixture);
    const result = await provider.getHealthQuote(quoteReq, { requestId: "req-1" });

    expect(result.grossPremium).toBe(10095);
    expect(result.product).toBe("healthAbsolute");
    const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.url).toContain("/BO/Service.svc");
    expect(call.xmlBody).toContain("<tem:Product>HealthAbsolute</tem:Product>");
    expect(call.token).toBe("test-token");
  });

  it("issueHealthPolicy returns the bound policy number", async () => {
    const { provider } = makeProvider(issuanceFixture);
    const issuance = HealthIssuanceRequestSchema.parse({
      ...quoteReq,
      quoteId: "Q-1",
      proposer: {
        firstName: "Shiv",
        lastName: "Kumawat",
        email: "s@example.com",
        mobile: "9829876493",
        dob: "1993-08-16",
        gender: "M",
      },
      address: { addressLine1: "x", pincode: "626138", city: "V", state: "TN" },
      receipt: {
        uniqueTranKey: "K1",
        transactionDate: "01/01/2025",
        amount: 10095,
        tranRefNo: "T1",
        tranRefNoDate: "01/01/2025",
        pgType: "PAYU",
      },
    });
    const result = await provider.issueHealthPolicy(issuance, { requestId: "req-2" });
    expect(result.status).toBe("ISSUED");
    expect(result.policyNumber).toBe("VIT-10-24-0000445-00-000");
  });
});

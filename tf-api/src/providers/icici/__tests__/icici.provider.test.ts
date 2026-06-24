import { describe, it, expect } from "vitest";
import { IciciProvider, passthroughCodeResolver } from "../icici.provider.ts";
import type { IciciTransport } from "../http.ts";
import type { IciciConfig } from "../config.ts";
import { MotorQuoteRequestSchema, MotorFullQuoteRequestSchema } from "@/contracts/quote-request.ts";
import { CanonicalQuoteResultSchema } from "@/contracts/quote-result.ts";

import quoteFixture from "../fixtures/quote.response.json";
import proposalFixture from "../fixtures/proposal.response.json";
import ckycFixture from "../fixtures/ckyc.response.json";
import policyStatusFixture from "../fixtures/policy-status.response.json";
import coiFixture from "../fixtures/coi.response.json";

const config: IciciConfig = {
  baseUrl: "https://uat.example",
  login: "user",
  password: "pass",
  aesKey: "key",
  aesMode: "aes-256-ecb",
  credentialSetId: "default",
};

type ReqArgs = Parameters<IciciTransport["request"]>[0];

/** Routes ICICI calls to recorded fixtures by URL/method; records sent bodies. */
function fakeTransport(overrides: Partial<Record<string, unknown>> = {}): {
  transport: IciciTransport;
  sent: ReqArgs[];
} {
  const sent: ReqArgs[] = [];
  const transport: IciciTransport = {
    async request(args) {
      sent.push(args);
      const u = args.url;
      if (u.includes("/proposal")) return overrides.proposal ?? proposalFixture;
      if (u.includes("/premium")) return overrides.quote ?? quoteFixture; // GET + POST
      if (u.includes("/ckyc")) return ckycFixture;
      if (u.includes("/policy")) return overrides.policyStatus ?? policyStatusFixture;
      if (u.includes("/certificate")) return coiFixture;
      throw new Error(`unexpected url ${u}`);
    },
  };
  return { transport, sent };
}

function makeProvider(t: IciciTransport) {
  return new IciciProvider({
    config,
    transport: t,
    codeResolver: passthroughCodeResolver,
    tokenProvider: async () => "test-token",
  });
}

const quoteReq = MotorQuoteRequestSchema.parse({
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  makeId: "10",
  makeName: "Make",
  modelId: "11846",
  modelName: "Model",
  fuelType: "petrol",
  rtoCode: "12621",
  registrationDate: "2021-06-01",
  zeroDep: true,
});

const fullReq = MotorFullQuoteRequestSchema.parse({
  ...quoteReq,
  quoteId: "epn_txn",
  amountCollected: 11863,
  paymentTransactionId: "pay-1",
  proposer: { firstName: "Ravi", lastName: "Kumar", email: "r@e.com", mobile: "9876543210", dob: "1990-05-15" },
  address: { addressLine1: "MG Road", pincode: "421004", city: "Kalyan", state: "MH" },
  vehicle: { engineNumber: "ENG1", chassisNumber: "CHS1", financeType: "none" },
});

describe("IciciProvider.getQuote", () => {
  it("returns a canonical quote result", async () => {
    const { transport } = fakeTransport();
    const result = await makeProvider(transport).getQuote(quoteReq, { requestId: "r1" });
    expect(CanonicalQuoteResultSchema.safeParse(result).success).toBe(true);
    expect(result.providerSlug).toBe("icici");
    expect(result.grossPremium).toBe(11863);
  });
});

describe("IciciProvider.getFullQuote", () => {
  it("overlays the proposal onto the quote (issued, no inspection)", async () => {
    const { transport, sent } = fakeTransport();
    const result = await makeProvider(transport).getFullQuote(fullReq, { requestId: "r2" });
    expect(result.policyNumber).toBe("3005/52846255/00/B00");
    expect(result.paymentUrl).toContain("janus.icicilombard.com");
    // Payment was bound (not forced proposal-only) since inspection isn't required.
    const proposal = sent.find((s) => s.url.includes("/proposal"));
    expect(proposal?.jsonBody).toMatchObject({ isProposalOnly: false, AmountCollected: 11863 });
  });

  it("forces proposal-only (no payment) when the quote requires inspection and it isn't approved", async () => {
    const inspectionQuote = { ...quoteFixture, IsInspectionRequire: true };
    const pendingStatus = { ...policyStatusFixture, Status: "INSPECTION_PENDING" };
    const { transport, sent } = fakeTransport({ quote: inspectionQuote, policyStatus: pendingStatus });

    await makeProvider(transport).getFullQuote(fullReq, { requestId: "r3" });

    const proposal = sent.find((s) => s.url.includes("/proposal"));
    expect(proposal?.jsonBody).toMatchObject({ isProposalOnly: true, AmountCollected: 0 });
    expect((proposal?.jsonBody as Record<string, unknown>).PaymentTransactionId).toBe("");
  });
});

describe("IciciProvider lifecycle calls", () => {
  it("completeCkyc / getPolicyStatus / getCertificate normalize", async () => {
    const { transport } = fakeTransport();
    const provider = makeProvider(transport);

    const kyc = await provider.completeCkyc(
      { transactionId: "epn", dob: "2001-10-29", policyType: "motor" },
      { requestId: "r4" },
    );
    expect(kyc.isKycSuccess).toBe(true);

    const status = await provider.getPolicyStatus({ transactionId: "epn" }, { requestId: "r5" });
    expect(status.status).toBe("ISSUED");

    const coi = await provider.getCertificate("epn", { requestId: "r6" });
    expect(coi.coiBase64.length).toBeGreaterThan(0);
  });
});

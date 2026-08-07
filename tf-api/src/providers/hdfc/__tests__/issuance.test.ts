import { describe, it, expect, vi } from "vitest";
import paymentFixture from "../fixtures/responses/payment.json" with { type: "json" };
import policyDocFixture from "../fixtures/responses/policy-document.json" with { type: "json" };
import { HdfcProvider } from "../hdfc.provider.ts";
import { passthroughCodeResolver } from "../db-code-resolver.ts";
import type { HdfcConfig } from "../config.ts";
import type { HdfcTransport } from "../http.ts";
import type { PolicyIssuanceRequest } from "@/contracts/policy.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "S",
  channelId: "C",
  credential: "x",
  productCode: "2311",
  tokenTtlSeconds: 1500,
  kyc: { baseUrl: "https://kyc.example", apiKey: "k", tokenTtlSeconds: 480, returnUrl: "" },
};

interface Call {
  url: string;
  jsonBody?: unknown;
}

function recordingTransport(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const transport: HdfcTransport = {
    request: vi.fn(async (args) => {
      calls.push({ url: args.url, jsonBody: args.jsonBody });
      const key = Object.keys(responses).find((k) => args.url.endsWith(k));
      return key ? responses[key] : {};
    }),
  };
  return { transport, calls };
}

function provider(transport: HdfcTransport) {
  return new HdfcProvider({
    config,
    transport,
    codeResolver: passthroughCodeResolver,
    tokenProvider: async () => "tok-1",
  });
}

const issueReq: PolicyIssuanceRequest = {
  quoteNo: "PR2026080700123",
  clientId: "CL-1",
  transactionId: "TXN-1",
  vehicleCategory: "fourWheeler",
  receipt: {
    uniqueTranKey: "UTK-1",
    transactionDate: "07/08/2026 16:26:00",
    receiptType: "IVR",
    amount: 43150,
    tranRefNo: "PG-77",
    tranRefNoDate: "07/08/2026",
    pgType: "PAYU",
  },
} as PolicyIssuanceRequest;

const ctx = { requestId: "req-1" };

describe("issuePolicy", () => {
  it("submits payment then fetches the policy document", async () => {
    const { transport, calls } = recordingTransport({
      submitpaymentdetails: paymentFixture,
      getpolicydocument: policyDocFixture,
    });
    await provider(transport).issuePolicy(issueReq, ctx);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual([
      "submitpaymentdetails",
      "getpolicydocument",
    ]);
  });

  it("maps the canonical receipt onto HDFC's Payment_Details", async () => {
    const { transport, calls } = recordingTransport({
      submitpaymentdetails: paymentFixture,
      getpolicydocument: policyDocFixture,
    });
    await provider(transport).issuePolicy(issueReq, ctx);
    const body = calls[0]!.jsonBody as {
      Proposal_no: string;
      TransactionID: string;
      Payment_Details: Record<string, unknown>;
    };
    expect(body.Proposal_no).toBe("PR2026080700123");
    expect(body.TransactionID).toBe("TXN-1");
    expect(body.Payment_Details.PAYMENT_AMOUNT).toBe("43150");
    expect(body.Payment_Details.INSTRUMENT_NUMBER).toBe("PG-77");
  });

  it("falls back to clientId when no transactionId was supplied", async () => {
    const { transport, calls } = recordingTransport({
      submitpaymentdetails: paymentFixture,
      getpolicydocument: policyDocFixture,
    });
    await provider(transport).issuePolicy({ ...issueReq, transactionId: undefined }, ctx);
    expect((calls[0]!.jsonBody as { TransactionID: string }).TransactionID).toBe("CL-1");
  });

  it("returns the issued policy number", async () => {
    const { transport } = recordingTransport({
      submitpaymentdetails: paymentFixture,
      getpolicydocument: policyDocFixture,
    });
    const out = await provider(transport).issuePolicy(issueReq, ctx);
    expect(out.status).toBe("ISSUED");
    expect(out.policyNumber).toBe("2311202600012345");
    expect(out.providerSlug).toBe("hdfc");
    expect(out.quoteNo).toBe("PR2026080700123");
  });

  it("does not fetch the policy document when no policy number came back", async () => {
    const { transport, calls } = recordingTransport({
      submitpaymentdetails: { StatusCode: "1" },
    });
    const out = await provider(transport).issuePolicy(issueReq, ctx);
    expect(out.status).toBe("IN_PROGRESS");
    expect(calls).toHaveLength(1);
  });

  it("surfaces HDFC's payment rejection verbatim", async () => {
    const { transport } = recordingTransport({
      submitpaymentdetails: { StatusCode: "0", Error: "BUSINESS EXCEPTION: Amount mismatch" },
    });
    await expect(provider(transport).issuePolicy(issueReq, ctx)).rejects.toThrow(/Amount mismatch/);
  });
});

describe("getCertificate", () => {
  it("fetches the policy document by policy number", async () => {
    const { transport, calls } = recordingTransport({ getpolicydocument: policyDocFixture });
    const coi = await provider(transport).getCertificate("2311202600012345", ctx);
    expect(coi.coiBase64).toBe("JVBERi0xLjQKJVBPTElDWQ==");
    const body = calls[0]!.jsonBody as { Req_Policy_Document: { Policy_Number: string } };
    expect(body.Req_Policy_Document.Policy_Number).toBe("2311202600012345");
  });
});

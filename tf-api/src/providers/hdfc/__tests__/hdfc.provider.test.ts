import { describe, it, expect, vi } from "vitest";
import idvFixture from "../fixtures/responses/idv.json" with { type: "json" };
import premiumFixture from "../fixtures/responses/premium.json" with { type: "json" };
import proposalFixture from "../fixtures/responses/proposal.json" with { type: "json" };
import { HdfcProvider } from "../hdfc.provider.ts";
import { passthroughCodeResolver } from "../db-code-resolver.ts";
import type { HdfcConfig } from "../config.ts";
import type { HdfcTransport } from "../http.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "NOVACRED",
  channelId: "NOVA0001",
  credential: "s3cret",
  productCode: "2311",
  tokenTtlSeconds: 1500,
  kyc: { baseUrl: "https://kyc.example", apiKey: "k", tokenTtlSeconds: 480, returnUrl: "https://r" },
};

interface Call {
  url: string;
  headers: Record<string, string>;
  jsonBody?: unknown;
}

function recordingTransport(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const transport: HdfcTransport = {
    request: vi.fn(async (args) => {
      calls.push({ url: args.url, headers: args.headers, jsonBody: args.jsonBody });
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

const quoteReq = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  makeId: "MAR",
  makeName: "MARUTI",
  modelId: "38908",
  modelName: "SWIFT",
  fuelType: "petrol",
  rtoCode: "10406",
  registrationDate: "2019-06-15",
  registrationNumber: "MH01QQ7878",
  isPreviousPolicyExpired: false,
  claimInPreviousPolicy: false,
  ncbPercent: 20,
  idvValue: 500000,
  zeroDep: true,
  engineProtect: false,
  rsa: false,
  tyreProtect: false,
  rimProtect: false,
  rti: false,
  consumables: false,
  paOwner: true,
  paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false,
  keyProtect: false,
  garageCash: false,
  lossOfBelongings: false,
  batteryProtect: false,
  drivingAccessories: false,
  ncbProtection: false,
} as MotorQuoteRequest;

const ctx = { requestId: "req-1" };

describe("getQuote", () => {
  it("calls IDV then premium, in that order", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).getQuote(quoteReq, ctx);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["getcalculateidv", "calculatepremium"]);
  });

  it("prices with HDFC's recommended IDV, not the caller's", async () => {
    // "IDV Deviation not allowed" — the recommendation always wins.
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).getQuote(quoteReq, ctx);
    const premiumBody = calls[1]!.jsonBody as { Policy_Details: { Vehicle_IDV: number } };
    expect(premiumBody.Policy_Details.Vehicle_IDV).toBe(1244800);
  });

  it("sends the channel headers and the bearer token on every data call", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).getQuote(quoteReq, ctx);
    for (const call of calls) {
      expect(call.headers).toMatchObject({
        SOURCE: "NOVACRED",
        CHANNEL_ID: "NOVA0001",
        PRODUCT_CODE: "2311",
        TOKEN: "tok-1",
      });
    }
  });

  it("returns a canonical quote with the HDFC premium", async () => {
    const { transport } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    const q = await provider(transport).getQuote(quoteReq, ctx);
    expect(q.providerSlug).toBe("hdfc");
    expect(q.grossPremium).toBe(25230);
    expect(q.idvValue).toBe(1244800);
    expect(q.minIdv).toBe(1182560);
    expect(q.maxIdv).toBe(1556000);
  });

  it("shares one TransactionID across the IDV and premium calls", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).getQuote(quoteReq, ctx);
    const a = (calls[0]!.jsonBody as { TransactionID: string }).TransactionID;
    const b = (calls[1]!.jsonBody as { TransactionID: string }).TransactionID;
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });

  it("surfaces HDFC's business exception verbatim", async () => {
    const { transport } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: { StatusCode: "0", Error: "BUSINESS EXCEPTION: RTO not serviceable" },
    });
    await expect(provider(transport).getQuote(quoteReq, ctx)).rejects.toThrow(
      /RTO not serviceable/,
    );
  });

  /**
   * The accessory cap can only be judged against HDFC's own recommended IDV, so
   * the guard sits between GetCalculateIDV and CalculatePremium. The fixture
   * recommends ₹12,44,800, which caps accessories at ₹3,11,200.
   */
  describe("accessory sum-insured cap", () => {
    it("refuses before CalculatePremium when the accessories breach the cap", async () => {
      const { transport, calls } = recordingTransport({
        getcalculateidv: idvFixture,
        calculatepremium: premiumFixture,
      });
      await expect(
        provider(transport).getQuote(
          { ...quoteReq, electricalAccessoriesSI: 200_000, nonElectricalAccessoriesSI: 200_000 },
          ctx,
        ),
      ).rejects.toThrow(/25%/);
      // Only the IDV call went out: the premium call must never be attempted.
      expect(calls.map((c) => c.url.split("/").pop())).toEqual(["getcalculateidv"]);
    });

    it("prices accessories that sit inside the cap", async () => {
      const { transport, calls } = recordingTransport({
        getcalculateidv: idvFixture,
        calculatepremium: premiumFixture,
      });
      await provider(transport).getQuote(
        { ...quoteReq, electricalAccessoriesSI: 200_000, nonElectricalAccessoriesSI: 100_000 },
        ctx,
      );
      expect(calls.map((c) => c.url.split("/").pop())).toEqual([
        "getcalculateidv",
        "calculatepremium",
      ]);
    });
  });
});

/**
 * The cap sits in `priceQuote`, which getQuote and getFullQuote share. That
 * makes it a single choke point — but only if the proposal path really does go
 * through it, which is what this proves. Without it the guard could be silently
 * bypassed on the one path that binds a policy.
 */
describe("accessory cap on the proposal path", () => {
  const fullish = {
    quoteId: "TXN-1",
    proposer: {
      firstName: "MAHENDRA",
      lastName: "GHANCHI",
      email: "m@example.com",
      mobile: "7387005111",
      dob: "1996-07-22",
      panNumber: "BXGPG2512P",
    },
    address: { addressLine1: "12 Main St", pincode: "307801", city: "MUMBAI", state: "MH" },
    vehicle: { engineNumber: "EN123", chassisNumber: "CH123", financeType: "none" },
    kycRefId: "KYC-99",
    isProposalOnly: false,
    isVehicleUnderLoan: false,
  };

  it("refuses before CreateProposal, so an over-cap policy can never be bound", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
      getproposaldocument: { StatusCode: "1" },
    });
    await expect(
      provider(transport).getFullQuote(
        {
          ...quoteReq,
          ...fullish,
          electricalAccessoriesSI: 200_000,
          nonElectricalAccessoriesSI: 200_000,
        } as MotorFullQuoteRequest,
        ctx,
      ),
    ).rejects.toThrow(/25%/);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["getcalculateidv"]);
  });
});

describe("getFullQuote", () => {
  const fullReq = {
    ...quoteReq,
    quoteId: "TXN-1",
    proposer: {
      firstName: "MAHENDRA",
      lastName: "GHANCHI",
      email: "m@example.com",
      mobile: "7387005111",
      dob: "1996-07-22",
      panNumber: "BXGPG2512P",
    },
    address: { addressLine1: "12 Main St", pincode: "307801", city: "MUMBAI", state: "MH" },
    vehicle: { engineNumber: "EN123", chassisNumber: "CH123", financeType: "none" },
    kycRefId: "KYC-99",
    isProposalOnly: false,
    isVehicleUnderLoan: false,
  } as MotorFullQuoteRequest;

  it("runs IDV, premium, proposal and proposal-document in order", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
      getproposaldocument: { StatusCode: "1" },
    });
    await provider(transport).getFullQuote(fullReq, ctx);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual([
      "getcalculateidv",
      "calculatepremium",
      "createproposal",
      "getproposaldocument",
    ]);
  });

  it("returns the proposal number in contractDetails", async () => {
    const { transport } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
      getproposaldocument: { StatusCode: "1" },
    });
    const q = await provider(transport).getFullQuote(fullReq, ctx);
    expect(q.contractDetails?.proposalNumber).toBe("PR2026080700123");
  });

  it("feeds the Pehchaan id into Customer_Pehchaan_id", async () => {
    const { transport, calls } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
      getproposaldocument: { StatusCode: "1" },
    });
    await provider(transport).getFullQuote(fullReq, ctx);
    const body = calls[2]!.jsonBody as { Customer_Details: Record<string, unknown> };
    expect(body.Customer_Details.Customer_Pehchaan_id).toBe("KYC-99");
  });

  it("refuses to create a proposal without a verified KYC id", async () => {
    // HDFC's rule: never issue when iskycVerified !== 1.
    const { transport } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    const noKyc = { ...fullReq, kycRefId: undefined, ckyc: undefined };
    await expect(provider(transport).getFullQuote(noKyc, ctx)).rejects.toThrow(/KYC/i);
  });

  it("throws when HDFC returns no proposal number", async () => {
    const { transport } = recordingTransport({
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
      createproposal: { StatusCode: "1" },
    });
    await expect(provider(transport).getFullQuote(fullReq, ctx)).rejects.toThrow(/proposal number/i);
  });
});

describe("initiateOvd", () => {
  it("rejects with 501 — HDFC's KYC kit has no document-upload API", async () => {
    const { transport } = recordingTransport({});
    await expect(
      provider(transport).initiateOvd({ transactionId: "T" } as never, [], ctx),
    ).rejects.toThrow(/not support/i);
  });
});

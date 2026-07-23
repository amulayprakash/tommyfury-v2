import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fgRenewalQuote,
  fgRenewalProposal,
  fgRenewalCreatePolicy,
} from "../renewal.ts";
import { FgProvider } from "../fg.provider.ts";
import type { FgConfig } from "../config.ts";
import {
  RenewalQuoteRequestSchema,
  RenewalProposalRequestSchema,
  RenewalCreatePolicyRequestSchema,
} from "@/contracts/renewal.ts";
import quoteFixture from "../fixtures/renewal-quote.response.json";
import breakinFixture from "../fixtures/renewal-quote.breakin.response.json";
import quoteFailFixture from "../fixtures/renewal-quote.fail.response.json";
import proposalFixture from "../fixtures/renewal-proposal.response.json";
import proposalFailFixture from "../fixtures/renewal-proposal.fail.response.json";
import issuanceFixture from "../fixtures/renewal-issuance.response.json";
import issuanceFailFixture from "../fixtures/renewal-issuance.fail.response.json";

const config = {
  vendorCode: "Webagg",
  renewal: {
    baseUrl: "https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify",
  },
} as unknown as FgConfig;

/** Captures the fetch args so the test can assert URL + Internal-Key header. */
function mockFetch(body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function mockFetchStatus(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("renewal contracts", () => {
  it("accepts a ModifyRenewalQuote request", () => {
    const parsed = RenewalQuoteRequestSchema.parse({ policyNo: "VD731720" });
    expect(parsed.policyNo).toBe("VD731720");
  });

  it("accepts a ModifyRenewalProposal request (echo + modify delta)", () => {
    const parsed = RenewalProposalRequestSchema.parse({
      productCode: "FPV",
      previousPolicyNo: "VD932796",
      proposalNo: "00VD932796",
      clientCode: "76583956",
      startDate: "2025-03-31",
      expiryDate: "2026-03-30",
      agentCode: "60081262",
      branch: "12",
      coverCode: "CO",
      vehicleIdv: 603000,
      discountPercentage: -80,
      addonCodes: ["STZDP"],
      idvOfCngOrLpg: 15000,
    });
    expect(parsed.vehicleIdv).toBe(603000);
    expect(parsed.discountPercentage).toBe(-80);
  });

  it("accepts a ModifyRenewalPolicyIssuance request", () => {
    const parsed = RenewalCreatePolicyRequestSchema.parse({
      policyNo: "VD731720",
      clientId: "72782626",
      proposalNo: "00VD731720",
      agentCode: "60084677",
      branchCode: "2J",
      receipt: {
        uniqueTranKey: "TD89984789",
        transactionDate: "01/12/2025",
        receiptType: "IVR",
        amount: 7783,
        tranRefNo: "24709987121",
        tranRefNoDate: "01/12/2025",
        pgType: "PAYU",
      },
    });
    expect(parsed.clientId).toBe("72782626");
  });
});

describe("fgRenewalQuote", () => {
  it("prices the expiring policy from the snapshot and derives linkage keys", async () => {
    const { fn, calls } = mockFetch(quoteFixture);
    vi.stubGlobal("fetch", fn);

    const q = await fgRenewalQuote(config, { policyNo: "VD731720" }, "tok", { requestId: "r1" });

    // Endpoint + Internal-Key header (NOT Authorization: Bearer).
    expect(calls[0]?.url).toBe(
      "https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify/ModifyRenewalQuote",
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Internal-Key"]).toBe("tok");
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");

    // Linkage: quoteNo == ProposalNo == "00" + policy no.
    expect(q.quoteNo).toBe("00VD731720");
    expect(q.transactionId).toBe("00VD731720");
    expect(q.providerSlug).toBe("fg");
    expect(q.policyType).toBe("comprehensive"); // CoverCode CO
    expect(q.vehicleCategory).toBe("fourWheeler"); // ProductCode FPV
    // Comma-grouped decimal strings → whole-rupee ints.
    expect(q.idvValue).toBe(256500); // "256,500"
    expect(q.grossPremium).toBe(7469); // "7468.80"
    expect(q.serviceTaxAmount).toBe(989); // "988.52"
    expect(q.basicOdPremium).toBe(3018); // "3017.77"
    expect(q.thirdPartyPremium).toBe(2474); // "2474"
    expect(q.totalAddonPremium).toBe(1667); // "1667.26"
    expect(q.netPremium).toBe(6480); // gross - tax
    expect(q.isInspectionRequired).toBe(false);
    expect(q.contractDetails?.clientCode).toBe("72782626");
    expect(q.contractDetails?.proposalNo).toBe("00VD731720");
    expect(q.contractDetails?.agentCode).toBe("60046470");
    expect(q.contractDetails?.branch).toBe("2J");
    // Surfaced as a NUMBER (FG "70") so it threads straight into the proposal.
    expect(q.contractDetails?.discountPercentage).toBe(70);
  });

  it("flags a break-in Success as inspection-required (ErrorCode 0)", async () => {
    const { fn } = mockFetch(breakinFixture);
    vi.stubGlobal("fetch", fn);
    const q = await fgRenewalQuote(config, { policyNo: "VD735683" }, "tok", { requestId: "r2" });
    expect(q.isInspectionRequired).toBe(true);
    expect(q.vehicleCategory).toBe("commercial"); // FCV
    expect(q.contractDetails?.previousPolicyNCB).toBe("35");
    expect(q.contractDetails?.eligiblePolicyNCB).toBe("45");
  });

  it("throws a classified ProviderError on a Fail response", async () => {
    const { fn } = mockFetch(quoteFailFixture);
    vi.stubGlobal("fetch", fn);
    await expect(
      fgRenewalQuote(config, { policyNo: "BAD" }, "tok", { requestId: "r3" }),
    ).rejects.toThrow(/Please pass correct policy number/);
  });

  it("wraps a non-2xx HTTP response as a ProviderError", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(401, { message: "unauthorized" }));
    await expect(
      fgRenewalQuote(config, { policyNo: "VD731720" }, "tok", { requestId: "r4" }),
    ).rejects.toMatchObject({ upstreamStatus: 401 });
  });
});

describe("fgRenewalProposal", () => {
  it("builds the modify payload (preserving misspellings) and prices the bound proposal", async () => {
    const { fn, calls } = mockFetch(proposalFixture);
    vi.stubGlobal("fetch", fn);

    const result = await fgRenewalProposal(
      config,
      {
        productCode: "FPV",
        previousPolicyNo: "VD731720",
        proposalNo: "00VD731720",
        clientCode: "72782626",
        startDate: "2025-03-31",
        expiryDate: "2026-03-30",
        ckycNo: "987654545678",
        ckycRefNo: "3456890878765",
        agentCode: "60081262",
        branch: "12",
        coverCode: "CO",
        vehicleIdv: 603000,
        discountPercentage: -80,
        addonCodes: ["STZDP"],
        idvOfCngOrLpg: 15000,
        inspectionNo: "132702032026",
        inspectionDate: "2026-03-02",
      },
      "tok",
      { requestId: "r5" },
    );

    expect(calls[0]?.url).toBe(
      "https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify/ModifyRenewalProposal",
    );
    const sent = JSON.parse((calls[0]?.init.body as string) ?? "{}");
    // Load-bearing misspelling + FG date format in the request.
    expect(sent.PolicyDetails.ExipryDate).toBe("30/03/2026");
    expect(sent.PolicyDetails.StartDate).toBe("31/03/2025");
    expect(sent.PolicyDetails.CKYCNo).toBe("987654545678");
    expect(sent.ModifyDetails.VehicleIDV).toBe("603000");
    expect(sent.ModifyDetails.DiscountPercentage).toBe("-80");
    expect(sent.ModifyDetails.IDVOfCNGOrLPG).toBe("15000");
    expect(sent.ModifyDetails.AddonCode).toEqual([{ CoverCode: "STZDP" }]);
    expect(sent.InspectionNo).toBe("132702032026");
    expect(sent.InspectionDate).toBe("02/03/2026");

    // Bound premium (plain floats → whole rupees) + carried linkage.
    expect(result.quoteNo).toBe("00VD731720");
    // TotalPremium is NET; gross = net + gst. 6595.71 + 1187.23 = 7782.94 → 7783,
    // matching the issuance sample Receipt.Amount "7783" (the real payable).
    expect(result.grossPremium).toBe(7783);
    expect(result.serviceTaxAmount).toBe(1187); // gst 1187.23
    expect(result.netPremium).toBe(6596); // TotalPremium 6595.71
    expect(result.basicOdPremium).toBe(4502); // 4501.71
    expect(result.thirdPartyPremium).toBe(2094);
    expect(result.idvValue).toBe(603000);
    expect(result.contractDetails?.clientId).toBe("72782626");
    expect(result.contractDetails?.agentCode).toBe("60084677");
    expect(result.contractDetails?.branchCode).toBe("12");
  });

  it("omits CKYC keys when not provided", async () => {
    const { fn, calls } = mockFetch(proposalFixture);
    vi.stubGlobal("fetch", fn);
    await fgRenewalProposal(
      config,
      {
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
      },
      "tok",
      { requestId: "r6" },
    );
    const sent = JSON.parse((calls[0]?.init.body as string) ?? "{}");
    expect("CKYCNo" in sent.PolicyDetails).toBe(false);
    expect("IDVOfCNGOrLPG" in sent.ModifyDetails).toBe(false);
    expect(sent.InspectionNo).toBe("");
    expect(sent.InspectionDate).toBe("");
  });

  it("throws on a proposal Fail response", async () => {
    const { fn } = mockFetch(proposalFailFixture);
    vi.stubGlobal("fetch", fn);
    await expect(
      fgRenewalProposal(
        config,
        {
          productCode: "FPV",
          previousPolicyNo: "BAD",
          proposalNo: "00BAD",
          clientCode: "1",
          startDate: "2025-03-31",
          expiryDate: "2026-03-30",
          agentCode: "1",
          branch: "12",
          coverCode: "CO",
          vehicleIdv: 1,
          discountPercentage: 0,
          addonCodes: [],
        },
        "tok",
        { requestId: "r7" },
      ),
    ).rejects.toThrow(/Please pass correct policy number/);
  });
});

describe("fgRenewalCreatePolicy", () => {
  const req = {
    policyNo: "VD731720",
    clientId: "72782626",
    proposalNo: "00VD731720",
    agentCode: "60084677",
    branchCode: "2J",
    receipt: {
      uniqueTranKey: "TD89984789",
      transactionDate: "01/12/2025",
      receiptType: "IVR",
      amount: 7783,
      tranRefNo: "24709987121",
      tranRefNoDate: "01/12/2025",
      pgType: "PAYU",
    },
  };

  it("issues the renewal and returns the new policy number", async () => {
    const { fn, calls } = mockFetch(issuanceFixture);
    vi.stubGlobal("fetch", fn);
    const r = await fgRenewalCreatePolicy(config, req, "tok");

    expect(calls[0]?.url).toBe(
      "https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify/ModifyRenewalPolicyIssuance",
    );
    const sent = JSON.parse((calls[0]?.init.body as string) ?? "{}");
    expect(sent.PolicyNo).toBe("VD731720");
    expect(sent.VendorCode).toBe("Webagg");
    expect(sent.ClientID).toBe("72782626");
    expect(sent.ProposalNo).toBe("00VD731720");
    expect(sent.BranchCode).toBe("2J");
    expect(sent.Receipt.UniqueTranKey).toBe("TD89984789");
    expect(sent.Receipt.Amount).toBe("7783");
    expect(sent.Receipt.PaymentType).toBe("PAYU");
    expect(sent.Receipt.ReceiptType).toBe("IVR");

    expect(r.status).toBe("ISSUED");
    expect(r.policyNumber).toBe("132/02/11/1226/MTP/2410000963");
    expect(r.quoteNo).toBe("00VD731720");
    expect(r.clientId).toBe("72782626");
  });

  it("throws on an issuance Fail response (duplicate)", async () => {
    const { fn } = mockFetch(issuanceFailFixture);
    vi.stubGlobal("fetch", fn);
    await expect(fgRenewalCreatePolicy(config, req, "tok")).rejects.toThrow(/Duplicate found/);
  });
});

describe("FgProvider renewal wiring (3 ops)", () => {
  const provider = new FgProvider({
    config,
    renewalTokenProvider: async () => "tok",
  });

  it("dispatches renewalProposal through the provider", async () => {
    const { fn, calls } = mockFetch(proposalFixture);
    vi.stubGlobal("fetch", fn);
    const result = await provider.renewalProposal(
      {
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
        addonCodes: ["STZDP"],
      },
      { requestId: "p1" },
    );
    expect(calls[0]?.url).toContain("/ModifyRenewalProposal");
    expect((calls[0]?.init.headers as Record<string, string>)["Internal-Key"]).toBe("tok");
    expect(result.quoteNo).toBe("00VD731720");
  });
});

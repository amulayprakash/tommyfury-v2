import { describe, it, expect, vi } from "vitest";
import idvFixture from "../fixtures/responses/idv.json" with { type: "json" };
import premiumFixture from "../fixtures/responses/premium.json" with { type: "json" };
import proposalFixture from "../fixtures/responses/proposal.json" with { type: "json" };
import paymentFixture from "../fixtures/responses/payment.json" with { type: "json" };
import policyDocFixture from "../fixtures/responses/policy-document.json" with { type: "json" };
import premiumCollection from "../fixtures/collection/renewal-premium.json" with { type: "json" };
import proposalCollection from "../fixtures/collection/renewal-proposal.json" with { type: "json" };
import extractCollection from "../fixtures/collection/renewal-extract.json" with { type: "json" };
import { HdfcProvider } from "../hdfc.provider.ts";
import { supportsRenewal } from "@/providers/insurance-provider.ts";
import { passthroughCodeResolver } from "../db-code-resolver.ts";
import {
  buildRenewalExtract,
  buildRenewalGetCalculateIDV,
  buildRenewalCalculatePremium,
  buildRenewalCreateProposal,
} from "../mapper/renewal.ts";
import { normalizeRenewalExtract, canonicalPolicyType } from "../normalizer.ts";
import type { HdfcConfig } from "../config.ts";
import type { HdfcTransport } from "../http.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "S",
  channelId: "C",
  credential: "x",
  productCode: "2311",
  tokenTtlSeconds: 1500,
  kyc: { baseUrl: "https://kyc.example", apiKey: "k", tokenTtlSeconds: 480, returnUrl: "" },
};

function recordingTransport(responses: Record<string, unknown>) {
  const calls: { url: string; jsonBody?: unknown }[] = [];
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

const ctx = { requestId: "req-1" };
const step = (c: { url: string }) => c.url.split("/").pop();

/**
 * A getpolicydataforrenewal response in the shape the kit's data dictionary
 * documents (sheet "03 RenewalExtract": everything under `Resp_RE`, plus a
 * `Customer_Details` block).
 */
const extractResponse = {
  StatusCode: "1",
  Error: null,
  Customer_Details: {
    Customer_Salutation: "MR.",
    Customer_FirstName: "MAHENDRA",
    Customer_MiddleName: "KUMAR",
    Customer_LastName: "GHANCHI",
    CustomerEmail: "mahendra@example.com",
    CustomerMobile: "7387005111",
    CustomerGender: "MALE",
    CustomerDOB: "22/07/1996",
    Customer_PANNum: "BXGPG2512P",
    Customer_PehchaanID: "PRD2G7DNHM",
    PermanentAddress1: "HNO 124",
    PermanentAddress2: "KUMHARO KA VAS",
    PermanentCityDistrict: "SIROHI",
    PermanentState: "RAJASTHAN",
    PermanentPinCode: "307801",
  },
  Resp_RE: {
    Policy_Type: "OD Plus TP",
    Policy_Term: "1",
    VehicleModelCode: "17532",
    RTOLocationCode: "10406",
    DateofDeliveryOrRegistration: "11/07/2023",
    Registration_No: "MH-01-QQ-7878",
    Policy_Effective_From_Date: "12/07/2026",
    PreviousPolicy_PolicyType: "COMPREHENSIVE",
    PreviousPolicy_PolicyEndDate: "11/07/2026",
    PreviousPolicy_TPStartDate: null,
    PreviousPolicy_TPEndDate: null,
    IDV: 500000,
  },
};

describe("renewal payload builders", () => {
  it("keys the extract by the existing policy number", () => {
    expect(buildRenewalExtract("TXN-1", "POL-9")).toEqual({
      TransactionID: "TXN-1",
      Req_Renewal: { Policy_No: "POL-9" },
    });
  });

  it("matches the collection's RenewalExtract fixture exactly", () => {
    expect(
      buildRenewalExtract(extractCollection.TransactionID, extractCollection.Req_Renewal.Policy_No),
    ).toEqual(extractCollection);
  });

  it("sends Req_Renewal alongside the IDV and cover blocks for premium", () => {
    const out = buildRenewalCalculatePremium({
      transactionId: "TXN-1",
      previousPolicyNo: "POL-9",
      registrationNo: "MH01QQ7878",
      idv: 500000,
      policyType: "OD Only",
      tenure: 1,
    });
    expect(Object.keys(out)).toEqual([
      "TransactionID",
      "Policy_Details",
      "Req_Renewal",
      "Req_PvtCar",
    ]);
    expect((out.Req_Renewal as Record<string, unknown>).Policy_No).toBe("POL-9");
    expect((out.Policy_Details as Record<string, unknown>).Vehicle_IDV).toBe(500000);
    // Raw plate, NOT dash-formatted: dashes are a CreateProposal-only rule.
    expect((out.Req_Renewal as Record<string, unknown>).Vehicle_Regn_No).toBe("MH01QQ7878");
  });

  it("reproduces the collection's renewal CalculatePremium payload byte for byte", () => {
    const out = buildRenewalCalculatePremium({
      transactionId: premiumCollection.TransactionID,
      previousPolicyNo: premiumCollection.Req_Renewal.Policy_No,
      registrationNo: premiumCollection.Req_Renewal.Vehicle_Regn_No,
      idv: premiumCollection.Policy_Details.Vehicle_IDV,
      policyType: premiumCollection.Req_PvtCar.POLICY_TYPE,
      tenure: premiumCollection.Req_PvtCar.POLICY_TENURE,
    });
    expect(out).toEqual(premiumCollection);
    // Key ORDER is part of HDFC's contract, and toEqual does not check it.
    expect(Object.keys(out.Req_PvtCar as object)).toEqual(
      Object.keys(premiumCollection.Req_PvtCar),
    );
  });

  it("keeps the renewal Req_PvtCar shorter than the New/Roll Over templates", () => {
    const out = buildRenewalCalculatePremium({
      transactionId: "T",
      previousPolicyNo: "P",
      idv: 1,
      policyType: "OD Only",
      tenure: 1,
    });
    const keys = Object.keys(out.Req_PvtCar as object);
    expect(keys).toHaveLength(60);
    for (const absent of [
      "PlanType",
      "RTIPlanType",
      "EMIPlanType",
      "NoOfWorkmen",
      "NoOfCleanerConductorCoolies",
      "kmsYouExpectToDrive",
      "isElectricMotorCover",
      "NoOfPAPaidDriver",
    ]) {
      expect(keys).not.toContain(absent);
    }
  });

  it("adds Customer_Details with the trailing null BusinessType_Mandatary for the proposal", () => {
    const out = buildRenewalCreateProposal({
      transactionId: proposalCollection.TransactionID,
      previousPolicyNo: proposalCollection.Req_Renewal.Policy_No,
      registrationNo: proposalCollection.Req_Renewal.Vehicle_Regn_No,
      idv: proposalCollection.Policy_Details.Vehicle_IDV,
      policyType: proposalCollection.Req_PvtCar.POLICY_TYPE,
      tenure: proposalCollection.Req_PvtCar.POLICY_TENURE,
    });
    expect(Object.keys(out)).toEqual([
      "TransactionID",
      "Policy_Details",
      "Req_Renewal",
      "Customer_Details",
      "Req_PvtCar",
    ]);
    const cd = out.Customer_Details as Record<string, unknown>;
    expect(Object.keys(cd)).toEqual(Object.keys(proposalCollection.Customer_Details));
    expect(Object.keys(cd).at(-1)).toBe("BusinessType_Mandatary");
    expect(cd.BusinessType_Mandatary).toBeNull();
    // Identical cover block to the premium call.
    expect(out.Req_PvtCar).toEqual(
      buildRenewalCalculatePremium({
        transactionId: proposalCollection.TransactionID,
        previousPolicyNo: proposalCollection.Req_Renewal.Policy_No,
        idv: proposalCollection.Policy_Details.Vehicle_IDV,
        policyType: proposalCollection.Req_PvtCar.POLICY_TYPE,
        tenure: proposalCollection.Req_PvtCar.POLICY_TENURE,
      }).Req_PvtCar,
    );
  });

  it("builds the renewal IDV call from the snapshot, still sending Registration_No 'New'", () => {
    const out = buildRenewalGetCalculateIDV("TXN-1", normalizeRenewalExtract(extractResponse));
    expect(Object.keys(out.IDV_DETAILS as object)).toEqual([
      "ModelCode",
      "RTOCode",
      "Vehicle_Registration_Date",
      "Registration_No",
      "Policy_Start_Date",
      "PreviousPolicy_PreviousPolicyType",
      "PreviousPolicy_EndDate",
      "PreviousPolicy_TPENDDATE",
      "PreviousPolicy_TPSTARTDATE",
    ]);
    expect(out.IDV_DETAILS).toMatchObject({
      ModelCode: "17532",
      RTOCode: "10406",
      Registration_No: "New",
    });
  });
});

describe("normalizeRenewalExtract", () => {
  it("reads the documented Resp_RE snapshot including the customer", () => {
    const snap = normalizeRenewalExtract(extractResponse);
    expect(snap.idv).toBe(500000);
    expect(snap.policyType).toBe("OD Plus TP");
    expect(snap.tenure).toBe(1);
    expect(snap.modelCode).toBe("17532");
    expect(snap.rtoCode).toBe("10406");
    expect(snap.registrationNo).toBe("MH-01-QQ-7878");
    expect(snap.customer.pehchaanId).toBe("PRD2G7DNHM");
    expect(snap.customer.firstName).toBe("MAHENDRA");
  });

  it("falls back to the Policy_Details.Vehicle_IDV shape the standalone module read", () => {
    const snap = normalizeRenewalExtract({ StatusCode: "1", Policy_Details: { Vehicle_IDV: 4242 } });
    expect(snap.idv).toBe(4242);
  });

  it("defaults an unstated cover to the package, never to OD-only", () => {
    expect(normalizeRenewalExtract({}).policyType).toBe("OD Plus TP");
    expect(normalizeRenewalExtract({}).tenure).toBe(1);
  });

  it("maps HDFC's POLICY_TYPE vocabulary back to canonical names", () => {
    expect(canonicalPolicyType("OD Plus TP")).toBe("comprehensive");
    expect(canonicalPolicyType("OD Only")).toBe("standAloneOD");
    expect(canonicalPolicyType("TP Only")).toBe("thirdParty");
    expect(canonicalPolicyType("something else")).toBe("comprehensive");
  });
});

describe("renewalQuote", () => {
  it("runs extract, IDV then premium", async () => {
    const { transport, calls } = recordingTransport({
      getpolicydataforrenewal: extractResponse,
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).renewalQuote({ policyNo: "POL-9" }, ctx);
    expect(calls.map(step)).toEqual([
      "getpolicydataforrenewal",
      "getcalculateidv",
      "calculatepremium",
    ]);
  });

  it("returns a canonical quote", async () => {
    const { transport } = recordingTransport({
      getpolicydataforrenewal: extractResponse,
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    const q = await provider(transport).renewalQuote({ policyNo: "POL-9" }, ctx);
    expect(q.providerSlug).toBe("hdfc");
    expect(q.grossPremium).toBe(25230);
    expect(q.policyType).toBe("comprehensive");
    expect(q.vehicleCategory).toBe("fourWheeler");
    expect(q.contractDetails?.previousPolicyNo).toBe("POL-9");
    // The IDV band from step 03 is surfaced for the UI slider.
    expect(q.minIdv).toBe(1182560);
    expect(q.maxIdv).toBe(1556000);
  });

  /**
   * The accessory cap guards `priceQuote`, which the renewal flow does not use.
   * That is correct rather than an oversight: mapper/renewal.ts hardcodes all
   * three accessory amounts to 0, so a renewal has no accessory sum insured to
   * cap. This pins that reasoning — if the renewal payload ever starts carrying
   * real accessory values, this test fails and the guard has to be extended.
   */
  it("carries no accessory sum insured, so the 25% cap has nothing to bite on", async () => {
    const { transport, calls } = recordingTransport({
      getpolicydataforrenewal: extractResponse,
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).renewalQuote({ policyNo: "POL-9" }, ctx);
    const premium = calls[2]!.jsonBody as {
      Req_PvtCar: {
        ElecticalAccessoryIDV: number;
        NonElecticalAccessoryIDV: number;
        BiFuel_Kit_Value: number;
      };
    };
    expect(premium.Req_PvtCar.ElecticalAccessoryIDV).toBe(0);
    expect(premium.Req_PvtCar.NonElecticalAccessoryIDV).toBe(0);
    expect(premium.Req_PvtCar.BiFuel_Kit_Value).toBe(0);
  });

  it("prices with HDFC's recommended IDV, not the expiring policy's", async () => {
    const { transport, calls } = recordingTransport({
      getpolicydataforrenewal: extractResponse,
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).renewalQuote({ policyNo: "POL-9" }, ctx);
    const premium = calls[2]!.jsonBody as { Policy_Details: { Vehicle_IDV: number } };
    expect(premium.Policy_Details.Vehicle_IDV).toBe(1244800); // idv.json IDV_AMOUNT
  });

  it("skips the IDV call when the snapshot has no model/RTO code", async () => {
    const { transport, calls } = recordingTransport({
      getpolicydataforrenewal: { StatusCode: "1", Policy_Details: { Vehicle_IDV: 500000 } },
      calculatepremium: premiumFixture,
    });
    await provider(transport).renewalQuote({ policyNo: "POL-9" }, ctx);
    expect(calls.map(step)).toEqual(["getpolicydataforrenewal", "calculatepremium"]);
    const premium = calls[1]!.jsonBody as { Policy_Details: { Vehicle_IDV: number } };
    expect(premium.Policy_Details.Vehicle_IDV).toBe(500000);
  });

  it("threads one TransactionID through every renewal step", async () => {
    const { transport, calls } = recordingTransport({
      getpolicydataforrenewal: extractResponse,
      getcalculateidv: idvFixture,
      calculatepremium: premiumFixture,
    });
    await provider(transport).renewalQuote({ policyNo: "POL-9" }, ctx);
    const ids = calls.map((c) => (c.jsonBody as { TransactionID: string }).TransactionID);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^REN/);
  });
});

describe("renewalProposal", () => {
  const req = {
    previousPolicyNo: "POL-9",
    proposalNo: "00POL-9",
    startDate: "2026-09-01",
    expiryDate: "2027-08-31",
    vehicleIdv: 500000,
    discountPercentage: 0,
    addonCodes: [],
    transactionId: "TXN-1",
    registrationNo: "MH01QQ7878",
  };

  it("creates the proposal and returns its number", async () => {
    const { transport } = recordingTransport({
      getpolicydataforrenewal: extractResponse,
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
    });
    const q = await provider(transport).renewalProposal(req, ctx);
    expect(q.contractDetails?.proposalNumber).toBe("PR2026080700123");
    expect(q.grossPremium).toBe(25230);
  });

  it("re-reads the snapshot so the proposal can carry Customer_Details", async () => {
    const { transport, calls } = recordingTransport({
      getpolicydataforrenewal: extractResponse,
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
    });
    await provider(transport).renewalProposal(req, ctx);
    expect(calls.map(step)).toEqual([
      "getpolicydataforrenewal",
      "calculatepremium",
      "createproposal",
    ]);
    const body = calls[2]!.jsonBody as {
      TransactionID: string;
      Customer_Details: Record<string, unknown>;
    };
    expect(body.TransactionID).toBe("TXN-1"); // caller's id is reused
    expect(body.Customer_Details.Customer_Pehchaan_id).toBe("PRD2G7DNHM");
    expect(body.Customer_Details.Customer_FirstName).toBe("MAHENDRA");
  });

  it("works without the FG-only fields the schema no longer requires", async () => {
    const { transport } = recordingTransport({
      getpolicydataforrenewal: extractResponse,
      calculatepremium: premiumFixture,
      createproposal: proposalFixture,
    });
    // No productCode / clientCode / agentCode / branch / coverCode anywhere.
    await expect(
      provider(transport).renewalProposal(
        {
          previousPolicyNo: "POL-9",
          proposalNo: "00POL-9",
          startDate: "2026-09-01",
          expiryDate: "2027-08-31",
          vehicleIdv: 0,
          discountPercentage: 0,
          addonCodes: [],
        },
        ctx,
      ),
    ).resolves.toMatchObject({ providerSlug: "hdfc" });
  });

  it("raises when HDFC returns no proposal number", async () => {
    const { transport } = recordingTransport({
      getpolicydataforrenewal: extractResponse,
      calculatepremium: premiumFixture,
      createproposal: { StatusCode: "1", Policy_Details: {} },
    });
    await expect(provider(transport).renewalProposal(req, ctx)).rejects.toThrow(
      /no proposal number/,
    );
  });
});

describe("renewalCreatePolicy", () => {
  const req = {
    policyNo: "POL-9",
    proposalNo: "PR2026080700123",
    transactionId: "TXN-1",
    receipt: {
      uniqueTranKey: "UTK",
      transactionDate: "07/08/2026 16:26:00",
      receiptType: "IVR",
      amount: 43150,
      tranRefNo: "PG-77",
      tranRefNoDate: "07/08/2026",
      pgType: "PAYU",
    },
  };

  it("submits payment and returns the new policy number", async () => {
    const { transport, calls } = recordingTransport({
      submitpaymentdetails: paymentFixture,
      getpolicydocument: policyDocFixture,
    });
    const out = await provider(transport).renewalCreatePolicy(req, ctx);
    expect(out.status).toBe("ISSUED");
    expect(out.policyNumber).toBe("2311202600012345");
    expect(out.receiptNo).toBe("PG-77");
    expect(calls.map(step)).toEqual(["submitpaymentdetails", "getpolicydocument"]);
    const pay = calls[0]!.jsonBody as {
      Proposal_no: string;
      Payment_Details: { PAYMENT_AMOUNT: string };
    };
    expect(pay.Proposal_no).toBe("PR2026080700123");
    expect(pay.Payment_Details.PAYMENT_AMOUNT).toBe("43150");
  });

  it("reports IN_PROGRESS (and skips the document call) when no policy number comes back", async () => {
    const { transport, calls } = recordingTransport({
      submitpaymentdetails: { StatusCode: "1", Policy_Details: {} },
    });
    const out = await provider(transport).renewalCreatePolicy(req, ctx);
    expect(out.status).toBe("IN_PROGRESS");
    expect(calls.map(step)).toEqual(["submitpaymentdetails"]);
  });
});

describe("RenewalProvider capability", () => {
  it("now satisfies supportsRenewal()", () => {
    const { transport } = recordingTransport({});
    expect(supportsRenewal(provider(transport))).toBe(true);
  });
});

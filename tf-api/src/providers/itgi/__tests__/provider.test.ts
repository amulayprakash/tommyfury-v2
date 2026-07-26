import { describe, it, expect, vi } from "vitest";
import { ItgiProvider } from "../itgi.provider.ts";
import { ItgiUnmappedCodeError } from "../errors.ts";
import type { ItgiTransport } from "../http.ts";
import type { ItgiConfig } from "../config.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";

const cfg: ItgiConfig = {
  soapBaseUrl: "https://s/services",
  restBaseUrl: "https://s/partner-services",
  partnerCode: "ITGIMOT999",
  partnerBranch: "TF",
  partnerSubBranch: "TF",
  responseUrl: "https://x/y",
  downloadUser: "u",
  downloadPassword: "p",
};

const idvResponse = {
  getVehicleIdvResponse: {
    getVehicleIdvReturn: {
      idv: "105665",
      minimumIdvAllowed: "95098",
      maximumIdvAllowed: "116231",
    },
  },
};

const premiumResponse = {
  getMotorPremiumResponse: {
    getMotorPremiumReturn: [
      {
        autocoverage: "false",
        coveragePremiumDetail: [{ coverageName: "IDV Basic", odPremium: "1895", tpPremium: "1366" }],
        premiumPayable: "2841.44",
        serviceTax: "433.44",
        totalODPremium: "1042",
        totalPremimAfterDiscLoad: "2408",
        totalTPPremium: "1366",
        discountLoading: "0",
        discountLoadingAmt: "0",
      },
    ],
  },
};

const proposalResponse = {
  validateProposalRequestResponse: {
    validateProposalRequestReturn: {
      amountPayable: "2841",
      orderNo: "000006AS5YSI",
      traceNo: "153852",
    },
  },
};

const paymentResponse = {
  updatePaymentDetailsResponse: {
    updatePaymentDetailsReturn: {
      policyNumber: "M0003356",
      statusMessage: "SUCCESSFULLY_SUBMITTED_IN_P400",
      premiumPayable: "2841",
    },
  },
};

const req = {
  vehicleType: "twoWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  makeId: "1",
  makeName: "HERO",
  modelId: "10",
  modelName: "SPLENDOR",
  fuelType: "petrol",
  engineCC: 100,
  seatingCapacity: 2,
  rtoCode: "DL01",
  registrationDate: "2023-10-20",
  registrationNumber: "DL10AH4567",
  policyStartDate: "2026-02-26",
  policyEndDate: "2027-02-25",
  previousPolicyExpiryDate: "2026-02-25",
  ncbPercent: 0,
  idvValue: 105665,
  paOwner: true,
  zeroDep: false,
  engineProtect: false,
  tyreProtect: false,
  rimProtect: false,
  consumables: false,
  rsa: false,
  paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false,
  claimInPreviousPolicy: false,
  isPreviousPolicyExpired: false,
} as unknown as MotorQuoteRequest;

function soapRouter() {
  return vi.fn(async (url: string) => {
    if (url.includes("IDVWebService")) return idvResponse;
    if (url.includes("Premium")) return premiumResponse;
    if (url.includes("PartnerProposalRequest")) return proposalResponse;
    if (url.includes("PaymentUpdateWS")) return paymentResponse;
    return {};
  });
}

function makeProvider(overrides: { soap?: ItgiTransport["soap"]; resolver?: unknown } = {}) {
  const transport: ItgiTransport = {
    soap: overrides.soap ?? soapRouter(),
    json: vi.fn(),
  };
  return {
    provider: new ItgiProvider({
      transport,
      config: cfg,
      resolveCodes:
        (overrides.resolver as never) ??
        (async () => ({ makeCode: "HHSPL", rtoCity: "DELHI", engineCC: 100, seatingCapacity: 2 })),
    }),
    transport,
  };
}

describe("ItgiProvider", () => {
  it("declares its identity and capabilities", () => {
    const { provider } = makeProvider();
    expect(provider.slug).toBe("itgi");
    expect(provider.displayName).toBe("IFFCO-Tokio");
    expect(provider.capabilities.has("twoWheeler")).toBe(true);
    expect(provider.capabilities.has("commercial")).toBe(false);
  });

  it("does not advertise operations it cannot perform", () => {
    const { provider } = makeProvider();
    // ITGI exposes no renewal API and no create-inspection endpoint, so these
    // must stay undeclared or the capability type-guards would lie.
    expect(provider.operations.has("renewal")).toBe(false);
    expect(provider.operations.has("inspection")).toBe(false);
    expect(provider.operations.has("retrieveQuote")).toBe(false);
    expect(provider.operations.has("quote")).toBe(true);
    expect(provider.operations.has("issuance")).toBe(true);
  });

  it("returns a canonical quote from IDV + premium", async () => {
    const { provider } = makeProvider();
    const q = await provider.getQuote(req, { requestId: "req-1" });
    expect(q.providerSlug).toBe("itgi");
    expect(q.grossPremium).toBe(2841);
    expect(q.basicOdPremium).toBe(1042);
    expect(q.idvValue).toBe(105665);
    expect(q.minIdv).toBe(95098);
  });

  it("calls IDV before premium, on the two-wheeler premium endpoint", async () => {
    const soap = soapRouter();
    const { provider } = makeProvider({ soap });
    await provider.getQuote(req, { requestId: "req-1" });
    const urls = soap.mock.calls.map((c) => c[0]);
    expect(urls[0]).toContain("IDVWebService");
    expect(urls[1]).toContain("MotorPremiumWebserviceVA");
  });

  it("routes a new vehicle to the dedicated premium endpoint", async () => {
    const soap = soapRouter();
    const { provider } = makeProvider({ soap });
    await provider.getQuote(
      { ...req, vehicleType: "newVehicle", businessType: "new" } as MotorQuoteRequest,
      { requestId: "req-1" },
    );
    expect(soap.mock.calls.map((c) => c[0])[1]).toContain("NewVehiclePremiumWebserviceVA");
  });

  it("propagates an unmapped RTO so compare can skip the provider", async () => {
    const { provider } = makeProvider({
      resolver: async () => {
        throw new ItgiUnmappedCodeError("RTO", "DL01");
      },
    });
    await expect(provider.getQuote(req, { requestId: "req-1" })).rejects.toThrow(
      ItgiUnmappedCodeError,
    );
  });

  it("flags a break-in quote as requiring inspection", async () => {
    const { provider } = makeProvider();
    const q = await provider.getQuote(
      { ...req, isPreviousPolicyExpired: true } as MotorQuoteRequest,
      { requestId: "req-1" },
    );
    expect(q.isInspectionRequired).toBe(true);
  });

  describe("getFullQuote", () => {
    const fullReq = {
      ...req,
      quoteId: "TFQ-1",
      kycRefId: "AOF3XL0PLU1MEH",
      proposer: {
        firstName: "Tom",
        lastName: "Gage",
        email: "a@b.c",
        mobile: "9876543210",
        dob: "1992-01-01",
        title: "Mr",
        gender: "M",
      },
      address: {
        addressLine1: "HNO 1",
        pincode: "110001",
        city: "DELHI",
        state: "DL",
      },
      vehicle: {
        engineNumber: "EN123",
        chassisNumber: "CH123",
        financeType: "none",
      },
      isProposalOnly: false,
      isVehicleUnderLoan: false,
    } as unknown as MotorFullQuoteRequest;

    it("creates the proposal and returns the vendor id chain", async () => {
      const { provider } = makeProvider();
      const q = await provider.getFullQuote(fullReq, { requestId: "req-1" });
      expect(q.contractDetails?.orderNo).toBe("000006AS5YSI");
      expect(q.contractDetails?.traceNo).toBe("153852");
      expect(String(q.contractDetails?.uniqueQuoteId).length).toBeGreaterThanOrEqual(12);
    });

    it("refuses to build a proposal without a CKYC reference", async () => {
      const { provider } = makeProvider();
      const noKyc = { ...fullReq, kycRefId: undefined, ckyc: undefined };
      await expect(
        provider.getFullQuote(noKyc as MotorFullQuoteRequest, { requestId: "req-1" }),
      ).rejects.toThrow(/CKYC/i);
    });

    it("refuses an unparseable registration number", async () => {
      const { provider } = makeProvider();
      await expect(
        provider.getFullQuote({ ...fullReq, registrationNumber: "NEW" } as MotorFullQuoteRequest, {
          requestId: "req-1",
        }),
      ).rejects.toThrow(/registration number/i);
    });
  });

  describe("issuePolicy", () => {
    const issueReq = {
      quoteNo: "153852",
      clientId: "000006AS5YSI",
      vehicleCategory: "twoWheeler",
      receipt: {
        uniqueTranKey: "199",
        transactionDate: "26/02/2026 10:00:00",
        receiptType: "IVR",
        amount: 2841,
        tranRefNo: "833",
        tranRefNoDate: "26/02/2026",
        pgType: "PAYU",
      },
    } as never;

    it("binds payment and returns the issued policy number", async () => {
      const { provider } = makeProvider();
      const r = await provider.issuePolicy(issueReq, { requestId: "req-1" });
      expect(r.policyNumber).toBe("M0003356");
      expect(r.status).toBe("ISSUED");
    });

    it("marks a break-in acceptance as inspection pending", async () => {
      const soap = vi.fn(async () => ({
        updatePaymentDetailsResponse: {
          updatePaymentDetailsReturn: {
            policyNumber: "1522313725648",
            statusMessage: "PAYMENT_ACCEPTED_BREAK_IN",
          },
        },
      }));
      const { provider } = makeProvider({ soap });
      const r = await provider.issuePolicy(issueReq, { requestId: "req-1" });
      expect(r.status).toBe("INSPECTION_PENDING");
    });

    it("marks a declined payment as rejected", async () => {
      const soap = vi.fn(async () => ({
        updatePaymentDetailsResponse: {
          updatePaymentDetailsReturn: { statusMessage: "TRANCTION_DECLINED" },
        },
      }));
      const { provider } = makeProvider({ soap });
      const r = await provider.issuePolicy(issueReq, { requestId: "req-1" });
      expect(r.status).toBe("REJECTED");
    });
  });

  it("reports policy status keyed by the unique quote id", async () => {
    const soap = vi.fn(async () => ({
      getPolicyStatusResponse: {
        getPolicyStatusReturn: { authFlag: "Y", policyNo: "MC897210", status: "OK" },
      },
    }));
    const { provider } = makeProvider({ soap });
    const r = await provider.getPolicyStatus({ transactionId: "TFQ123456789" }, { requestId: "r" });
    expect(r.policyNumber).toBe("MC897210");
    expect(r.status).toBe("ISSUED");
  });

  it("completes CKYC and surfaces the IURN", async () => {
    const transport: ItgiTransport = {
      soap: vi.fn(),
      json: vi.fn().mockResolvedValue({
        status: 200,
        result: { status: "SUCCESS", itgiUniqueReferenceId: "AOF3XL0PLU1MEH" },
      }),
    };
    const provider = new ItgiProvider({
      transport,
      config: cfg,
      resolveCodes: async () => ({ makeCode: "X", rtoCity: "Y" }),
    });
    const r = await provider.completeCkyc(
      {
        transactionId: "T1",
        dob: "1992-01-01",
        panNumber: "TESPA7100P",
        policyType: "motor",
        fullName: "Tom Gage",
        mobile: "9876543210",
      } as never,
      { requestId: "req-1" },
    );
    expect(r.isKycSuccess).toBe(true);
    expect(r.ckycNumber).toBe("AOF3XL0PLU1MEH");
  });
});

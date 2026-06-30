import { describe, it, expect } from "vitest";
import { ProviderCapabilityError } from "@/errors/app-error.ts";
import type { VehicleCategory, BusinessType, PolicyType } from "@/contracts/enums.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import { CanonicalQuoteResultSchema } from "@/contracts/quote-result.ts";
import { IciciProvider, passthroughCodeResolver } from "../icici.provider.ts";
import { buildSaveQuotePayload, type IciciResolvedCodes } from "../mapper.ts";
import type { IciciTransport } from "../http.ts";
import type { IciciConfig } from "../config.ts";

import quoteFixture from "../fixtures/quote.response.json";
import proposalFixture from "../fixtures/proposal.response.json";
import policyStatusFixture from "../fixtures/policy-status.response.json";

/**
 * ICICI Lombard motor test-case matrix — mirrors the team test sheet
 * (Vehicle Category × Business Type × Plan Type). Each supported combination must
 * resolve to its documented ICICI Product Code and produce a canonical quote;
 * each unsupported combination must be cleanly rejected (ProviderCapabilityError),
 * never silently mis-priced.
 *
 * Test vehicle (canonical fixture vehicle): MakeCode 10, ModelCode 11846,
 * RTOCode 12621 (Kalyan, MH). Premiums come from the recorded UAT quote fixture.
 */

const config: IciciConfig = {
  baseUrl: "https://uat.example",
  login: "user",
  password: "pass",
  aesKey: "key",
  aesMode: "aes-256-ecb",
  credentialSetId: "default",
};

const codes: IciciResolvedCodes = {
  makeCode: 10,
  modelCode: 11846,
  rtoCode: 12621,
  previousInsurerCode: "ICICI LOMBARD",
};

type ReqArgs = Parameters<IciciTransport["request"]>[0];

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
      if (u.includes("/premium")) return overrides.quote ?? quoteFixture;
      if (u.includes("/policy")) return overrides.policyStatus ?? policyStatusFixture;
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

function baseQuote(overrides: Partial<MotorQuoteRequest> = {}): MotorQuoteRequest {
  return {
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
    isPreviousPolicyExpired: false,
    claimInPreviousPolicy: false,
    ncbPercent: 20,
    zeroDep: true,
    engineProtect: false,
    rsa: true,
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
    hasAntiTheftDevice: false,
    hasPayU: false,
    hasCibil: false,
    previousPolicyHasZdCover: false,
    ...overrides,
  };
}

interface Case {
  category: VehicleCategory;
  business: BusinessType;
  plan: PolicyType;
  expectedCode: number | undefined; // undefined ⇒ not offered by ICICI
}

// ── 2W + 4W matrix (the two lines ICICI actually quotes) ──────────────────────
const MATRIX: Case[] = [
  // Two-wheeler
  { category: "twoWheeler", business: "new", plan: "comprehensive", expectedCode: 10 },
  { category: "twoWheeler", business: "new", plan: "thirdParty", expectedCode: undefined },
  { category: "twoWheeler", business: "new", plan: "standAloneOD", expectedCode: undefined },
  { category: "twoWheeler", business: "rollover", plan: "comprehensive", expectedCode: 13 },
  { category: "twoWheeler", business: "rollover", plan: "thirdParty", expectedCode: 26 },
  { category: "twoWheeler", business: "rollover", plan: "standAloneOD", expectedCode: 16 },
  { category: "twoWheeler", business: "renewal", plan: "comprehensive", expectedCode: 13 },
  { category: "twoWheeler", business: "renewal", plan: "thirdParty", expectedCode: 26 },
  { category: "twoWheeler", business: "renewal", plan: "standAloneOD", expectedCode: undefined },
  // Four-wheeler
  { category: "fourWheeler", business: "new", plan: "comprehensive", expectedCode: 20 },
  { category: "fourWheeler", business: "new", plan: "thirdParty", expectedCode: undefined },
  { category: "fourWheeler", business: "new", plan: "standAloneOD", expectedCode: undefined },
  { category: "fourWheeler", business: "rollover", plan: "comprehensive", expectedCode: 21 },
  { category: "fourWheeler", business: "rollover", plan: "thirdParty", expectedCode: 29 },
  { category: "fourWheeler", business: "rollover", plan: "standAloneOD", expectedCode: 22 },
  { category: "fourWheeler", business: "renewal", plan: "comprehensive", expectedCode: 21 },
  { category: "fourWheeler", business: "renewal", plan: "thirdParty", expectedCode: 29 },
  { category: "fourWheeler", business: "renewal", plan: "standAloneOD", expectedCode: undefined },
];

const label = (c: Case) => `${c.category} / ${c.business} / ${c.plan}`;

describe("ICICI product-code matrix (Save Quote)", () => {
  for (const c of MATRIX) {
    if (c.expectedCode !== undefined) {
      it(`SUPPORTED — ${label(c)} → ProductCode ${c.expectedCode}`, () => {
        const { payload } = buildSaveQuotePayload(
          baseQuote({ vehicleType: c.category, businessType: c.business, selectedPolicy: c.plan }),
          codes,
          `req-${c.category}-${c.business}-${c.plan}`,
        );
        expect(payload.ProductCode).toBe(c.expectedCode);
      });
    } else {
      it(`NOT OFFERED — ${label(c)} → rejected (ProviderCapabilityError)`, () => {
        expect(() =>
          buildSaveQuotePayload(
            baseQuote({ vehicleType: c.category, businessType: c.business, selectedPolicy: c.plan }),
            codes,
            "req-x",
          ),
        ).toThrow(ProviderCapabilityError);
      });
    }
  }
});

describe("ICICI end-to-end quote for every supported combination", () => {
  for (const c of MATRIX.filter((m) => m.expectedCode !== undefined)) {
    it(`returns a canonical quote — ${label(c)}`, async () => {
      const { transport } = fakeTransport();
      const result = await makeProvider(transport).getQuote(
        baseQuote({ vehicleType: c.category, businessType: c.business, selectedPolicy: c.plan }),
        { requestId: "r" },
      );
      expect(CanonicalQuoteResultSchema.safeParse(result).success).toBe(true);
      expect(result.providerSlug).toBe("icici");
      expect(result.grossPremium).toBeGreaterThan(0);
    });
  }
});

// ── Commercial Vehicle matrix (Generic 5 — PCV / GCV / MISC) ──────────────────
interface CvCase {
  cvClass: "pcv" | "gcv" | "misc";
  business: BusinessType;
  plan: PolicyType;
  expectedCode: number | undefined; // undefined ⇒ not offered by ICICI
}

const CV_MATRIX: CvCase[] = [
  // PCV
  { cvClass: "pcv", business: "rollover", plan: "comprehensive", expectedCode: 41 },
  { cvClass: "pcv", business: "rollover", plan: "thirdParty", expectedCode: 42 },
  { cvClass: "pcv", business: "new", plan: "comprehensive", expectedCode: 49 },
  { cvClass: "pcv", business: "rollover", plan: "standAloneOD", expectedCode: undefined },
  // GCV
  { cvClass: "gcv", business: "rollover", plan: "comprehensive", expectedCode: 44 },
  { cvClass: "gcv", business: "rollover", plan: "thirdParty", expectedCode: 43 },
  { cvClass: "gcv", business: "new", plan: "comprehensive", expectedCode: 50 },
  // MISC (TP-only per the master)
  { cvClass: "misc", business: "rollover", plan: "thirdParty", expectedCode: 48 },
  { cvClass: "misc", business: "new", plan: "thirdParty", expectedCode: 40 },
  { cvClass: "misc", business: "rollover", plan: "comprehensive", expectedCode: undefined },
];

const cvLabel = (c: CvCase) => `${c.cvClass} / ${c.business} / ${c.plan}`;

describe("ICICI commercial-vehicle product-code matrix (Save Quote)", () => {
  for (const c of CV_MATRIX) {
    const req = () =>
      baseQuote({
        vehicleType: "commercial",
        businessType: c.business,
        selectedPolicy: c.plan,
        commercialVehicleClass: c.cvClass,
        grossVehicleWeight: 7500,
      });
    if (c.expectedCode !== undefined) {
      it(`SUPPORTED — ${cvLabel(c)} → ProductCode ${c.expectedCode} on motor-cv`, () => {
        const { line, url, payload } = buildSaveQuotePayload(req(), codes, `req-cv-${cvLabel(c)}`);
        expect(line).toBe("cv");
        expect(url).toContain("/generic/motor-cv/generic/premium");
        expect(payload.ProductCode).toBe(c.expectedCode);
      });
    } else {
      it(`NOT OFFERED — ${cvLabel(c)} → rejected (ProviderCapabilityError)`, () => {
        expect(() => buildSaveQuotePayload(req(), codes, "req-cv-x")).toThrow(ProviderCapabilityError);
      });
    }
  }

  it("derives GCV from commercialSubType=goods when no explicit class", () => {
    const { payload } = buildSaveQuotePayload(
      baseQuote({ vehicleType: "commercial", commercialSubType: "goods", businessType: "rollover", selectedPolicy: "comprehensive" }),
      codes,
      "req-cv-derive",
    );
    expect(payload.ProductCode).toBe(44); // GCV roll-over comprehensive
  });

  it("derives PCV from commercialSubType=passenger and carries IMT-23 flag", () => {
    const { payload } = buildSaveQuotePayload(
      baseQuote({ vehicleType: "commercial", commercialSubType: "passenger", businessType: "rollover", selectedPolicy: "comprehensive", isInclusionOfIMT: true }),
      codes,
      "req-cv-pcv",
    );
    expect(payload.ProductCode).toBe(41); // PCV roll-over comprehensive
    expect(payload.IsInclusionOfIMT).toBe(true);
  });
});

describe("ICICI commercial-vehicle end-to-end quote", () => {
  it("returns a canonical quote for a commercial vehicle", async () => {
    const { transport, sent } = fakeTransport();
    const result = await makeProvider(transport).getQuote(
      baseQuote({ vehicleType: "commercial", commercialSubType: "goods", businessType: "rollover", selectedPolicy: "comprehensive", grossVehicleWeight: 7500 }),
      { requestId: "r-cv" },
    );
    expect(CanonicalQuoteResultSchema.safeParse(result).success).toBe(true);
    expect(result.providerSlug).toBe("icici");
    expect(sent[0]?.url).toContain("/generic/motor-cv/generic/premium");
  });
});

describe("ICICI out-of-scope vehicle categories", () => {
  // EV is not a separate ICICI line — an electric vehicle is quoted on the 2W/4W
  // line via fuelType "electric"; it must still resolve to a normal product code.
  it("EV (electric 4W) → quoted on the 4W line (ProductCode 21)", () => {
    const { line, payload } = buildSaveQuotePayload(
      baseQuote({ vehicleType: "fourWheeler", fuelType: "electric", businessType: "rollover", selectedPolicy: "comprehensive" }),
      codes,
      "req-ev",
    );
    expect(line).toBe("fw");
    expect(payload.ProductCode).toBe(21);
  });
});

describe("ICICI break-in flow (rollover with expired policy → inspection)", () => {
  // Break-in is not a distinct business type: it is a rollover/renewal whose quote
  // comes back IsInspectionRequire=true, which must gate payment to proposal-only
  // until the inspection is approved.
  const fullReq: MotorFullQuoteRequest = {
    ...baseQuote(),
    quoteId: "epn_txn",
    isProposalOnly: false,
    isVehicleUnderLoan: false,
    amountCollected: 11863,
    paymentTransactionId: "pay-1",
    proposer: { firstName: "Ravi", lastName: "Kumar", email: "r@e.com", mobile: "9876543210", dob: "1990-05-15" },
    address: { addressLine1: "MG Road", pincode: "421004", city: "Kalyan", state: "MH" },
    vehicle: { engineNumber: "ENG1", chassisNumber: "CHS1", financeType: "none" },
  };

  it("forces proposal-only (no payment bound) when inspection is required and not yet approved", async () => {
    const inspectionQuote = { ...quoteFixture, IsInspectionRequire: true };
    const pendingStatus = { ...policyStatusFixture, Status: "INSPECTION_PENDING" };
    const { transport, sent } = fakeTransport({ quote: inspectionQuote, policyStatus: pendingStatus });

    await makeProvider(transport).getFullQuote(fullReq, { requestId: "r" });

    const proposal = sent.find((s) => s.url.includes("/proposal"));
    expect(proposal?.jsonBody).toMatchObject({ isProposalOnly: true, AmountCollected: 0 });
  });
});

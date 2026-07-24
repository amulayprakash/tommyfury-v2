import { describe, it, expect } from "vitest";
import { MotorQuoteRequestSchema, MotorFullQuoteRequestSchema } from "@/contracts/quote-request.ts";
import { PolicyIssuanceRequestSchema } from "@/contracts/policy.ts";
import {
  buildGetQuotePayload,
  buildCreateProposalPayload,
  buildIssueProposalPayload,
  toFgDate,
  toNumericUid,
  fgSalutation,
  type FgResolvedCodes,
  type FgPayloadMeta,
} from "../mapper.ts";

const codes: FgResolvedCodes = { make: "HONDA", modelCode: "HO0002", rtoCode: "MH01", zone: "A" };
const meta: FgPayloadMeta = { vendorCode: "Webagg", agentCode: "60001464", branchCode: "10" };

const baseQuote = (over: Record<string, unknown> = {}) =>
  MotorQuoteRequestSchema.parse({
    vehicleType: "fourWheeler",
    selectedPolicy: "comprehensive",
    businessType: "rollover",
    makeId: "HONDA",
    makeName: "Honda",
    modelId: "HO0002",
    modelName: "City",
    fuelType: "petrol",
    rtoCode: "MH01",
    registrationDate: "2024-06-04",
    engineCC: 1198,
    seatingCapacity: 5,
    ...over,
  });

const fullQuote = (over: Record<string, unknown> = {}) =>
  MotorFullQuoteRequestSchema.parse({
    ...baseQuote(),
    quoteId: "0000771450",
    proposer: {
      firstName: "Chandrakant",
      lastName: "Kadam",
      email: "ck@example.com",
      mobile: "9821550969",
      dob: "1987-12-02",
      gender: "M",
      panNumber: "ATYPK2714N",
    },
    address: {
      addressLine1: "Safalya Building No 2",
      pincode: "400013",
      city: "Mumbai",
      state: "MAHARASHTRA",
    },
    vehicle: { engineNumber: "ENG123", chassisNumber: "CHS123" },
    idvValue: 738908,
    ckyc: "10097186172315",
    ...over,
  });

const risk = (p: { payload: Record<string, unknown> }) =>
  p.payload.Risk as Record<string, unknown>;
const header = (p: { payload: Record<string, unknown> }) =>
  p.payload.PolicyHeader as Record<string, unknown>;
const vehicle = (p: { payload: Record<string, unknown> }) =>
  risk(p).Vehicle as Record<string, unknown>;

describe("buildGetQuotePayload", () => {
  it("builds a 4W rollover comprehensive ENQ payload (FPV)", () => {
    const p = buildGetQuotePayload(baseQuote(), codes, meta, "req-1");
    expect(p.url).toBe("/MotorAPI/1.0.0/GetQuote");
    expect(header(p).METHOD).toBe("ENQ");
    expect(header(p).ContractType).toBe("FPV");
    expect(risk(p).RiskType).toBe("FPV");
    expect(risk(p).Cover).toBe("CO");
    expect(vehicle(p).Make).toBe("HONDA");
    expect(vehicle(p).ModelCode).toBe("HO0002");
    expect(vehicle(p).IDV).toBe("0");
    expect(vehicle(p).RegistrationDate).toBe("04/06/2024");
    expect(p.payload.Uid).toMatch(/^\d+$/); // FG MotorAPI requires a numeric Uid
    expect(p.payload.VendorCode).toBe("Webagg");
  });

  it("carries the registration number into Vehicle.RegistrationNo (rollover ENQ)", () => {
    // FG's JSON MotorAPI rejects a rollover ENQ with a blank RegistrationNo.
    const p = buildGetQuotePayload(baseQuote({ registrationNumber: "MH01AB1234" }), codes, meta, "r");
    expect(vehicle(p).RegistrationNo).toBe("MH01AB1234");
  });

  it("emits a numeric Uid derived from the (UUID) requestId", () => {
    const p = buildGetQuotePayload(baseQuote(), codes, meta, "3523f7b3-17a3-40d4-9e97-f2d0ff63b22c");
    expect(p.payload.Uid).toMatch(/^\d+$/);
    expect(String(p.payload.Uid).length).toBeLessThanOrEqual(20);
  });

  it("defaults IDV to 0 (FG computes it) and reprices when a user IDV is given", () => {
    expect(vehicle(buildGetQuotePayload(baseQuote(), codes, meta, "r")).IDV).toBe("0");
    const withIdv = buildGetQuotePayload(baseQuote({ idvValue: 650000 }), codes, meta, "r");
    expect(vehicle(withIdv).IDV).toBe("650000");
  });

  it("maps thirdParty → LO cover", () => {
    const p = buildGetQuotePayload(baseQuote({ selectedPolicy: "thirdParty" }), codes, meta, "r");
    expect(risk(p).Cover).toBe("LO");
  });

  it("passes provider add-on cover codes through verbatim", () => {
    const p = buildGetQuotePayload(
      baseQuote({ providerAddonCodes: ["ZCETR", "STNCB"] }),
      codes,
      meta,
      "r",
    );
    expect(risk(p).AddonReq).toBe("Y");
    const addons = (risk(p).Addon as Array<{ CoverCode: string }>).map((a) => a.CoverCode);
    expect(addons).toEqual(["ZCETR", "STNCB"]);
  });

  it("sets PA / unnamed-passenger / paid-driver via AdditionalBenefit (not addons)", () => {
    const p = buildGetQuotePayload(
      baseQuote({ paOwner: true, paUnnamedPassenger: true, legalLiabilityPaidDriver: true }),
      codes,
      meta,
      "r",
    );
    const benefit = risk(p).AdditionalBenefit as Record<string, unknown>;
    // CPA needs a nominee (captured at proposal), so the quote prices with CPAReq=N.
    expect(benefit.CPAReq).toBe("N");
    expect(benefit.PACoverForUnnamedPassengers).toBe("200000");
    expect(benefit.LegalLiabilitytoPaidDriver).toBe("1");
  });

  it("maps commercial goods → ContractType FCV / RiskType FGV with gross weight", () => {
    const p = buildGetQuotePayload(
      baseQuote({ vehicleType: "commercial", commercialSubType: "goods", grossVehicleWeight: 7500 }),
      codes,
      meta,
      "r",
    );
    expect(header(p).ContractType).toBe("FCV");
    expect(risk(p).RiskType).toBe("FGV");
    expect(vehicle(p).GrossWeigh).toBe("7500");
  });

  it("maps commercial passenger → ContractType FCV / RiskType FPC", () => {
    const p = buildGetQuotePayload(
      baseQuote({ vehicleType: "commercial", commercialSubType: "passenger" }),
      codes,
      meta,
      "r",
    );
    expect(header(p).ContractType).toBe("FCV");
    expect(risk(p).RiskType).toBe("FPC");
  });

  it("flags rollover via PreviousInsDtls", () => {
    const p = buildGetQuotePayload(baseQuote({ businessType: "rollover" }), codes, meta, "r");
    const prev = risk(p).PreviousInsDtls as Record<string, unknown>;
    expect(prev.RollOver).toBe("Y");
    expect(prev.NewVehicle).toBe("N");
  });

  it("pins the emitted Vehicle.FuelType to the FG code (coded, not the full word)", () => {
    const p = buildGetQuotePayload(baseQuote({ fuelType: "petrol" }), codes, meta, "r");
    expect(vehicle(p).FuelType).toBe("P");
  });
});

describe("buildCreateProposalPayload", () => {
  it("builds a CRT payload referencing the prior quote number", () => {
    const p = buildCreateProposalPayload(fullQuote(), codes, meta, "req-2");
    expect(p.url).toBe("/MotorAPI/1.0.0/CreateProposal");
    expect(header(p).METHOD).toBe("CRT");
    expect(header(p).strpolicyquoteNumber).toBe("0000771450");
    const client = p.payload.Client as Record<string, unknown>;
    expect(client.FirstName).toBe("Chandrakant");
    expect(client.PANNo).toBe("ATYPK2714N");
    expect(vehicle(p).EngineNo).toBe("ENG123");
    expect(vehicle(p).ChassiNo).toBe("CHS123");
    expect(vehicle(p).IDV).toBe("738908");
  });

  it("echoes the quote's OD special discount as a negative percentage", () => {
    const p = buildCreateProposalPayload(fullQuote({ odDiscountPercent: 60 }), codes, meta, "r");
    const benefit = risk(p).AdditionalBenefit as Record<string, unknown>;
    expect(benefit.Discount).toBe("-60");
    // ENQ keeps the FG-decides default
    const enq = buildGetQuotePayload(baseQuote(), codes, meta, "r");
    expect((risk(enq).AdditionalBenefit as Record<string, unknown>).Discount).toBe("0.00000");
  });

  it("starts a clean rollover the day after the previous policy expires", () => {
    const p = buildCreateProposalPayload(
      fullQuote({ previousPolicyExpiryDate: "2099-08-10" }),
      codes,
      meta,
      "r",
    );
    expect(header(p).PolicyStartDate).toBe("11/08/2099");
    expect(header(p).PolicyEndDate).toBe("10/08/2100");
  });

  it("carries break-in inspection evidence into RollOverList", () => {
    const p = buildCreateProposalPayload(
      fullQuote({
        isPreviousPolicyExpired: true,
        inspectionReportNumber: "LVC-000123",
        inspectionDate: "2026-07-14",
      }),
      codes,
      meta,
      "r",
    );
    const rollOver = (risk(p).PreviousInsDtls as Record<string, unknown>)
      .RollOverList as Record<string, unknown>;
    expect(rollOver.InspectionRptNo).toBe("LVC-000123");
    expect(rollOver.InspectionDt).toBe("14/07/2026");
  });

  it("adds a CPA nominee block when PA + nominee are present", () => {
    const p = buildCreateProposalPayload(
      fullQuote({ paOwner: true, nomineeName: "Asha", nomineeAge: 30, nomineeRelation: "SPOU" }),
      codes,
      meta,
      "r",
    );
    const cpa = (risk(p).AdditionalBenefit as Record<string, unknown>).CPA as Record<string, unknown>;
    expect(cpa.CPANomName).toBe("Asha");
    expect(cpa.CPANomAge).toBe("30");
  });

  it("throws KYC_INCOMPLETE when CKYCNo is missing at proposal", () => {
    expect(() => buildCreateProposalPayload(fullQuote({ ckyc: "" }), codes, meta, "r")).toThrowError(
      /CKYC/i,
    );
    try {
      buildCreateProposalPayload(fullQuote({ ckyc: "" }), codes, meta, "r");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("KYC_INCOMPLETE");
    }
  });

  it("carries the CKYCNo into the Client block", () => {
    const p = buildCreateProposalPayload(fullQuote(), codes, meta, "r");
    expect((p.payload.Client as Record<string, unknown>).CKYCNo).toBe("10097186172315");
  });

  const femaleProposer = {
    firstName: "Meenu",
    lastName: "Gupta",
    email: "m@example.com",
    mobile: "9696895446",
    dob: "1990-01-01",
    gender: "F",
    panNumber: "DHQPG4064J",
  };

  it("derives the Salutation from Gender so it matches FG's sex check (F → MRS)", () => {
    const male = buildCreateProposalPayload(fullQuote(), codes, meta, "r");
    expect((male.payload.Client as Record<string, unknown>).Salutation).toBe("MR");
    const female = buildCreateProposalPayload(fullQuote({ proposer: femaleProposer }), codes, meta, "r");
    const c = female.payload.Client as Record<string, unknown>;
    expect(c.Salutation).toBe("MRS");
    expect(c.Gender).toBe("F");
  });

  it("throws VALIDATION when the proposer gender is missing (FG null-refs on blank)", () => {
    const noGender = { ...femaleProposer };
    delete (noGender as { gender?: string }).gender;
    expect(() =>
      buildCreateProposalPayload(fullQuote({ proposer: noGender }), codes, meta, "r"),
    ).toThrowError(/gender/i);
  });

  it("includes the full Client column set (ClientCategory / VIPFlag / VIPCategory)", () => {
    const c = buildCreateProposalPayload(fullQuote(), codes, meta, "r").payload.Client as Record<
      string,
      unknown
    >;
    expect(c.ClientCategory).toBe("");
    expect(c.VIPFlag).toBe("N");
    expect(c.VIPCategory).toBe("");
  });

  it("rejects Standalone OD when the TP policy expires before the OD year ends", () => {
    // OD start 2027-06-12 → OD ends 2028-06-11; TP expires 2027-06-11 (too soon).
    expect(() =>
      buildCreateProposalPayload(
        fullQuote({
          selectedPolicy: "standAloneOD",
          policyStartDate: "2027-06-12",
          previousTpExpiryDate: "2027-06-11",
        }),
        codes,
        meta,
        "r",
      ),
    ).toThrowError(/must stay in force for the full OD year/i);
  });

  it("allows Standalone OD when the TP policy covers the full OD year", () => {
    expect(() =>
      buildCreateProposalPayload(
        fullQuote({
          selectedPolicy: "standAloneOD",
          policyStartDate: "2026-08-16",
          previousTpExpiryDate: "2028-06-11",
        }),
        codes,
        meta,
        "r",
      ),
    ).not.toThrow();
  });
});

describe("toFgDate", () => {
  it("converts ISO to DD/MM/YYYY", () => {
    expect(toFgDate("2026-03-11")).toBe("11/03/2026");
  });
});

describe("toNumericUid", () => {
  it("extracts the numeric digits from a UUID requestId (≤20 digits)", () => {
    const uid = toNumericUid("3523f7b3-17a3-40d4-9e97-f2d0ff63b22c");
    expect(uid).toMatch(/^\d+$/);
    expect(uid.length).toBeGreaterThanOrEqual(8);
    expect(uid.length).toBeLessThanOrEqual(20);
  });

  it("falls back to a numeric digest when the requestId has too few digits", () => {
    expect(toNumericUid("req-1")).toMatch(/^\d+$/);
    expect(toNumericUid("abc")).toMatch(/^\d+$/);
  });

  it("is deterministic for a given requestId (stable mapper output)", () => {
    expect(toNumericUid("req-xyz-9")).toBe(toNumericUid("req-xyz-9"));
  });
});

describe("fgSalutation", () => {
  it("maps gender to a sex-matching salutation (M→MR, F→MRS)", () => {
    expect(fgSalutation("M")).toBe("MR");
    expect(fgSalutation("F")).toBe("MRS");
    expect(fgSalutation("O")).toBe("MR");
    expect(fgSalutation(undefined)).toBe("MR");
  });
});

describe("buildIssueProposalPayload", () => {
  const issuanceReq = () =>
    PolicyIssuanceRequestSchema.parse({
      quoteNo: "0000112799",
      clientId: "80036976",
      vehicleCategory: "fourWheeler",
      policyStartDate: "2026-05-14",
      policyEndDate: "2029-05-13",
      receipt: {
        uniqueTranKey: "PB1436423646497",
        transactionDate: "14/05/2026",
        receiptType: "IVR",
        amount: 26652,
        tranRefNo: "PB814363724334018",
        tranRefNoDate: "14/05/2026",
        pgType: "PAYU",
      },
    });

  it("targets IssueProposal with a minimal body (no VendorUserId, no Client/Risk)", () => {
    const p = buildIssueProposalPayload(issuanceReq(), meta, "req-9");
    expect(p.url).toBe("/MotorAPI/1.0.0/IssueProposal");
    expect(p.payload).not.toHaveProperty("VendorUserId");
    expect(p.payload).not.toHaveProperty("Risk");
    expect(p.payload).not.toHaveProperty("Client");
    const ph = p.payload.PolicyHeader as Record<string, unknown>;
    expect(ph.strPolicyQuoteNumber).toBe("0000112799");
    expect(ph.ClientID).toBe("80036976");
    expect((p.payload.Receipt as Record<string, unknown>).Amount).toBe("26652");
  });
});

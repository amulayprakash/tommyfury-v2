import { describe, it, expect } from "vitest";
import { MotorQuoteRequestSchema, MotorFullQuoteRequestSchema } from "@/contracts/quote-request.ts";
import {
  buildGetQuotePayload,
  buildCreateProposalPayload,
  toFgDate,
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
    expect(p.url).toBe("/MotorNB/1.0.0/GetQuote");
    expect(header(p).METHOD).toBe("ENQ");
    expect(header(p).ContractType).toBe("FPV");
    expect(risk(p).RiskType).toBe("FPV");
    expect(risk(p).Cover).toBe("CO");
    expect(vehicle(p).Make).toBe("HONDA");
    expect(vehicle(p).ModelCode).toBe("HO0002");
    expect(vehicle(p).IDV).toBe("0");
    expect(vehicle(p).RegistrationDate).toBe("04/06/2024");
    expect(p.payload.Uid).toBe("req-1");
    expect(p.payload.VendorCode).toBe("Webagg");
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
});

describe("buildCreateProposalPayload", () => {
  it("builds a CRT payload referencing the prior quote number", () => {
    const p = buildCreateProposalPayload(fullQuote(), codes, meta, "req-2");
    expect(p.url).toBe("/MotorNB/1.0.0/CreateProposal");
    expect(header(p).METHOD).toBe("CRT");
    expect(header(p).strPolicyQuoteNumber).toBe("0000771450");
    const client = p.payload.Client as Record<string, unknown>;
    expect(client.FirstName).toBe("Chandrakant");
    expect(client.PANNo).toBe("ATYPK2714N");
    expect(vehicle(p).EngineNo).toBe("ENG123");
    expect(vehicle(p).ChassiNo).toBe("CHS123");
    expect(vehicle(p).IDV).toBe("738908");
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
});

describe("toFgDate", () => {
  it("converts ISO to DD/MM/YYYY", () => {
    expect(toFgDate("2026-03-11")).toBe("11/03/2026");
  });
});

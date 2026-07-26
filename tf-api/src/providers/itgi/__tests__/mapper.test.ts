import { describe, it, expect } from "vitest";
import { buildIdvPayload, buildPremiumPayload, hasElectedAddons } from "../mapper.ts";
import { selectPolicyPath } from "../policy-types/index.ts";
import { selectPremiumBlock, normalizeIdv, normalizeQuote } from "../normalizer.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";

const req = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  makeId: "1",
  makeName: "MARUTI",
  modelId: "10",
  modelName: "SWIFT",
  fuelType: "petrol",
  engineCC: 1197,
  seatingCapacity: 5,
  rtoCode: "DL01",
  registrationDate: "2023-10-20",
  registrationNumber: "DL10AH4567",
  policyStartDate: "2026-02-26",
  policyEndDate: "2027-02-25",
  previousPolicyExpiryDate: "2026-02-24",
  ncbPercent: 45,
  idvValue: 105665,
  zeroDep: false,
  tyreProtect: false,
  rimProtect: false,
  engineProtect: false,
  consumables: false,
  rsa: false,
  paOwner: true,
  paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false,
  claimInPreviousPolicy: false,
  isPreviousPolicyExpired: false,
} as unknown as MotorQuoteRequest;

const codes = { makeCode: "MRSFT", rtoCity: "DELHI", engineCC: 1197, seatingCapacity: 5 };
const partner = {
  partnerCode: "ITGIMOT999",
  partnerBranch: "TF",
  partnerSubBranch: "TF",
  responseUrl: "https://x/y",
};
const asOf = new Date("2026-02-20");
const path = (r: MotorQuoteRequest = req) => selectPolicyPath(r, asOf);

describe("itgi idv payload", () => {
  it("builds the composite makeCode as TYPE-MAKE-YEAR", () => {
    expect(buildIdvPayload(req, codes)).toContain("<prem:makeCode>PCP-MRSFT-2023</prem:makeCode>");
  });

  it("sends the resolved rto token and MM/DD/YYYY dates", () => {
    const xml = buildIdvPayload(req, codes);
    expect(xml).toContain("<prem:rtoCity>DELHI</prem:rtoCity>");
    expect(xml).toContain("<prem:dateOfRegistration>10/20/2023</prem:dateOfRegistration>");
  });
});

describe("itgi premium payload", () => {
  it("reproduces the vendor's misspelled tags verbatim", () => {
    const xml = buildPremiumPayload(req, codes, path(), partner);
    // These misspellings are the vendor's own; "fixing" them breaks the call.
    expect(xml).toContain("<engineCpacity>1197</engineCpacity>");
    expect(xml).toContain("<regictrationCity>DELHI</regictrationCity>");
    expect(xml).not.toContain("engineCapacity");
    expect(xml).not.toContain("registrationCity");
  });

  it("sends contract type, zcover and the partner block", () => {
    const xml = buildPremiumPayload(req, codes, path(), partner);
    expect(xml).toContain("<contractType>PCP</contractType>");
    expect(xml).toContain("<zcover>CO</zcover>");
    expect(xml).toContain("<partnerCode>ITGIMOT999</partnerCode>");
  });

  it("includes IDV Basic and NCB coverage items", () => {
    const xml = buildPremiumPayload(req, codes, path(), partner);
    expect(xml).toContain("<coverageId>IDV Basic</coverageId>");
    expect(xml).toContain("<sumInsured>105665</sumInsured>");
    expect(xml).toContain("<coverageId>No Claim Bonus</coverageId>");
  });

  it("sends opt-in add-ons with sum insured Y", () => {
    const withAddons = { ...req, tyreProtect: true, rimProtect: true, engineProtect: true };
    const xml = buildPremiumPayload(withAddons, codes, path(withAddons), partner);
    expect(xml).toContain("<coverageId>Tyre Protection</coverageId>");
    expect(xml).toContain("<coverageId>Engine Gear Box Protection</coverageId>");
    expect(xml).toContain("<coverageId>RIM</coverageId><number/><sumInsured>Y</sumInsured>");
  });

  it("escapes the ampersand in Towing & Related", () => {
    const withRsa = { ...req, rsa: true };
    const xml = buildPremiumPayload(withRsa, codes, path(withRsa), partner);
    expect(xml).toContain("Towing &amp; Related");
  });

  it("sends act-only policies with zcover AC and IDV sum insured 1", () => {
    const tp = { ...req, selectedPolicy: "thirdParty" } as MotorQuoteRequest;
    const xml = buildPremiumPayload(tp, codes, path(tp), partner);
    expect(xml).toContain("<zcover>AC</zcover>");
    expect(xml).toContain("<coverageId>IDV Basic</coverageId><number/><sumInsured>1</sumInsured>");
    expect(xml).toContain("<coverageId>Legal Liability to Driver</coverageId>");
  });

  it("omits the NCB item when ncb is zero", () => {
    const xml = buildPremiumPayload({ ...req, ncbPercent: 0 }, codes, path(), partner);
    expect(xml).not.toContain("No Claim Bonus");
  });

  it("rejects an NCB percentage the vendor does not accept", () => {
    const xml = buildPremiumPayload({ ...req, ncbPercent: 33 }, codes, path(), partner);
    expect(xml).not.toContain("No Claim Bonus");
  });

  it("marks a single-year OD renewal with type OD", () => {
    const od = { ...req, selectedPolicy: "standAloneOD" } as MotorQuoteRequest;
    const xml = buildPremiumPayload(od, codes, path(od), partner);
    expect(xml).toContain("<type>OD</type>");
  });

  it("detects elected add-ons for premium block selection", () => {
    expect(hasElectedAddons(req)).toBe(false);
    expect(hasElectedAddons({ ...req, zeroDep: true })).toBe(true);
  });
});

// ─── Normalizer ───────────────────────────────────────────────────────────────
// Mirrors the vendor's real dual-block response (kit curl sample).
const dual = {
  getMotorPremiumResponse: {
    getMotorPremiumReturn: [
      {
        autocoverage: "false",
        coveragePremiumDetail: [
          { coverageName: "IDV Basic", odPremium: "1895", tpPremium: "1366" },
          { coverageName: "No Claim Bonus", odPremium: "-853" },
        ],
        discountLoading: "0",
        discountLoadingAmt: "0",
        premiumPayable: "2841.44",
        serviceTax: "433.44",
        totalODPremium: "1042",
        totalPremimAfterDiscLoad: "2408",
        totalTPPremium: "1366",
      },
      {
        autocoverage: "true",
        coveragePremiumDetail: [
          { coverageName: "IDV Basic", odPremium: "1895", tpPremium: "1366" },
          { coverageName: "No Claim Bonus", odPremium: "-853" },
          { coverageName: "Tyre Protection", coveragePremium: "100" },
          { coverageName: "RIM", coveragePremium: "100" },
          { coverageName: "Engine Gear Box Protection", coveragePremium: "264" },
        ],
        discountLoading: "0",
        discountLoadingAmt: "0",
        premiumPayable: "3388.96",
        serviceTax: "516.96",
        totalODPremium: "1042",
        totalPremimAfterDiscLoad: "2872",
        totalTPPremium: "1366",
      },
    ],
  },
};

describe("premium block selection", () => {
  it("picks the autocoverage block when add-ons were requested", () => {
    const block = selectPremiumBlock(dual, true);
    expect(block.autocoverage).toBe("true");
    expect(block.premiumPayable).toBe("3388.96");
  });

  it("picks the base block when no add-ons were requested", () => {
    const block = selectPremiumBlock(dual, false);
    expect(block.autocoverage).toBe("false");
    expect(block.premiumPayable).toBe("2841.44");
  });

  it("falls back to the only block when the vendor returns one", () => {
    const single = {
      getMotorPremiumResponse: {
        getMotorPremiumReturn: [dual.getMotorPremiumResponse.getMotorPremiumReturn[0]],
      },
    };
    expect(selectPremiumBlock(single, true).autocoverage).toBe("false");
  });
});

describe("quote normalization", () => {
  const ctx = {
    requestId: "req-1",
    quoteNo: "Q1",
    policyType: "comprehensive",
    vehicleCategory: "twoWheeler",
    idvValue: 105665,
  };

  it("maps totals into the canonical breakdown in whole rupees", () => {
    const q = normalizeQuote(dual, { ...ctx, hasAddons: true });
    expect(q.providerSlug).toBe("itgi");
    expect(q.basicOdPremium).toBe(1042);
    expect(q.thirdPartyPremium).toBe(1366);
    expect(q.serviceTaxAmount).toBe(517); // 516.96 rounded
    expect(q.grossPremium).toBe(3389); // 3388.96 rounded
    expect(q.netPremium).toBe(2872);
  });

  it("maps add-on premiums from the combined coveragePremium field", () => {
    const q = normalizeQuote(dual, { ...ctx, hasAddons: true });
    expect(q.addonPremiums.tyreProtect).toBe(100);
    expect(q.addonPremiums.rimProtect).toBe(100);
    expect(q.addonPremiums.engineProtect).toBe(264);
    expect(q.totalAddonPremium).toBe(464);
  });

  it("maps the NCB discount as a positive amount", () => {
    const q = normalizeQuote(dual, { ...ctx, hasAddons: true });
    expect(q.discounts.ncbAmount).toBe(853);
  });

  it("has no add-on premiums when the base block is selected", () => {
    const q = normalizeQuote(dual, { ...ctx, hasAddons: false });
    expect(q.totalAddonPremium).toBe(0);
    expect(q.grossPremium).toBe(2841);
  });

  it("reads idv bounds from the idv response", () => {
    const idv = normalizeIdv({
      getVehicleIdvResponse: {
        getVehicleIdvReturn: {
          idv: "415695",
          minimumIdvAllowed: "376105",
          maximumIdvAllowed: "415695",
        },
      },
    });
    expect(idv).toEqual({ idv: 415695, minIdv: 376105, maxIdv: 415695 });
  });

  it("throws when the idv response carries the misspelled error field", () => {
    expect(() =>
      normalizeIdv({
        getVehicleIdvResponse: { getVehicleIdvReturn: { erorMessage: "Invalid RTO city" } },
      }),
    ).toThrow(/Invalid RTO city/);
  });
});

import { describe, it, expect } from "vitest";
import {
  HDFC_SLUG,
  HDFC_CAPABILITIES,
  HDFC_OPERATIONS,
  HDFC_MOTOR_CAPABILITIES,
  hdfcPolicyType,
  HDFC_ENDPOINTS,
} from "../config.ts";

describe("HDFC capability surface", () => {
  it("supports only private car categories", () => {
    expect([...HDFC_CAPABILITIES].sort()).toEqual(["fourWheeler", "newVehicle"]);
  });

  it("declares the full lifecycle it can actually serve", () => {
    expect([...HDFC_OPERATIONS].sort()).toEqual(
      ["ckyc", "coi", "issuance", "proposal", "quote", "renewal"],
    );
  });

  it("does not declare operations the vendor has no endpoint for", () => {
    for (const op of ["retrieveQuote", "policyStatus", "inspection", "ovd"]) {
      expect(HDFC_OPERATIONS.has(op as never)).toBe(false);
    }
  });

  it("offers all three plan types for four-wheeler, comprehensive only for new", () => {
    expect(HDFC_MOTOR_CAPABILITIES.fourWheeler?.policyTypes.sort()).toEqual([
      "comprehensive",
      "standAloneOD",
      "thirdParty",
    ]);
    expect(HDFC_MOTOR_CAPABILITIES.newVehicle?.policyTypes).toEqual(["comprehensive"]);
  });

  it("excludes add-ons HDFC has no cover field for", () => {
    const addons = HDFC_MOTOR_CAPABILITIES.fourWheeler?.addons ?? [];
    for (const absent of ["rimProtect", "keyProtect", "drivingAccessories"]) {
      expect(addons).not.toContain(absent);
    }
    expect(addons).toContain("zeroDep");
    expect(addons).toContain("tyreProtect");
  });

  it("advertises the covers whose Req_PvtCar flags are now wired", () => {
    const addons = HDFC_MOTOR_CAPABILITIES.fourWheeler?.addons ?? [];
    // IsEAW_Cover — "Emergency Assistance Wider", a separate cover from
    // IsEA_Cover that prices independently (live UAT: EA ₹50, EAW ₹499).
    expect(addons).toContain("rsaWorldwide");
    // IsLossofUseDownTimeProt_Cover — HDFC's name for Garage Cash. It used to be
    // listed as a cover HDFC "has no field for", which was wrong: live UAT
    // returns Loss_of_Use_Premium 559 when the flag is set.
    expect(addons).toContain("garageCash");
    // IsEMIProtector_Cover, rated on the instalment amount.
    expect(addons).toContain("emiProtect");
  });
});

describe("hdfcPolicyType", () => {
  it("maps canonical plan types onto HDFC POLICY_TYPE strings", () => {
    expect(hdfcPolicyType("comprehensive")).toBe("OD Plus TP");
    expect(hdfcPolicyType("thirdParty")).toBe("TP Only");
    expect(hdfcPolicyType("standAloneOD")).toBe("OD Only");
  });
});

describe("HDFC_ENDPOINTS", () => {
  it("exposes all eight HEI operations", () => {
    expect(Object.keys(HDFC_ENDPOINTS).sort()).toEqual([
      "authenticate",
      "calculatePremium",
      "createProposal",
      "getCalculateIDV",
      "getPolicyDocument",
      "getProposalDocument",
      "renewalExtract",
      "submitPaymentDetails",
    ]);
  });
});

describe("slug", () => {
  it("is 'hdfc'", () => {
    expect(HDFC_SLUG).toBe("hdfc");
  });
});

import { describe, expect, it } from "vitest";

import {
  buildHdfcFullQuoteRequest,
  buildHdfcQuoteRequest,
  HDFC_SLUG,
} from "../build-hdfc-request";
import { DEFAULT_PROPOSER } from "../hdfc-uat-store";
import type { HdfcConditions } from "../hdfc-uat-store";

const base: HdfcConditions = {
  makeId: "12798", makeName: "MARUTI", modelId: "12798", modelName: "SWIFT ZXI",
  fuelType: "petrol", rtoCode: "10406",
  registrationNumber: "MH01QQ7878", registrationDate: "2025-08-13",
  engineNumber: "ENG1234567890123", chassisNumber: "MA3EWDE1S00123456",
  businessType: "rollover", isUsedVehiclePurchase: false,
  planType: "comprehensive", tenureYears: 1, paOwner: true,
  previousInsurerId: "TATAAIG", previousInsurerName: "Tata AIG",
  previousPolicyNumber: "PREVPOL0001",
  previousPolicyExpiryDate: "2026-08-20", isPreviousPolicyExpired: false,
  ncbPercent: 20, claimInPreviousPolicy: false,
};

describe("buildHdfcQuoteRequest", () => {
  it("asks for HDFC and nothing else", () => {
    expect(buildHdfcQuoteRequest("fourWheeler", base, []).providers).toEqual([HDFC_SLUG]);
  });

  it("carries the vehicle and policy conditions through", () => {
    const req = buildHdfcQuoteRequest("fourWheeler", base, []);
    expect(req.vehicleType).toBe("fourWheeler");
    expect(req.selectedPolicy).toBe("comprehensive");
    expect(req.modelId).toBe("12798");
    expect(req.rtoCode).toBe("10406");
    expect(req.tenureYears).toBe(1);
  });

  it("sends the previous TP policy only for a standalone OD", () => {
    const withTp: HdfcConditions = {
      ...base, planType: "standAloneOD",
      previousTpPolicyNumber: "TPPOL0001",
      previousTpStartDate: "2025-08-13", previousTpExpiryDate: "2028-07-14",
    };
    expect(buildHdfcQuoteRequest("fourWheeler", withTp, []).previousTpPolicyNumber)
      .toBe("TPPOL0001");
    expect(buildHdfcQuoteRequest("fourWheeler", base, []).previousTpPolicyNumber)
      .toBeUndefined();
  });

  it("always names the previous insurer on a standalone OD, because HDFC validates the TP policy against it", () => {
    const saod: HdfcConditions = { ...base, planType: "standAloneOD" };
    expect(buildHdfcQuoteRequest("fourWheeler", saod, []).previousInsurerId).toBe("TATAAIG");
  });

  it("omits engineCC when it is zero, which the contract rejects", () => {
    const ev: HdfcConditions = { ...base, fuelType: "electric", engineCC: 0 };
    expect(buildHdfcQuoteRequest("fourWheeler", ev, []).engineCC).toBeUndefined();
  });

  it("passes HDFC's own plan bundles through as provider addon codes", () => {
    const req = buildHdfcQuoteRequest("fourWheeler", base, ["Silver Plan"]);
    expect(req.providerAddonCodes).toEqual(["Silver Plan"]);
  });

  it("asks for the raw exchange so the drawer can show it", () => {
    expect(buildHdfcQuoteRequest("fourWheeler", base, []).includeRawExchange).toBe(true);
  });

  it("suppresses owner PA only when the condition turns it off", () => {
    expect(buildHdfcQuoteRequest("fourWheeler", base, []).paOwner).toBe(true);
    expect(buildHdfcQuoteRequest("fourWheeler", { ...base, paOwner: false }, []).paOwner).toBe(false);
  });

  it("carries HDFC's used-car product flag", () => {
    const used: HdfcConditions = { ...base, isUsedVehiclePurchase: true };
    expect(buildHdfcQuoteRequest("fourWheeler", used, []).isUsedVehiclePurchase).toBe(true);
  });

  it("turns on the canonical add-on flags HDFC honours, unlike FG's cover codes", () => {
    const req = buildHdfcQuoteRequest("fourWheeler", base, ["zeroDep", "rti", "Silver Plan"]);
    expect(req.zeroDep).toBe(true);
    expect(req.rti).toBe(true);
    expect(req.engineProtect).toBe(false);
    // A canonical key is a flag, not a vendor cover code — only the bundle passes through.
    expect(req.providerAddonCodes).toEqual(["Silver Plan"]);
  });
});

const BINDING = { quoteId: "HDFCQ1", kycRefId: "KYCREF1", ckyc: "PEHCHAAN1" };

describe("buildHdfcFullQuoteRequest", () => {
  const req = buildHdfcFullQuoteRequest("fourWheeler", base, DEFAULT_PROPOSER, [], BINDING);

  it("keeps the priced conditions the quote was rated under", () => {
    expect(req.selectedPolicy).toBe("comprehensive");
    expect(req.modelId).toBe("12798");
    expect(req.tenureYears).toBe(1);
    expect(req.quoteId).toBe("HDFCQ1");
  });

  it("sends the nominee relation exactly as HDFC's RELATION MASTER spells it", () => {
    // "spouse" was rejected live; "Spouse" bound. The match is case-sensitive.
    expect(req.nomineeRelation).toBe("Spouse");
    expect(req.nomineeName).toBe(DEFAULT_PROPOSER.nomineeName);
    expect(req.nomineeAge).toBe(DEFAULT_PROPOSER.nomineeAge);
  });

  it("reaches the request with both KYC identifiers", () => {
    expect(req.kycRefId).toBe("KYCREF1");
    expect(req.ckyc).toBe("PEHCHAAN1");
  });

  it("omits the KYC identifiers when none was captured", () => {
    const noKyc = buildHdfcFullQuoteRequest("fourWheeler", base, DEFAULT_PROPOSER, [], {
      quoteId: "HDFCQ1",
    });
    expect(noKyc.kycRefId).toBeUndefined();
    expect(noKyc.ckyc).toBeUndefined();
  });

  it("carries the proposer, address and vehicle identifiers the proposal needs", () => {
    expect(req.proposer.firstName).toBe(DEFAULT_PROPOSER.firstName);
    expect(req.address.pincode).toBe(DEFAULT_PROPOSER.pincode);
    expect(req.vehicle.engineNumber).toBe("ENG1234567890123");
    expect(req.vehicle.chassisNumber).toBe("MA3EWDE1S00123456");
    expect(req.vehicle.financeType).toBe("none");
  });

  it("drops the provider lock, which the proposal route carries in its URL instead", () => {
    expect((req as { providers?: string[] }).providers).toBeUndefined();
  });
});

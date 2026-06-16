import { describe, it, expect } from "vitest";
import { ProviderCapabilityError } from "@/errors/app-error.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CkycRequest } from "@/contracts/kyc.ts";
import {
  buildSaveQuotePayload,
  buildProposalPayload,
  buildCkycPayload,
  buildOvdFormData,
  resolveLine,
  toIciciDob,
  type IciciResolvedCodes,
} from "../mapper.ts";

const codes: IciciResolvedCodes = {
  makeCode: 10,
  modelCode: 11846,
  rtoCode: 12621,
  previousInsurerCode: "ICICI LOMBARD",
};

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
    ...overrides,
  };
}

describe("resolveLine", () => {
  it("maps fourWheeler/newVehicle → fw and twoWheeler → tw", () => {
    expect(resolveLine("fourWheeler")).toBe("fw");
    expect(resolveLine("newVehicle")).toBe("fw");
    expect(resolveLine("twoWheeler")).toBe("tw");
  });

  it("throws for unsupported categories", () => {
    expect(() => resolveLine("commercial")).toThrow(ProviderCapabilityError);
  });
});

describe("toIciciDob", () => {
  it("formats YYYY-MM-DD → dd-MMM-yyyy", () => {
    expect(toIciciDob("1992-11-08")).toBe("08-Nov-1992");
    expect(toIciciDob("2001-10-29")).toBe("29-Oct-2001");
  });
});

describe("buildSaveQuotePayload", () => {
  it("builds a 4W rollover comprehensive payload with ProductCode 21 and IDV", () => {
    const { line, url, payload } = buildSaveQuotePayload(
      baseQuote({ idvValue: 600000 }),
      codes,
      "req-1",
    );
    expect(line).toBe("fw");
    expect(url).toBe("/generic/motor-fw/generic/premium");
    expect(payload.ProductCode).toBe(21);
    expect(payload.MakeCode).toBe(10);
    expect(payload.RTOCode).toBe(12621);
    expect(payload.IDV).toBe(600000);
    expect(payload.IDVType).toBeUndefined();
    expect(payload.AddOns).toEqual(expect.arrayContaining(["ZD", "RSA"]));
    expect(payload.PreviousPolicyNcbPercentage).toBe(20);
    expect(payload.RequestId).toBe("req-1");
  });

  it("uses IDVType (avg) when no IDV provided, and 2W endpoint for two-wheelers", () => {
    const { line, url, payload } = buildSaveQuotePayload(
      baseQuote({ vehicleType: "twoWheeler", selectedPolicy: "thirdParty", zeroDep: false, rsa: false }),
      codes,
      "req-2",
    );
    expect(line).toBe("tw");
    expect(url).toBe("/generic/motor-tw/generic/premium");
    expect(payload.ProductCode).toBe(24); // 2W TP rollover
    expect(payload.IDVType).toBe(3);
    expect(payload.IDV).toBeUndefined();
  });

  it("throws when no product code matches the journey", () => {
    expect(() =>
      buildSaveQuotePayload(baseQuote({ businessType: "new", selectedPolicy: "standAloneOD" }), codes, "r"),
    ).toThrow(ProviderCapabilityError);
  });
});

describe("buildProposalPayload", () => {
  it("maps proposer/vehicle/nominee onto the ICICI proposal shape", () => {
    const full: MotorFullQuoteRequest = {
      ...baseQuote(),
      quoteId: "epn_txn",
      isProposalOnly: false,
      isVehicleUnderLoan: false,
      proposer: {
        firstName: "Ravi",
        lastName: "Kumar",
        email: "ravi@example.com",
        mobile: "9876543210",
        dob: "1990-05-15",
        panNumber: "ABCDE1234F",
      },
      address: { addressLine1: "MG Road", pincode: "421004", city: "Kalyan", state: "MH" },
      vehicle: { engineNumber: "ENG1", chassisNumber: "CHS1", financeType: "none" },
      nomineeName: "Sita",
      nomineeAge: 30,
      nomineeRelation: "SPOUSE",
    };

    const { url, payload } = buildProposalPayload(full, codes, "req-3");
    expect(url).toBe("/generic/motor-fw/generic/proposal");
    expect(payload.TransactionId).toBe("epn_txn");
    expect(payload.ProposerName).toBe("Ravi Kumar");
    expect(payload.EngineNo).toBe("ENG1");
    expect(payload.ChassisNo).toBe("CHS1");
    expect(payload.NomineeRelationship).toBe("SPOUSE");
    expect(payload.PanNumber).toBe("ABCDE1234F");
    expect(payload.RequestId).toBe("req-3");
  });
});

describe("buildCkycPayload", () => {
  it("maps PolicyType to ICICI's numeric code and formats DOB", () => {
    const req: CkycRequest = {
      transactionId: "epn_txn",
      dob: "2001-10-29",
      aadhaarNumber: "987654398765",
      nameAsPerAadhaar: "Abv Dth",
      gender: "M",
      policyType: "motor",
    };
    const payload = buildCkycPayload(req);
    expect(payload.PolicyType).toBe(1);
    expect(payload.DateOfBirth).toBe("29-Oct-2001");
    expect(payload.AadhaarNumber).toBe("987654398765");
  });
});

describe("buildOvdFormData", () => {
  it("appends ICICI-spelled file fields and metadata", () => {
    const form = buildOvdFormData(
      { transactionId: "epn", proofOfIdentityType: "AADHAAR", proofOfAddressType: "AADHAAR", policyType: "motor" },
      [
        { fieldName: "proofOfIdentity", originalName: "id.jpg", mimeType: "image/jpeg", buffer: Buffer.from("a") },
        { fieldName: "proofOfAddress", originalName: "ad.jpg", mimeType: "image/jpeg", buffer: Buffer.from("b") },
      ],
    );
    expect(form.get("quoteTransactionId")).toBe("epn");
    expect(form.get("PolicyType")).toBe("1");
    expect(form.has("ProofOfIdentify")).toBe(true); // note ICICI spelling
    expect(form.has("ProofOfAddress")).toBe(true);
  });
});

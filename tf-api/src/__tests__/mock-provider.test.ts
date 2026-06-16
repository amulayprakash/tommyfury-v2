import { describe, it, expect } from "vitest";
import { MockProvider } from "@/providers/mock/mock.provider.ts";

const provider = new MockProvider();
const ctx = { requestId: "test-req-001" };

describe("MockProvider", () => {
  it("has the correct slug and all five capabilities", () => {
    expect(provider.slug).toBe("mock");
    expect(provider.capabilities.has("fourWheeler")).toBe(true);
    expect(provider.capabilities.has("twoWheeler")).toBe(true);
    expect(provider.capabilities.has("commercial")).toBe(true);
    expect(provider.capabilities.has("newVehicle")).toBe(true);
    expect(provider.capabilities.has("newCommercial")).toBe(true);
  });

  it("returns a Zuno-shaped quote for a 4W comprehensive quote", async () => {
    const req = {
      vehicleType: "fourWheeler" as const,
      selectedPolicy: "comprehensive" as const,
      businessType: "rollover" as const,
      makeId: "MARUTI",
      makeName: "Maruti Suzuki",
      modelId: "SWIFT",
      modelName: "Swift",
      fuelType: "petrol" as const,
      rtoCode: "DL01",
      registrationDate: "2021-06-01",
      idvValue: 600000,
      ncbPercent: 20,
      claimInPreviousPolicy: false,
      isPreviousPolicyExpired: false,
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
    };

    const result = await provider.getQuote(req, ctx);

    expect(result.providerSlug).toBe("mock");
    expect(result.vehicleCategory).toBe("fourWheeler");
    expect(result.idvValue).toBe(600000);
    expect(result.grossPremium).toBeGreaterThan(0);
    expect(result.serviceTaxPercent).toBe(18);
    // GST math: serviceTaxAmount ≈ netPremium * 0.18
    expect(result.serviceTaxAmount).toBeCloseTo(result.netPremium * 0.18, 0);
    // NCB discount applied to OD
    expect(result.discounts.ncbPercent).toBe(20);
    expect(result.discounts.ncbAmount).toBeGreaterThan(0);
    // Addons present
    expect(result.addonPremiums.zeroDep).toBeGreaterThan(0);
    expect(result.addonPremiums.rsa).toBe(499);
    expect(result.addonPremiums.paOwner).toBe(330);
  });

  it("returns zero premiums for no-quote scenario", async () => {
    const req = {
      vehicleType: "twoWheeler" as const,
      selectedPolicy: "thirdParty" as const,
      businessType: "rollover" as const,
      makeId: "HONDA",
      makeName: "Honda",
      modelId: "ACTIVA",
      modelName: "Activa",
      fuelType: "petrol" as const,
      rtoCode: "MH02",
      registrationDate: "2020-01-01",
      ncbPercent: 0,
      claimInPreviousPolicy: false,
      isPreviousPolicyExpired: false,
      zeroDep: false,
      engineProtect: false,
      rsa: false,
      tyreProtect: false,
      rimProtect: false,
      rti: false,
      consumables: false,
      paOwner: false,
      paUnnamedPassenger: false,
      legalLiabilityPaidDriver: false,
    };

    const result = await provider.getQuote(req, ctx, "no-quote");
    expect(result.grossPremium).toBe(0);
    expect(result.quoteNo).toBe("");
  });

  it("returns a full-quote with policyNumber and paymentUrl", async () => {
    const req = {
      vehicleType: "fourWheeler" as const,
      selectedPolicy: "comprehensive" as const,
      businessType: "rollover" as const,
      makeId: "MARUTI",
      makeName: "Maruti Suzuki",
      modelId: "SWIFT",
      modelName: "Swift",
      fuelType: "petrol" as const,
      rtoCode: "DL01",
      registrationDate: "2021-06-01",
      idvValue: 500000,
      ncbPercent: 0,
      claimInPreviousPolicy: false,
      isPreviousPolicyExpired: false,
      zeroDep: false,
      engineProtect: false,
      rsa: false,
      tyreProtect: false,
      rimProtect: false,
      rti: false,
      consumables: false,
      paOwner: true,
      paUnnamedPassenger: false,
      legalLiabilityPaidDriver: false,
      quoteId: "full-quote-test-001",
      isProposalOnly: false,
      isVehicleUnderLoan: false,
      proposer: {
        firstName: "Ravi",
        lastName: "Kumar",
        email: "ravi@example.com",
        mobile: "9876543210",
        dob: "1990-05-15",
      },
      address: {
        addressLine1: "123 MG Road",
        pincode: "110001",
        city: "Delhi",
        state: "Delhi",
      },
      vehicle: {
        engineNumber: "ENG12345",
        chassisNumber: "CHS67890",
        financeType: "none" as const,
      },
    };

    const result = await provider.getFullQuote(req, ctx);
    expect(result.policyNumber).toMatch(/^MOCK-POL-/);
    expect(result.paymentUrl).toContain("mock/payment");
    expect(result.contractDetails?.proposerName).toBe("Ravi Kumar");
  });
});

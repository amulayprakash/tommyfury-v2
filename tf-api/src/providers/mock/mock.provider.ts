import { randomUUID } from "node:crypto";
import type {
  VehicleCategory,
  ProviderOperation,
  PolicyType,
  AddonKey,
  MotorCapabilities,
} from "@/contracts/enums.ts";
import { ADDON_METADATA } from "@/contracts/enums.ts";
import type { InsuranceProvider, ProviderContext } from "@/providers/insurance-provider.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";

const ALL_CATEGORIES_LIST: VehicleCategory[] = [
  "fourWheeler",
  "twoWheeler",
  "commercial",
  "newVehicle",
  "newCommercial",
];

const ALL_CATEGORIES: ReadonlySet<VehicleCategory> = new Set(ALL_CATEGORIES_LIST);

const ALL_POLICY_TYPES: PolicyType[] = ["comprehensive", "thirdParty", "standAloneOD"];
const ALL_ADDONS: AddonKey[] = ADDON_METADATA.map((a) => a.key);

// The dev provider advertises everything for every category.
const MOCK_MOTOR_CAPABILITIES: MotorCapabilities = Object.fromEntries(
  ALL_CATEGORIES_LIST.map((c) => [c, { policyTypes: ALL_POLICY_TYPES, addons: ALL_ADDONS }]),
) as MotorCapabilities;

// Deterministic base rates by category (₹)
const BASE_OD: Record<VehicleCategory, number> = {
  fourWheeler: 3200,
  twoWheeler: 1100,
  commercial: 7500,
  newVehicle: 4000,
  newCommercial: 9000,
};

const BASE_TP: Record<VehicleCategory, number> = {
  fourWheeler: 2094,
  twoWheeler: 740,
  commercial: 4500,
  newVehicle: 2094,
  newCommercial: 4500,
};

type Scenario = "slow" | "upstream-500" | "no-quote";

export class MockProvider implements InsuranceProvider {
  readonly slug = "mock";
  readonly displayName = "Mock Insurer (Dev)";
  readonly capabilities: ReadonlySet<VehicleCategory> = ALL_CATEGORIES;
  readonly operations: ReadonlySet<ProviderOperation> = new Set(["quote", "proposal"]);
  readonly motorCapabilities: MotorCapabilities = MOCK_MOTOR_CAPABILITIES;

  async getQuote(
    req: MotorQuoteRequest,
    ctx: ProviderContext,
    scenario?: Scenario,
  ): Promise<CanonicalQuoteResult> {
    if (scenario === "slow") await delay(4000);
    if (scenario === "upstream-500") throw new Error("Mock upstream 500");
    if (scenario === "no-quote") {
      return {
        quoteNo: "",
        requestId: ctx.requestId,
        providerSlug: this.slug,
        policyType: req.selectedPolicy,
        vehicleCategory: req.vehicleType,
        idvValue: req.idvValue ?? 0,
        basicOdPremium: 0,
        thirdPartyPremium: 0,
        addonPremiums: {},
        discounts: {},
        totalAddonPremium: 0,
        totalDiscount: 0,
        netPremium: 0,
        serviceTaxPercent: 18,
        serviceTaxAmount: 0,
        grossPremium: 0,
        insurerName: "No Quote Available",
      };
    }

    return computePremium(req, ctx.requestId, this.slug);
  }

  async getFullQuote(
    req: MotorFullQuoteRequest,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult> {
    const base = await this.getQuote(req, ctx);
    return {
      ...base,
      policyNumber: `MOCK-POL-${randomUUID().slice(0, 8).toUpperCase()}`,
      paymentUrl: `http://localhost:4000/mock/payment?quoteNo=${base.quoteNo}`,
      contractDetails: {
        proposerName: `${req.proposer.firstName} ${req.proposer.lastName}`,
        engineNumber: req.vehicle.engineNumber,
        chassisNumber: req.vehicle.chassisNumber,
      },
    };
  }
}

function computePremium(
  req: MotorQuoteRequest,
  requestId: string,
  slug: string,
): CanonicalQuoteResult {
  const cat = req.vehicleType;
  const baseOd = BASE_OD[cat] ?? 3200;
  const baseTp = BASE_TP[cat] ?? 2094;

  // IDV factor: higher IDV → proportionally higher OD premium
  const idv = req.idvValue ?? 500000;
  const odFactor = Math.max(0.6, Math.min(2.0, idv / 500000));
  const basicOd = req.selectedPolicy !== "thirdParty" ? Math.round(baseOd * odFactor) : 0;
  const tp = req.selectedPolicy !== "standAloneOD" ? baseTp : 0;

  // Addons
  const addons = {
    zeroDep: req.zeroDep ? Math.round(basicOd * 0.12) : undefined,
    engineProtect: req.engineProtect ? Math.round(basicOd * 0.06) : undefined,
    rsa: req.rsa ? 499 : undefined,
    tyreProtect: req.tyreProtect ? Math.round(basicOd * 0.04) : undefined,
    rimProtect: req.rimProtect ? Math.round(basicOd * 0.03) : undefined,
    rti: req.rti ? Math.round(basicOd * 0.08) : undefined,
    consumables: req.consumables ? Math.round(basicOd * 0.05) : undefined,
    paOwner: req.paOwner ? 330 : undefined,
    paUnnamedPassenger: req.paUnnamedPassenger ? 100 : undefined,
    legalLiabilityPaidDriver: req.legalLiabilityPaidDriver ? 100 : undefined,
  };

  const totalAddon = Object.values(addons).reduce((s: number, v) => s + (v ?? 0), 0);

  // NCB discount on OD only
  const ncbAmount = Math.round(basicOd * (req.ncbPercent / 100));
  const discounts = { ncbPercent: req.ncbPercent, ncbAmount };
  const totalDiscount = ncbAmount;

  const net = basicOd + tp + totalAddon - totalDiscount;
  const gstAmount = Math.round(net * 0.18);
  const gross = net + gstAmount;

  return {
    quoteNo: `MOCK-${requestId.slice(0, 8).toUpperCase()}`,
    requestId,
    providerSlug: slug,
    insurerId: "mock-001",
    insurerName: "Mock General Insurance",
    policyType: req.selectedPolicy,
    vehicleCategory: cat,
    idvValue: idv,
    basicOdPremium: basicOd,
    thirdPartyPremium: tp,
    addonPremiums: addons,
    discounts,
    totalAddonPremium: totalAddon,
    totalDiscount,
    netPremium: net,
    serviceTaxPercent: 18,
    serviceTaxAmount: gstAmount,
    grossPremium: gross,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

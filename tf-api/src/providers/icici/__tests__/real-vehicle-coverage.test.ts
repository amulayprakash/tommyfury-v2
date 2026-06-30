import { describe, it, expect } from "vitest";
import { ProviderCapabilityError } from "@/errors/app-error.ts";
import type { BusinessType, PolicyType, VehicleCategory, FuelType } from "@/contracts/enums.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import { IciciProvider, passthroughCodeResolver } from "../icici.provider.ts";
import { buildSaveQuotePayload, type IciciResolvedCodes } from "../mapper.ts";
import type { IciciTransport } from "../http.ts";
import type { IciciConfig } from "../config.ts";

import quoteFixture from "../fixtures/quote.response.json";
import proposalFixture from "../fixtures/proposal.response.json";
import policyStatusFixture from "../fixtures/policy-status.response.json";

/**
 * FULL 12-condition coverage per wheel (2W & 4W), each driven by a REAL vehicle
 * from ICICI's UAT MMV master (real Make/Model/RTO codes) + a sample registration
 * number valid for that RTO state-series.
 *
 * 12 conditions = 4 business types (new / rollover / breakin / renewal)
 *                × 3 plan types  (Comprehensive / Own Damage / Third Party).
 *
 * Product codes are ICICI's published Product Master (Generic 2W/4W PDFs):
 *   2W: 10 BrandNew · 13 RollOver · 16 OwnDamage · 26 2W-TP
 *   4W: 20 BrandNew · 21 RollOver · 22 OwnDamage · 29 4W-TP
 * ICICI sells NO BrandNew-OD, NO BrandNew-TP, NO standalone Renewal-OD product —
 * those requests are expected to be REJECTED (capability error), not mis-priced.
 * "Breakin" is not its own product: it reuses the RollOver codes but the quote
 * comes back inspection-required; payment is then gated (tested separately below).
 */

const config: IciciConfig = {
  baseUrl: "https://uat.example",
  login: "user",
  password: "pass",
  aesKey: "key",
  aesMode: "aes-256-ecb",
  credentialSetId: "default",
};

// ─── Real test vehicles (from dock boyz/ICICI/UAT_MMV_Details) ─────────────────
interface Vehicle {
  tag: string;
  category: VehicleCategory;
  makeName: string;
  makeCode: number;
  modelName: string;
  modelCode: number;
  rtoName: string;
  rtoCode: number;
  fuel: FuelType;
  regNo: string;
}

const V1: Vehicle = { tag: "V1", category: "fourWheeler", makeName: "MARUTI", makeCode: 10, modelName: "SWIFT VXI", modelCode: 22193, rtoName: "Pune", rtoCode: 9, fuel: "petrol", regNo: "MH-12-AB-1234" };
const V2: Vehicle = { tag: "V2", category: "fourWheeler", makeName: "HYUNDAI", makeCode: 8, modelName: "CRETA", modelCode: 10184, rtoName: "Mumbai", rtoCode: 8, fuel: "petrol", regNo: "MH-01-CD-5678" };
const V3: Vehicle = { tag: "V3", category: "fourWheeler", makeName: "HONDA", makeCode: 7, modelName: "AMAZE 1.2 EX MT", modelCode: 21899, rtoName: "Thane", rtoCode: 13, fuel: "petrol", regNo: "MH-04-EF-9012" };
const V4: Vehicle = { tag: "V4", category: "fourWheeler", makeName: "MARUTI", makeCode: 10, modelName: "BALENO SIGMA", modelCode: 23078, rtoName: "Kalyan", rtoCode: 597, fuel: "petrol", regNo: "MH-05-GH-3456" };

const W1: Vehicle = { tag: "W1", category: "twoWheeler", makeName: "HERO", makeCode: 32, modelName: "SPLENDOR PLUS DRUM", modelCode: 21646, rtoName: "Pune", rtoCode: 634, fuel: "petrol", regNo: "MH-12-XY-4321" };
const W2: Vehicle = { tag: "W2", category: "twoWheeler", makeName: "TVS", makeCode: 39, modelName: "JUPITER", modelCode: 17877, rtoName: "Mumbai", rtoCode: 192, fuel: "petrol", regNo: "MH-01-ZW-8765" };
const W3: Vehicle = { tag: "W3", category: "twoWheeler", makeName: "BAJAJ", makeCode: 31, modelName: "PULSAR 150", modelCode: 12637, rtoName: "Thane", rtoCode: 2029, fuel: "petrol", regNo: "MH-04-UV-2109" };
const W4: Vehicle = { tag: "W4", category: "twoWheeler", makeName: "BAJAJ", makeCode: 31, modelName: "PULSAR 180", modelCode: 380, rtoName: "Nashik", rtoCode: 412, fuel: "petrol", regNo: "MH-15-JK-7788" };

type Expect = number | "REJECT";

interface Case {
  vehicle: Vehicle;
  business: BusinessType;
  breakin?: boolean; // rollover/renewal with expired previous policy ⇒ inspection
  plan: PolicyType;
  expect: Expect;
}

// ─── 4W — all 12 conditions ────────────────────────────────────────────────────
const FW_CASES: Case[] = [
  { vehicle: V2, business: "new", plan: "comprehensive", expect: 20 },
  { vehicle: V2, business: "new", plan: "standAloneOD", expect: "REJECT" },
  { vehicle: V2, business: "new", plan: "thirdParty", expect: "REJECT" },
  { vehicle: V1, business: "rollover", plan: "comprehensive", expect: 21 },
  { vehicle: V1, business: "rollover", plan: "standAloneOD", expect: 22 },
  { vehicle: V1, business: "rollover", plan: "thirdParty", expect: 29 },
  { vehicle: V3, business: "rollover", breakin: true, plan: "comprehensive", expect: 21 },
  { vehicle: V3, business: "rollover", breakin: true, plan: "standAloneOD", expect: 22 },
  { vehicle: V3, business: "rollover", breakin: true, plan: "thirdParty", expect: 29 },
  { vehicle: V4, business: "renewal", plan: "comprehensive", expect: 21 },
  { vehicle: V4, business: "renewal", plan: "standAloneOD", expect: "REJECT" },
  { vehicle: V4, business: "renewal", plan: "thirdParty", expect: 29 },
];

// ─── 2W — all 12 conditions ────────────────────────────────────────────────────
const TW_CASES: Case[] = [
  { vehicle: W2, business: "new", plan: "comprehensive", expect: 10 },
  { vehicle: W2, business: "new", plan: "standAloneOD", expect: "REJECT" },
  { vehicle: W2, business: "new", plan: "thirdParty", expect: "REJECT" },
  { vehicle: W1, business: "rollover", plan: "comprehensive", expect: 13 },
  { vehicle: W1, business: "rollover", plan: "standAloneOD", expect: 16 },
  { vehicle: W1, business: "rollover", plan: "thirdParty", expect: 26 },
  { vehicle: W3, business: "rollover", breakin: true, plan: "comprehensive", expect: 13 },
  { vehicle: W3, business: "rollover", breakin: true, plan: "standAloneOD", expect: 16 },
  { vehicle: W3, business: "rollover", breakin: true, plan: "thirdParty", expect: 26 },
  { vehicle: W4, business: "renewal", plan: "comprehensive", expect: 13 },
  { vehicle: W4, business: "renewal", plan: "standAloneOD", expect: "REJECT" },
  { vehicle: W4, business: "renewal", plan: "thirdParty", expect: 26 },
];

function reqFor(c: Case): MotorQuoteRequest {
  const v = c.vehicle;
  return {
    vehicleType: v.category,
    selectedPolicy: c.plan,
    businessType: c.business,
    makeId: String(v.makeCode),
    makeName: v.makeName,
    modelId: String(v.modelCode),
    modelName: v.modelName,
    fuelType: v.fuel,
    rtoCode: String(v.rtoCode),
    registrationNumber: v.regNo,
    registrationDate: "2021-06-01",
    // Break-in = expired previous policy → ICICI returns IsInspectionRequire=true.
    isPreviousPolicyExpired: c.breakin ?? false,
    previousPolicyExpiryDate: c.breakin ? "2024-01-01" : undefined,
    claimInPreviousPolicy: false,
    ncbPercent: 20,
    zeroDep: c.plan !== "thirdParty",
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
  };
}

function resolvedFor(v: Vehicle): IciciResolvedCodes {
  return { makeCode: v.makeCode, modelCode: v.modelCode, rtoCode: v.rtoCode, previousInsurerCode: "ICICI LOMBARD" };
}

function label(c: Case): string {
  const biz = c.breakin ? "breakin" : c.business;
  return `${c.vehicle.tag} ${c.vehicle.makeName} ${c.vehicle.modelName} [${c.vehicle.regNo}] — ${biz}/${c.plan}`;
}

function runMatrix(name: string, cases: Case[]) {
  describe(name, () => {
    for (const c of cases) {
      if (c.expect === "REJECT") {
        it(`${label(c)} → NOT a valid ICICI product (rejected)`, () => {
          expect(() => buildSaveQuotePayload(reqFor(c), resolvedFor(c.vehicle), "req")).toThrow(
            ProviderCapabilityError,
          );
        });
      } else {
        it(`${label(c)} → ProductCode ${c.expect}`, () => {
          const { payload } = buildSaveQuotePayload(reqFor(c), resolvedFor(c.vehicle), "req");
          expect(payload.ProductCode).toBe(c.expect);
          expect(payload.MakeCode).toBe(c.vehicle.makeCode);
          expect(payload.ModelCode).toBe(c.vehicle.modelCode);
          expect(payload.RTOCode).toBe(c.vehicle.rtoCode);
          expect(payload.RegistrationNo).toBe(c.vehicle.regNo);
        });
      }
    }
  });
}

runMatrix("ICICI 4W — 12-condition real-vehicle coverage", FW_CASES);
runMatrix("ICICI 2W — 12-condition real-vehicle coverage", TW_CASES);

// ─── Break-in flow: inspection gate (payment must not bind until approved) ──────
function fakeTransport(overrides: Partial<Record<string, unknown>> = {}) {
  const sent: Parameters<IciciTransport["request"]>[0][] = [];
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

describe("ICICI break-in inspection gate (per wheel)", () => {
  for (const v of [V3, W3]) {
    it(`${v.tag} ${v.makeName} ${v.modelName} [${v.regNo}] — inspection-required quote forces proposal-only`, async () => {
      const full: MotorFullQuoteRequest = {
        ...reqFor({ vehicle: v, business: "rollover", breakin: true, plan: "comprehensive", expect: 0 }),
        quoteId: "epn_txn",
        isProposalOnly: false,
        isVehicleUnderLoan: false,
        amountCollected: 11863,
        paymentTransactionId: "pay-1",
        proposer: { firstName: "Ravi", lastName: "Kumar", email: "r@e.com", mobile: "9876543210", dob: "1990-05-15" },
        address: { addressLine1: "MG Road", pincode: "421004", city: "Kalyan", state: "MH" },
        vehicle: { engineNumber: "ENG1", chassisNumber: "CHS1", financeType: "none" },
      };
      const { transport, sent } = fakeTransport({
        quote: { ...quoteFixture, IsInspectionRequire: true },
        policyStatus: { ...policyStatusFixture, Status: "INSPECTION_PENDING" },
      });
      const provider = new IciciProvider({ config, transport, codeResolver: passthroughCodeResolver, tokenProvider: async () => "t" });
      await provider.getFullQuote(full, { requestId: "r" });
      const proposal = sent.find((s) => s.url.includes("/proposal"));
      expect(proposal?.jsonBody).toMatchObject({ isProposalOnly: true, AmountCollected: 0 });
    });
  }
});

// ─── Add-ons coverage ───────────────────────────────────────────────────────────
describe("ICICI add-on coverage", () => {
  it("4W — all supported add-ons + PA + voluntary deductible + bi-fuel + discounts map to vendor codes", () => {
    const req = {
      ...reqFor({ vehicle: V1, business: "rollover", plan: "comprehensive", expect: 21 }),
      zeroDep: true,
      rsa: true,
      engineProtect: true,
      keyProtect: true,
      garageCash: true,
      lossOfBelongings: true,
      consumables: true,
      tyreProtect: true,
      voluntaryDeductible: 2500,
      unnamedPaSumInsured: 100000,
      namedPaSumInsured: 50000,
      bifuelKitType: "CNG" as const,
      bifuelKitSI: 30000,
      hasAntiTheftDevice: true,
      hasPayU: true,
      payURange: 5000,
    } satisfies MotorQuoteRequest;
    const { payload } = buildSaveQuotePayload(req, resolvedFor(V1), "req-addon-4w");
    expect(payload.AddOns).toEqual(
      expect.arrayContaining(["ZD", "RSA", "EP", "KP", "GC", "LOPB", "CS", "TP", "VD-2500"]),
    );
    expect(payload.UnNamedPaCover).toBe(100000);
    expect(payload.NamedPaCover).toBe(50000);
    expect(payload.GasKitType).toBe(1);
    expect(payload.GasKitSI).toBe(30000);
    expect(payload.HasAntiTheftDevice).toBe(true);
    expect(payload.HasPayU).toBe(true);
    expect(payload.PayURange).toBe(5000);
  });

  it("2W — all supported add-ons (incl. RTI, battery, driving accessories) map to vendor codes", () => {
    const req = {
      ...reqFor({ vehicle: W1, business: "rollover", plan: "comprehensive", expect: 13 }),
      zeroDep: true,
      rsa: true,
      rti: true,
      engineProtect: true,
      batteryProtect: true,
      keyProtect: true,
      tyreProtect: true,
      drivingAccessories: true,
      consumables: true,
      drivingAccessoriesSI: 2000,
      keyProtectSI: 1500,
    } satisfies MotorQuoteRequest;
    const { payload } = buildSaveQuotePayload(req, resolvedFor(W1), "req-addon-2w");
    expect(payload.AddOns).toEqual(
      expect.arrayContaining(["ZD", "RSA", "RTI", "EP", "LDBP", "KP", "TP", "DA", "CS"]),
    );
    expect(payload.DrivingAccessoriesSI).toBe(2000);
    expect(payload.KeyProtectSI).toBe(1500);
  });
});

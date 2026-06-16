import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "@/app.ts";
import {
  registerProvider,
  clearRegistry,
  getAllProviders,
} from "@/providers/provider-registry.ts";
import { MockProvider } from "@/providers/mock/mock.provider.ts";
import { compareQuotes } from "@/services/compare.service.ts";
import { MotorQuoteRequestSchema } from "@/contracts/quote-request.ts";
import { ADDON_METADATA } from "@/contracts/enums.ts";
import { ICICI_MOTOR_CAPABILITIES } from "@/providers/icici/config.ts";
import type { InsuranceProvider, ProviderContext } from "@/providers/insurance-provider.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type {
  VehicleCategory,
  ProviderOperation,
  MotorCapabilities,
} from "@/contracts/enums.ts";

const req: MotorQuoteRequest = MotorQuoteRequestSchema.parse({
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  makeId: "MARUTI",
  makeName: "Maruti Suzuki",
  modelId: "SWIFT",
  modelName: "Swift",
  fuelType: "petrol",
  rtoCode: "DL01",
  registrationDate: "2021-06-01",
  idvValue: 500000,
  ncbPercent: 20,
});

/** Minimal stub provider for eligibility/error-isolation tests. */
class StubProvider implements InsuranceProvider {
  constructor(
    readonly slug: string,
    readonly displayName: string,
    readonly capabilities: ReadonlySet<VehicleCategory>,
    readonly operations: ReadonlySet<ProviderOperation>,
    readonly motorCapabilities: MotorCapabilities,
    private readonly behaviour: "ok" | "throw" = "ok",
  ) {}

  async getQuote(r: MotorQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult> {
    if (this.behaviour === "throw") throw new Error("upstream exploded");
    return {
      quoteNo: `${this.slug}-1`,
      requestId: ctx.requestId,
      providerSlug: this.slug,
      policyType: r.selectedPolicy,
      vehicleCategory: r.vehicleType,
      idvValue: r.idvValue ?? 0,
      basicOdPremium: 1000,
      thirdPartyPremium: 500,
      addonPremiums: {},
      discounts: {},
      totalAddonPremium: 0,
      totalDiscount: 0,
      netPremium: 1500,
      serviceTaxPercent: 18,
      serviceTaxAmount: 270,
      grossPremium: 1770,
    };
  }

  async getFullQuote(): Promise<CanonicalQuoteResult> {
    throw new Error("not implemented");
  }
}

describe("capability matrix", () => {
  it("mock advertises all plan types and add-ons for every category", () => {
    const cap = new MockProvider().motorCapabilities.fourWheeler;
    expect(cap?.policyTypes).toEqual(
      expect.arrayContaining(["comprehensive", "thirdParty", "standAloneOD"]),
    );
    expect(cap?.addons).toEqual(ADDON_METADATA.map((a) => a.key));
  });

  it("ICICI matrix is derived from its product + addon code maps", () => {
    const fw = ICICI_MOTOR_CAPABILITIES.fourWheeler;
    const tw = ICICI_MOTOR_CAPABILITIES.twoWheeler;
    expect(fw?.policyTypes).toEqual(
      expect.arrayContaining(["comprehensive", "thirdParty", "standAloneOD"]),
    );
    expect(fw?.addons).toEqual(
      expect.arrayContaining(["zeroDep", "engineProtect", "rsa", "tyreProtect", "consumables"]),
    );
    // 2W exposes RTI; 4W does not.
    expect(tw?.addons).toContain("rti");
    expect(fw?.addons).not.toContain("rti");
    // Only actionable AddonKeys leak through (no keyProtect/garageCash yet).
    expect(fw?.addons).not.toContain("keyProtect");
  });
});

describe("compareQuotes service", () => {
  beforeEach(() => {
    clearRegistry();
    registerProvider(new MockProvider());
  });

  it("returns a success result for an eligible provider", async () => {
    const results = await compareQuotes(req);
    expect(results).toHaveLength(1);
    expect(results[0]!.providerSlug).toBe("mock");
    expect(results[0]!.status).toBe("success");
    expect(results[0]!.quote?.grossPremium).toBeGreaterThan(0);
  });

  it("excludes providers whose matrix lacks the requested plan type", async () => {
    registerProvider(
      new StubProvider(
        "tponly",
        "TP Only",
        new Set(["fourWheeler"]),
        new Set(["quote"]),
        { fourWheeler: { policyTypes: ["thirdParty"], addons: [] } },
      ),
    );
    // comprehensive → tponly filtered out, only mock remains
    const comp = await compareQuotes(req);
    expect(comp.map((r) => r.providerSlug)).toEqual(["mock"]);

    // thirdParty → both eligible
    const tp = await compareQuotes({ ...req, selectedPolicy: "thirdParty" });
    expect(tp.map((r) => r.providerSlug).sort()).toEqual(["mock", "tponly"]);
  });

  it("honours the providers allow-list", async () => {
    const results = await compareQuotes(req, ["does-not-exist"]);
    expect(results).toHaveLength(0);
  });

  it("isolates a failing provider as status=error without breaking the rest", async () => {
    registerProvider(
      new StubProvider(
        "boom",
        "Boom Insurer",
        new Set(["fourWheeler"]),
        new Set(["quote"]),
        { fourWheeler: { policyTypes: ["comprehensive"], addons: [] } },
        "throw",
      ),
    );
    const results = await compareQuotes(req);
    const bySlug = Object.fromEntries(results.map((r) => [r.providerSlug, r]));
    expect(bySlug.mock!.status).toBe("success");
    expect(bySlug.boom!.status).toBe("error");
    expect(bySlug.boom!.error?.message).toContain("upstream exploded");
  });

  it("getAllProviders reflects the registry", () => {
    expect(getAllProviders().map((p) => p.slug)).toContain("mock");
  });
});

describe("compare + providers endpoints", () => {
  const app = createApp();

  beforeEach(() => {
    clearRegistry();
    registerProvider(new MockProvider());
  });

  it("GET /providers exposes the motor capability matrix", async () => {
    const res = await request(app).get("/api/v1/providers");
    expect(res.status).toBe(200);
    const mock = res.body.providers.find((p: { slug: string }) => p.slug === "mock");
    expect(mock.motorCapabilities.fourWheeler.policyTypes).toContain("comprehensive");
  });

  it("POST /motor/quotes/compare returns per-provider results", async () => {
    const res = await request(app).post("/api/v1/motor/quotes/compare").send(req);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    const results = res.body.response.results as Array<{ providerSlug: string; status: string }>;
    expect(results.some((r) => r.providerSlug === "mock" && r.status === "success")).toBe(true);
  });

  it("422s a malformed compare request", async () => {
    const res = await request(app)
      .post("/api/v1/motor/quotes/compare")
      .send({ ...req, vehicleType: "spaceship" });
    expect(res.status).toBe(422);
  });
});

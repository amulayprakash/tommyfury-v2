import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "@/app.ts";
import { registerProvider, clearRegistry } from "@/providers/provider-registry.ts";
import { FgProvider } from "@/providers/fg/fg.provider.ts";
import type { FgTransport } from "@/providers/fg/http.ts";
import type { FgConfig } from "@/providers/fg/config.ts";

import quoteFixture from "@/providers/fg/fixtures/quote.response.json";
import proposalFixture from "@/providers/fg/fixtures/proposal.response.json";
import issuanceFixture from "@/providers/fg/fixtures/issuance.response.json";

const config: FgConfig = {
  baseUrl: "https://uat.example.com:8243",
  tokenUrl: "https://uat.example.com:9443/oauth2/token",
  clientBasic: "Zm9vOmJhcg==",
  username: "Webagg-Partners",
  password: "secret",
  vendorCode: "Webagg",
  agentCode: "60001464",
  branchCode: "10",
  credentialSetId: "default",
  ckyc: {
    baseUrl: "https://uat.example.com:8243/GCKYC/3.0.0",
    tokenUrl: "https://uat.example.com:9443/oauth2/token",
    clientBasic: "Y2t5YzpiYXNpYw==",
    subscriptionToken: "test-ckyc-token",
  },
  renewal: {
    baseUrl: "https://uat.example.com:8243/motorRenewal/1.0.0/TCS-Renewal/API/MotorRenewal",
    tokenUrl: "https://uat.example.com:9443/oauth2/token",
    clientBasic: "cmVuZXdhbDpiYXNpYw==",
  },
  health: {
    baseUrl: "https://uat.example.com:8243/Health/1.0.0/BO/Service.svc",
    tokenUrl: "https://uat.example.com:9443/oauth2/token",
    clientBasic: "aGVhbHRoOmJhc2lj",
    agentCode: "60000272",
    branchCode: "10",
  },
  payment: {
    url: "https://pay.example.com/WebAggPayNew.aspx",
    paymentOption: "3",
    responseUrl: "https://app.example.com/api/v1/fg/payment/callback",
    checksumSecret: "test-secret",
  },
  inspection: {
    baseUrl: "https://livechek.example.com/api",
    appKey: "test-app-key",
    companyId: "test-company",
    appId: "test-app",
  },
};

/** Routes FG calls to the recorded fixtures by URL. */
class FixtureTransport implements FgTransport {
  constructor(private readonly failBody?: unknown) {}
  async request(args: { method: string; url: string }): Promise<unknown> {
    const { url } = args;
    if (url.includes("/CreateProposal")) return proposalFixture;
    if (url.includes("/PolicyIssuance")) return issuanceFixture;
    if (url.includes("/GetQuote")) return this.failBody ?? quoteFixture;
    throw new Error(`unmapped url: ${url}`);
  }
}

function registerFg(transport: FgTransport) {
  registerProvider(new FgProvider({ config, transport, tokenProvider: async () => "test-token" }));
}

const app = createApp();

const quoteBody = {
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
  zeroDep: true,
};

beforeEach(() => {
  clearRegistry();
  registerFg(new FixtureTransport());
});

describe("FG integration (fixtures)", () => {
  it("returns a canonical envelope for a 4W GetQuote", async () => {
    const res = await request(app).post("/api/v1/fg/motor/quote").send(quoteBody);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.response.providerSlug).toBe("fg");
    expect(res.body.response.transactionId).toBe("0000621254");
    expect(res.body.response.basicOdPremium).toBe(7390.93);
    expect(res.body.response.grossPremium).toBeCloseTo(35385.899, 1);
  });

  it("binds a proposal (CreateProposal) returning the ClientId", async () => {
    const res = await request(app)
      .post("/api/v1/fg/motor/full-quote")
      .send({
        ...quoteBody,
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
          addressLine1: "Safalya Building",
          pincode: "400013",
          city: "Mumbai",
          state: "MAHARASHTRA",
        },
        vehicle: { engineNumber: "ENG1", chassisNumber: "CHS1" },
      });
    expect(res.status).toBe(200);
    expect(res.body.response.contractDetails.clientId).toBe("72590187");
  });

  it("issues a policy returning the real PolicyNo", async () => {
    const res = await request(app)
      .post("/api/v1/fg/policy/issue")
      .send({
        quoteNo: "0001260064",
        clientId: "72600518",
        vehicleCategory: "fourWheeler",
        policyType: "comprehensive",
        receipt: {
          uniqueTranKey: "TP816781",
          transactionDate: "27/05/2025 16:26:00",
          receiptType: "IVR",
          amount: 8688,
          tranRefNo: "174719032601",
          tranRefNoDate: "27/05/2025 16:26:00",
          pgType: "PAYU",
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.response.status).toBe("ISSUED");
    expect(res.body.response.policyNumber).toBe("132/02/22/0526/MTP/2410006867");
    expect(res.body.response.applicationNo).toBe("Z2243303");
    expect(res.body.response.receiptNo).toBe("Z2243303");
  });

  it("quotes a commercial (GCV) vehicle", async () => {
    const res = await request(app)
      .post("/api/v1/fg/motor/commercial/quote")
      .send({
        ...quoteBody,
        vehicleType: "commercial",
        commercialSubType: "goods",
        grossVehicleWeight: 7500,
      });
    expect(res.status).toBe(200);
    expect(res.body.response.providerSlug).toBe("fg");
  });

  it("lists FG with commercial capability via /providers", async () => {
    const res = await request(app).get("/api/v1/providers");
    expect(res.status).toBe(200);
    const fg = (res.body.providers as Array<{ slug: string; capabilities: string[] }>).find(
      (p) => p.slug === "fg",
    );
    expect(fg).toBeDefined();
    expect(fg!.capabilities).toContain("commercial");
    expect(fg!.capabilities).toContain("fourWheeler");
  });

  it("includes FG in a compare run", async () => {
    const res = await request(app).post("/api/v1/motor/quotes/compare").send(quoteBody);
    expect(res.status).toBe(200);
    const slugs = (res.body.response.results as Array<{ providerSlug: string }>).map(
      (r) => r.providerSlug,
    );
    expect(slugs).toContain("fg");
  });

  it("422s an unsupported vehicle category (twoWheeler)", async () => {
    const res = await request(app)
      .post("/api/v1/fg/motor/quote")
      .send({ ...quoteBody, vehicleType: "twoWheeler" });
    expect(res.status).toBe(422);
  });

  it("surfaces an FG business failure as a 502 provider error", async () => {
    clearRegistry();
    registerFg(new FixtureTransport({ Client: { Status: "Failed", ErrorMessage: "no quote" } }));
    const res = await request(app).post("/api/v1/fg/motor/quote").send(quoteBody);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PROVIDER_ERROR");
  });
});

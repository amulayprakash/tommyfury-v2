import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "@/app.ts";
import { registerProvider, clearRegistry } from "@/providers/provider-registry.ts";
import { MockProvider } from "@/providers/mock/mock.provider.ts";
import { IciciProvider } from "@/providers/icici/icici.provider.ts";
import type { IciciTransport } from "@/providers/icici/http.ts";
import type { IciciConfig } from "@/providers/icici/config.ts";

import quoteFixture from "@/providers/icici/fixtures/quote.response.json";
import proposalFixture from "@/providers/icici/fixtures/proposal.response.json";
import ckycFixture from "@/providers/icici/fixtures/ckyc.response.json";
import ovdFixture from "@/providers/icici/fixtures/ovd.response.json";
import policyStatusFixture from "@/providers/icici/fixtures/policy-status.response.json";
import coiFixture from "@/providers/icici/fixtures/coi.response.json";

const config: IciciConfig = {
  baseUrl: "https://uat.example.com",
  login: "u",
  password: "p",
  aesKey: Buffer.alloc(32, 1).toString("base64"),
  aesMode: "aes-256-ecb",
  credentialSetId: "default",
};

/** Routes ICICI calls to the recorded PDF fixtures by URL. */
class FixtureTransport implements IciciTransport {
  constructor(private readonly failBody?: unknown) {}
  async request(args: { method: string; url: string }): Promise<unknown> {
    const { url } = args;
    if (this.failBody && url.endsWith("/premium")) return this.failBody;
    if (url.includes("/proposal")) return proposalFixture;
    if (url.includes("/certificate")) return coiFixture;
    if (url.includes("/ovdinitiate")) return ovdFixture; // contains "/ckyc/" — match first
    if (url.includes("/ckyc")) return ckycFixture;
    if (url.includes("/premium")) return quoteFixture; // POST save + GET retrieve
    if (url.includes("/policy")) return policyStatusFixture;
    throw new Error(`unmapped url: ${url}`);
  }
}

function registerIcici(transport: IciciTransport) {
  registerProvider(
    new IciciProvider({ config, transport, tokenProvider: async () => "test-token" }),
  );
}

const app = createApp();

const quoteBody = {
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
  idvValue: 510498,
  ncbPercent: 20,
  zeroDep: true,
  rsa: true,
};

beforeEach(() => {
  clearRegistry();
  registerProvider(new MockProvider());
  registerIcici(new FixtureTransport());
});

describe("ICICI integration (fixtures)", () => {
  it("returns a Zuno-shaped envelope for a 4W save quote", async () => {
    const res = await request(app).post("/api/v1/icici/motor/quote").send(quoteBody);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.response.providerSlug).toBe("icici");
    expect(res.body.response.grossPremium).toBe(11863);
    expect(res.body.response.transactionId).toBe("epn_4kmbJzdvQtrANuxnme");
  });

  it("retrieves a quote by transaction id", async () => {
    const res = await request(app)
      .get("/api/v1/icici/motor/quote/epn_4kmbJzdvQtrANuxnme")
      .query({ category: "fourWheeler" });
    expect(res.status).toBe(200);
    expect(res.body.response.netPremium).toBe(10053);
  });

  it("rejects retrieve without a valid category", async () => {
    const res = await request(app).get("/api/v1/icici/motor/quote/epn_x");
    expect(res.status).toBe(422);
  });

  it("binds a proposal returning policy number + payment link", async () => {
    const res = await request(app)
      .post("/api/v1/icici/motor/full-quote")
      .send({
        ...quoteBody,
        quoteId: "epn_4kmbJzdvQtrANuxnme",
        proposer: {
          firstName: "Ravi",
          lastName: "Kumar",
          email: "ravi@example.com",
          mobile: "9876543210",
          dob: "1990-05-15",
        },
        address: { addressLine1: "MG Road", pincode: "421004", city: "Kalyan", state: "MH" },
        vehicle: { engineNumber: "ENG1", chassisNumber: "CHS1" },
      });
    expect(res.status).toBe(200);
    expect(res.body.response.policyNumber).toBe("3005/52846255/00/B00");
    expect(res.body.response.paymentUrl).toContain("janus.icicilombard.com");
  });

  it("completes CKYC", async () => {
    const res = await request(app)
      .post("/api/v1/icici/kyc/ckyc")
      .send({ transactionId: "epn_x", dob: "1992-11-08", panNumber: "ABCDE1234F" });
    expect(res.status).toBe(200);
    expect(res.body.response.kycId).toBe("kyc_5ferAmAMVXClJFKnXnWPa");
    expect(res.body.response.isKycSuccess).toBe(true);
  });

  it("completes OVD via multipart upload", async () => {
    const res = await request(app)
      .post("/api/v1/icici/kyc/ovd")
      .field("transactionId", "epn_x")
      .field("proofOfIdentityType", "AADHAAR")
      .field("proofOfAddressType", "AADHAAR")
      .field("policyType", "motor")
      .attach("proofOfIdentity", Buffer.from("id-bytes"), "id.jpg")
      .attach("proofOfAddress", Buffer.from("addr-bytes"), "addr.jpg");
    expect(res.status).toBe(200);
    expect(res.body.response.kycId).toBe("kyc_5k4grUGluqgq7VB29pLCh");
  });

  it("returns policy status", async () => {
    const res = await request(app)
      .post("/api/v1/icici/policy/status")
      .send({ transactionId: "epn_x" });
    expect(res.status).toBe(200);
    expect(res.body.response.status).toBe("ISSUED");
  });

  it("returns the COI", async () => {
    const res = await request(app).get("/api/v1/icici/policy/epn_x/certificate");
    expect(res.status).toBe(200);
    expect(res.body.response.coiBase64).toBe("JVBERi0xLjMKJeLjz9MKMTAgMCBvYmo8PC9QIDEx");
  });

  it("422s an unsupported vehicle category (commercial)", async () => {
    const res = await request(app)
      .post("/api/v1/icici/motor/quote")
      .send({ ...quoteBody, vehicleType: "commercial" });
    expect(res.status).toBe(422);
  });

  it("422s an unsupported operation on a provider (mock has no CKYC)", async () => {
    const res = await request(app)
      .post("/api/v1/mock/kyc/ckyc")
      .send({ transactionId: "x", dob: "1990-01-01", panNumber: "ABCDE1234F" });
    expect(res.status).toBe(422);
  });

  it("404s an unknown provider", async () => {
    const res = await request(app).post("/api/v1/nope/motor/quote").send(quoteBody);
    expect(res.status).toBe(404);
  });

  it("surfaces an ICICI business failure (Success:false) as a 502 provider error", async () => {
    clearRegistry();
    registerIcici(new FixtureTransport({ Success: false, ErrorMessage: "no quote available" }));
    const res = await request(app).post("/api/v1/icici/motor/quote").send(quoteBody);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PROVIDER_ERROR");
  });
});

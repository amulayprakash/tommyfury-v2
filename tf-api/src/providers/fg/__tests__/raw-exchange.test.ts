import { describe, it, expect } from "vitest";
import { MotorQuoteRequestSchema } from "@/contracts/quote-request.ts";
import { FgProvider, passthroughCodeResolver } from "../fg.provider.ts";
import type { FgConfig } from "../config.ts";
import type { FgTransport } from "../http.ts";
import quoteFixture from "../fixtures/quote.response.json";

const config = {
  baseUrl: "https://uat-internal-apigw.generalicentralinsurance.com:8243",
  vendorCode: "Webagg",
  agentCode: "60001464",
  branchCode: "10",
} as unknown as FgConfig;

/** Fake FG backend: always replays the recorded quote response. */
const transport: FgTransport = { request: async () => quoteFixture };

const provider = new FgProvider({
  config,
  transport,
  codeResolver: passthroughCodeResolver,
  tokenProvider: async () => "test-token",
});

const quoteRequest = (over: Record<string, unknown> = {}) =>
  MotorQuoteRequestSchema.parse({
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
    registrationNumber: "MH01AB1234",
    engineCC: 1198,
    seatingCapacity: 5,
    ...over,
  });

describe("FgProvider raw exchange (certification harness)", () => {
  it("omits the request half of the exchange by default", async () => {
    // The normalizer has always carried the vendor RESPONSE on _rawResponse (it
    // backs the debug envelope and the persisted rawFullQuote), so the default
    // must stay exactly that — what the harness adds is the REQUEST half, which
    // carries the agent/branch codes.
    const result = await provider.getQuote(quoteRequest(), { requestId: "req-1" });
    expect(result.quoteNo).toBe("0000925782");
    expect(result._rawResponse).toEqual(quoteFixture);
    expect(result._rawResponse).not.toHaveProperty("request");
  });

  it("returns the request and response when includeRawExchange is set", async () => {
    const result = await provider.getQuote(quoteRequest({ includeRawExchange: true }), {
      requestId: "req-2",
    });
    const raw = result._rawResponse as { request: Record<string, unknown>; response: unknown };
    expect(raw.response).toEqual(quoteFixture);
    expect(raw.request).toMatchObject({ PolicyHeader: { METHOD: "ENQ" } });
  });
});

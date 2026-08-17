import { describe, it, expect } from "vitest";
import { MotorQuoteRequestSchema } from "@/contracts/quote-request.ts";
import { FgProvider, passthroughCodeResolver } from "../fg.provider.ts";
import type { FgConfig } from "../config.ts";
import type { FgTransport } from "../http.ts";
import quoteFixture from "../fixtures/quote.response.json";

/**
 * GCI confirmed the motor endpoints require no bearer ("Token not required for get
 * quote and create proposal API"), and it is verified live on UAT — GetQuote returns
 * 200 with no Authorization header, with a foreign bearer, and even with a fabricated
 * one. The gateway does not validate the token on these paths.
 *
 * So a token failure must not take the integration down. We still ask for a token —
 * calls go back to being authenticated the moment the credential is restored, with no
 * code change — but when the vendor refuses to issue one we proceed without it rather
 * than throwing an opaque 500.
 */

const config = {
  baseUrl: "https://uat-internal-apigw.generalicentralinsurance.com:8243",
  vendorCode: "Webagg",
  agentCode: "60001464",
  branchCode: "10",
} as unknown as FgConfig;

/** Records the token each call was made with, and replays a recorded quote. */
function recordingTransport() {
  const tokens: string[] = [];
  const transport: FgTransport = {
    async request(args) {
      tokens.push(args.token);
      return quoteFixture;
    },
  };
  return { transport, tokens };
}

const quoteRequest = () =>
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
  });

describe("motor calls when no token can be obtained", () => {
  it("still returns a quote, sending an empty token", async () => {
    const { transport, tokens } = recordingTransport();
    const provider = new FgProvider({
      config,
      transport,
      codeResolver: passthroughCodeResolver,
      tokenProvider: async () => {
        throw new Error("Token fetch failed [400]: invalid_grant");
      },
    });

    const quote = await provider.getQuote(quoteRequest(), { requestId: "no-token" });

    expect(quote.quoteNo).toBeTruthy();
    expect(tokens).toEqual([""]);
  });

  it("uses the bearer normally when the credential works", async () => {
    const { transport, tokens } = recordingTransport();
    const provider = new FgProvider({
      config,
      transport,
      codeResolver: passthroughCodeResolver,
      tokenProvider: async () => "tok-live",
    });

    await provider.getQuote(quoteRequest(), { requestId: "with-token" });

    expect(tokens).toEqual(["tok-live"]);
  });
});

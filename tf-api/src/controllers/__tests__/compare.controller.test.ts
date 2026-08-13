import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { env } from "@/config/env.ts";
import type { CompareResultItem } from "@/services/compare.service.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";

const compareQuotes = vi.fn();
vi.mock("@/services/compare.service.ts", () => ({
  compareQuotes: (...a: unknown[]) => compareQuotes(...a),
}));

const { handleCompareQuotes } = await import("../compare.controller.ts");

/** Recognisable stand-in for the vendor exchange the FG harness asks for. */
const RAW_EXCHANGE = { request: { PolicyHeader: { METHOD: "ENQ" } }, response: { Quote: "0001" } };

function stubResult(): CompareResultItem {
  return {
    providerSlug: "fg",
    displayName: "Future Generali",
    status: "success",
    quote: {
      quoteNo: "0000925782",
      requestId: "req-1",
      providerSlug: "fg",
      policyType: "comprehensive",
      vehicleCategory: "fourWheeler",
      idvValue: 500000,
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
      _rawResponse: RAW_EXCHANGE,
    } as CanonicalQuoteResult,
  };
}

/** Minimal express doubles: capture the body handed to res.json. */
function fakeRes(): { res: Response; body: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  const res = {
    status: () => res,
    json: (b: Record<string, unknown>) => {
      captured = b;
      return res;
    },
  } as unknown as Response;
  return { res, body: () => captured };
}

function fakeReq(body: Record<string, unknown>): Request {
  return { body, requestId: "req-1" } as unknown as Request;
}

/** The quote as it reached the client, or undefined when no result came back. */
function sentQuote(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const { results } = body.response as { results: Array<{ quote?: Record<string, unknown> }> };
  return results[0]?.quote;
}

const next: NextFunction = () => undefined;

describe("handleCompareQuotes raw exchange gating", () => {
  const debugDefault = env.ENABLE_DEBUG_PAYLOAD;

  beforeEach(() => {
    compareQuotes.mockReset();
    compareQuotes.mockResolvedValue([stubResult()]);
  });

  afterEach(() => {
    env.ENABLE_DEBUG_PAYLOAD = debugDefault;
  });

  it("strips the raw exchange when the caller did not ask for it", async () => {
    env.ENABLE_DEBUG_PAYLOAD = true;
    const { res, body } = fakeRes();
    await handleCompareQuotes(fakeReq({ vehicleType: "fourWheeler" }), res, next);
    expect(sentQuote(body())).not.toHaveProperty("_rawResponse");
  });

  it("keeps the raw exchange when the caller opted in and the deployment allows it", async () => {
    env.ENABLE_DEBUG_PAYLOAD = true;
    const { res, body } = fakeRes();
    await handleCompareQuotes(
      fakeReq({ vehicleType: "fourWheeler", includeRawExchange: true }),
      res,
      next,
    );
    expect(sentQuote(body())?._rawResponse).toEqual(RAW_EXCHANGE);
  });

  it("still strips the raw exchange when the deployment forbids debug payloads", async () => {
    env.ENABLE_DEBUG_PAYLOAD = false;
    const { res, body } = fakeRes();
    await handleCompareQuotes(
      fakeReq({ vehicleType: "fourWheeler", includeRawExchange: true }),
      res,
      next,
    );
    expect(sentQuote(body())).not.toHaveProperty("_rawResponse");
  });
});

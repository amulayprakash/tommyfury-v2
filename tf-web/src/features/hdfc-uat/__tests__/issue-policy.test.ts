import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { issuePolicy } from "../../vehicle/api/vehicle-api";
import type { PolicyIssuanceRequest } from "../../vehicle/api/types";

/**
 * The last call of the HDFC journey. HDFC has no payment gateway: issuance
 * RECORDS a payment already collected (submitpaymentdetails → getpolicydocument)
 * and hands back the bound policy number, so this one POST is what turns a
 * proposal into a policy.
 *
 * The request body is asserted field by field because every one of them was
 * learned from a live rejection: `quoteNo` carries HDFC's Proposal_Number (not a
 * quote id), `transactionId` is the cross-step correlation id HDFC threads
 * through all seven HEI calls, and `receipt.amount` must equal the proposal's
 * premium — HDFC re-rates at issuance and refuses a mismatch.
 */

const ISSUE_URL = "http://localhost:4000/api/v1/hdfc/policy/issue";

let captured: unknown = null;

const server = setupServer(
  http.post(ISSUE_URL, async ({ request }) => {
    captured = await request.json();
    return HttpResponse.json({
      status: "success",
      message: "ok",
      requestId: "req_test",
      response: {
        providerSlug: "hdfc",
        insurerName: "HDFC ERGO",
        status: "ISSUED",
        policyNumber: "2311204154453200000",
        applicationNo: "PROP123",
        receiptNo: "UAT1234",
        quoteNo: "PROP123",
      },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  captured = null;
});
afterAll(() => server.close());

const req: PolicyIssuanceRequest = {
  quoteNo: "PROP123",
  clientId: "CLIENT456",
  transactionId: "TXN789",
  vehicleCategory: "fourWheeler",
  receipt: {
    uniqueTranKey: "UAT1234",
    transactionDate: "17/08/2026 12:00:00",
    receiptType: "IVR",
    amount: 24680,
    tranRefNo: "UAT1234",
    tranRefNoDate: "2026-08-17",
    pgType: "BIZDIRECT",
  },
};

describe("issuePolicy", () => {
  it("POSTs the receipt to /{provider}/policy/issue and returns the bound policy", async () => {
    const result = await issuePolicy("hdfc", req);

    expect(captured).toEqual(req);
    expect(result.status).toBe("ISSUED");
    expect(result.policyNumber).toBe("2311204154453200000");
  });

  it("sends the proposal number, client id, transaction id and category HDFC keys on", async () => {
    await issuePolicy("hdfc", req);

    const body = captured as PolicyIssuanceRequest;
    expect(body.quoteNo).toBe("PROP123");
    expect(body.clientId).toBe("CLIENT456");
    expect(body.transactionId).toBe("TXN789");
    expect(body.vehicleCategory).toBe("fourWheeler");
  });

  it("carries the receipt through untouched, amount included", async () => {
    await issuePolicy("hdfc", req);

    const body = captured as PolicyIssuanceRequest;
    // HDFC re-rates at issuance: an amount that is not the proposal's premium is
    // rejected, so nothing in this layer may round, scale or default it.
    expect(body.receipt.amount).toBe(24680);
    expect(body.receipt.tranRefNo).toBe("UAT1234");
    expect(body.receipt.tranRefNoDate).toBe("2026-08-17");
    expect(body.receipt.pgType).toBe("BIZDIRECT");
    expect(body.receipt.receiptType).toBe("IVR");
  });
});

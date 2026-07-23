import { describe, it, expect, vi } from "vitest";
import { handlePaymentCallback, type PaymentCallbackDeps } from "@/services/payment.service.ts";
import type { FgConfig } from "@/providers/fg/config.ts";

const config = {
  payment: {
    successUrl: "https://web.example.com/insurance_ps",
    failureUrl: "https://web.example.com/failure",
    reconUrl: "https://pg.example.com/comservice.asmx/FetchTRNDetails",
    reconSource: "webaggregator",
    reconKey: "tid", // send pg.tid as the FetchTRNDetails transactionId
    reconEnforce: true, // hard-block on a recon miss (see the enforcement-off case below)
  },
} as unknown as FgConfig;

const quoteRow = {
  clientId: "CL1",
  grossPremium: 2530,
  vehicleCategory: "fourWheeler",
  policyType: "comprehensive",
};

function makeDeps(overrides: Partial<PaymentCallbackDeps>): PaymentCallbackDeps {
  return {
    loadConfig: () => config,
    findQuote: vi.fn(async () => quoteRow as never),
    reconcile: vi.fn(async () => ({ ok: true, paymentAmount: 2530, transactionId: "Q1" })),
    issue: vi.fn(async () => ({ providerSlug: "fg", status: "issued", policyNumber: "POL-1" }) as never),
    ...overrides,
  };
}

const okPg = { WS_P_ID: "WS1", TID: "Q1", PGID: "PG1", Premium: "2530", Response: "Success" };

describe("handlePaymentCallback recon gate", () => {
  it("issues the policy when recon matches", async () => {
    const issue = vi.fn(async () => ({ providerSlug: "fg", status: "issued", policyNumber: "POL-1" }) as never);
    const deps = makeDeps({ issue });
    const out = await handlePaymentCallback("fg", okPg, deps);
    expect(out.ok).toBe(true);
    expect(out.policyNumber).toBe("POL-1");
    expect(issue).toHaveBeenCalledOnce();
    expect(out.redirectUrl).toContain("insurance_ps");
  });

  it("does NOT issue when recon mismatches; redirects to failure", async () => {
    const issue = vi.fn(async () => ({ providerSlug: "fg", status: "issued" }) as never);
    const reconcile = vi.fn(async () => ({ ok: false, reason: "amount mismatch (expected 2530, got 5)" }));
    const deps = makeDeps({ issue, reconcile });
    const out = await handlePaymentCallback("fg", okPg, deps);
    expect(out.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
    expect(out.redirectUrl).toContain("failure");
  });

  it("reconciles the server-known premium, not the browser-reported amount", async () => {
    const reconcile = vi.fn(async () => ({ ok: true, paymentAmount: 2530, transactionId: "Q1" }));
    const deps = makeDeps({ reconcile });
    // Browser posts a tampered Premium=5; recon must be asked for the real 2530.
    await handlePaymentCallback("fg", { ...okPg, Premium: "5" }, deps);
    expect(reconcile).toHaveBeenCalledWith(
      config,
      expect.objectContaining({ transactionId: "Q1", expectedAmount: 2530, source: "webaggregator" }),
    );
  });

  it("redirects to failure when PG reports a non-success response", async () => {
    const issue = vi.fn();
    const reconcile = vi.fn();
    const deps = makeDeps({ issue, reconcile });
    const out = await handlePaymentCallback("fg", { ...okPg, Response: "Failure" }, deps);
    expect(out.ok).toBe(false);
    expect(reconcile).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });

  it("with recon enforcement OFF, logs both ids and still issues on a recon miss", async () => {
    // Until FG_PAYMENT_RECON_KEY is confirmed on UAT, a wrong-key "not found"
    // (or any recon miss) must NOT block issuance — the callback logs tid +
    // WS_P_ID + the outcome and proceeds. This guards against a wrong key guess
    // blocking 100% of issuance.
    const softConfig = {
      payment: { ...config.payment, reconEnforce: false },
    } as unknown as FgConfig;
    const issue = vi.fn(async () => ({ providerSlug: "fg", status: "issued", policyNumber: "POL-1" }) as never);
    const reconcile = vi.fn(async () => ({ ok: false, reason: "recon record not found" }));
    const deps = makeDeps({ issue, reconcile, loadConfig: () => softConfig });
    const out = await handlePaymentCallback("fg", okPg, deps);
    expect(out.ok).toBe(true);
    expect(out.policyNumber).toBe("POL-1");
    expect(issue).toHaveBeenCalledOnce();
    expect(out.redirectUrl).toContain("insurance_ps");
  });
});

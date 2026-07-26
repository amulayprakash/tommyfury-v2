import { env } from "@/config/env.ts";
import { logger } from "@/lib/logger.ts";
import { AppError } from "@/errors/app-error.ts";
import { loadFgConfig, type FgConfig } from "@/providers/fg/config.ts";
import {
  buildPaymentForm,
  parsePgFields,
  pgSucceeded,
  pgResultToReceipt,
  type PaymentForm,
} from "@/providers/fg/payment.ts";
import { findQuoteByTransactionId } from "@/repositories/quote.repository.ts";
import {
  PolicyIssuanceRequestSchema,
  type PolicyIssuanceRequest,
  type PolicyIssuanceResult,
} from "@/contracts/policy.ts";
import type { VehicleCategory, PolicyType } from "@/contracts/enums.ts";
import { issuePolicy } from "./policy.service.ts";
import { reconcilePayment, type ReconInput, type ReconResult } from "@/providers/fg/payment-recon.ts";

export interface PaymentInitiateBody {
  quoteNo: string;
  premiumAmount: number;
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
}

/** Builds the checksum-signed FG payment form for the browser to auto-submit. */
export function initiatePayment(providerSlug: string, body: PaymentInitiateBody): PaymentForm {
  if (providerSlug !== "fg") {
    throw new AppError(501, `Payment is not supported for provider "${providerSlug}"`, "NOT_IMPLEMENTED");
  }
  return buildPaymentForm(loadFgConfig(), body);
}

export interface PaymentCallbackOutcome {
  ok: boolean;
  policyNumber?: string;
  redirectUrl: string;
}

/** Collaborators of the callback flow — injectable so tests avoid the DB/network. */
export interface PaymentCallbackDeps {
  loadConfig: () => FgConfig;
  findQuote: typeof findQuoteByTransactionId;
  reconcile: (config: FgConfig, input: ReconInput) => Promise<ReconResult>;
  issue: (providerSlug: string, req: PolicyIssuanceRequest) => Promise<PolicyIssuanceResult>;
}

const defaultCallbackDeps: PaymentCallbackDeps = {
  loadConfig: loadFgConfig,
  findQuote: findQuoteByTransactionId,
  reconcile: (config, input) => reconcilePayment(config, input),
  issue: issuePolicy,
};

/**
 * Handles FG's payment ResponseURL callback (v1.41): parses the PG result; on a
 * reported success, re-verifies the transaction via the FetchTRNDetails recon
 * service against the server-known proposal premium. Because the exact recon key
 * (our TID vs FG's WS_P_ID) is UNVERIFIED on UAT, a recon miss only hard-blocks
 * issuance when `payment.reconEnforce` is set; otherwise it LOGS both ids + the
 * outcome and proceeds (a wrong key guess must not block 100% of issuance).
 * Returns the browser redirect target (success/failure web page).
 */
export async function handlePaymentCallback(
  providerSlug: string,
  rawBody: Record<string, unknown>,
  deps: PaymentCallbackDeps = defaultCallbackDeps,
): Promise<PaymentCallbackOutcome> {
  if (providerSlug !== "fg") {
    throw new AppError(501, `Payment is not supported for provider "${providerSlug}"`, "NOT_IMPLEMENTED");
  }
  const config = deps.loadConfig();
  const pg = parsePgFields(rawBody);
  const quoteNo = pg.tid ?? "";

  if (!pgSucceeded(pg)) {
    logger.warn({ providerSlug, quoteNo, response: pg.response }, "FG payment not successful");
    return { ok: false, redirectUrl: failureRedirect(config.payment.failureUrl, quoteNo) };
  }

  const row = await deps.findQuote(providerSlug, quoteNo);
  if (!row?.clientId) {
    throw new AppError(
      409,
      `No proposal with a ClientId found for quote "${quoteNo}"; cannot issue`,
      "PROPOSAL_NOT_FOUND",
    );
  }

  // Reconcile the SERVER-known premium (defends against a tampered browser
  // Premium). Fall back to the PG-reported premium only when we have no stored
  // proposal amount.
  const expectedAmount = row.grossPremium ?? (pg.premium ? Number(pg.premium) : 0);
  // Which id FetchTRNDetails is keyed by is UNVERIFIED on UAT — send whichever pg
  // id FG_PAYMENT_RECON_KEY selects (our TID, or FG's WS_P_ID). Note the DB lookup
  // above always uses our TID (quoteNo); only the recon call uses the chosen key.
  const reconTransactionId = (config.payment.reconKey === "wsPId" ? pg.wsPId : pg.tid) ?? "";
  const recon = await deps.reconcile(config, {
    transactionId: reconTransactionId,
    expectedAmount,
    source: config.payment.reconSource,
  });
  if (!recon.ok) {
    // Log BOTH ids + the recon outcome so a wrong recon-key guess is diagnosable
    // from a single line, and only hard-block when recon is trusted. Until
    // FG_PAYMENT_RECON_KEY is confirmed live, a wrong key returns "not found" for
    // every real txn — blocking here would reject 100% of payments — so proceed.
    logger.warn(
      {
        providerSlug,
        quoteNo,
        tid: pg.tid,
        wsPId: pg.wsPId,
        reconKey: config.payment.reconKey,
        reconEnforce: config.payment.reconEnforce,
        reason: recon.reason,
      },
      "FG payment recon did not pass",
    );
    if (config.payment.reconEnforce) {
      return { ok: false, redirectUrl: failureRedirect(config.payment.failureUrl, quoteNo) };
    }
  }

  // Issue the recon-authoritative amount when recon PASSED; otherwise the
  // server-known proposal premium (whole rupees). `reconcilePayment` spreads the
  // parsed record into its failure result too, so a failed recon still carries a
  // paymentAmount — and when that failure IS an amount mismatch (partial or
  // tampered payment) adopting it would bind the policy for the wrong amount.
  const amount = recon.ok ? recon.paymentAmount ?? expectedAmount : expectedAmount;
  const issuanceReq = PolicyIssuanceRequestSchema.parse({
    quoteNo,
    clientId: row.clientId,
    vehicleCategory: row.vehicleCategory as VehicleCategory,
    policyType: row.policyType as PolicyType,
    receipt: pgResultToReceipt(pg, config, amount),
  });

  const result = await deps.issue(providerSlug, issuanceReq);
  return {
    ok: Boolean(result.policyNumber),
    policyNumber: result.policyNumber,
    redirectUrl: successRedirect(config.payment.successUrl, quoteNo, result.policyNumber),
  };
}

function webBase(): string {
  return env.ALLOWED_ORIGINS[0] ?? "http://localhost:8080";
}

function successRedirect(configured: string | undefined, quoteNo: string, policyNo?: string): string {
  // Default matches ROUTES.checkout.insurancePaymentSuccess ("/insurance_ps").
  const base = configured ?? `${webBase()}/insurance_ps`;
  const u = new URL(base);
  u.searchParams.set("quoteNo", quoteNo);
  if (policyNo) u.searchParams.set("policyNo", policyNo);
  return u.toString();
}

function failureRedirect(configured: string | undefined, quoteNo: string): string {
  // Default matches ROUTES.checkout.hdfcFailure ("/failure").
  const base = configured ?? `${webBase()}/failure`;
  const u = new URL(base);
  u.searchParams.set("quoteNo", quoteNo);
  return u.toString();
}

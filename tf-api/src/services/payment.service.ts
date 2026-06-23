import { env } from "@/config/env.ts";
import { logger } from "@/lib/logger.ts";
import { AppError } from "@/errors/app-error.ts";
import { loadFgConfig } from "@/providers/fg/config.ts";
import {
  buildPaymentForm,
  parsePgFields,
  pgSucceeded,
  pgResultToReceipt,
  type PaymentForm,
} from "@/providers/fg/payment.ts";
import { findQuoteByTransactionId } from "@/repositories/quote.repository.ts";
import { PolicyIssuanceRequestSchema } from "@/contracts/policy.ts";
import type { VehicleCategory, PolicyType } from "@/contracts/enums.ts";
import { issuePolicy } from "./policy.service.ts";

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

/**
 * Handles FG's payment ResponseURL callback: parses the PG result, and on
 * success binds the receipt to the prior proposal and issues the policy. Returns
 * the browser redirect target (success/failure web page).
 */
export async function handlePaymentCallback(
  providerSlug: string,
  rawBody: Record<string, unknown>,
): Promise<PaymentCallbackOutcome> {
  if (providerSlug !== "fg") {
    throw new AppError(501, `Payment is not supported for provider "${providerSlug}"`, "NOT_IMPLEMENTED");
  }
  const config = loadFgConfig();
  const pg = parsePgFields(rawBody);
  const quoteNo = pg.tid ?? "";

  if (!pgSucceeded(pg)) {
    logger.warn({ providerSlug, quoteNo, response: pg.response }, "FG payment not successful");
    return { ok: false, redirectUrl: failureRedirect(config.payment.failureUrl, quoteNo) };
  }

  const row = await findQuoteByTransactionId(providerSlug, quoteNo);
  if (!row?.clientId) {
    throw new AppError(
      409,
      `No proposal with a ClientId found for quote "${quoteNo}"; cannot issue`,
      "PROPOSAL_NOT_FOUND",
    );
  }

  const amount = pg.premium ? Number(pg.premium) : (row.grossPremium ?? 0);
  const issuanceReq = PolicyIssuanceRequestSchema.parse({
    quoteNo,
    clientId: row.clientId,
    vehicleCategory: row.vehicleCategory as VehicleCategory,
    policyType: row.policyType as PolicyType,
    receipt: pgResultToReceipt(pg, config, amount),
  });

  const result = await issuePolicy(providerSlug, issuanceReq);
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

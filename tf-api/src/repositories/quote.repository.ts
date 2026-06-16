import type { Prisma } from "@prisma/client";
import { prisma, persistenceDisabled } from "@/lib/prisma.ts";
import { logger } from "@/lib/logger.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";

/** Strips `undefined` so values are valid Prisma JSON. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Persistence is best-effort: an audit-write failure must never break the
 * quote/proposal the user is waiting on — it's logged at error level instead.
 * Skipped entirely under NODE_ENV=test so the suite stays hermetic.
 */
export async function recordQuote(
  providerSlug: string,
  req: MotorQuoteRequest,
  result: CanonicalQuoteResult,
): Promise<void> {
  if (persistenceDisabled) return;
  try {
    const data = {
      providerSlug,
      vehicleCategory: result.vehicleCategory,
      status: result.grossPremium > 0 ? "success" : "no_quote",
      quoteNo: result.quoteNo || null,
      providerTransactionId: result.transactionId ?? result.quoteNo ?? null,
      policyType: result.policyType,
      makeModel: `${req.makeName} ${req.modelName}`.trim(),
      registrationNo: req.registrationNumber ?? null,
      idvValue: Math.round(result.idvValue),
      netPremium: Math.round(result.netPremium),
      grossPremium: Math.round(result.grossPremium),
      addonPremiums: toJson(result.addonPremiums),
      discounts: toJson(result.discounts),
      rawRequest: toJson(req),
    };
    await prisma.quote.upsert({
      where: { requestId: result.requestId },
      update: data,
      create: { requestId: result.requestId, ...data },
    });
  } catch (err) {
    logger.error({ err, providerSlug, requestId: result.requestId }, "Failed to persist quote");
  }
}

export async function recordProposal(
  providerSlug: string,
  req: MotorFullQuoteRequest,
  result: CanonicalQuoteResult,
): Promise<void> {
  if (persistenceDisabled) return;
  try {
    const status =
      (result.contractDetails?.status as string | undefined) ??
      (result.policyNumber ? "proposed" : "pending");
    const data = {
      providerSlug,
      vehicleCategory: result.vehicleCategory,
      status,
      quoteNo: result.quoteNo || null,
      providerTransactionId: result.transactionId ?? req.quoteId ?? null,
      policyType: result.policyType,
      holderName: `${req.proposer.firstName} ${req.proposer.lastName}`.trim(),
      holderEmail: req.proposer.email,
      holderMobile: req.proposer.mobile,
      makeModel: `${req.makeName} ${req.modelName}`.trim(),
      registrationNo: req.registrationNumber ?? null,
      engineNumber: req.vehicle.engineNumber,
      chassisNumber: req.vehicle.chassisNumber,
      idvValue: Math.round(result.idvValue),
      netPremium: Math.round(result.netPremium),
      grossPremium: Math.round(result.grossPremium),
      policyNumber: result.policyNumber ?? null,
      policyStatus: (result.contractDetails?.status as string | undefined) ?? null,
      paymentLink: result.paymentUrl ?? null,
      addonPremiums: toJson(result.addonPremiums),
      discounts: toJson(result.discounts),
      contractDetails: toJson(result.contractDetails),
      rawFullQuote: toJson(result._rawResponse),
    };
    await prisma.quote.upsert({
      where: { requestId: result.requestId },
      update: data,
      create: { requestId: result.requestId, ...data },
    });
  } catch (err) {
    logger.error({ err, providerSlug, requestId: result.requestId }, "Failed to persist proposal");
  }
}

export async function attachKyc(
  providerSlug: string,
  transactionId: string,
  kycId: string | undefined,
): Promise<void> {
  if (persistenceDisabled || !kycId) return;
  try {
    await prisma.quote.updateMany({
      where: { providerSlug, providerTransactionId: transactionId },
      data: { kycId },
    });
  } catch (err) {
    logger.error({ err, providerSlug, transactionId }, "Failed to attach KYC id");
  }
}

export async function updatePolicyStatus(
  providerSlug: string,
  transactionId: string,
  policyStatus: string,
  policyNumber?: string,
): Promise<void> {
  if (persistenceDisabled) return;
  try {
    await prisma.quote.updateMany({
      where: { providerSlug, providerTransactionId: transactionId },
      data: { policyStatus, ...(policyNumber ? { policyNumber } : {}) },
    });
  } catch (err) {
    logger.error({ err, providerSlug, transactionId }, "Failed to update policy status");
  }
}

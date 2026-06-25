import type { Prisma } from "@prisma/client";
import { prisma, persistenceDisabled } from "@/lib/prisma.ts";
import { logger } from "@/lib/logger.ts";
import type {
  HealthQuoteRequest,
  HealthFullQuoteRequest,
} from "@/contracts/health/health-quote-request.ts";
import type { HealthIssuanceRequest } from "@/contracts/health/health-policy.ts";
import type { HealthQuoteResult } from "@/contracts/health/health-quote-result.ts";
import type { PolicyIssuanceResult } from "@/contracts/policy.ts";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/** Best-effort audit write (skipped under NODE_ENV=test); never breaks the response. */
export async function recordHealthQuote(
  providerSlug: string,
  req: HealthQuoteRequest,
  result: HealthQuoteResult,
): Promise<void> {
  if (persistenceDisabled) return;
  try {
    const self = req.members.find((m) => m.relation === "self") ?? req.members[0];
    const data = {
      providerSlug,
      product: result.product,
      line: result.line,
      status: result.grossPremium > 0 ? "success" : "no_quote",
      quoteNo: result.quoteNo || null,
      providerTransactionId: result.transactionId ?? result.quoteNo ?? null,
      sumInsured: Math.round(result.sumInsured),
      policyTermYears: result.policyTermYears,
      members: toJson(result.members),
      holderName: self?.name ?? null,
      basePremium: Math.round(result.basePremium),
      netPremium: Math.round(result.netPremium),
      grossPremium: Math.round(result.grossPremium),
      rawRequest: toJson(req),
    };
    await prisma.healthQuote.upsert({
      where: { requestId: result.requestId },
      update: data,
      create: { requestId: result.requestId, ...data },
    });
  } catch (err) {
    logger.error({ err, providerSlug, requestId: result.requestId }, "Failed to persist health quote");
  }
}

export async function recordHealthProposal(
  providerSlug: string,
  req: HealthFullQuoteRequest,
  result: HealthQuoteResult,
): Promise<void> {
  if (persistenceDisabled) return;
  try {
    const data = {
      providerSlug,
      product: result.product,
      line: result.line,
      status: result.policyNumber ? "proposed" : "pending",
      quoteNo: result.quoteNo || null,
      providerTransactionId: result.transactionId ?? req.quoteId ?? null,
      sumInsured: Math.round(result.sumInsured),
      policyTermYears: result.policyTermYears,
      members: toJson(result.members),
      holderName: `${req.proposer.firstName} ${req.proposer.lastName}`.trim(),
      holderEmail: req.proposer.email,
      holderMobile: req.proposer.mobile,
      clientId: result.clientId ?? null,
      basePremium: Math.round(result.basePremium),
      netPremium: Math.round(result.netPremium),
      grossPremium: Math.round(result.grossPremium),
      contractDetails: toJson(result.contractDetails),
      rawFullQuote: toJson(result._rawResponse),
    };
    await prisma.healthQuote.upsert({
      where: { requestId: result.requestId },
      update: data,
      create: { requestId: result.requestId, ...data },
    });
  } catch (err) {
    logger.error({ err, providerSlug, requestId: result.requestId }, "Failed to persist health proposal");
  }
}

export async function recordHealthIssuance(
  providerSlug: string,
  req: HealthIssuanceRequest,
  result: PolicyIssuanceResult,
): Promise<void> {
  if (persistenceDisabled) return;
  try {
    await prisma.healthQuote.updateMany({
      where: { providerSlug, providerTransactionId: req.quoteId },
      data: {
        status: result.policyNumber ? "issued" : "pending",
        policyStatus: result.status,
        ...(result.policyNumber ? { policyNumber: result.policyNumber } : {}),
        applicationNo: result.applicationNo ?? null,
        receiptNo: result.receiptNo ?? null,
        clientId: result.clientId ?? req.clientId ?? null,
        paymentTranKey: req.receipt.uniqueTranKey,
        paymentRefNo: req.receipt.tranRefNo,
        pgType: req.receipt.pgType,
      },
    });
  } catch (err) {
    logger.error({ err, providerSlug, quoteNo: req.quoteId }, "Failed to persist health issuance");
  }
}

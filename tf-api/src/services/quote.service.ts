import { randomUUID } from "node:crypto";
import {
  getProvider,
  requireCapability,
  requireOperation,
} from "@/providers/provider-registry.ts";
import { supportsQuoteRetrieval } from "@/providers/insurance-provider.ts";
import { AppError } from "@/errors/app-error.ts";
import { recordQuote, recordProposal } from "@/repositories/quote.repository.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { VehicleCategory } from "@/contracts/enums.ts";

export async function fetchQuote(
  providerSlug: string,
  req: MotorQuoteRequest,
): Promise<CanonicalQuoteResult> {
  const provider = getProvider(providerSlug);
  requireOperation(provider, "quote");
  requireCapability(provider, req.vehicleType as VehicleCategory);

  const requestId = randomUUID();
  const result = await provider.getQuote(req, { requestId });
  await recordQuote(providerSlug, req, result);
  return result;
}

export async function fetchFullQuote(
  providerSlug: string,
  req: MotorFullQuoteRequest,
): Promise<CanonicalQuoteResult> {
  const provider = getProvider(providerSlug);
  requireOperation(provider, "proposal");
  requireCapability(provider, req.vehicleType as VehicleCategory);

  const requestId = req.quoteId ?? randomUUID();
  const result = await provider.getFullQuote(req, { requestId });
  await recordProposal(providerSlug, req, result);
  return result;
}

export async function retrieveQuote(
  providerSlug: string,
  transactionId: string,
  category: VehicleCategory,
): Promise<CanonicalQuoteResult> {
  const provider = getProvider(providerSlug);
  requireOperation(provider, "retrieveQuote");
  requireCapability(provider, category);
  if (!supportsQuoteRetrieval(provider)) {
    throw new AppError(500, `Provider "${providerSlug}" mis-declares retrieveQuote`, "PROVIDER_MISCONFIG");
  }

  const requestId = randomUUID();
  return provider.retrieveQuote(transactionId, category, { requestId });
}

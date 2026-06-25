import { randomUUID } from "node:crypto";
import { getProvider, requireOperation } from "@/providers/provider-registry.ts";
import { supportsHealth, type HealthProvider } from "@/providers/insurance-provider.ts";
import { AppError } from "@/errors/app-error.ts";
import {
  recordHealthQuote,
  recordHealthProposal,
  recordHealthIssuance,
} from "@/repositories/health.repository.ts";
import type {
  HealthQuoteRequest,
  HealthFullQuoteRequest,
} from "@/contracts/health/health-quote-request.ts";
import type { HealthIssuanceRequest } from "@/contracts/health/health-policy.ts";
import type { HealthQuoteResult } from "@/contracts/health/health-quote-result.ts";
import type { HealthProduct } from "@/contracts/health/health-enums.ts";
import type { PolicyIssuanceResult } from "@/contracts/policy.ts";

/** Resolves a registered provider and asserts it supports the health line. */
export function getHealthProvider(slug: string): HealthProvider {
  const provider = getProvider(slug);
  requireOperation(provider, "healthQuote");
  if (!supportsHealth(provider)) {
    throw new AppError(500, `Provider "${slug}" mis-declares health support`, "PROVIDER_MISCONFIG");
  }
  return provider;
}

/** Guards that the provider actually offers the requested product. */
export function requireHealthProduct(provider: HealthProvider, product: HealthProduct): void {
  if (!provider.healthCapabilities[product]) {
    throw new AppError(
      422,
      `Provider "${provider.slug}" does not offer health product "${product}"`,
      "PROVIDER_CAPABILITY_ERROR",
    );
  }
}

export async function fetchHealthQuote(
  providerSlug: string,
  req: HealthQuoteRequest,
): Promise<HealthQuoteResult> {
  const provider = getHealthProvider(providerSlug);
  requireHealthProduct(provider, req.product);

  const requestId = randomUUID();
  const result = await provider.getHealthQuote(req, { requestId });
  await recordHealthQuote(providerSlug, req, result);
  return result;
}

export async function fetchHealthProposal(
  providerSlug: string,
  req: HealthFullQuoteRequest,
): Promise<HealthQuoteResult> {
  const provider = getHealthProvider(providerSlug);
  requireOperation(provider, "healthProposal");
  requireHealthProduct(provider, req.product);

  const requestId = req.quoteId ?? randomUUID();
  const result = await provider.getHealthProposal(req, { requestId });
  await recordHealthProposal(providerSlug, req, result);
  return result;
}

export async function issueHealthPolicy(
  providerSlug: string,
  req: HealthIssuanceRequest,
): Promise<PolicyIssuanceResult> {
  const provider = getHealthProvider(providerSlug);
  requireOperation(provider, "healthIssuance");
  requireHealthProduct(provider, req.product);

  const requestId = req.quoteId ?? randomUUID();
  const result = await provider.issueHealthPolicy(req, { requestId });
  await recordHealthIssuance(providerSlug, req, result);
  return result;
}

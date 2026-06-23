import { randomUUID } from "node:crypto";
import { getProvider, requireOperation } from "@/providers/provider-registry.ts";
import { supportsRenewal } from "@/providers/insurance-provider.ts";
import { AppError } from "@/errors/app-error.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { PolicyIssuanceResult } from "@/contracts/policy.ts";
import type { RenewalQuoteRequest, RenewalCreatePolicyRequest } from "@/contracts/renewal.ts";

function renewalProvider(providerSlug: string) {
  const provider = getProvider(providerSlug);
  requireOperation(provider, "renewal");
  if (!supportsRenewal(provider)) {
    throw new AppError(500, `Provider "${providerSlug}" mis-declares renewal`, "PROVIDER_MISCONFIG");
  }
  return provider;
}

export async function renewalQuote(
  providerSlug: string,
  req: RenewalQuoteRequest,
): Promise<CanonicalQuoteResult> {
  return renewalProvider(providerSlug).renewalQuote(req, { requestId: randomUUID() });
}

export async function renewalCreatePolicy(
  providerSlug: string,
  req: RenewalCreatePolicyRequest,
): Promise<PolicyIssuanceResult> {
  return renewalProvider(providerSlug).renewalCreatePolicy(req, { requestId: randomUUID() });
}

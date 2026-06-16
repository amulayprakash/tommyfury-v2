import { getAllProviders } from "@/providers/provider-registry.ts";
import { fetchQuote } from "@/services/quote.service.ts";
import { logger } from "@/lib/logger.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { InsuranceProvider } from "@/providers/insurance-provider.ts";

/** One vendor's outcome in a compare run. */
export interface CompareResultItem {
  providerSlug: string;
  displayName: string;
  status: "success" | "no_quote" | "error";
  quote?: CanonicalQuoteResult;
  error?: { code: string; message: string };
}

/** True when a provider can be asked for this journey's quote. */
function isEligible(
  provider: InsuranceProvider,
  req: MotorQuoteRequest,
  allowList?: string[],
): boolean {
  if (allowList && !allowList.includes(provider.slug)) return false;
  if (!provider.operations.has("quote")) return false;
  if (!provider.capabilities.has(req.vehicleType)) return false;
  const cap = provider.motorCapabilities[req.vehicleType];
  if (!cap) return false;
  return cap.policyTypes.includes(req.selectedPolicy);
}

/**
 * Fans out the quote request to every eligible provider in parallel. One slow or
 * failing vendor never blocks the others — each result is reported independently.
 */
export async function compareQuotes(
  req: MotorQuoteRequest,
  allowList?: string[],
): Promise<CompareResultItem[]> {
  const eligible = getAllProviders().filter((p) => isEligible(p, req, allowList));

  const settled = await Promise.allSettled(eligible.map((p) => fetchQuote(p.slug, req)));

  return eligible.map((provider, i) => {
    const outcome = settled[i]!;
    if (outcome.status === "fulfilled") {
      const quote = outcome.value;
      const status = quote.grossPremium > 0 ? "success" : "no_quote";
      return { providerSlug: provider.slug, displayName: provider.displayName, status, quote };
    }

    const reason = outcome.reason as { code?: string; message?: string } | undefined;
    logger.warn(
      { provider: provider.slug, err: reason },
      "compare: provider quote failed",
    );
    return {
      providerSlug: provider.slug,
      displayName: provider.displayName,
      status: "error",
      error: {
        code: reason?.code ?? "PROVIDER_ERROR",
        message: reason?.message ?? "Quote request failed",
      },
    };
  });
}

import { getAllProviders } from "@/providers/provider-registry.ts";
import { supportsHealth, type HealthProvider } from "@/providers/insurance-provider.ts";
import { fetchHealthQuote } from "@/services/health.service.ts";
import { logger } from "@/lib/logger.ts";
import type {
  HealthCompareRequest,
  HealthQuoteRequest,
} from "@/contracts/health/health-quote-request.ts";
import type { HealthQuoteResult } from "@/contracts/health/health-quote-result.ts";
import type { HealthProduct } from "@/contracts/health/health-enums.ts";

/** One (provider, product) outcome in a health compare run. */
export interface HealthCompareResultItem {
  providerSlug: string;
  displayName: string;
  product: HealthProduct;
  status: "success" | "no_quote" | "error";
  quote?: HealthQuoteResult;
  error?: { code: string; message: string };
}

/** Expands the request into the (provider, product) pairs to price. */
function eligiblePairs(
  req: HealthCompareRequest,
): Array<{ provider: HealthProvider; product: HealthProduct }> {
  const providers = getAllProviders()
    .filter(supportsHealth)
    .filter((p) => !req.providers || req.providers.includes(p.slug));

  const pairs: Array<{ provider: HealthProvider; product: HealthProduct }> = [];
  for (const provider of providers) {
    const supported = Object.keys(provider.healthCapabilities) as HealthProduct[];
    const wanted = req.products ?? supported;
    for (const product of wanted) {
      if (provider.healthCapabilities[product]) pairs.push({ provider, product });
    }
  }
  return pairs;
}

/**
 * Fans out one member set across every eligible (provider, product) in parallel.
 * One slow/failing combination never blocks the others (mirrors compareQuotes).
 */
export async function compareHealthQuotes(
  req: HealthCompareRequest,
): Promise<HealthCompareResultItem[]> {
  const base = { ...req };
  delete base.products;
  delete base.providers;
  const pairs = eligiblePairs(req);

  const settled = await Promise.allSettled(
    pairs.map(({ provider, product }) =>
      fetchHealthQuote(provider.slug, { ...base, product } as HealthQuoteRequest),
    ),
  );

  return pairs.map(({ provider, product }, i) => {
    const outcome = settled[i]!;
    if (outcome.status === "fulfilled") {
      const quote = outcome.value;
      const status = quote.grossPremium > 0 ? "success" : "no_quote";
      return { providerSlug: provider.slug, displayName: provider.displayName, product, status, quote };
    }
    const reason = outcome.reason as { code?: string; message?: string } | undefined;
    logger.warn({ provider: provider.slug, product, err: reason }, "health compare: quote failed");
    return {
      providerSlug: provider.slug,
      displayName: provider.displayName,
      product,
      status: "error",
      error: {
        code: reason?.code ?? "PROVIDER_ERROR",
        message: reason?.message ?? "Health quote request failed",
      },
    };
  });
}

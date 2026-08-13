import type { Request, Response, NextFunction } from "express";
import { compareQuotes } from "@/services/compare.service.ts";
import { env } from "@/config/env.ts";
import type { CompareQuotesRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";

/**
 * Drop the audit-only raw vendor exchange before returning to the client. Kept
 * only when the caller opted in (`includeRawExchange`) AND the deployment
 * permits debug payloads — the FG certification harness needs both.
 */
function stripRaw(quote: CanonicalQuoteResult): Omit<CanonicalQuoteResult, "_rawResponse"> {
  const rest = { ...quote };
  delete rest._rawResponse;
  return rest;
}

export async function handleCompareQuotes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { providers, ...quoteReq } = req.body as CompareQuotesRequest;
    const results = await compareQuotes(quoteReq, providers);
    const keepRaw = Boolean(quoteReq.includeRawExchange) && env.ENABLE_DEBUG_PAYLOAD;
    const sanitized = keepRaw
      ? results
      : results.map((r) => (r.quote ? { ...r, quote: stripRaw(r.quote) } : r));
    res.status(200).json({
      status: "success",
      message: "Quotes compared",
      requestId: req.requestId,
      response: { results: sanitized },
    });
  } catch (err) {
    next(err);
  }
}

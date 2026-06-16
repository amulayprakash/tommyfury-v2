import type { Request, Response, NextFunction } from "express";
import { compareQuotes } from "@/services/compare.service.ts";
import type { CompareQuotesRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";

/** Drop the audit-only raw vendor response before returning to the client. */
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
    const sanitized = results.map((r) => (r.quote ? { ...r, quote: stripRaw(r.quote) } : r));
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

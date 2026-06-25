import type { Request, Response, NextFunction } from "express";
import {
  fetchHealthQuote,
  fetchHealthProposal,
  issueHealthPolicy,
} from "@/services/health.service.ts";
import { compareHealthQuotes } from "@/services/health-compare.service.ts";
import { successEnvelope } from "@/contracts/quote-result.ts";
import type { HealthQuoteResult } from "@/contracts/health/health-quote-result.ts";
import type { HealthCompareRequest } from "@/contracts/health/health-quote-request.ts";
import { env } from "@/config/env.ts";

/** Drop the audit-only raw vendor response before returning to the client. */
function stripRaw(quote: HealthQuoteResult): Omit<HealthQuoteResult, "_rawResponse"> {
  const rest = { ...quote };
  delete rest._rawResponse;
  return rest;
}

export async function handleHealthQuote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await fetchHealthQuote(provider, req.body as never);
    res
      .status(200)
      .json(successEnvelope(result, req.requestId, result._rawResponse, env.ENABLE_DEBUG_PAYLOAD));
  } catch (err) {
    next(err);
  }
}

export async function handleHealthFullQuote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await fetchHealthProposal(provider, req.body as never);
    res
      .status(200)
      .json(successEnvelope(result, req.requestId, result._rawResponse, env.ENABLE_DEBUG_PAYLOAD));
  } catch (err) {
    next(err);
  }
}

export async function handleHealthIssue(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await issueHealthPolicy(provider, req.body as never);
    res
      .status(200)
      .json(successEnvelope(result, req.requestId, result._rawResponse, env.ENABLE_DEBUG_PAYLOAD));
  } catch (err) {
    next(err);
  }
}

export async function handleHealthCompare(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const results = await compareHealthQuotes(req.body as HealthCompareRequest);
    const sanitized = results.map((r) => (r.quote ? { ...r, quote: stripRaw(r.quote) } : r));
    res.status(200).json({
      status: "success",
      message: "Health quotes compared",
      requestId: req.requestId,
      response: { results: sanitized },
    });
  } catch (err) {
    next(err);
  }
}

import type { Request, Response, NextFunction } from "express";
import { fetchQuote, fetchFullQuote, retrieveQuote } from "@/services/quote.service.ts";
import { successEnvelope } from "@/contracts/quote-result.ts";
import { VehicleCategorySchema } from "@/contracts/enums.ts";
import { ValidationError } from "@/errors/app-error.ts";
import { env } from "@/config/env.ts";

export async function handleGetQuote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await fetchQuote(provider, req.body as never);
    res
      .status(200)
      .json(successEnvelope(result, req.requestId, result._rawResponse, env.ENABLE_DEBUG_PAYLOAD));
  } catch (err) {
    next(err);
  }
}

export async function handleGetFullQuote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await fetchFullQuote(provider, req.body as never);
    res
      .status(200)
      .json(successEnvelope(result, req.requestId, result._rawResponse, env.ENABLE_DEBUG_PAYLOAD));
  } catch (err) {
    next(err);
  }
}

export async function handleRetrieveQuote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider, transactionId } = req.params as { provider: string; transactionId: string };
    const parsed = VehicleCategorySchema.safeParse(req.query.category);
    if (!parsed.success) {
      throw new ValidationError([{ path: ["category"], message: "Valid ?category is required" }]);
    }
    const result = await retrieveQuote(provider, transactionId, parsed.data);
    res
      .status(200)
      .json(successEnvelope(result, req.requestId, result._rawResponse, env.ENABLE_DEBUG_PAYLOAD));
  } catch (err) {
    next(err);
  }
}

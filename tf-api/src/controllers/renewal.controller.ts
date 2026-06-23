import type { Request, Response, NextFunction } from "express";
import { renewalQuote, renewalCreatePolicy } from "@/services/renewal.service.ts";
import { successEnvelope } from "@/contracts/quote-result.ts";
import { env } from "@/config/env.ts";

export async function handleRenewalQuote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await renewalQuote(provider, req.body as never);
    res
      .status(200)
      .json(successEnvelope(result, req.requestId, result._rawResponse, env.ENABLE_DEBUG_PAYLOAD));
  } catch (err) {
    next(err);
  }
}

export async function handleRenewalCreate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await renewalCreatePolicy(provider, req.body as never);
    res
      .status(200)
      .json(successEnvelope(result, req.requestId, result._rawResponse, env.ENABLE_DEBUG_PAYLOAD));
  } catch (err) {
    next(err);
  }
}

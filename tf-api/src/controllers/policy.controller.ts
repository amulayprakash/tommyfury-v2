import type { Request, Response, NextFunction } from "express";
import { getPolicyStatus, getCertificate } from "@/services/policy.service.ts";
import { successEnvelope } from "@/contracts/quote-result.ts";

export async function handlePolicyStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await getPolicyStatus(provider, req.body as never);
    res.status(200).json(successEnvelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function handleCertificate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider, transactionId } = req.params as { provider: string; transactionId: string };
    const result = await getCertificate(provider, transactionId);
    res.status(200).json(successEnvelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

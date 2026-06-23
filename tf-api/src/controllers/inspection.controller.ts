import type { Request, Response, NextFunction } from "express";
import { createInspection, getInspectionStatus } from "@/services/inspection.service.ts";
import { successEnvelope } from "@/contracts/quote-result.ts";

export async function handleCreateInspection(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await createInspection(provider, req.body as never);
    res.status(200).json(successEnvelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function handleInspectionStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider, refId } = req.params as { provider: string; refId: string };
    const result = await getInspectionStatus(provider, refId);
    res.status(200).json(successEnvelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

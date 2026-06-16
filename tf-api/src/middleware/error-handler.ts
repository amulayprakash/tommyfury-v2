import type { Request, Response, NextFunction } from "express";
import { AppError } from "@/errors/app-error.ts";
import { errorEnvelope } from "@/contracts/quote-result.ts";
import { logger } from "@/lib/logger.ts";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? "unknown";

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, err.message);
    } else {
      logger.warn({ err, requestId }, err.message);
    }
    res
      .status(err.statusCode)
      .json(errorEnvelope(err.message, requestId, err.code, err.details, err.statusCode));
    return;
  }

  logger.error({ err, requestId }, "Unhandled error");
  res.status(500).json(errorEnvelope("Internal server error", requestId, "INTERNAL_ERROR"));
}

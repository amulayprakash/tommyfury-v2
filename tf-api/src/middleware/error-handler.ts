import type { Request, Response, NextFunction } from "express";
import { MulterError } from "multer";
import { AppError } from "@/errors/app-error.ts";
import { errorEnvelope } from "@/contracts/quote-result.ts";
import { logger } from "@/lib/logger.ts";
import { OVD_MAX_FILE_BYTES } from "@/routes/v1/lifecycle.routes.ts";

/**
 * Upload failures arrive as multer's own error type, not an AppError — without
 * this they fall through to a bare 500 "Internal server error", which tells a
 * customer nothing about the oversized document they just picked.
 */
function fromMulter(err: MulterError): AppError {
  const mb = Math.round(OVD_MAX_FILE_BYTES / 1024 / 1024);
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return new AppError(413, `Each document must be ${mb} MB or smaller.`, "FILE_TOO_LARGE");
    case "LIMIT_FILE_COUNT":
    case "LIMIT_UNEXPECTED_FILE":
      return new AppError(
        422,
        "Upload exactly one identity proof and one address proof.",
        "UNEXPECTED_FILE",
      );
    default:
      return new AppError(422, `Document upload failed: ${err.message}`, "UPLOAD_FAILED");
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? "unknown";

  if (err instanceof MulterError) err = fromMulter(err);

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

import type { Request, Response, NextFunction } from "express";
import { completeCkyc, initiateOvd } from "@/services/kyc.service.ts";
import { successEnvelope } from "@/contracts/quote-result.ts";
import { ValidationError } from "@/errors/app-error.ts";
import type { OvdFile } from "@/contracts/kyc.ts";

export async function handleCkyc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const result = await completeCkyc(provider, req.body as never);
    res.status(200).json(successEnvelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function handleOvd(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const files = collectOvdFiles(req);
    if (files.length === 0) {
      throw new ValidationError([
        { path: ["files"], message: "proofOfIdentity and proofOfAddress files are required" },
      ]);
    }
    const result = await initiateOvd(provider, req.body as never, files);
    res.status(200).json(successEnvelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

/** Maps multer's memory-storage files onto the provider-agnostic OvdFile shape. */
function collectOvdFiles(req: Request): OvdFile[] {
  const grouped = req.files as Record<string, Express.Multer.File[]> | undefined;
  if (!grouped) return [];
  const out: OvdFile[] = [];
  for (const fieldName of ["proofOfIdentity", "proofOfAddress"] as const) {
    const file = grouped[fieldName]?.[0];
    if (file) {
      out.push({
        fieldName,
        originalName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
      });
    }
  }
  return out;
}

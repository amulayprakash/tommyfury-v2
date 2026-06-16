import type { Request, Response, NextFunction } from "express";
import { searchRto, searchMmv, listInsurers } from "@/repositories/master.repository.ts";

export async function handleRtoSearch(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json({ status: "success", results: await searchRto(q) });
  } catch (err) {
    next(err);
  }
}

export async function handleMmvSearch(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const pick = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : undefined);
    res.json({
      status: "success",
      results: await searchMmv({ make: pick("make"), model: pick("model"), category: pick("category") }),
    });
  } catch (err) {
    next(err);
  }
}

export async function handleInsurers(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({ status: "success", results: await listInsurers() });
  } catch (err) {
    next(err);
  }
}

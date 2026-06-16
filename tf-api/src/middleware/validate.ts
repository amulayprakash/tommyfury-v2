import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { ValidationError } from "@/errors/app-error.ts";

type Target = "body" | "query" | "params";

export function validate(schema: ZodSchema, target: Target = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      return next(new ValidationError(result.error.issues));
    }
    // Replace raw input with coerced/defaulted values
    (req as unknown as Record<string, unknown>)[target] = result.data;
    next();
  };
}

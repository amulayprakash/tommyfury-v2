import { Router } from "express";
import { validate } from "@/middleware/validate.ts";
import {
  HealthQuoteRequestSchema,
  HealthFullQuoteRequestSchema,
  HealthCompareRequestSchema,
} from "@/contracts/health/health-quote-request.ts";
import { HealthIssuanceRequestSchema } from "@/contracts/health/health-policy.ts";
import {
  handleHealthQuote,
  handleHealthFullQuote,
  handleHealthIssue,
  handleHealthCompare,
} from "@/controllers/health.controller.ts";

const router = Router();

// Compare — fan out one member set across every eligible product/provider.
router.post("/health/quotes/compare", validate(HealthCompareRequestSchema), handleHealthCompare);

// Per-provider health lifecycle (quote → proposal → issuance).
router.post("/:provider/health/quote", validate(HealthQuoteRequestSchema), handleHealthQuote);
router.post(
  "/:provider/health/full-quote",
  validate(HealthFullQuoteRequestSchema),
  handleHealthFullQuote,
);
router.post("/:provider/health/issue", validate(HealthIssuanceRequestSchema), handleHealthIssue);

export { router as healthInsuranceRouter };

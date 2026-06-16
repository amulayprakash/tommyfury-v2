import { Router } from "express";
import { validate } from "@/middleware/validate.ts";
import { CompareQuotesRequestSchema } from "@/contracts/quote-request.ts";
import { handleCompareQuotes } from "@/controllers/compare.controller.ts";

const router = Router();

// POST /api/v1/motor/quotes/compare — fan out one quote request to every eligible
// provider and return their results side by side.
router.post("/motor/quotes/compare", validate(CompareQuotesRequestSchema), handleCompareQuotes);

export { router as compareRouter };

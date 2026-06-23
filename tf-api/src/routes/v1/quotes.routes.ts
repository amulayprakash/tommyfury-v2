import { Router } from "express";
import { validate } from "@/middleware/validate.ts";
import { MotorQuoteRequestSchema, MotorFullQuoteRequestSchema } from "@/contracts/quote-request.ts";
import {
  RenewalQuoteRequestSchema,
  RenewalCreatePolicyRequestSchema,
} from "@/contracts/renewal.ts";
import {
  handleGetQuote,
  handleGetFullQuote,
  handleRetrieveQuote,
} from "@/controllers/quote.controller.ts";
import { handleRenewalQuote, handleRenewalCreate } from "@/controllers/renewal.controller.ts";

const router = Router();

// POST /api/v1/:provider/motor/quote — mirrors Laravel /motor/quote
router.post("/:provider/motor/quote", validate(MotorQuoteRequestSchema), handleGetQuote);

// GET /api/v1/:provider/motor/quote/:transactionId?category=... — retrieve cached quote
router.get("/:provider/motor/quote/:transactionId", handleRetrieveQuote);

// POST /api/v1/:provider/motor/full-quote — mirrors /motor/full-quote
router.post(
  "/:provider/motor/full-quote",
  validate(MotorFullQuoteRequestSchema),
  handleGetFullQuote,
);

// New vehicle
router.post("/:provider/motor/new/quote", validate(MotorQuoteRequestSchema), handleGetQuote);
router.post(
  "/:provider/motor/new/full-quote",
  validate(MotorFullQuoteRequestSchema),
  handleGetFullQuote,
);

// Commercial
router.post(
  "/:provider/motor/commercial/quote",
  validate(MotorQuoteRequestSchema),
  handleGetQuote,
);
router.post(
  "/:provider/motor/commercial/full-quote",
  validate(MotorFullQuoteRequestSchema),
  handleGetFullQuote,
);

// New commercial
router.post(
  "/:provider/motor/new-commercial/quote",
  validate(MotorQuoteRequestSchema),
  handleGetQuote,
);
router.post(
  "/:provider/motor/new-commercial/full-quote",
  validate(MotorFullQuoteRequestSchema),
  handleGetFullQuote,
);

// Renewal of an existing policy (FG: separate motorRenewal JSON API)
router.post(
  "/:provider/motor/renewal/quote",
  validate(RenewalQuoteRequestSchema),
  handleRenewalQuote,
);
router.post(
  "/:provider/motor/renewal/create",
  validate(RenewalCreatePolicyRequestSchema),
  handleRenewalCreate,
);

export { router as quotesRouter };

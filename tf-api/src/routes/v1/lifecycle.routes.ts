import { Router } from "express";
import multer from "multer";
import { validate } from "@/middleware/validate.ts";
import { CkycRequestSchema, OvdRequestSchema } from "@/contracts/kyc.ts";
import { PolicyStatusRequestSchema, PolicyIssuanceRequestSchema } from "@/contracts/policy.ts";
import { PaymentInitiateRequestSchema } from "@/contracts/policy.ts";
import { InspectionRequestSchema } from "@/contracts/inspection.ts";
import { handleCkyc, handleOvd } from "@/controllers/kyc.controller.ts";
import {
  handlePolicyStatus,
  handleCertificate,
  handleIssuePolicy,
} from "@/controllers/policy.controller.ts";
import {
  handlePaymentInitiate,
  handlePaymentCallbackController,
} from "@/controllers/payment.controller.ts";
import {
  handleCreateInspection,
  handleInspectionStatus,
} from "@/controllers/inspection.controller.ts";

const router = Router();

// In-memory uploads: 2 files, 5 MB each. Bytes never logged (see pino redact).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
});

// KYC
router.post("/:provider/kyc/ckyc", validate(CkycRequestSchema), handleCkyc);
router.post(
  "/:provider/kyc/ovd",
  upload.fields([
    { name: "proofOfIdentity", maxCount: 1 },
    { name: "proofOfAddress", maxCount: 1 },
  ]),
  validate(OvdRequestSchema),
  handleOvd,
);

// Policy
router.post("/:provider/policy/status", validate(PolicyStatusRequestSchema), handlePolicyStatus);
router.post("/:provider/policy/issue", validate(PolicyIssuanceRequestSchema), handleIssuePolicy);
router.get("/:provider/policy/:transactionId/certificate", handleCertificate);

// Payment (FG web-aggregator gateway)
router.post("/:provider/payment/initiate", validate(PaymentInitiateRequestSchema), handlePaymentInitiate);
// FG calls back here after payment — accept both POST (form) and GET (query).
router.post("/:provider/payment/callback", handlePaymentCallbackController);
router.get("/:provider/payment/callback", handlePaymentCallbackController);

// Break-in / pre-inspection (LiveChek)
router.post("/:provider/inspection", validate(InspectionRequestSchema), handleCreateInspection);
router.get("/:provider/inspection/:refId/status", handleInspectionStatus);

export { router as lifecycleRouter };

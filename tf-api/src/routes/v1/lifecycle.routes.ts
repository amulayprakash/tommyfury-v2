import { Router } from "express";
import multer from "multer";
import { validate } from "@/middleware/validate.ts";
import { CkycRequestSchema, OvdRequestSchema } from "@/contracts/kyc.ts";
import { PolicyStatusRequestSchema } from "@/contracts/policy.ts";
import { handleCkyc, handleOvd } from "@/controllers/kyc.controller.ts";
import { handlePolicyStatus, handleCertificate } from "@/controllers/policy.controller.ts";

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
router.get("/:provider/policy/:transactionId/certificate", handleCertificate);

export { router as lifecycleRouter };

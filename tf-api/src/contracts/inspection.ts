import { z } from "zod";
import { PolicyLifecycleStatusSchema } from "./enums.ts";

// ─── Break-in / pre-inspection (LiveChek) ─────────────────────────────────────
// Used when FG requires a pre-issuance vehicle inspection (break-in, TP→Comp,
// owner change, PYP skipped). Spec: Inspection Service/API_Doc_UAT_FG.pdf.

export const InspectionRequestSchema = z.object({
  /** Aggregator's correlation id (echoed across status updates). Defaults to quoteNo. */
  refId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional(),
  mobileNumber: z.string().regex(/^[6-9]\d{9}$/),
  address: z.string().optional(),
  regNumber: z.string().min(1),
  /** LiveChek vehicle category: car | bike | truck | bus | … */
  vehicleCategory: z.string().min(1),
  vehicleSubCategory: z.string().optional(),
  make: z.string().min(1),
  brand: z.string().min(1),
  modelYear: z.string().optional(),
  fuelType: z.string().optional(),
  city: z.string().optional(),
  odometer: z.coerce.number().nonnegative().optional(),
  /** registrationType: commercial | non-commercial */
  regType: z.string().optional(),
  /** Agent code / mobile registered with LiveChek. */
  appUserId: z.string().optional(),
});

export type InspectionRequest = z.infer<typeof InspectionRequestSchema>;

export const InspectionResultSchema = z.object({
  refId: z.string(),
  status: PolicyLifecycleStatusSchema,
  /** Raw vendor status string (e.g. "initial", "company-approved"). */
  rawStatus: z.string().optional(),
  inspectionId: z.string().optional(),
  message: z.string().optional(),
  _rawResponse: z.unknown().optional(),
});

export type InspectionResult = z.infer<typeof InspectionResultSchema>;

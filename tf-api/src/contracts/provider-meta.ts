import { z } from "zod";
import {
  VehicleCategorySchema,
  PolicyTypeSchema,
  AddonKeySchema,
  ProviderOperationSchema,
} from "./enums.ts";
import { CanonicalQuoteResultSchema } from "./quote-result.ts";

// ─── Provider listing (GET /providers) ─────────────────────────────────────────

export const MotorCategoryCapabilitySchema = z.object({
  policyTypes: z.array(PolicyTypeSchema),
  addons: z.array(AddonKeySchema),
});

export const MotorCapabilitiesSchema = z.record(
  VehicleCategorySchema,
  MotorCategoryCapabilitySchema,
);

export const ProviderInfoSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  capabilities: z.array(VehicleCategorySchema),
  operations: z.array(ProviderOperationSchema),
  motorCapabilities: MotorCapabilitiesSchema,
});

export const ProvidersResponseSchema = z.object({
  status: z.literal("success"),
  providers: z.array(ProviderInfoSchema),
});

// ─── Compare (POST /motor/quotes/compare) ──────────────────────────────────────

export const CompareResultItemSchema = z.object({
  providerSlug: z.string(),
  displayName: z.string(),
  status: z.enum(["success", "no_quote", "error"]),
  quote: CanonicalQuoteResultSchema.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export const CompareResponseDataSchema = z.object({
  results: z.array(CompareResultItemSchema),
});

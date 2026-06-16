import { z } from "zod";
import {
  VehicleCategorySchema,
  PolicyTypeSchema,
  FuelTypeSchema,
  BusinessTypeSchema,
} from "./enums.ts";

// ─── Motor Quote Request ───────────────────────────────────────────────────────

export const MotorQuoteRequestSchema = z.object({
  // Journey
  vehicleType: VehicleCategorySchema,
  selectedPolicy: PolicyTypeSchema,
  businessType: BusinessTypeSchema,

  // Vehicle
  makeId: z.string().min(1),
  makeName: z.string().min(1),
  modelId: z.string().min(1),
  modelName: z.string().min(1),
  variantId: z.string().optional(),
  variantName: z.string().optional(),
  fuelType: FuelTypeSchema,
  engineCC: z.coerce.number().int().positive().optional(),
  seatingCapacity: z.coerce.number().int().positive().optional(),
  idvValue: z.coerce.number().nonnegative().optional(),
  idvPercent: z.coerce.number().min(0).max(100).optional(),

  // Registration
  rtoCode: z.string().min(1),
  registrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  registrationNumber: z.string().optional(),
  vehicleAge: z.coerce.number().int().nonnegative().optional(),

  // Previous policy (rollover/renewal)
  previousPolicyNumber: z.string().optional(),
  previousInsurerId: z.string().optional(),
  previousInsurerName: z.string().optional(),
  previousPolicyExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isPreviousPolicyExpired: z.boolean().default(false),
  previousPolicyType: PolicyTypeSchema.optional(),

  // NCB
  claimInPreviousPolicy: z.boolean().default(false),
  ncbPercent: z.coerce.number().int().min(0).max(50).default(0),

  // New policy dates
  policyStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  policyEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  // Addons
  zeroDep: z.boolean().default(false),
  engineProtect: z.boolean().default(false),
  rsa: z.boolean().default(false),
  tyreProtect: z.boolean().default(false),
  rimProtect: z.boolean().default(false),
  rti: z.boolean().default(false),
  consumables: z.boolean().default(false),
  paOwner: z.boolean().default(true),
  paUnnamedPassenger: z.boolean().default(false),
  legalLiabilityPaidDriver: z.boolean().default(false),
});

export type MotorQuoteRequest = z.infer<typeof MotorQuoteRequestSchema>;

// ─── Compare (multi-vendor aggregation) Request ────────────────────────────────
// Same as a single quote, plus an optional allow-list of provider slugs. When
// omitted, every registered provider eligible for the journey is queried.
export const CompareQuotesRequestSchema = MotorQuoteRequestSchema.extend({
  providers: z.array(z.string().min(1)).optional(),
});

export type CompareQuotesRequest = z.infer<typeof CompareQuotesRequestSchema>;

// ─── Full Quote (Proposal) Request ────────────────────────────────────────────

export const ProposerSchema = z.object({
  title: z.enum(["Mr", "Mrs", "Ms", "Dr"]).optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(["M", "F", "O"]).optional(),
  panNumber: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/).optional(),
  aadharNumber: z.string().length(12).optional(),
});

export const AddressSchema = z.object({
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  pincode: z.string().regex(/^\d{6}$/),
  city: z.string().min(1),
  state: z.string().min(1),
});

export const VehicleIdentitySchema = z.object({
  engineNumber: z.string().min(1),
  chassisNumber: z.string().min(1),
  color: z.string().optional(),
  financeType: z.enum(["hypothecation", "lease", "none"]).default("none"),
  financierName: z.string().optional(),
});

/** Sales-partner / banca attribution, passed through verbatim to the vendor. */
export const SpDetailSchema = z.object({
  spCode: z.string().optional(),
  customerReferenceNumber: z.string().optional(),
  channelName: z.string().optional(),
  primaryRmCode: z.string().optional(),
  secondaryRmCode: z.string().optional(),
  banca1: z.string().optional(),
  banca2: z.string().optional(),
  banca3: z.string().optional(),
});

export const MotorFullQuoteRequestSchema = MotorQuoteRequestSchema.extend({
  quoteId: z.string().min(1),
  proposer: ProposerSchema,
  address: AddressSchema,
  vehicle: VehicleIdentitySchema,
  nomineeRelation: z.string().optional(),
  nomineeName: z.string().optional(),
  nomineeAge: z.coerce.number().int().positive().optional(),
  kycRefId: z.string().optional(),
  ckyc: z.string().optional(),

  // Optional, provider-agnostic proposal/payment fields (vendors that don't
  // use them simply ignore them). Driven by ICICI's proposal contract.
  amountCollected: z.coerce.number().nonnegative().optional(),
  paymentTransactionId: z.string().optional(),
  successUrl: z.string().url().optional(),
  failureUrl: z.string().url().optional(),
  isProposalOnly: z.boolean().default(false),
  isVehicleUnderLoan: z.boolean().default(false),
  financierName: z.string().optional(),
  odometerReading: z.coerce.number().nonnegative().optional(),
  odometerCaptureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  spDetail: SpDetailSchema.optional(),
});

export type MotorFullQuoteRequest = z.infer<typeof MotorFullQuoteRequestSchema>;

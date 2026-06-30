import { z } from "zod";

// MONEY UNITS: every monetary field below (premiums, IDV, tax, discounts) is in
// WHOLE RUPEES (INR) — not paise. Providers, persistence, the FG payment gateway, and
// the frontend all use rupees end-to-end.

// ─── Canonical Quote Result — mirrors live Zuno response shape ─────────────────

export const AddonPremiumSchema = z.object({
  zeroDep: z.number().nonnegative().optional(),
  engineProtect: z.number().nonnegative().optional(),
  rsa: z.number().nonnegative().optional(),
  tyreProtect: z.number().nonnegative().optional(),
  rimProtect: z.number().nonnegative().optional(),
  rti: z.number().nonnegative().optional(),
  consumables: z.number().nonnegative().optional(),
  keyProtect: z.number().nonnegative().optional(),
  garageCash: z.number().nonnegative().optional(),
  lossOfBelongings: z.number().nonnegative().optional(),
  batteryProtect: z.number().nonnegative().optional(),
  drivingAccessories: z.number().nonnegative().optional(),
  ncbProtection: z.number().nonnegative().optional(),
  paOwner: z.number().nonnegative().optional(),
  paUnnamedPassenger: z.number().nonnegative().optional(),
  paNamedPassenger: z.number().nonnegative().optional(),
  legalLiabilityPaidDriver: z.number().nonnegative().optional(),
});

export const DiscountSchema = z.object({
  ncbPercent: z.number().nonnegative().optional(),
  ncbAmount: z.number().nonnegative().optional(),
  aaaMembership: z.number().nonnegative().optional(),
  antiTheft: z.number().nonnegative().optional(),
  voluntaryDeductible: z.number().nonnegative().optional(),
  ownDamageDiscount: z.number().nonnegative().optional(),
  payU: z.number().nonnegative().optional(),
});

export const CanonicalQuoteResultSchema = z.object({
  // Identity
  quoteNo: z.string(),
  /** Vendor transaction id that keys downstream calls (== quoteNo for ICICI). */
  transactionId: z.string().optional(),
  requestId: z.string(),
  providerSlug: z.string(),
  insurerId: z.string().optional(),
  insurerName: z.string().optional(),
  insurerLogoUrl: z.string().optional(),

  // Policy
  policyType: z.string(),
  vehicleCategory: z.string(),
  idvValue: z.number().min(0),
  minIdv: z.number().min(0).optional(),
  maxIdv: z.number().min(0).optional(),
  policyStartDate: z.string().optional(),
  policyEndDate: z.string().optional(),
  isInspectionRequired: z.boolean().optional(),

  // Premium breakdown
  basicOdPremium: z.number().min(0),
  thirdPartyPremium: z.number().min(0),
  addonPremiums: AddonPremiumSchema,
  discounts: DiscountSchema,
  totalAddonPremium: z.number().min(0),
  totalDiscount: z.number().min(0),
  netPremium: z.number().min(0),
  serviceTaxPercent: z.number().min(0).default(18),
  serviceTaxAmount: z.number().min(0),
  grossPremium: z.number().min(0),

  // Contract metadata (populated by full-quote)
  policyNumber: z.string().optional(),
  paymentUrl: z.string().optional(),
  contractDetails: z.record(z.string(), z.unknown()).optional(),

  // Raw provider response stored for audit (never exposed to client in prod)
  _rawResponse: z.unknown().optional(),
});

export type CanonicalQuoteResult = z.infer<typeof CanonicalQuoteResultSchema>;

// ─── API Response envelope — mirrors Zuno's HTTP envelope ─────────────────────

export function successEnvelope<T>(
  data: T,
  requestId: string,
  debugPayload?: unknown,
  enableDebug = false,
) {
  return {
    status: "success" as const,
    message: "Quote fetched successfully",
    requestId,
    response: data,
    ...(enableDebug && debugPayload !== undefined ? { payload: debugPayload } : {}),
  };
}

export function errorEnvelope(
  message: string,
  requestId: string,
  code: string,
  details?: unknown,
  httpStatus = 500,
) {
  return {
    status: "error" as const,
    message,
    requestId,
    http_status: httpStatus,
    error: { code, details },
  };
}

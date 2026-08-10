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

  // Commercial-vehicle attributes (only meaningful for commercial/newCommercial).
  // Optional so 4W/2W journeys and existing providers (icici) are unaffected.
  commercialSubType: z.enum(["goods", "passenger"]).optional(),
  grossVehicleWeight: z.coerce.number().positive().optional(),
  carryingCapacity: z.coerce.number().positive().optional(),
  /**
   * Commercial vehicle product class (ICICI CV: PCV / GCV / MISC). When omitted it
   * is derived from commercialSubType (passenger→pcv, goods→gcv); set explicitly to
   * select the MISC (miscellaneous/special) product line.
   */
  commercialVehicleClass: z.enum(["pcv", "gcv", "misc"]).optional(),
  /** Include IMT-23 endorsement (ICICI CV Save-Quote IsInclusionOfIMT). */
  isInclusionOfIMT: z.boolean().optional(),

  // Registration
  rtoCode: z.string().min(1),
  registrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  registrationNumber: z.string().optional(),
  vehicleAge: z.coerce.number().int().nonnegative().optional(),

  /**
   * The customer is buying the vehicle SECOND-HAND and taking fresh cover on it,
   * rather than renewing or rolling over cover they already hold. A distinct
   * market transaction: ownership transfers, so the seller's no-claim bonus does
   * not follow the car and the insurer inspects before putting it on risk.
   *
   * Deliberately a separate optional flag rather than a fourth `BusinessType`
   * member. `businessType` is a REQUIRED field that FG, ICICI and ITGI all branch
   * on directly (and ICICI passes through to its own product resolver), so
   * widening that union would change what those three vendors are sent for a
   * value they have no concept of. An optional, default-false flag they never
   * read leaves them byte-identical. If every provider ever grows a used-vehicle
   * path, folding this back into `businessType` is the tidier end state.
   *
   * Consumed today only by HDFC ERGO, which has a distinct "Used Car"
   * BusinessType_Mandatary with its own Req_PvtCar / Policy_Details templates.
   *
   * Bare `.optional()`, not `.default(false)`: a default would make the key
   * required in the inferred type and the generated OpenAPI schema, which is the
   * opposite of leaving existing callers alone. Absent means "not a used-car
   * purchase".
   */
  isUsedVehiclePurchase: z.boolean().optional(),

  // Previous policy (rollover/renewal)
  previousPolicyNumber: z.string().optional(),
  previousInsurerId: z.string().optional(),
  previousInsurerName: z.string().optional(),
  previousPolicyStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  previousPolicyExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isPreviousPolicyExpired: z.boolean().default(false),
  previousPolicyType: PolicyTypeSchema.optional(),

  // Previous third-party policy details (required by FG for standalone OD).
  previousTpPolicyNumber: z.string().optional(),
  previousTpStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  previousTpExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  // NCB
  claimInPreviousPolicy: z.boolean().default(false),
  ncbPercent: z.coerce.number().int().min(0).max(50).default(0),

  // New policy dates
  policyStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  policyEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  /**
   * Policy tenure in YEARS — the length of the cover being bought, not of the
   * expiring one. Optional and defaulted to 1 so every existing caller and
   * provider is unchanged: FG, ICICI and ITGI ignore it entirely and keep
   * issuing annual policies.
   *
   * The Indian market writes a motor term as "OD + TP" (1+1, 1+3, 3+3, 0+3…).
   * This field is the OWN-DAMAGE leg for a package or standalone-OD policy, and
   * the THIRD-PARTY leg for a liability-only policy — i.e. whichever leg the
   * chosen `selectedPolicy` actually rates. The other leg is not a free
   * variable in any vendor contract we hold: it follows from the business type
   * (a new private car is sold with a statutory 3-year TP leg, a rollover with
   * a 1-year one). Consumed today only by HDFC ERGO (POLICY_TENURE).
   *
   * `.default(1).optional()` (rather than a bare `.default(1)`) is deliberate:
   * the default still fires when the key is absent from a parsed request, but
   * the INFERRED type stays `number | undefined`, so the dozens of existing
   * MotorQuoteRequest object literals across the FG / ICICI / ITGI tests and
   * probe scripts keep compiling untouched. Read it as `req.tenureYears ?? 1`.
   */
  tenureYears: z.coerce.number().int().min(1).max(5).default(1).optional(),

  // Addons
  zeroDep: z.boolean().default(false),
  engineProtect: z.boolean().default(false),
  rsa: z.boolean().default(false),
  /**
   * The wider/worldwide roadside-assistance tier (see AddonKeySchema). FG, ICICI
   * and ITGI sell a single RSA product and ignore it.
   *
   * A bare `.optional()` rather than the `.default(false)` the add-ons above
   * carry, matching `hasAntiTheftDevice` and `previousPolicyHasZdCover` further
   * down. A default would make the key REQUIRED in the inferred type and in the
   * generated OpenAPI schema, forcing every existing MotorQuoteRequest literal
   * across the FG / ICICI / ITGI tests, the probe scripts and tf-web to name it.
   * Absent means off; read it as `Boolean(req.rsaWorldwide)`.
   */
  rsaWorldwide: z.boolean().optional(),
  /**
   * EMI protector. Rated on `emiAmount`, not at a flat rate — HDFC UAT refuses
   * the whole payload ("EMI Protector Plus - Add on system rate is not
   * available") when the cover is on and the amount is 0, so its mapper drops
   * the cover rather than sending a request the vendor cannot price.
   * Optional for the same reason as `rsaWorldwide` above.
   */
  emiProtect: z.boolean().optional(),
  tyreProtect: z.boolean().default(false),
  rimProtect: z.boolean().default(false),
  rti: z.boolean().default(false),
  consumables: z.boolean().default(false),
  paOwner: z.boolean().default(true),
  paUnnamedPassenger: z.boolean().default(false),
  legalLiabilityPaidDriver: z.boolean().default(false),
  // Additional boolean covers (wired for ICICI; FG ignores per its capability matrix).
  keyProtect: z.boolean().default(false),
  garageCash: z.boolean().default(false),
  lossOfBelongings: z.boolean().default(false),
  batteryProtect: z.boolean().default(false),
  drivingAccessories: z.boolean().default(false),
  ncbProtection: z.boolean().default(false),

  // Provider-specific add-on cover codes chosen from a vendor's own catalog
  // (e.g. FG's master "Add On Covers"). Passed through verbatim to that vendor;
  // providers that use the canonical boolean flags above simply ignore this.
  providerAddonCodes: z.array(z.string().min(1)).optional(),

  // ── Optional, provider-agnostic cover/discount inputs ───────────────────────
  // All optional + default-off so existing callers and providers that don't honour
  // them are unaffected. Currently consumed by ICICI Lombard (see its mapper).
  /** Voluntary deductible amount (ICICI: AddOns VD-2500 / VD-5000). */
  voluntaryDeductible: z.coerce.number().int().nonnegative().optional(),
  /** PA cover sum-insured (ICICI: UnNamedPaCover / NamedPaCover). */
  unnamedPaSumInsured: z.coerce.number().nonnegative().optional(),
  namedPaSumInsured: z.coerce.number().nonnegative().optional(),
  /** External bi-fuel (CNG/LPG) kit (ICICI: GasKitType / GasKitSI). */
  bifuelKitType: z.enum(["NA", "CNG", "LPG", "FactoryFittedCNG", "FactoryFittedLPG"]).optional(),
  bifuelKitSI: z.coerce.number().nonnegative().optional(),
  /** Electrical / non-electrical accessory sum-insured. */
  electricalAccessoriesSI: z.coerce.number().nonnegative().optional(),
  nonElectricalAccessoriesSI: z.coerce.number().nonnegative().optional(),
  /** Anti-theft device + AAA membership discounts. */
  hasAntiTheftDevice: z.boolean().optional(),
  automobileAssociationMembership: z.string().optional(),
  /** PayU / CIBIL discount drivers (CIBIL needs name + PAN). */
  hasPayU: z.boolean().optional(),
  payURange: z.coerce.number().int().nonnegative().optional(),
  hasCibil: z.boolean().optional(),
  panNumber: z.string().optional(),
  proposerName: z.string().optional(),
  /** 2W cover sum-insured (ICICI: DrivingAccessoriesSI / KeyProtectSI). */
  drivingAccessoriesSI: z.coerce.number().nonnegative().optional(),
  keyProtectSI: z.coerce.number().nonnegative().optional(),
  /**
   * Sum insured for the `lossOfBelongings` cover (HDFC:
   * Req_PvtCar.LossOfPersonalBelonging_SI). Optional with NO default, like every
   * other `*SI` field here, so providers that rate the cover as a flat boolean
   * are untouched. HDFC rates it on this amount and charges nothing without one,
   * so its mapper substitutes the vendor's own sample value when it is absent.
   */
  lossOfBelongingsSI: z.coerce.number().nonnegative().optional(),
  /**
   * The monthly loan instalment the `emiProtect` cover is bought against, in
   * whole rupees. Optional with no default, like every other amount here.
   *
   * HDFC rates the cover as a straight percentage of it — live on UAT a Swift
   * with `EMIAmount: 15000` returns `EMI_PROTECTOR_PREMIUM: 600` at
   * `EMI_PROTECTOR_PREMIUM_Rate: 0.04` — and refuses the payload outright when
   * the cover is on with a zero amount, so there is nothing sensible to invent
   * here and no vendor sample to copy: HDFC's own collection never turns the
   * cover on. Without an amount the cover simply is not requested.
   */
  emiAmount: z.coerce.number().nonnegative().optional(),
  /** Driver / employee counts (commercial-ish; ICICI optional). */
  numberOfDrivers: z.coerce.number().int().nonnegative().optional(),
  numberOfEmployees: z.coerce.number().int().nonnegative().optional(),
  /** Owner pincode for the quote (ICICI Save-Quote Pincode). */
  pincode: z.string().regex(/^\d{6}$/).optional(),
  /** Previous policy carried a Zero-Dep cover (ICICI PreviousPolicyHasZdCover). */
  previousPolicyHasZdCover: z.boolean().optional(),
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

  /**
   * Whether the policyholder is a natural person or a company. Provider-agnostic:
   * every motor insurer distinguishes the two (different KYC, different GST
   * treatment, no owner-driver PA for a company that cannot drive).
   *
   * Optional, and absent means "individual", so nothing existing changes.
   * Consumed today by HDFC ERGO, whose Customer_Details block already carries the
   * `Customer_Type` and `Company_Name` keys — no key-set change is involved,
   * only the values. `companyName` is what HDFC wants when the type is
   * corporate; `gstin` fills its `Customer_GSTIN_Number`.
   */
  customerType: z.enum(["individual", "corporate"]).optional(),
  companyName: z.string().optional(),
  gstin: z.string().optional(),

  // Pre-inspection evidence for break-in scenarios (FG rejects a break-in
  // proposal without it). Populated from the completed LiveChek inspection
  // (or a vendor-issued report reference during UAT).
  inspectionReportNumber: z.string().optional(),
  inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  /**
   * The OD special-discount percentage the vendor applied at quote
   * (CanonicalQuoteResult.odDiscountPercent). FG re-rates the proposal WITHOUT
   * the discount unless it is echoed back in CreateProposal.
   */
  odDiscountPercent: z.coerce.number().min(0).max(100).optional(),

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

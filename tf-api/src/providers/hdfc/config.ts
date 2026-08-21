import { env } from "@/config/env.ts";
import { WEB_BASE_URL } from "@/config/app-urls.ts";
import type {
  VehicleCategory,
  ProviderOperation,
  PolicyType,
  AddonKey,
  MotorCapabilities,
} from "@/contracts/enums.ts";

export const HDFC_SLUG = "hdfc";
export const HDFC_DISPLAY_NAME = "HDFC ERGO";

// ─── Vendor settings (was .env — only the credentials stayed there) ───────────

/** Registers the HDFC provider at startup. */
export const HDFC_ENABLED = true;

/**
 * HEI motor service (JSON) + Pehchaan e-KYC (separate host, separate JWT).
 * ⚠️ UAT hosts — confirm the production HEI and Pehchaan bases with HDFC ERGO
 * before go-live.
 */
export const HDFC_GATEWAY = {
  baseUrl: "https://accessuat.hdfcergo.com/cp/integration/heiintegrationservice/integration/",
  /** Channel identity issued to us by HDFC. */
  source: "NOVACRED",
  channelId: "NOVA0001",
  /** Private Car product code; the kit ships no other line. */
  productPvtCar: "2311",
  /** Token lifetime in seconds. HDFC returns no expiry — value unconfirmed. */
  tokenTtlSeconds: 1500,
  kycBaseUrl: "https://ekyc-uat.hdfcergo.com/e-kyc",
  kycTokenTtlSeconds: 480,
  /**
   * Absolute URL Pehchaan returns the browser to after its hosted journey. It
   * arrives with ?kycId=<id>, which the client feeds back as
   * CkycRequest.ckycNumber to complete the lookup. Only needed for the hosted
   * fallback: on UAT, /primary/kyc-verified verifies headlessly and returns no
   * redirect (2026-08-13).
   */
  kycReturnUrl: `${WEB_BASE_URL}/hdfc/kyc/return`,
} as const;

/**
 * Private Car only (PRODUCT_CODE 2311). The vendor kit ships no two-wheeler or
 * commercial Postman collection, product code or master data, so advertising
 * those categories would make every such request fail at the vendor.
 */
export const HDFC_CAPABILITIES: ReadonlySet<VehicleCategory> = new Set<VehicleCategory>([
  "fourWheeler",
  "newVehicle",
]);

/**
 * Four operations are deliberately absent because HDFC exposes no endpoint:
 *
 * - `retrieveQuote` — no get-quote-by-id call; premium is recomputed each time.
 * - `policyStatus`  — nothing in the kit.
 * - `inspection`    — break-in is triggered automatically at HDFC's end
 *                     (PVTcarTestScenarios.xls: "Proposal should be triggered
 *                     for Inspection"), same as ITGI. Nothing to call.
 * - `ovd`           — the Pehchaan kit has no document-upload API; documents are
 *                     captured inside HDFC's own hosted journey.
 */
export const HDFC_OPERATIONS: ReadonlySet<ProviderOperation> = new Set<ProviderOperation>([
  "quote",
  "proposal",
  "ckyc",
  // Pehchaan ships a separate corporate kit (/partner/corporate/kyc), so HDFC is
  // the one provider that can take an entity-shaped CKYC request. FG/ICICI/ITGI
  // do individuals only and deliberately stay off this list.
  "corporateCkyc",
  "issuance",
  "renewal",
  "coi",
]);

/** HDFC POLICY_TYPE vocabulary (exact strings from the Postman collection). */
export const HDFC_POLICY_TYPE = {
  comprehensive: "OD Plus TP",
  thirdParty: "TP Only",
  standAloneOD: "OD Only",
} as const;

export type HdfcPolicyTypeValue = (typeof HDFC_POLICY_TYPE)[keyof typeof HDFC_POLICY_TYPE];

export function hdfcPolicyType(policyType: PolicyType): HdfcPolicyTypeValue {
  return HDFC_POLICY_TYPE[policyType];
}

/**
 * HDFC's RELATION MASTER — the only values `Owner_Driver_Nominee_Relationship`
 * accepts, in the exact casing of `PrivateCarMasterData.xls`, sheet
 * "RELATION MASTER".
 *
 * HDFC matches this field against the master CASE-SENSITIVELY. A live
 * CreateProposal carrying the canonical `nomineeRelation: "spouse"` was rejected
 * outright with "Please pass Nominee relationship as per the shared master!",
 * even though "Spouse" is in the list.
 *
 * "Police Holder" is reproduced verbatim: it is evidently HDFC's typo for
 * "Policy Holder", but it is what their master contains, so it is what the
 * payload must carry.
 */
export const HDFC_RELATION_MASTER = [
  "Brother",
  "Child",
  "Daughter",
  "Employee",
  "Father",
  "Father in law",
  "Grand Daughter",
  "Grand Father",
  "Grand Mother",
  "Grand Son",
  "Husband",
  "Mother",
  "Mother in law",
  "Partner",
  "Police Holder",
  "Sister",
  "Son",
  "Special concession adult",
  "Special concession child",
  "Wife",
  "Nephew",
  "Niece",
  "Uncle",
  "Spouse",
] as const;

/**
 * Lookup key → the master's own spelling, plus the extra spellings that resolve
 * onto a master value.
 *
 * HDFC's master misspells the policyholder as "Police Holder". The two aliases
 * below exist so a caller who spells it correctly — which any sane UI will —
 * still resolves to the value HDFC will accept, instead of being rejected for
 * sending the right word.
 *
 * A Map, not an object literal, and one Map rather than a master table plus an
 * alias table. `nomineeRelation` is free text off a web form, and an object
 * literal resolves INHERITED keys: `aliases["constructor"]` returned the `Object`
 * function — truthy, so the pass-through fallback never fired, and TypeScript
 * still believed the result was a string. JSON.stringify drops a function value,
 * which deleted Owner_Driver_Nominee_Relationship from Req_PvtCar altogether —
 * exactly the key-set change HDFC's Blaze engine rejects. `__proto__` was worse
 * still: an object where a string is required.
 */
const HDFC_RELATION_BY_KEY: ReadonlyMap<string, string> = new Map<string, string>([
  ...HDFC_RELATION_MASTER.map((value): [string, string] => [relationKey(value), value]),
  ["policy holder", "Police Holder"],
  ["policyholder", "Police Holder"],
]);

/** Case-, spacing- and padding-insensitive lookup key. */
function relationKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Canonical free-text nominee relation → HDFC's RELATION MASTER value.
 *
 * The canonical `nomineeRelation` is deliberately `z.string()` and shared with
 * FG, ICICI and ITGI, so the correction belongs to this adapter rather than to
 * the contract.
 *
 * An unrecognised relation is passed through on purpose — trimmed, but otherwise
 * exactly as the caller spelled it. We do not substitute a guess: HDFC's own
 * error message ("Please pass Nominee relationship as per the shared master!")
 * is clearer than us silently nominating the wrong relative on a customer's
 * policy.
 */
export function hdfcNomineeRelation(relation: string | null | undefined): string | null {
  if (!relation) return null;
  const key = relationKey(relation);
  if (!key) return null;
  return HDFC_RELATION_BY_KEY.get(key) ?? relation.trim();
}

/** HDFC business-type vocabulary (BusinessType_Mandatary). */
export const HDFC_BUSINESS_TYPE = {
  new: "New Vehicle",
  rollover: "Roll Over",
  used: "Used Car",
} as const;

export type HdfcBusinessType = (typeof HDFC_BUSINESS_TYPE)[keyof typeof HDFC_BUSINESS_TYPE];

/** The eight HEI operations. Identical across products; only PRODUCT_CODE varies. */
export const HDFC_ENDPOINTS = {
  authenticate: "authenticate",
  getCalculateIDV: "getcalculateidv",
  calculatePremium: "calculatepremium",
  createProposal: "createproposal",
  getProposalDocument: "getproposaldocument",
  submitPaymentDetails: "submitpaymentdetails",
  getPolicyDocument: "getpolicydocument",
  renewalExtract: "getpolicydataforrenewal",
} as const;

export type HdfcEndpointName = keyof typeof HDFC_ENDPOINTS;

/**
 * Canonical add-on flags HDFC honours, each backed by a Req_PvtCar cover field.
 * HDFC has no rimProtect / keyProtect / drivingAccessories.
 */
const PRIVATE_CAR_ADDONS: AddonKey[] = [
  "zeroDep",
  "tyreProtect",
  "ncbProtection",
  "rti",
  "consumables",
  "engineProtect",
  "rsa",
  "rsaWorldwide",
  /**
   * `IsLossofUseDownTimeProt_Cover`. HDFC's name for the cover is "Loss of Use or
   * Down Time Protection" and the canonical name for the same benefit — a payout
   * while the vehicle is off the road being repaired — is Garage Cash, which the
   * contract already carries for ICICI Lombard. Reusing the existing key rather
   * than inventing an HDFC-shaped one keeps the compare card honest: the two
   * vendors are quoting the same thing under different brand names.
   *
   * Live on UAT (1-year Swift, IDV ₹559,200): `Loss_of_Use_Premium: 559` at
   * `Loss_of_Use_Premium_Rate: 0.001`. HDFC's own New Business proposal sample
   * (`fixtures/collection/new-proposal.json`) ships the flag on.
   */
  "garageCash",
  "emiProtect",
  "lossOfBelongings",
  "paOwner",
  "paUnnamedPassenger",
  "legalLiabilityPaidDriver",
  "batteryProtect",
];

/**
 * HDFC's named add-on PLANS.
 *
 * A "plan type" is not a rating input — it is a NAMED BUNDLE OF MANDATORY ADD-ON
 * COVERS, i.e. merchandising. Three independent pieces of vendor evidence say so
 * and they agree exactly:
 *
 *  1. `PrivateCarMasterData.xls`, sheet "PlanTypes": each plan is listed as a
 *     plan name, a set of "Mandatory add on cover" rows and a validity band.
 *  2. Live `GetCalculateIDV` returns `addonPlansToCoversMapping` — the same plans
 *     as `coverGroup` codes, each with `isMandatory` and a per-vehicle
 *     `isEligibile`. The codes decode against the CalculatePremium response's own
 *     rate fields on the very same vehicle: on a 1-year Swift, G0034 carries
 *     `computedRate` 0.004 = `Vehicle_Base_ZD_Premium_Rate`, G0023 0.0011 =
 *     `..._NCB_..._Rate`, G0014 0.0014 = `..._ENG_..._Rate`, G0007 0.001 =
 *     `..._COC_..._Rate`, G0009 = `EA_premium` ₹50 and G0011 = `EAW_premium`
 *     ₹499. Every plan's decoded cover list matches its PlanTypes row.
 *  3. The plan NAME itself is inert. Live on UAT, sending `PlanType` as "Gold",
 *     "Silver", "Diamond", "Platinum", "Titanium", "Menu Card Approach" and the
 *     invented "NONSENSE-XYZ" all returned an identical gross premium (₹8,354),
 *     because the premium comes from the individual `Is*_Cover` flags.
 *
 * So a plan IS expressible, and it is expressible through the canonical add-on
 * flags rather than through a new canonical "plan" concept — "Titanium" is HDFC
 * branding, not an insurance term. It is selected through the existing
 * `MotorQuoteRequest.providerAddonCodes` passthrough, which exists for exactly
 * this: codes chosen from one vendor's own catalog.
 *
 * `isEligibile` is real, not decorative: on a 1-year-old Swift the two
 * "Essential" plans come back `false` and the other four `true`, and on a
 * 6-year-old Swift the Essentials flip to `true` — matching the master's own
 * Validity column ("upto 5 years" vs "5 to 10 years with NCB %").
 *
 * GOLD IS DELIBERATELY ABSENT. It appears in the live mapping but NOT in HDFC's
 * own PlanTypes sheet; it is `isEligibile: false` on every vehicle probed; and
 * the second of its two cover groups (N161521G0020) decodes to no cover we can
 * name from any source we hold. Guessing it would put a cover on a customer's
 * policy that nobody can identify.
 */
export interface HdfcPlan {
  /** The exact string HDFC's own addonPlansToCoversMapping uses. */
  planType: string;
  /** Canonical add-on flags the plan makes mandatory. */
  covers: AddonKey[];
}

export const HDFC_PLANS: Readonly<Record<string, HdfcPlan>> = {
  silver: { planType: "Silver Plan", covers: ["zeroDep"] },
  platinum: {
    planType: "Platinum Plan",
    covers: ["zeroDep", "ncbProtection", "engineProtect"],
  },
  titanium: {
    planType: "Titanium Plan",
    covers: ["zeroDep", "ncbProtection", "engineProtect", "consumables"],
  },
  diamond: { planType: "Diamond Plan", covers: ["zeroDep", "consumables"] },
  essentialzd: {
    planType: "Essential ZD Plan",
    covers: ["zeroDep", "rsa", "rsaWorldwide", "lossOfBelongings"],
  },
  essentialegp: {
    planType: "Essential EGP Plan",
    covers: ["zeroDep", "engineProtect", "rsa", "rsaWorldwide", "lossOfBelongings"],
  },
  /**
   * "Menu Card Approach" is the pack's name for the ABSENCE of a plan — the
   * customer picks covers one at a time. Recognised (rather than ignored) so a
   * caller who names it gets HDFC's own label on the payload and its own covers
   * honoured, which is exactly what the integration already does by default.
   */
  menucard: { planType: "Menu Card Approach", covers: [] },
};

/**
 * HDFC-only add-on codes carried through `providerAddonCodes`. These have no
 * canonical peer: no other vendor we integrate sells them, and inventing a
 * canonical flag for a cover HDFC's own sandbox cannot price would put an
 * unratable option on the compare card.
 */
export const HDFC_PROVIDER_ADDON_CODES = {
  /**
   * `IsHighProtection_Cover` — "Higher Protection and Removal Costs", an
   * increased towing/removal limit. Expressible but UNRATED on UAT: HDFC answers
   * "Higher Protection and Removal Costs - Add on system rate is not available"
   * at every `HigherTowingLimit` tried (null, 1, 2, 3, 25000, 50000), so the
   * limit is not the missing input — the rate row simply is not there.
   */
  highProtection: "HIGH_PROTECTION",
} as const;

/**
 * Normalises a plan name to a `HDFC_PLANS` key. HDFC spells the same plan three
 * ways across its own artefacts — "Platinum Plan" in the live mapping,
 * "Platinum plan" in the master workbook, "Platinum" in the scenario sheet — so
 * case, spacing and the trailing words "plan" / "approach" are all stripped.
 */
export function hdfcPlanFor(code: string): HdfcPlan | undefined {
  const key = code
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/(plan|approach)$/, "");
  return HDFC_PLANS[key];
}

/**
 * The Req_PvtCar `NoOfEmi` sent with the EMI Protector cover.
 *
 * HDFC UAT rates exactly one instalment count. Live: `NoOfEmi: 3` with
 * `EMIAmount: 15000` prices at ₹600; the identical request with `NoOfEmi: 6`
 * is refused with "EMI Protector Plus - Add on system rate is not available".
 */
export const HDFC_EMI_INSTALMENTS = 3;

/**
 * The Req_PvtCar `EMIPlanType` sent with the EMI Protector cover.
 *
 * The cover CANNOT be bought without it — proven live: `IsEMIProtector_Cover: 1`
 * with a valid `NoOfEmi`/`EMIAmount` but no `EMIPlanType` is refused, and adding
 * `EMIPlanType: "A"` to the very same payload prices it. "A" rates at 4% of the
 * instalment and "B" at 8%; "C" has no rate. "A" is the base tier, so it is what
 * a customer who simply asked for EMI protection gets. What separates A from B
 * is not documented anywhere in the kit — an open confirmation.
 */
export const HDFC_EMI_PLAN_TYPE = "A";

export const HDFC_MOTOR_CAPABILITIES: MotorCapabilities = {
  fourWheeler: {
    policyTypes: ["comprehensive", "thirdParty", "standAloneOD"],
    addons: PRIVATE_CAR_ADDONS,
  },
  // A brand-new vehicle is always sold as a package; the collection's New
  // Business folder has no TP-only or SA-OD variant.
  newVehicle: {
    policyTypes: ["comprehensive"],
    addons: PRIVATE_CAR_ADDONS,
  },
};

export interface HdfcConfig {
  baseUrl: string;
  source: string;
  channelId: string;
  credential: string;
  productCode: string;
  tokenTtlSeconds: number;
  kyc: {
    baseUrl: string;
    apiKey: string;
    tokenTtlSeconds: number;
    returnUrl: string;
  };
}

/**
 * Builds the HDFC config from the constants above plus the credentials in env.
 * Throws only when HDFC is enabled but its credential is missing; fixture-driven
 * tests construct a config literal and never call this.
 */
export function loadHdfcConfig(): HdfcConfig {
  if (!env.HDFC_CREDENTIAL) {
    throw new Error("HDFC provider enabled but missing env: HDFC_CREDENTIAL");
  }
  return {
    baseUrl: HDFC_GATEWAY.baseUrl.replace(/\/?$/, "/"),
    source: HDFC_GATEWAY.source,
    channelId: HDFC_GATEWAY.channelId,
    credential: env.HDFC_CREDENTIAL,
    productCode: HDFC_GATEWAY.productPvtCar,
    tokenTtlSeconds: HDFC_GATEWAY.tokenTtlSeconds,
    kyc: {
      baseUrl: HDFC_GATEWAY.kycBaseUrl.replace(/\/$/, ""),
      apiKey: env.HDFC_KYC_API_KEY ?? "",
      tokenTtlSeconds: HDFC_GATEWAY.kycTokenTtlSeconds,
      returnUrl: HDFC_GATEWAY.kycReturnUrl,
    },
  };
}

/** Absolute URL for an HEI operation. */
export function hdfcEndpointUrl(config: HdfcConfig, name: HdfcEndpointName): string {
  return config.baseUrl + HDFC_ENDPOINTS[name];
}

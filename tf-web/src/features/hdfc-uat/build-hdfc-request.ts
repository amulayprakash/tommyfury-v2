import type {
  AddonKey,
  CompareQuotesRequest,
  MotorFullQuoteRequest,
} from "../vehicle/api/types";
import { ALL_ADDON_KEYS } from "../vehicle/api/types";
import type { HdfcConditions, HdfcProposer } from "./hdfc-uat-store";

/**
 * The one provider this harness is allowed to talk to.
 *
 * Every request built in this file carries `providers: [HDFC_SLUG]`. That single
 * line is what makes `/hdfc` HDFC-only, and it is enforced HERE rather than in a
 * page so that no page — present or future — can forget it: a page that renders
 * whatever `useCompareQuotesQuery` returns cannot show an ICICI card if the
 * request never asked for ICICI.
 */
export const HDFC_SLUG = "hdfc";

/**
 * The compare request this harness sends.
 *
 * `includeRawExchange` is NOT on `CompareQuotesRequest` on this branch: the
 * contract field lands with the FG harness (`feat/fg-uat-journey`, which adds it
 * to `tf-api/src/contracts/quote-request.ts` and regenerates the bindings). The
 * backend's zod schemas are non-strict, so sending the flag before that merge is
 * inert — unknown keys are stripped, not rejected — and the raw-exchange drawer
 * starts filling the moment the two branches meet. Widening the type here says
 * exactly what we send, rather than casting the whole request and losing the
 * checking on every other field.
 */
export type HdfcQuoteRequest = CompareQuotesRequest & { includeRawExchange?: boolean };

/** The proposal request, same widening, for the same reason. */
export type HdfcFullQuoteRequest = MotorFullQuoteRequest & { includeRawExchange?: boolean };

/** Membership test over the canonical add-on keys. */
const CANONICAL_ADDONS = new Set<string>(ALL_ADDON_KEYS);

/**
 * The canonical quote request for one set of certification conditions.
 *
 * Mirrors the customer wizard's `buildQuoteRequest`, but pinned to HDFC and always
 * asking for the raw exchange. Fields the harness captures for LATER steps
 * (engine and chassis number) have no place on the quote contract and are carried
 * in the store until the proposal needs them.
 *
 * It lives outside the pages because the review step must send CreateProposal the
 * very conditions the quote was priced under — HDFC re-rates from what it
 * receives, so a second, hand-built copy of this that drifted would quietly change
 * the premium and be rejected at issuance for not matching the receipt.
 *
 * `addonCodes` is the tester's add-on selection and may hold two different kinds
 * of string. Unlike FG — which prices add-ons ONLY from its own cover codes, so
 * the FG harness forces every canonical flag off — HDFC honours the canonical
 * flags directly (`HDFC_MOTOR_CAPABILITIES` in `tf-api/src/providers/hdfc/config.ts`
 * lists them). So a selected entry that IS a canonical add-on key turns that flag
 * on, and anything else — HDFC's named plan bundles, "Silver Plan", "Diamond
 * Plan" and friends — goes through untouched as `providerAddonCodes`.
 */
export function buildHdfcQuoteRequest(
  category: string,
  c: HdfcConditions,
  addonCodes: string[],
): HdfcQuoteRequest {
  const selected = new Set(addonCodes);
  const addonFlags = Object.fromEntries(
    ALL_ADDON_KEYS.map((key) => [key, selected.has(key)]),
  ) as Record<AddonKey, boolean>;
  // Owner PA is compulsory by default and is suppressed only by the stated
  // condition (the CPA owner-driver exclusion case), so the condition wins over
  // whatever the add-on checkboxes say.
  addonFlags.paOwner = c.paOwner;

  const providerAddonCodes = addonCodes.filter((code) => !CANONICAL_ADDONS.has(code));

  return {
    vehicleType: category as CompareQuotesRequest["vehicleType"],
    selectedPolicy: c.planType as CompareQuotesRequest["selectedPolicy"],
    businessType: c.businessType,
    makeId: c.makeId,
    makeName: c.makeName,
    modelId: c.modelId,
    modelName: c.modelName,
    fuelType: c.fuelType as CompareQuotesRequest["fuelType"],
    // engineCC 0 (EVs) fails contract validation server-side — send it only when positive.
    engineCC: c.engineCC || undefined,
    rtoCode: c.rtoCode,
    registrationDate: c.registrationDate,
    registrationNumber: c.registrationNumber || undefined,
    // HDFC's Used Car product is a separate flag, not a business type.
    isUsedVehiclePurchase: c.isUsedVehiclePurchase,
    previousPolicyNumber: c.previousPolicyNumber || undefined,
    // Sent whenever it is set, not only for standalone OD. The canonical contract
    // has no separate TP-insurer field, so the backend mapper falls the TP insurer
    // back to this one; with neither supplied, HDFC refused a live SA_OD proposal
    // with "Valid TP policy is required to book SAOD Policy." (2026-08-13).
    previousInsurerId: c.previousInsurerId || undefined,
    previousInsurerName: c.previousInsurerName || undefined,
    previousPolicyStartDate: c.previousPolicyStartDate,
    previousPolicyExpiryDate: c.previousPolicyExpiryDate,
    isPreviousPolicyExpired: c.isPreviousPolicyExpired,
    claimInPreviousPolicy: c.claimInPreviousPolicy,
    ncbPercent: c.ncbPercent,
    // From the conditions, not pinned to 1 like FG's harness: HDFC sells long-term
    // new-business terms (the 1+3 scenario is one of the six bound on UAT).
    tenureYears: c.tenureYears,
    // HDFC needs an ACTIVE third-party policy for standalone OD; on any other plan
    // these fields are noise the vendor validates anyway, so they stay off.
    ...(c.planType === "standAloneOD"
      ? {
          previousTpPolicyNumber: c.previousTpPolicyNumber,
          previousTpStartDate: c.previousTpStartDate,
          previousTpExpiryDate: c.previousTpExpiryDate,
        }
      : {}),
    ...(c.idvValue ? { idvValue: c.idvValue } : {}),
    ...(c.electricalAccessoriesSI
      ? { electricalAccessoriesSI: c.electricalAccessoriesSI }
      : {}),
    ...(c.nonElectricalAccessoriesSI
      ? { nonElectricalAccessoriesSI: c.nonElectricalAccessoriesSI }
      : {}),
    ...(c.bifuelKitType
      ? { bifuelKitType: c.bifuelKitType as CompareQuotesRequest["bifuelKitType"] }
      : {}),
    ...(c.bifuelKitSI ? { bifuelKitSI: c.bifuelKitSI } : {}),
    ...(c.unnamedPaSumInsured ? { unnamedPaSumInsured: c.unnamedPaSumInsured } : {}),
    ...(providerAddonCodes.length ? { providerAddonCodes } : {}),
    // The backend echoes `_rawResponse` only when this is set AND
    // ENABLE_DEBUG_PAYLOAD is on in its env — an empty drawer means that env var.
    includeRawExchange: true,
    ...addonFlags,
    // LAST, and deliberately so: this is the provider lock, and nothing spread
    // after it could quietly widen the fan-out back to every enabled insurer.
    providers: [HDFC_SLUG],
  };
}

/**
 * What the proposal step knows that the quote step did not: which priced quote is
 * being bound, and which Pehchaan record vouches for the proposer.
 *
 * The plan calls this parameter `kyc`; it carries `quoteId` too because HDFC's
 * proposal is keyed off the quote it re-rates, and threading it separately would
 * mean a sixth positional argument no caller could read at a glance.
 */
export interface HdfcBinding {
  /** The priced quote's id — `transactionId` where the vendor gave one, else `quoteNo`. */
  quoteId: string;
  kycRefId?: string | null;
  ckyc?: string | null;
}

/**
 * The CreateProposal request: the very same priced conditions, plus the identity,
 * address, vehicle identifiers and KYC reference HDFC needs to bind.
 *
 * `providers` is dropped rather than carried: the full-quote call names its
 * provider in the URL (`POST /{provider}/motor/full-quote`), and the contract has
 * no such field, so leaving it in would be a key the backend silently strips.
 */
export function buildHdfcFullQuoteRequest(
  category: string,
  c: HdfcConditions,
  proposer: HdfcProposer,
  addonCodes: string[],
  kyc: HdfcBinding,
): HdfcFullQuoteRequest {
  const quote: Omit<HdfcQuoteRequest, "providers"> & { providers?: string[] } =
    buildHdfcQuoteRequest(category, c, addonCodes);
  delete quote.providers;

  return {
    ...quote,
    quoteId: kyc.quoteId,
    proposer: {
      firstName: proposer.firstName,
      lastName: proposer.lastName,
      email: proposer.email,
      mobile: proposer.mobile,
      dob: proposer.dob,
      gender: proposer.gender,
      ...(proposer.panNumber ? { panNumber: proposer.panNumber } : {}),
    },
    // AddressSchema's field names, not the vendor's: addressLine1/2, not line1/2.
    // A wrong key here type-checks nowhere near the vendor and would surface only
    // as an opaque HDFC rejection at CreateProposal.
    address: {
      addressLine1: proposer.addressLine1,
      addressLine2: proposer.addressLine2,
      pincode: proposer.pincode,
      city: proposer.city,
      state: proposer.state,
    },
    vehicle: {
      engineNumber: c.engineNumber,
      chassisNumber: c.chassisNumber,
      // The harness sells to an unencumbered owner; a financier would need its own
      // fields, and none of the six certification scenarios carries one.
      financeType: "none",
    },
    nomineeName: proposer.nomineeName,
    // HDFC matches this against its RELATION MASTER CASE-SENSITIVELY — a live
    // CreateProposal carrying "spouse" was rejected outright while "Spouse" bound.
    // The master is `HDFC_RELATION_MASTER` in tf-api/src/providers/hdfc/config.ts.
    nomineeRelation: proposer.nomineeRelation,
    nomineeAge: proposer.nomineeAge,
    ...(kyc.ckyc ? { ckyc: kyc.ckyc } : {}),
    ...(kyc.kycRefId ? { kycRefId: kyc.kycRefId } : {}),
    isProposalOnly: false,
    isVehicleUnderLoan: false,
  };
}

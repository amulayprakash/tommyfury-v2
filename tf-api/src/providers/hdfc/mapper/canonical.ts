import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { AddonKey } from "@/contracts/enums.ts";
import {
  hdfcPolicyType,
  hdfcPlanFor,
  hdfcNomineeRelation,
  HDFC_BUSINESS_TYPE,
  HDFC_POLICY_TYPE,
  HDFC_EMI_INSTALMENTS,
  HDFC_EMI_PLAN_TYPE,
  HDFC_PROVIDER_ADDON_CODES,
  type HdfcBusinessType,
} from "../config.ts";
import type {
  HdfcRequestShape,
  HdfcResolvedCodes,
  HdfcCustomer,
  HdfcFinancier,
} from "../types.ts";

/**
 * Canonical request → the intermediate shape the ported HDFC payload builders
 * consume. This is the ONLY new logic in the port; everything downstream is the
 * standalone module's UAT-verified code.
 */

/**
 * HDFC BusinessType_Mandatary. Mirrors FG's rule for what counts as new
 * business: either the explicit business type or the newVehicle category.
 *
 * "Used Car" is checked FIRST because it is the most specific signal a request
 * can carry: a second-hand purchase is neither a rollover of the buyer's own
 * cover nor a brand-new vehicle, whatever else the request says.
 */
export function resolveBusinessType(req: MotorQuoteRequest): HdfcBusinessType {
  if (req.isUsedVehiclePurchase) return HDFC_BUSINESS_TYPE.used;
  if (req.businessType === "new" || req.vehicleType === "newVehicle") {
    return HDFC_BUSINESS_TYPE.new;
  }
  const reg = req.registrationNumber?.trim();
  if (!reg || reg.toUpperCase() === "NEW") return HDFC_BUSINESS_TYPE.new;
  return HDFC_BUSINESS_TYPE.rollover;
}

/**
 * HDFC rejects a rollover whose previous policy has not already expired when the
 * new policy starts. When the customer's old policy is still running, shift the
 * start to the day after it ends rather than letting HDFC reject the quote.
 * Both arguments and the return value are ISO YYYY-MM-DD.
 */
export function applyRolloverDateSanity(
  startDate: string,
  previousExpiry: string | undefined,
): string {
  if (!previousExpiry) return startDate;
  const start = new Date(startDate);
  const prevEnd = new Date(previousExpiry);
  if (Number.isNaN(start.getTime()) || Number.isNaN(prevEnd.getTime())) return startDate;
  if (start > prevEnd) return startDate;
  // Advance in UTC. Date-only strings parse as UTC midnight, so mixing in the
  // local-time setDate/getDate pair would keep the wall clock across a DST
  // boundary and shift the resulting UTC calendar day by one — yielding a start
  // date on or before the previous expiry, which is the exact rejection this
  // function exists to prevent.
  const shifted = new Date(
    Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), prevEnd.getUTCDate() + 1),
  );
  return shifted.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Return-to-Invoice ceiling, from HDFC's own certification pack
 * (PVTcarTestScenarios.xls, "New and Rollover" rows 23–24): "RTI cover is valid
 * up to 3 year's for all product."
 *
 * HDFC's UAT rules engine enforces a LOOSER threshold than its own pack states —
 * it declines RTI from five years but happily prices it on a four-year-old car
 * (live, ₹1,049 on a 2022 Swift). The stated rule is the underwriting rule, so
 * it is ours to apply.
 */
export const HDFC_RTI_MAX_VEHICLE_AGE_YEARS = 3;

/**
 * Sum insured sent with the Loss of Personal Belongings cover when the caller
 * names none. HDFC rates that cover *on this number* — with the 0 we used to
 * send, `LossOfPersonalBelongings_Premium` came back 0 and the customer would
 * have bought a cover worth nothing. ₹50,000 is HDFC's own value: the only
 * request in the kit's Postman collection that switches the cover on
 * ("Comprehensive / New Business / OD Plus TP / 3 OD + 3 TP / 04 CreateProposal")
 * sends `LossOfPersonalBelonging_SI: 50000`.
 */
export const HDFC_DEFAULT_LOSS_OF_BELONGINGS_SI = 50_000;

/**
 * Is the vehicle older than `maxYears` at the moment cover starts?
 *
 * Cover start — not "today" — is the point an eligibility rule is judged at,
 * which matters for a rollover whose start has been pushed past the previous
 * policy's expiry.
 *
 * `MotorQuoteRequest` carries the age two ways. An explicit `vehicleAge` (whole
 * years) wins when the caller supplied one; otherwise the age is measured from
 * `registrationDate` in REAL CALENDAR years, by asking whether cover starts
 * after the vehicle's Nth registration anniversary. Whole-year subtraction and
 * 365-day arithmetic both get this wrong at the boundary: a car registered
 * 1,460 days ago is three years and 364 days old, which floors to 3 — and an
 * "up to 3 years" rule must still decline it.
 */
export function exceedsVehicleAge(
  req: MotorQuoteRequest,
  maxYears: number,
  coverStartDate: string,
): boolean {
  if (req.vehicleAge != null) return req.vehicleAge > maxYears;
  const registered = new Date(req.registrationDate);
  const starts = new Date(coverStartDate);
  if (Number.isNaN(registered.getTime()) || Number.isNaN(starts.getTime())) return false;
  const anniversary = Date.UTC(
    registered.getUTCFullYear() + maxYears,
    registered.getUTCMonth(),
    registered.getUTCDate(),
  );
  return starts.getTime() > anniversary;
}

/**
 * The chosen HDFC plan, and the add-on covers it makes mandatory.
 *
 * A plan is selected through `providerAddonCodes` — the canonical passthrough
 * for "codes chosen from a vendor's own catalog" — because a plan name is HDFC
 * branding, not an insurance concept: nothing about "Titanium" means anything to
 * another insurer. What the plan RESOLVES TO is provider-agnostic, and that is
 * what gets sent: the ordinary canonical cover flags. See HDFC_PLANS for the
 * three-way vendor evidence behind each plan's cover list.
 *
 * An unrecognised code is ignored rather than rejected, which is what the
 * passthrough's own contract promises ("passed through verbatim… providers that
 * use the canonical boolean flags simply ignore this"). "Gold Plan" lands here
 * deliberately — see HDFC_PLANS.
 */
export function resolvePlan(req: MotorQuoteRequest): {
  planType?: string;
  covers: ReadonlySet<AddonKey>;
} {
  for (const code of req.providerAddonCodes ?? []) {
    const plan = hdfcPlanFor(code);
    if (plan) return { planType: plan.planType, covers: new Set(plan.covers) };
  }
  return { covers: new Set<AddonKey>() };
}

/** True when the caller asked for an HDFC-only cover by its vendor code. */
function hasProviderCode(req: MotorQuoteRequest, code: string): boolean {
  return (req.providerAddonCodes ?? []).some((c) => c.trim().toUpperCase() === code);
}

/**
 * HDFC's Policy_Details hypothecation block.
 *
 * `AgreementType` is genuinely ours to fill and was not being filled: the
 * canonical `VehicleIdentitySchema.financeType` already states whether the
 * vehicle is hypothecated or leased, and HDFC's field wants exactly that.
 *
 * `FinancierCode` still cannot be: HDFC wants a numeric code from its own
 * `GENMST_FINANCIER` master (65k rows in `PrivateCarMasterData.xls`) while the
 * canonical request carries only a financier NAME, and there is no canonical
 * financier master to hang a `Provider*Code` cross-walk off — unlike insurers,
 * which have `InsurerMaster` + `ProviderInsurerCode`. Sending a guessed code is
 * worse than sending none, so `financierCode` stays null until that master
 * exists. `BranchName` likewise has no canonical source.
 */
function toFinancier(req: MotorQuoteRequest): HdfcFinancier | undefined {
  const full = req as Partial<MotorFullQuoteRequest>;
  const financeType = full.vehicle?.financeType;
  if (!financeType || financeType === "none") return undefined;
  return {
    agreementType: financeType === "lease" ? "Lease" : "Hypothecation",
    financierCode: undefined,
    branchName: undefined,
  };
}

/** Full-quote requests carry a proposer + address; plain quotes do not. */
function toCustomer(req: MotorQuoteRequest): HdfcCustomer | undefined {
  const full = req as Partial<MotorFullQuoteRequest>;
  if (!full.proposer) return undefined;
  const p = full.proposer;
  const a = full.address;
  const corporate = full.customerType === "corporate";
  return {
    // Customer_Details already carries Customer_Type and Company_Name, so a
    // corporate policyholder changes VALUES only — no key-set change, and none
    // of the golden proposal fixtures move.
    customerType: corporate ? "Corporate" : "Individual",
    companyName: full.companyName,
    gstin: full.gstin,
    firstName: p.firstName,
    lastName: p.lastName,
    dob: p.dob,
    email: p.email,
    mobile: p.mobile,
    panNo: p.panNumber,
    salutation: p.title?.toUpperCase() ?? "MR",
    gender: p.gender === "F" ? "FEMALE" : "MALE",
    permAddress1: a?.addressLine1,
    permAddress2: a?.addressLine2,
    permCityDistrict: a?.city,
    permState: a?.state,
    permPinCode: a?.pincode,
    pehchaanId: full.kycRefId ?? full.ckyc,
  };
}

export function toHdfcRequest(
  req: MotorQuoteRequest,
  codes: HdfcResolvedCodes,
  transactionId: string,
): HdfcRequestShape {
  const isElectric = req.fuelType === "electric";
  const startDate = applyRolloverDateSanity(
    req.policyStartDate ?? todayIso(),
    req.previousPolicyExpiryDate,
  );
  const full = req as Partial<MotorFullQuoteRequest>;
  const policyType = hdfcPolicyType(req.selectedPolicy);

  /**
   * A liability-only policy has no own-damage section, so nothing that rates off
   * the own-damage premium can attach to it. HDFC does NOT police this: asked for
   * "TP Only" with every cover selected it returns `Basic_OD_Premium: 0` and
   * still bills the own-damage add-ons — live on UAT, Zero Dep ₹2,855 / Tyre
   * Secure ₹1,328 / NCB Protect ₹730 / RTI ₹1,328 / Consumables ₹664 /
   * Engine-Gearbox ₹930 / Emergency Assistance ₹50 on a policy whose own-damage
   * premium is zero (PVTcarTestScenarios.xls "New and Rollover" rows 5 and 15).
   * Those are rupees a customer would be charged for cover the policy cannot
   * carry, so the eligibility is ours to enforce.
   *
   * WHICH covers are own-damage-side is settled by two pieces of vendor
   * evidence, not by taste:
   *
   *  - HDFC's own liability sample, `fixtures/collection/liability-premium.json`,
   *    sends every `Is*_Cover` flag as 0, both accessory IDVs as 0,
   *    `AntiTheftDiscFlag: false` and `Voluntary_Excess_Discount: 0` — while
   *    still sending `CPA_Tenure: 1`.
   *  - The same live UAT responses show HDFC pricing `UnnamedPerson_premium`
   *    (₹300 / ₹100) and `PaidDriver_Premium` (₹150 / ₹50) on those TP-only
   *    policies. Unnamed-passenger PA and legal liability to a paid driver are
   *    liability-section covers, so they survive — as do compulsory PA and the
   *    bi-fuel kit, which carries its own `BiFuel_Kit_TP_Premium`.
   */
  const liabilityOnly = policyType === HDFC_POLICY_TYPE.thirdParty;
  /**
   * The plan the customer chose, expanded to the covers it makes mandatory. A
   * plan is additive: it turns covers ON that the request did not name, and
   * never turns off one it did.
   */
  const plan = resolvePlan(req);
  /** An own-damage cover flag: forced off on a policy with no OD section. */
  const odCover = (selected: boolean | undefined, key?: AddonKey): boolean =>
    (Boolean(selected) || (key !== undefined && plan.covers.has(key))) && !liabilityOnly;
  /** An own-damage sum insured / discount amount: forced to 0 for the same reason. */
  const odAmount = (value: number | undefined): number => (liabilityOnly ? 0 : (value ?? 0));

  /**
   * Return to Invoice, gated on vehicle age per HDFC's pack. Own-damage-side
   * too — RTI tops an own-damage total loss up to the invoice price.
   */
  const rti =
    odCover(req.rti, "rti") && !exceedsVehicleAge(req, HDFC_RTI_MAX_VEHICLE_AGE_YEARS, startDate);

  const lossOfPersonalBelongings = odCover(req.lossOfBelongings, "lossOfBelongings");

  /**
   * EMI Protector travels as a triple — cover flag, instalment count, instalment
   * amount — plus `EMIPlanType`, and HDFC refuses the WHOLE payload when any of
   * them is missing rather than just declining the cover. So the cover is only
   * requested when the caller supplied an amount to rate it on; without one it
   * is silently dropped, which is the same discipline the Loss-of-Personal-
   * Belongings SI trap taught (a cover flag with a zero sum insured buys
   * nothing). There is no vendor default to fall back on here: HDFC's own
   * collection never turns the cover on.
   */
  const emiAmount = req.emiAmount ?? 0;
  const emiProtector = odCover(req.emiProtect, "emiProtect") && emiAmount > 0;

  return {
    transactionId,
    businessType: resolveBusinessType(req),
    isElectric,
    vehicle: {
      modelCode: codes.modelCode,
      rtoCode: codes.rtoCode,
      registrationNo: req.registrationNumber,
      registrationDate: req.registrationDate,
      manufactureYear: req.registrationDate,
      fuelType: req.fuelType?.toUpperCase(),
      engineNumber: full.vehicle?.engineNumber,
      chassisNumber: full.vehicle?.chassisNumber,
      // Overwritten with HDFC's recommended IDV before CalculatePremium — see
      // the provider's quote flow. A caller value is only a starting point.
      idv: req.idvValue ?? 0,
    },
    policy: {
      startDate,
      proposalDate: todayIso(),
      // POLICY_TENURE is a SINGLE int carrying one leg of the market's "OD+TP"
      // notation, per the kit's data dictionary (PrivateCarDataDictionary.xlsx,
      // "03 CalculatePremium Request" row 40): "Policy Tenure(1,2,3). Product
      // Code 2311 (Comprehensive): New Policy 1OD–3TP, 2OD–3TP, 3OD–3TP;
      // Rollover 1OD–1TP, 3OD. Product Code 2319 (TP Only Product): New Policy
      // 3TP; Rollover 1TP, 2TP, 3TP." So on the package/SA-OD product it is the
      // OD term and the TP leg is implied by business type; on the TP-only
      // product it is the TP term. There is no second tenure field to send.
      tenure: req.tenureYears ?? 1,
      policyType,
    },
    previousPolicy: {
      insurerCode: codes.previousInsurerCode,
      policyNo: req.previousPolicyNumber,
      startDate: req.previousPolicyStartDate,
      endDate: req.previousPolicyExpiryDate,
      tpStartDate: req.previousTpStartDate,
      tpEndDate: req.previousTpExpiryDate,
      // The previous standalone-OD policy's paired TP policy number. Its two
      // sibling dates were already wired; omitting the number left HDFC unable
      // to identify the TP policy it was being asked to validate against.
      tpPolicyNo: req.previousTpPolicyNumber,
      ncbPercentage: req.ncbPercent,
      claim: req.claimInPreviousPolicy,
      type: req.previousPolicyType,
      hadZeroDep: req.previousPolicyHasZdCover,
    },
    addons: {
      planType: plan.planType,
      zeroDep: odCover(req.zeroDep, "zeroDep"),
      tyreSecure: odCover(req.tyreProtect, "tyreProtect"),
      ncbProtection: odCover(req.ncbProtection, "ncbProtection"),
      rti,
      rtiPlanType: rti ? "A" : undefined,
      consumables: odCover(req.consumables, "consumables"),
      // HDFC UAT rejects engine-gearbox cover on an electric vehicle outright:
      // "EGP Add on cover not applicable for electric vehicles". An EV has no
      // engine or gearbox, so dropping the flag is faithful to what the
      // customer can actually buy rather than a workaround.
      engineProtect: odCover(req.engineProtect, "engineProtect") && !isElectric,
      roadsideAssistance: odCover(req.rsa, "rsa"),
      /**
       * `IsEAW_Cover` — the wider RSA tier, a cover HDFC sells separately from
       * ordinary Emergency Assistance and prices separately too (live: EA ₹50
       * and EAW ₹499 on the same quote). It was hardcoded false, so the ₹499
       * cover HDFC's own New Business sample switches ON could never be bought.
       */
      roadsideAssistanceWorldwide: odCover(req.rsaWorldwide, "rsaWorldwide"),
      roadsideAssistanceAdvance: false,
      /**
       * `IsLossofUseDownTimeProt_Cover`, from the canonical `garageCash` — the
       * same benefit under the other market name. See PRIVATE_CAR_ADDONS.
       */
      lossOfUse: odCover(req.garageCash, "garageCash"),
      emiProtector,
      noOfEmi: emiProtector ? HDFC_EMI_INSTALMENTS : undefined,
      emiAmount: emiProtector ? emiAmount : 0,
      emiPlanType: emiProtector ? HDFC_EMI_PLAN_TYPE : undefined,
      /**
       * HDFC-only, so it comes in through providerAddonCodes rather than a
       * canonical flag. `HigherTowingLimit` is left unset on purpose: sweeping
       * it on UAT (null / 1 / 2 / 3 / 25000 / 50000) changed nothing — every
       * value returns "Higher Protection and Removal Costs - Add on system rate
       * is not available" — so no value is more truthful than none.
       */
      highProtection: odCover(
        hasProviderCode(req, HDFC_PROVIDER_ADDON_CODES.highProtection),
      ),
      lossOfPersonalBelongings,
      // Rated ON this sum insured, so sending the cover flag with a zero SI buys
      // nothing — see HDFC_DEFAULT_LOSS_OF_BELONGINGS_SI.
      lossOfPersonalBelongingsSI: lossOfPersonalBelongings
        ? (req.lossOfBelongingsSI ?? HDFC_DEFAULT_LOSS_OF_BELONGINGS_SI)
        : 0,
      llPaidDriver: req.legalLiabilityPaidDriver ? 1 : 0,
      paPaidDriverSI: 0,
      noOfPaPaidDriver: req.legalLiabilityPaidDriver ? 1 : 0,
      unnamedPersons: req.paUnnamedPassenger ? 1 : 0,
      unnamedPersonSI: req.unnamedPaSumInsured ?? 0,
      cpaTenure: req.paOwner ? 1 : 0,
      electricalAccessoryIdv: odAmount(req.electricalAccessoriesSI),
      nonElectricalAccessoryIdv: odAmount(req.nonElectricalAccessoriesSI),
      /**
       * Never claimed. HDFC's certification pack states the rule flatly — "Anti
       * Theft Discount not applicable for all motor product"
       * (PVTcarTestScenarios.xls "New and Rollover" row 27) — and its own
       * liability sample sends `AntiTheftDiscFlag: false`. UAT nonetheless
       * grants it: passing the canonical `hasAntiTheftDevice` through returned
       * `AntiTheftDisc_Premium: 37`, i.e. a discount off the filed rate that
       * HDFC does not actually offer, which under-prices the policy and would
       * be re-rated at issuance.
       *
       * The fix belongs here rather than in the canonical contract:
       * `hasAntiTheftDevice` is a real customer fact and ICICI Lombard prices a
       * genuine discount from it. It is only HDFC that must not be told.
       */
      antiTheftDisc: false,
      voluntaryExcess: odAmount(req.voluntaryDeductible),
      biFuelType: req.bifuelKitType && req.bifuelKitType !== "NA" ? req.bifuelKitType : "",
      biFuelKitValue: req.bifuelKitSI ?? 0,
      automobileAssociationNo: req.automobileAssociationMembership,
      nomineeName: full.nomineeName,
      nomineeAge: full.nomineeAge,
      // HDFC matches this against its own RELATION MASTER case-sensitively and
      // rejects the whole proposal otherwise — see hdfcNomineeRelation. Applied
      // here so all three Req_PvtCar templates get the corrected value.
      nomineeRelationship: hdfcNomineeRelation(full.nomineeRelation),
      /**
       * This flag is the CPA *exemption*, not a statement that the owner drives.
       * HDFC's own warning spells out what it means: "Owner has no valid driving
       * license or Having CPA in another policy". Set it and HDFC charges no
       * compulsory PA cover.
       *
       * It was hardcoded `true`, which suppressed CPA on every single quote —
       * verified live on UAT: identical request, CPA ₹0 / gross ₹3,396 with
       * true, CPA ₹325 / gross ₹3,780 with false. So we were under-quoting and
       * would have issued policies missing a cover that is compulsory in India.
       *
       * It is therefore the inverse of the customer's paOwner choice: asking for
       * owner-driver PA means the exemption does not apply.
       */
      effectiveDrivingLicense: !req.paOwner,
    },
    ev: isElectric
      ? {
          // All three EV riders indemnify the vehicle itself — the traction
          // motor, the battery and the charger — so they are own-damage covers
          // and go off with the rest on a liability-only policy. The explicit 0
          // matters: the Req_PvtCar templates read `ev.motorCover ?? 1`.
          motorCover: liabilityOnly ? 0 : 1,
          // HDFC enforces a dependency: "This cover cannot be opted unless
          // addon 'Battery, Charger & Accessories Cover' is selected." So the
          // battery zero-dep rider is only offered when the customer also took
          // batteryProtect. Forcing batteryProtect on instead would silently
          // add a paid cover they did not ask for.
          zeroDepBattery: odCover(req.zeroDep && req.batteryProtect) ? 1 : 0,
          batteryChargerCover: odCover(req.batteryProtect, "batteryProtect") ? 1 : 0,
        }
      : {},
    financier: toFinancier(req),
    customer: toCustomer(req),
    payment: full.amountCollected
      ? { amount: full.amountCollected, instrumentNumber: full.paymentTransactionId }
      : undefined,
  };
}

import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import { hdfcPolicyType, HDFC_BUSINESS_TYPE, type HdfcBusinessType } from "../config.ts";
import type { HdfcRequestShape, HdfcResolvedCodes, HdfcCustomer } from "../types.ts";

/**
 * Canonical request → the intermediate shape the ported HDFC payload builders
 * consume. This is the ONLY new logic in the port; everything downstream is the
 * standalone module's UAT-verified code.
 */

/**
 * HDFC BusinessType_Mandatary. Mirrors FG's rule for what counts as new
 * business: either the explicit business type or the newVehicle category.
 * "Used Car" is not reachable from the canonical request today — the wizard has
 * no used-vehicle journey — so the template exists but is only selected when a
 * caller sets businessType explicitly through the full-quote path.
 */
export function resolveBusinessType(req: MotorQuoteRequest): HdfcBusinessType {
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

/** Full-quote requests carry a proposer + address; plain quotes do not. */
function toCustomer(req: MotorQuoteRequest): HdfcCustomer | undefined {
  const full = req as Partial<MotorFullQuoteRequest>;
  if (!full.proposer) return undefined;
  const p = full.proposer;
  const a = full.address;
  return {
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
      policyType: hdfcPolicyType(req.selectedPolicy),
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
      zeroDep: req.zeroDep,
      tyreSecure: req.tyreProtect,
      ncbProtection: req.ncbProtection,
      rti: req.rti,
      rtiPlanType: req.rti ? "A" : undefined,
      consumables: req.consumables,
      // HDFC UAT rejects engine-gearbox cover on an electric vehicle outright:
      // "EGP Add on cover not applicable for electric vehicles". An EV has no
      // engine or gearbox, so dropping the flag is faithful to what the
      // customer can actually buy rather than a workaround.
      engineProtect: req.engineProtect && !isElectric,
      roadsideAssistance: req.rsa,
      roadsideAssistanceWorldwide: false,
      roadsideAssistanceAdvance: false,
      lossOfPersonalBelongings: req.lossOfBelongings,
      lossOfPersonalBelongingsSI: 0,
      llPaidDriver: req.legalLiabilityPaidDriver ? 1 : 0,
      paPaidDriverSI: 0,
      noOfPaPaidDriver: req.legalLiabilityPaidDriver ? 1 : 0,
      unnamedPersons: req.paUnnamedPassenger ? 1 : 0,
      unnamedPersonSI: req.unnamedPaSumInsured ?? 0,
      cpaTenure: req.paOwner ? 1 : 0,
      electricalAccessoryIdv: req.electricalAccessoriesSI ?? 0,
      nonElectricalAccessoryIdv: req.nonElectricalAccessoriesSI ?? 0,
      antiTheftDisc: req.hasAntiTheftDevice ?? false,
      voluntaryExcess: req.voluntaryDeductible ?? 0,
      biFuelType: req.bifuelKitType && req.bifuelKitType !== "NA" ? req.bifuelKitType : "",
      biFuelKitValue: req.bifuelKitSI ?? 0,
      automobileAssociationNo: req.automobileAssociationMembership,
      nomineeName: full.nomineeName,
      nomineeAge: full.nomineeAge,
      nomineeRelationship: full.nomineeRelation,
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
          motorCover: 1,
          // HDFC enforces a dependency: "This cover cannot be opted unless
          // addon 'Battery, Charger & Accessories Cover' is selected." So the
          // battery zero-dep rider is only offered when the customer also took
          // batteryProtect. Forcing batteryProtect on instead would silently
          // add a paid cover they did not ask for.
          zeroDepBattery: req.zeroDep && req.batteryProtect ? 1 : 0,
          batteryChargerCover: req.batteryProtect ? 1 : 0,
        }
      : {},
    customer: toCustomer(req),
    payment: full.amountCollected
      ? { amount: full.amountCollected, instrumentNumber: full.paymentTransactionId }
      : undefined,
  };
}

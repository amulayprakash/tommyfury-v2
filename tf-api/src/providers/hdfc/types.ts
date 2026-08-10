import type { HdfcBusinessType, HdfcPolicyTypeValue } from "./config.ts";

/**
 * The intermediate shape the ported payload builders consume. It exists so the
 * three collection-exact templates could be carried over verbatim: only this
 * shape's *producer* (mapper/canonical.ts) is new code.
 *
 * Dates are ISO (YYYY-MM-DD); the templates convert to DD/MM/YYYY.
 * Amounts are whole rupees, matching the rest of the stack.
 */

export interface HdfcVehicle {
  /** HDFC VEHICLEMODELCODE, resolved from ProviderMmvCode. */
  modelCode: string;
  /** HDFC RTO_CODE, resolved from ProviderRtoCode. */
  rtoCode: string;
  registrationNo?: string;
  registrationDate?: string;
  firstRegistrationDate?: string;
  deliveryOrRegistrationDate?: string;
  manufactureYear?: string;
  fuelType?: string;
  engineNumber?: string;
  chassisNumber?: string;
  idv: number;
}

export interface HdfcPolicy {
  startDate?: string;
  proposalDate?: string;
  tenure: number;
  policyType: HdfcPolicyTypeValue;
}

export interface HdfcPreviousPolicy {
  /** HDFC insurer short code from ProviderInsurerCode — NOT "OTHERS". */
  insurerCode?: string;
  policyNo?: string;
  startDate?: string;
  endDate?: string;
  tpStartDate?: string;
  tpEndDate?: string;
  tpInsurer?: string;
  tpPolicyNo?: string;
  ncbPercentage: number;
  claim: boolean;
  type?: string;
  hadZeroDep?: boolean;
  hadRti?: boolean;
}

export interface HdfcAddons {
  zeroDep: boolean;
  tyreSecure: boolean;
  ncbProtection: boolean;
  rti: boolean;
  rtiPlanType?: string;
  consumables: boolean;
  engineProtect: boolean;
  roadsideAssistance: boolean;
  roadsideAssistanceWorldwide: boolean;
  roadsideAssistanceAdvance: boolean;
  /** IsLossofUseDownTimeProt_Cover — canonical `garageCash`. */
  lossOfUse: boolean;
  /**
   * IsEMIProtector_Cover. All three fields travel together: HDFC refuses the
   * payload when the cover is on and either the amount or the plan type is
   * missing, so the mapper only ever sets the flag with both populated.
   */
  emiProtector: boolean;
  noOfEmi?: number;
  emiAmount: number;
  emiPlanType?: string;
  /** IsHighProtection_Cover, from the providerAddonCodes passthrough. */
  highProtection: boolean;
  higherTowingLimit?: number;
  /**
   * Req_PvtCar.PlanType — HDFC's merchandising label for the cover bundle the
   * customer chose. Inert as a rating input (see HDFC_PLANS); sent because it is
   * HDFC's own field and the Roll Over template already carries the key.
   */
  planType?: string;
  lossOfPersonalBelongings: boolean;
  lossOfPersonalBelongingsSI: number;
  llPaidDriver: number;
  paPaidDriverSI: number;
  noOfPaPaidDriver: number;
  unnamedPersons: number;
  unnamedPersonSI: number;
  cpaTenure: number;
  electricalAccessoryIdv: number;
  nonElectricalAccessoryIdv: number;
  antiTheftDisc: boolean;
  voluntaryExcess: number;
  biFuelType: string;
  biFuelKitValue: number;
  automobileAssociationNo?: string;
  nomineeName?: string;
  nomineeAge?: number;
  nomineeRelationship?: string;
  effectiveDrivingLicense: boolean;
  /**
   * Used Car only — the Used template emits IsFibertank / NumberOfDrivers, which
   * no other business type sends. `numberOfDrivers` has a canonical source
   * (MotorQuoteRequest.numberOfDrivers); `fibertank` has none, so it stays
   * unset until a used-vehicle journey exists to supply it.
   */
  fibertank?: boolean;
  numberOfDrivers?: number;
}

/**
 * Hypothecation / lease details. HDFC's Policy_Details carries these for
 * financed vehicles on both Roll Over and New Vehicle.
 *
 * Currently always undefined: the canonical request carries the financier's
 * NAME (MotorFullQuoteRequest.financierName) while HDFC wants its numeric
 * FinancierCode from the kit's GENMST_FINANCIER master, and BranchName has no
 * canonical source at all. The original integration sent null here too, so
 * emitting null is faithful, not a regression — but a financed vehicle's
 * hypothecation will not be recorded on the HDFC policy until a
 * financier-code cross-walk exists. Tracked in the integration notes.
 */
export interface HdfcFinancier {
  agreementType?: string;
  financierCode?: string;
  branchName?: string;
}

export interface HdfcEv {
  motorCover?: number;
  zeroDepBattery?: number;
  batteryChargerCover?: number;
}

export interface HdfcCustomer {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dob?: string;
  email?: string;
  mobile?: string;
  panNo?: string;
  salutation?: string;
  gender?: string;
  permAddress1?: string;
  permAddress2?: string;
  permCityDistrict?: string;
  permState?: string;
  permPinCode?: string;
  /** Pehchaan kyc_id → Customer_Pehchaan_id. Issuance is refused without it. */
  pehchaanId?: string;
  /** Customer_Type. HDFC's vocabulary is "Individual" / "Corporate". */
  customerType?: "Individual" | "Corporate";
  /** Company_Name — HDFC wants it populated for a corporate policyholder. */
  companyName?: string;
  gstin?: string;
}

export interface HdfcPayment {
  amount: number;
  paymentDate?: string;
  instrumentNumber?: string;
  bankName?: string;
  bankBranchName?: string;
  paymentModeCode?: string;
  payerType?: string;
}

export interface HdfcRequestShape {
  transactionId: string;
  businessType: HdfcBusinessType;
  isElectric: boolean;
  vehicle: HdfcVehicle;
  policy: HdfcPolicy;
  previousPolicy: HdfcPreviousPolicy;
  addons: HdfcAddons;
  ev: HdfcEv;
  financier?: HdfcFinancier;
  customer?: HdfcCustomer;
  payment?: HdfcPayment;
  /** Proposal number returned by CreateProposal, for the payment/document steps. */
  proposalNumber?: string;
  policyNumber?: string;
  /** Existing policy number for the renewal flow. */
  previousPolicyNo?: string;
}

/** What db-code-resolver.ts produces. */
export interface HdfcResolvedCodes {
  modelCode: string;
  rtoCode: string;
  previousInsurerCode?: string;
}

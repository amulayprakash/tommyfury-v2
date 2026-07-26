/** The payload delta a policy path contributes to the premium/proposal payloads. */
export interface ItgiPolicyPath {
  /** Vendor cover mode: CO = comprehensive, AC = act-only / third-party. */
  zcover: "CO" | "AC";
  /** Vendor policy type: CP | TP | OD | BP. */
  policyType: "CP" | "TP" | "OD" | "BP";
  /** Act-only policies still send IDV Basic, but with sum insured 1. */
  idvSumInsuredOverride?: number;
  /** Standalone OD needs the running package (TP) policy's details. */
  requiresTpPolicyDetails: boolean;
  /** New vehicles use NewVehiclePremiumWebserviceVA and set newVehicleFlag. */
  usesNewVehicleEndpoint: boolean;
  newVehicleFlag?: "Y";
  /** Break-in modifier (composes onto any of the above). */
  breakIn: boolean;
  breakInMoreThan90Days: "Y" | "N";
  /** Break-in inception is read as today+3 when inspection is at ITGI's end. */
  inceptionOffsetDays: number;
}

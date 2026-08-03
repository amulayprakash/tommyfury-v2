'use strict';

const { toHdfcDate, generateTransactionId } = require('../utils/helpers');

/**
 * Two-Wheeler (Req_TW) and Commercial GCV (Req_GCV) / PCV (Req_PCV) payload
 * builders.
 *
 * IMPORTANT — verification status:
 * The Postman collection you provided is Private Car ONLY, and the master data
 * files do not contain two-wheeler / commercial product codes or their request
 * schemas. These builders therefore follow HDFC ERGO's STANDARD HEI integration
 * structure (the same Customer_Details + Policy_Details envelope as Private Car,
 * with a product-specific Req_* block). They are wired end-to-end and will run,
 * but the exact Req_TW / Req_GCV / Req_PCV field set MUST be confirmed against
 * HDFC's two-wheeler & commercial collections once you receive them. Fields most
 * likely to need adjustment are flagged with `// VERIFY`.
 *
 * When you get those collections, adjust the Req_* templates here the same way
 * the Private Car templates were matched field-for-field. Nothing else (auth,
 * token cache, endpoints, controllers, routes, product codes) needs to change.
 */

/* ------------------------------- helpers -------------------------------- */
const bool01 = (x) => (x === true || x === 1 || x === '1' ? 1 : 0);
const boolTF = (x) => x === true || x === 1 || x === '1';
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

function resolveBusinessType(req) {
  if (req.businessType) return req.businessType;
  const regNo = req.vehicle && req.vehicle.registrationNo;
  if (!regNo || String(regNo).toUpperCase() === 'NEW') return 'New Vehicle';
  if (req.usedVehicle) return 'Used Car';
  return 'Roll Over';
}

/* Shared Customer_Details (identical envelope across HEI motor products). */
function buildCustomerDetails(c = {}) {
  return {
    GC_CustomerID: c.gcCustomerId ?? '',
    IsCustomer_modify: null,
    Company_Name: c.companyName ?? '',
    Customer_Type: c.type || 'Individual',
    Customer_FirstName: c.firstName ?? '',
    Customer_MiddleName: c.middleName ?? '',
    Customer_LastName: c.lastName ?? '',
    Customer_DateofBirth: toHdfcDate(c.dob),
    Customer_Email: c.email ?? '',
    Customer_Mobile: c.mobile ?? '',
    Customer_Telephone: c.telephone ?? '',
    Customer_PanNo: c.panNo ?? '',
    Customer_AnnualIncome: c.annualIncome ?? null,
    Customer_OrganisationType: c.organisationType ?? null,
    Customer_PepStatus: c.pepStatus ?? null,
    Customer_Salutation: c.salutation || 'MR',
    Customer_Gender: c.gender || 'MALE',
    Customer_Perm_Address1: c.permAddress1 ?? '',
    Customer_Perm_Address2: c.permAddress2 ?? '',
    Customer_Perm_Apartment: c.permApartment ?? '',
    Customer_Perm_Street: c.permStreet ?? '',
    Customer_Perm_CityDistrictCode: c.permCityDistrictCode ?? '',
    Customer_Perm_CityDistrict: c.permCityDistrict ?? '',
    Customer_Perm_StateCode: c.permStateCode ?? '',
    Customer_Perm_State: c.permState ?? '',
    Customer_Perm_PinCode: c.permPinCode ?? '',
    Customer_Perm_PinCodeLocality: c.permPinCodeLocality ?? '',
    Customer_Mailing_Address1: c.mailingAddress1 ?? c.permAddress1 ?? '',
    Customer_Mailing_Address2: c.mailingAddress2 ?? c.permAddress2 ?? '',
    Customer_Mailing_Apartment: c.mailingApartment ?? c.permApartment ?? '',
    Customer_Mailing_Street: c.mailingStreet ?? c.permStreet ?? '',
    Customer_Mailing_CityDistrictCode: c.mailingCityDistrictCode ?? c.permCityDistrictCode ?? '',
    Customer_Mailing_CityDistrict: c.mailingCityDistrict ?? c.permCityDistrict ?? '',
    Customer_Mailing_StateCode: c.mailingStateCode ?? c.permStateCode ?? '',
    Customer_Mailing_State: c.mailingState ?? c.permState ?? '',
    Customer_Mailing_PinCode: c.mailingPinCode ?? c.permPinCode ?? '',
    Customer_Mailing_PinCodeLocality: c.mailingPinCodeLocality ?? '',
    Customer_GSTIN_Number: c.gstinNumber ?? '',
    Customer_GSTIN_State: c.gstinState ?? '',
    Customer_Professtion: c.profession ?? null,
    Customer_MaritalStatus: c.maritalStatus ?? null,
    Customer_EIA_Number: c.eiaNumber ?? null,
    Customer_IDProof: c.idProof ?? null,
    Customer_IDProofNo: c.idProofNo ?? null,
    Customer_Nationality: c.nationality ?? null,
    Customer_UniqueRefNo: c.uniqueRefNo ?? null,
    Customer_GSTDetails: null,
    Customer_Pehchaan_id: c.pehchaanId ?? '',
  };
}

/* Shared Policy_Details envelope. Commercial/TW use the same core vehicle keys
   as Private Car; sub-products add their own fields in the Req_* block. */
function buildPolicyDetails(req) {
  const v = req.vehicle || {};
  const p = req.policy || {};
  const pp = req.previousPolicy || {};
  const bt = resolveBusinessType(req);
  const isNew = bt === 'New Vehicle';
  const startDate = p.startDate ? new Date(p.startDate) : new Date();
  const proposalDate = p.proposalDate ? new Date(p.proposalDate) : new Date();

  const pd = {
    PolicyStartDate: toHdfcDate(startDate),
    ProposalDate: toHdfcDate(proposalDate),
    BusinessType_Mandatary: bt,
    VehicleModelCode: String(v.modelCode),
    DateofDeliveryOrRegistration: toHdfcDate(v.deliveryOrRegistrationDate || v.registrationDate || startDate),
    DateofFirstRegistration: isNew ? (v.firstRegistrationDate ? toHdfcDate(v.firstRegistrationDate) : null) : toHdfcDate(v.firstRegistrationDate),
    YearOfManufacture: String(v.manufactureYear || new Date(startDate).getFullYear()),
    Registration_No: isNew ? null : (v.registrationNo ?? null),
    EngineNumber: v.engineNumber ?? null,
    ChassisNumber: v.chassisNumber ?? null,
    RTOLocationCode: String(v.rtoCode),
    Vehicle_IDV: num(v.idv),
  };
  if (!isNew) {
    pd.PreviousPolicy_NCBPercentage = num(pp.ncbPercentage);
    pd.PreviousPolicy_PolicyEndDate = toHdfcDate(pp.endDate);
    pd.PreviousPolicy_PolicyClaim = (pp.claim || 'No');
    pd.PreviousPolicy_PreviousPolicyType = pp.type ?? 'COMPREHENSIVE';
  }
  return pd;
}

/* ====================== Two Wheeler (Req_TW) ============================ */
// VERIFY against HDFC two-wheeler collection when available.
function buildReqTW(req) {
  const a = req.addons || {};
  const p = req.policy || {};
  return {
    POSP_CODE: a.pospCode ?? null,
    POLICY_TYPE: p.policyType ?? 'Comprehensive',
    POLICY_TENURE: num(p.tenure, 1),
    ExtensionCountryCode: 0.0,
    ExtensionCountryName: null,
    Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
    BiFuelType: a.biFuelType ?? null,        // VERIFY (CNG kit rare on TW)
    BiFuel_Kit_Value: num(a.biFuelKitValue),
    Owner_Driver_Nominee_Name: a.nomineeName ?? null,
    Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
    Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
    IsZeroDept_Cover: bool01(a.zeroDep),
    IsNCBProtection_Cover: bool01(a.ncbProtection),
    IsRTI_Cover: bool01(a.rti),
    RTIPlanType: a.rti ? (a.rtiPlanType || 'A') : null,
    IsCOC_Cover: bool01(a.consumables),
    IsEA_Cover: bool01(a.roadsideAssistance),
    ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
    NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
    AntiTheftDiscFlag: boolTF(a.antiTheftDisc),
    PAPaiddriverSI: num(a.paPaidDriverSI),
    NoofUnnamedPerson: num(a.unnamedPersons),
    UnnamedPersonSI: num(a.unnamedPersonSI),
    Voluntary_Excess_Discount: num(a.voluntaryExcess),
    TPPDLimit: 0.0,
    AutoMobile_Assoication_No: a.automobileAssociationNo ?? null,
    fuel_type: null,
    CPA_Tenure: a.cpaTenure != null ? num(a.cpaTenure) : 1,
    // EV two-wheeler covers — VERIFY field names
    isElectricMotorCover: bool01(req.ev && (req.ev.motorCover ?? (String(req.vehicle?.fuelType).toUpperCase() === 'ELECTRIC' ? 1 : 0))),
    isZeroDepClaimforBattery: bool01(req.ev && req.ev.zeroDepBattery),
    isBatteryChargerAccessoryCover: bool01(req.ev && req.ev.batteryChargerCover),
  };
}

/* =============== Commercial — Goods Carrying (Req_GCV) ================== */
// VERIFY against HDFC commercial (GCV) collection when available.
function buildReqGCV(req) {
  const a = req.addons || {};
  const p = req.policy || {};
  const cv = req.commercial || {};
  return {
    POSP_CODE: a.pospCode ?? null,
    POLICY_TYPE: p.policyType ?? 'Comprehensive',
    POLICY_TENURE: num(p.tenure, 1),
    ExtensionCountryCode: 0.0,
    ExtensionCountryName: null,
    Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
    // Goods-carrying specifics — VERIFY
    GrossVehicleWeight: num(cv.grossVehicleWeight),
    CarryingCapacity: num(cv.carryingCapacity),
    NumberOfEmployees: num(cv.numberOfEmployees),
    NoOfWorkmen: num(cv.noOfWorkmen),
    LLPaiddriver: num(cv.llPaidDriver),
    LLtoEmployees: num(cv.llToEmployees),
    IsHazardousGoods: bool01(cv.hazardousGoods),
    TrailerIDV: num(cv.trailerIdv),
    // Common covers
    Owner_Driver_Nominee_Name: a.nomineeName ?? null,
    Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
    Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
    IsZeroDept_Cover: bool01(a.zeroDep),
    IsNCBProtection_Cover: bool01(a.ncbProtection),
    IsCOC_Cover: bool01(a.consumables),
    IsEA_Cover: bool01(a.roadsideAssistance),
    ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
    NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
    PAPaiddriverSI: num(a.paPaidDriverSI),
    NoofUnnamedPerson: num(a.unnamedPersons),
    UnnamedPersonSI: num(a.unnamedPersonSI),
    Voluntary_Excess_Discount: num(a.voluntaryExcess),
    TPPDLimit: 0.0,
    fuel_type: null,
    CPA_Tenure: a.cpaTenure != null ? num(a.cpaTenure) : 1,
  };
}

/* ============ Commercial — Passenger Carrying (Req_PCV) ================= */
// VERIFY against HDFC commercial (PCV) collection when available.
function buildReqPCV(req) {
  const a = req.addons || {};
  const p = req.policy || {};
  const cv = req.commercial || {};
  return {
    POSP_CODE: a.pospCode ?? null,
    POLICY_TYPE: p.policyType ?? 'Comprehensive',
    POLICY_TENURE: num(p.tenure, 1),
    ExtensionCountryCode: 0.0,
    ExtensionCountryName: null,
    Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
    // Passenger-carrying specifics — VERIFY
    SeatingCapacity: num(cv.seatingCapacity),
    NoOfPassengers: num(cv.noOfPassengers),
    LLtoPassengers: num(cv.llToPassengers),
    NumberOfEmployees: num(cv.numberOfEmployees),
    NoOfCleanerConductorCoolies: num(cv.noOfCleanerConductorCoolies),
    LLPaiddriver: num(cv.llPaidDriver),
    IsSchoolBus: bool01(cv.schoolBus),
    // Common covers
    Owner_Driver_Nominee_Name: a.nomineeName ?? null,
    Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
    Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
    IsZeroDept_Cover: bool01(a.zeroDep),
    IsNCBProtection_Cover: bool01(a.ncbProtection),
    IsCOC_Cover: bool01(a.consumables),
    IsEA_Cover: bool01(a.roadsideAssistance),
    ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
    NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
    PAPaiddriverSI: num(a.paPaidDriverSI),
    NoofUnnamedPerson: num(a.unnamedPersons),
    UnnamedPersonSI: num(a.unnamedPersonSI),
    Voluntary_Excess_Discount: num(a.voluntaryExcess),
    TPPDLimit: 0.0,
    fuel_type: null,
    CPA_Tenure: a.cpaTenure != null ? num(a.cpaTenure) : 1,
  };
}

/* --------------------- Req block key + builder by LOB/sub -------------- */
function reqBlockFor(lob, subType) {
  if (lob === 'twowheeler') return { key: 'Req_TW', build: buildReqTW };
  if (lob === 'commercial' && subType === 'pcv') return { key: 'Req_PCV', build: buildReqPCV };
  if (lob === 'commercial') return { key: 'Req_GCV', build: buildReqGCV }; // default gcv
  throw new Error(`No Req_* builder for lob=${lob} subType=${subType}`);
}

/* -------------------------- step builders ------------------------------ */
// IDV request is identical shape to Private Car (model + RTO + reg dates).
function buildGetCalculateIDV(req) {
  const v = req.vehicle || {};
  const p = req.policy || {};
  const pp = req.previousPolicy || {};
  const startDate = p.startDate ? new Date(p.startDate) : new Date();
  return {
    TransactionID: req.transactionId || generateTransactionId('IDV'),
    IDV_DETAILS: {
      ModelCode: String(v.modelCode),
      RTOCode: String(v.rtoCode),
      Vehicle_Registration_Date: toHdfcDate(v.registrationDate) || toHdfcDate(startDate),
      Registration_No: v.registrationNo || 'New',
      Policy_Start_Date: toHdfcDate(startDate),
      PreviousPolicy_PreviousPolicyType: pp.type || 'COMPREHENSIVE',
      PreviousPolicy_EndDate: toHdfcDate(pp.endDate),
      PreviousPolicy_TPENDDATE: toHdfcDate(pp.tpEndDate),
      PreviousPolicy_TPSTARTDATE: toHdfcDate(pp.tpStartDate),
    },
  };
}

function buildCalculatePremium(req, lob, subType) {
  const { key, build } = reqBlockFor(lob, subType);
  return {
    TransactionID: req.transactionId || generateTransactionId('QB'),
    Policy_Details: buildPolicyDetails(req),
    [key]: build(req),
  };
}

function buildCreateProposal(req, lob, subType) {
  const { key, build } = reqBlockFor(lob, subType);
  return {
    TransactionID: req.transactionId || generateTransactionId('PROP'),
    Customer_Details: buildCustomerDetails(req.customer),
    Policy_Details: buildPolicyDetails(req),
    [key]: build(req),
  };
}

function buildGetProposalDocument(req) {
  return {
    TransactionID: req.transactionId || generateTransactionId('GPD'),
    Req_Policy_Document: { Proposal_Number: req.proposalNumber },
  };
}
function buildGetPolicyDocument(req) {
  return {
    TransactionID: req.transactionId || generateTransactionId('GPOL'),
    Req_Policy_Document: { Policy_Number: req.policyNumber },
  };
}
function buildSubmitPaymentDetails(req) {
  const pay = req.payment || {};
  return {
    TransactionID: req.transactionId || generateTransactionId('PAY'),
    Proposal_no: req.proposalNumber,
    Cis_Flag: req.cisFlag || 'Y',
    Payment_Details: {
      GC_PaymentID: pay.gcPaymentId ?? '',
      BANK_NAME: pay.bankName || 'BIZDIRECT',
      BANK_BRANCH_NAME: pay.bankBranchName || 'Andheri',
      PAYMENT_MODE_CD: pay.paymentModeCode || 'EP',
      PAYER_TYPE: pay.payerType || 'CUSTOMER',
      PAYMENT_AMOUNT: String(pay.amount),
      INSTRUMENT_NUMBER: pay.instrumentNumber || (req.transactionId || generateTransactionId('INS')),
      PAYMENT_DATE: toHdfcDate(pay.paymentDate || new Date()),
    },
  };
}

module.exports = {
  buildGetCalculateIDV,
  buildCalculatePremium,
  buildCreateProposal,
  buildGetProposalDocument,
  buildGetPolicyDocument,
  buildSubmitPaymentDetails,
  buildReqTW,
  buildReqGCV,
  buildReqPCV,
  reqBlockFor,
  resolveBusinessType,
};

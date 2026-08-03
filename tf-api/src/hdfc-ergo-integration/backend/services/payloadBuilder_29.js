'use strict';

const { toHdfcDate, generateTransactionId } = require('../utils/helpers');

/**
 * payloadBuilder produces request bodies that match the HDFC ERGO Private Car
 * Postman collection EXACTLY — same keys, same order, same defaults — for each
 * business case:
 *
 *   businessType:  "New Vehicle" | "Roll Over" | "Used Car"   (+ Renewal flow)
 *   vehicleType:   four_wheeler | ev | new_vehicle | two_wheeler | commercial
 *
 * The three Comprehensive variants (New Business / Roll Over / Used Vehicle)
 * each have a DIFFERENT Policy_Details + Req_PvtCar field set in the collection,
 * so we build each one to its own template rather than one merged shape. Only
 * fields the collection actually sends are included — nothing extra, so HDFC's
 * validators see the payload they expect.
 *
 * Frontend request shape is unchanged (see routes); everything is mapped here.
 */

/* ============================ helpers =================================== */
function bool01(x) {
  return x === true || x === 1 || x === '1' ? 1 : 0;
}
function boolTF(x) {
  return x === true || x === 1 || x === '1';
}
function isEV(req) {
  const fuel = (req.vehicle && req.vehicle.fuelType) || '';
  return req.vehicleType === 'ev' || String(fuel).toUpperCase() === 'ELECTRIC';
}
function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

/**
 * Split an Indian registration number into HDFC's three sections:
 *   "MH12AB1234" -> { s1:"MH", s2:"12", s3:"AB", s4:"1234" }
 * HDFC's schema wants registrationNumberSection1..3 (state, rto number, series)
 * and the numeric part. Handles "MH-12-AB-1234", spaces, and BH-series.
 */
/**
 * HDFC premium always needs DateofDeliveryOrRegistration. Guarantee a value:
 * explicit delivery/registration date → manufacture year (mid-year) → policy
 * start date → today. Never returns empty.
 */
/**
 * YearOfManufacture must be a 4-digit year only. Frontend sometimes sends
 * "10/2011" or "2011-10" or a full date — extract just the year, else Blaze
 * crashes ("unexpected character").
 */
function yearOnly(val, fallbackDate) {
  if (val != null) {
    const m = String(val).match(/(19|20)\d{2}/); // first 4-digit year
    if (m) return m[0];
  }
  if (fallbackDate) return String(new Date(fallbackDate).getFullYear());
  return String(new Date().getFullYear());
}

function deliveryOrRegDate(v, startDate) {
  if (v.deliveryOrRegistrationDate) return toHdfcDate(v.deliveryOrRegistrationDate);
  if (v.registrationDate) return toHdfcDate(v.registrationDate);
  if (v.manufactureYear) {
    // manufactureYear may be "2011", "10/2011", "2011-10", etc. Pull the year.
    const m = String(v.manufactureYear).match(/(19|20)\d{2}/);
    if (m) return toHdfcDate(new Date(`${m[0]}-06-15`));
  }
  if (startDate) return toHdfcDate(startDate);
  return toHdfcDate(new Date());
}

// HDFC "Claim Status as per Customer" — mandatory for Roll Over. HDFC's
// collection sample uses ALL CAPS: "YES"/"NO" (not title case). Never empty.
function normalizeClaim(claim) {
  const c = String(claim ?? '').trim().toLowerCase();
  if (c === 'yes' || c === 'y' || c === 'true' || c === '1') return 'YES';
  return 'NO';
}

// HDFC createProposal expects Registration_No in DASH format: "MH-01-QQ-7878".
// Input may be "MH01QQ7878", "MH 01 QQ 7878", " mh12xt5251 ", etc.
function formatRegWithDashes(regNo) {
  if (!regNo) return null;
  const clean = String(regNo).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean === 'NEW' || clean === 'NULL' || !clean) return regNo;
  const m = clean.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (!m) return clean; // fallback: no reliable split
  return [m[1], m[2], m[3], m[4]].filter(Boolean).join('-'); // MH-12-XT-5251
}

function splitRegistration(regNo) {
  if (!regNo || String(regNo).toUpperCase() === 'NEW') {
    return { s1: '', s2: '', s3: '', s4: '' };
  }
  const clean = String(regNo).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); // MH12AB1234
  const m = clean.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (!m) {
    // Fallback: best-effort, keep whole thing in section3.
    return { s1: clean.slice(0, 2), s2: clean.slice(2, 4), s3: '', s4: clean.slice(4) };
  }
  return { s1: m[1], s2: m[2], s3: m[3], s4: m[4] };
}

/**
 * BusinessType_Mandatary exact values from the collection:
 *   "New Vehicle", "Roll Over", "Used Car".
 */
function resolveBusinessType(req) {
  if (req.businessType) return req.businessType;
  if (req.vehicleType === 'new_vehicle') return 'New Vehicle';
  const regNo = req.vehicle && req.vehicle.registrationNo;
  if (!regNo || String(regNo).toUpperCase() === 'NEW') return 'New Vehicle';
  if (req.usedVehicle) return 'Used Car';
  return 'Roll Over';
}

/* ==================== STEP 02: GetCalculateIDV ========================== */
// Body identical across New/Rollover; Used omits Registration_No.
function buildGetCalculateIDV(req) {
  const v = req.vehicle || {};
  const p = req.policy || {};
  const pp = req.previousPolicy || {};
  const startDate = p.startDate ? new Date(p.startDate) : new Date();

  // Match the collection's GetCalculateIDV body EXACTLY. Both the New-Business
  // AND the Roll-Over samples use Registration_No:"New" and have NO
  // registrationNumberSection* fields. IDV is computed from model+RTO+dates, not
  // the actual plate — so we always send "New" here. (Sending a real number made
  // HDFC's schema demand registrationNumberSection*, which is the error we saw.)
  const idv = {
    ModelCode: String(v.modelCode),
    RTOCode: String(v.rtoCode),
    Vehicle_Registration_Date: toHdfcDate(v.registrationDate) || toHdfcDate(startDate),
    Registration_No: 'New',
    Policy_Start_Date: toHdfcDate(startDate),
    PreviousPolicy_PreviousPolicyType: pp.type || 'COMPREHENSIVE',
    PreviousPolicy_EndDate: toHdfcDate(pp.endDate),
    PreviousPolicy_TPENDDATE: toHdfcDate(pp.tpEndDate),
    PreviousPolicy_TPSTARTDATE: toHdfcDate(pp.tpStartDate),
  };

  return {
    TransactionID: req.transactionId || generateTransactionId('PCCOM'),
    IDV_DETAILS: idv,
  };
}

/* ============= Req_PvtCar templates (one per business type) ============= */

// --- New Business Req_PvtCar (exact order from collection) ---
function reqPvtCar_New(req) {
  const a = req.addons || {};
  const ev = req.ev || {};
  const p = req.policy || {};
  const electric = isEV(req);
  return {
    POSP_CODE: a.pospCode ?? null,
    POLICY_TYPE: p.policyType ?? 'OD Plus TP',
    POLICY_TENURE: num(p.tenure, 1),
    ExtensionCountryCode: 0.0,
    ExtensionCountryName: null,
    BreakIN_ID: null,
    BreakInStatus: null,
    BreakInInspectionFlag: null,
    BreakinWaiver: false,
    BreakinInspectionDate: null,
    Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
    NumberOfEmployees: 0,
    NoOfWorkmen: 0,
    NoOfCleanerConductorCoolies: 0,
    BiFuelType: a.biFuelType ?? '',
    BiFuel_Kit_Value: num(a.biFuelKitValue),
    LLPaiddriver: num(a.llPaidDriver),
    PAPaiddriverSI: num(a.paPaidDriverSI),
    Owner_Driver_Nominee_Name: a.nomineeName ?? null,
    Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
    Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
    Owner_Driver_Appointee_Name: a.appointeeName ?? null,
    Owner_Driver_Appointee_Relationship: a.appointeeRelationship ?? null,
    IsZeroDept_Cover: bool01(a.zeroDep),
    IsTyreSecure_Cover: bool01(a.tyreSecure),
    ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
    NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
    OtherLoadDiscRate: 0.0,
    AntiTheftDiscFlag: boolTF(a.antiTheftDisc),
    HandicapDiscFlag: boolTF(a.handicapDisc),
    IsNCBProtection_Cover: bool01(a.ncbProtection),
    IsRTI_Cover: bool01(a.rti),
    RTIPlanType: a.rti ? (a.rtiPlanType || 'A') : null,
    IsCOC_Cover: bool01(a.consumables),
    IsEngGearBox_Cover: bool01(a.engineProtect),
    IsLossofUseDownTimeProt_Cover: bool01(a.downtimeProtect),
    IsEA_Cover: bool01(a.roadsideAssistance),
    IsEAW_Cover: bool01(a.roadsideAssistanceWorldwide),
    IsEAAdvance_Cover: bool01(a.roadsideAssistanceAdvance),
    IsTowing_Cover: bool01(a.towing),
    Towing_Limit: a.towingLimit ?? null,
    IsEMIProtector_Cover: bool01(a.emiProtector),
    NoOfEmi: a.noOfEmi ?? null,
    EMIAmount: num(a.emiAmount),
    NoofUnnamedPerson: num(a.unnamedPersons),
    UnnamedPersonSI: num(a.unnamedPersonSI),
    Voluntary_Excess_Discount: num(a.voluntaryExcess),
    IsLimitedtoOwnPremises: 0,
    TPPDLimit: 0.0,
    NoofnamedPerson: num(a.namedPersons),
    namedPersonSI: num(a.namedPersonSI),
    NamedPersons: a.namedPersonsList ?? null,
    AutoMobile_Assoication_No: a.automobileAssociationNo ?? null,
    fuel_type: null,
    CPA_Tenure: a.cpaTenure != null ? num(a.cpaTenure) : 0,
    payAsYouDrive: a.payAsYouDrive ?? null,
    initialOdometerReading: a.initialOdometerReading ?? null,
    initialOdometerReadingDate: toHdfcDate(a.initialOdometerReadingDate),
    kmsYouExpectToDrive: num(a.kmsYouExpectToDrive),
    IsHighProtection_Cover: bool01(a.highProtection),
    HigherTowingLimit: a.higherTowingLimit ?? null,
    IsLossOfPersonalBelongings_Cover: bool01(a.lossOfPersonalBelongings),
    LossOfPersonalBelonging_SI: num(a.lossOfPersonalBelongingsSI),
    isCoPassengerOptedForLOPB: bool01(a.coPassengerLOPB),
    isElectricMotorCover: electric ? bool01(ev.motorCover != null ? ev.motorCover : 1) : 0,
    isZeroDepClaimforBattery: electric ? bool01(ev.zeroDepBattery != null ? ev.zeroDepBattery : a.zeroDep) : 0,
    isBatteryChargerAccessoryCover: electric ? bool01(ev.batteryChargerCover) : 0,
    NoOfPAPaidDriver: num(a.noOfPaPaidDriver),
  };
}

// --- Roll Over Req_PvtCar (adds PlanType, EMIPlanType; order per collection) ---
function reqPvtCar_Rollover(req) {
  const a = req.addons || {};
  const ev = req.ev || {};
  const p = req.policy || {};
  const electric = isEV(req);
  return {
    PlanType: a.planType ?? null,
    POSP_CODE: a.pospCode ?? null,
    POLICY_TYPE: p.policyType ?? 'OD Plus TP',
    POLICY_TENURE: num(p.tenure, 1),
    ExtensionCountryCode: 0.0,
    ExtensionCountryName: null,
    BreakIN_ID: null,
    BreakInStatus: null,
    BreakInInspectionFlag: null,
    BreakinWaiver: false,
    BreakinInspectionDate: null,
    Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
    NumberOfEmployees: 0,
    NoOfWorkmen: 0,
    NoOfCleanerConductorCoolies: 0,
    BiFuelType: a.biFuelType ?? '',
    BiFuel_Kit_Value: num(a.biFuelKitValue),
    LLPaiddriver: num(a.llPaidDriver),
    PAPaiddriverSI: num(a.paPaidDriverSI),
    Owner_Driver_Nominee_Name: a.nomineeName ?? null,
    Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
    Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
    Owner_Driver_Appointee_Name: a.appointeeName ?? null,
    Owner_Driver_Appointee_Relationship: a.appointeeRelationship ?? null,
    IsZeroDept_Cover: bool01(a.zeroDep),
    IsTyreSecure_Cover: bool01(a.tyreSecure),
    ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
    NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
    OtherLoadDiscRate: 0.0,
    AntiTheftDiscFlag: boolTF(a.antiTheftDisc),
    HandicapDiscFlag: boolTF(a.handicapDisc),
    IsNCBProtection_Cover: bool01(a.ncbProtection),
    IsRTI_Cover: bool01(a.rti),
    RTIPlanType: a.rti ? (a.rtiPlanType || 'A') : '',
    IsCOC_Cover: bool01(a.consumables),
    IsEngGearBox_Cover: bool01(a.engineProtect),
    IsLossofUseDownTimeProt_Cover: bool01(a.downtimeProtect),
    IsEA_Cover: bool01(a.roadsideAssistance),
    IsEAW_Cover: bool01(a.roadsideAssistanceWorldwide),
    IsEAAdvance_Cover: bool01(a.roadsideAssistanceAdvance),
    IsTowing_Cover: bool01(a.towing),
    Towing_Limit: a.towingLimit ?? null,
    IsEMIProtector_Cover: bool01(a.emiProtector),
    NoOfEmi: a.noOfEmi ?? null,
    EMIAmount: num(a.emiAmount),
    EMIPlanType: a.emiPlanType ?? null,
    NoofUnnamedPerson: num(a.unnamedPersons),
    UnnamedPersonSI: num(a.unnamedPersonSI),
    Voluntary_Excess_Discount: num(a.voluntaryExcess),
    IsLimitedtoOwnPremises: 0,
    TPPDLimit: 0.0,
    NoofnamedPerson: num(a.namedPersons),
    namedPersonSI: num(a.namedPersonSI),
    NamedPersons: a.namedPersonsList ?? null,
    AutoMobile_Assoication_No: a.automobileAssociationNo ?? null,
    fuel_type: null,
    CPA_Tenure: a.cpaTenure != null ? num(a.cpaTenure) : 1,
    payAsYouDrive: a.payAsYouDrive ?? null,
    initialOdometerReading: a.initialOdometerReading ?? null,
    initialOdometerReadingDate: toHdfcDate(a.initialOdometerReadingDate),
    IsHighProtection_Cover: bool01(a.highProtection),
    HigherTowingLimit: a.higherTowingLimit ?? null,
    IsLossOfPersonalBelongings_Cover: bool01(a.lossOfPersonalBelongings),
    LossOfPersonalBelonging_SI: num(a.lossOfPersonalBelongingsSI),
    isCoPassengerOptedForLOPB: bool01(a.coPassengerLOPB),
    isElectricMotorCover: electric ? bool01(ev.motorCover != null ? ev.motorCover : 1) : 0,
    isZeroDepClaimforBattery: electric ? bool01(ev.zeroDepBattery != null ? ev.zeroDepBattery : a.zeroDep) : 0,
    isBatteryChargerAccessoryCover: electric ? bool01(ev.batteryChargerCover) : 0,
    NoOfPAPaidDriver: num(a.noOfPaPaidDriver),
  };
}

// --- Used Car Req_PvtCar (distinct order; adds IsFibertank/NumberOfDrivers) ---
function reqPvtCar_Used(req) {
  const a = req.addons || {};
  const p = req.policy || {};
  return {
    POSP_CODE: a.pospCode ?? null,
    POLICY_TYPE: p.policyType ?? '',
    POLICY_TENURE: num(p.tenure, 1),
    ExtensionCountryCode: 0,
    ExtensionCountryName: null,
    BreakIN_ID: null,
    BreakInStatus: null,
    BreakInInspectionFlag: null,
    BreakinWaiver: false,
    BreakinInspectionDate: null,
    Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
    NumberOfEmployees: 0,
    BiFuelType: a.biFuelType ?? null,
    BiFuel_Kit_Value: num(a.biFuelKitValue),
    LLPaiddriver: num(a.llPaidDriver),
    PAPaiddriverSI: num(a.paPaidDriverSI),
    Owner_Driver_Nominee_Name: a.nomineeName ?? null,
    Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
    Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
    Owner_Driver_Appointee_Name: a.appointeeName ?? null,
    Owner_Driver_Appointee_Relationship: a.appointeeRelationship ?? null,
    Towing_Limit: a.towingLimit ?? null,
    IsTowing_Cover: bool01(a.towing),
    IsEAAdvance_Cover: bool01(a.roadsideAssistanceAdvance),
    ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
    NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
    OtherLoadDiscRate: 0,
    AntiTheftDiscFlag: boolTF(a.antiTheftDisc),
    HandicapDiscFlag: boolTF(a.handicapDisc),
    NoofUnnamedPerson: num(a.unnamedPersons),
    UnnamedPersonSI: num(a.unnamedPersonSI),
    Voluntary_Excess_Discount: num(a.voluntaryExcess),
    IsLimitedtoOwnPremises: 0,
    TPPDLimit: 0,
    NoofnamedPerson: num(a.namedPersons),
    namedPersonSI: num(a.namedPersonSI),
    NamedPersons: a.namedPersonsList ?? null,
    AutoMobile_Assoication_No: a.automobileAssociationNo ?? null,
    fuel_type: null,
    CPA_Tenure: a.cpaTenure != null ? num(a.cpaTenure) : 1,
    PayAsYouDrive: a.payAsYouDrive ?? null,
    InitialOdometerReading: a.initialOdometerReading ?? null,
    InitialOdometerReadingDate: toHdfcDate(a.initialOdometerReadingDate),
    IsZeroDept_Cover: bool01(a.zeroDep),
    IsTyreSecure_Cover: bool01(a.tyreSecure),
    IsNCBProtection_Cover: bool01(a.ncbProtection),
    IsRTI_Cover: bool01(a.rti),
    IsCOC_Cover: bool01(a.consumables),
    IsEngGearBox_Cover: bool01(a.engineProtect),
    IsLossofUseDownTimeProt_Cover: bool01(a.downtimeProtect),
    IsEA_Cover: bool01(a.roadsideAssistance),
    IsEAW_Cover: bool01(a.roadsideAssistanceWorldwide),
    IsFibertank: bool01(a.fibertank),
    NoOfWorkmen: 0,
    NumberOfDrivers: num(a.numberOfDrivers),
    IsHighProtection_Cover: bool01(a.highProtection),
    HigherTowingLimit: num(a.higherTowingLimit),
    IsLossOfPersonalBelongings_Cover: bool01(a.lossOfPersonalBelongings),
    LossOfPersonalBelonging_SI: num(a.lossOfPersonalBelongingsSI),
  };
}

function reqPvtCarFor(bt, req) {
  if (bt === 'Roll Over') return reqPvtCar_Rollover(req);
  if (bt === 'Used Car') return reqPvtCar_Used(req);
  return reqPvtCar_New(req);
}

/* ================== Policy_Details templates per type =================== */
function policyDetails_New(req) {
  const v = req.vehicle || {};
  const p = req.policy || {};
  const startDate = p.startDate ? new Date(p.startDate) : new Date();
  const proposalDate = p.proposalDate ? new Date(p.proposalDate) : new Date();
  return {
    PolicyStartDate: toHdfcDate(startDate),
    ProposalDate: toHdfcDate(proposalDate),
    BusinessType_Mandatary: 'New Vehicle',
    VehicleModelCode: String(v.modelCode),
    DateofDeliveryOrRegistration: deliveryOrRegDate(v, startDate),
    DateofFirstRegistration: v.firstRegistrationDate ? toHdfcDate(v.firstRegistrationDate) : null,
    YearOfManufacture: yearOnly(v.manufactureYear, startDate),
    Registration_No: null, // collection uses null; real number would require sections
    EngineNumber: v.engineNumber ? String(v.engineNumber).trim() : null,
    ChassisNumber: v.chassisNumber ? String(v.chassisNumber).trim() : null,
    RTOLocationCode: String(v.rtoCode),
    Vehicle_IDV: num(v.idv),
  };
}

function policyDetails_Rollover(req, opts = {}) {
  const v = req.vehicle || {};
  const p = req.policy || {};
  const pp = req.previousPolicy || {};
  const fin = req.financier || {};
  const startDate = p.startDate ? new Date(p.startDate) : new Date();
  const proposalDate = p.proposalDate ? new Date(p.proposalDate) : new Date();
  // ONLY createProposal needs previous-policy identity (insurer, policy no) to
  // validate claim status. calculatePremium/quote must send null for these —
  // HDFC's premium sample uses null, and a code like "OTHERS" makes premium
  // fail with "No Data found for given previous insured code". So gate on
  // opts.forProposal.
  const forProposal = !!opts.forProposal;
  // HDFC only accepts insurer codes from its own master (e.g. ICICILOMBARD,
  // LIBERTYVIDEOCON). "OTHERS" fails with "No Data found for given previous
  // insured code". Default to a known-valid UAT code; real value preferred.
  const prevInsurer = forProposal ? (pp.insurerCode || pp.insurer || 'ICICILOMBARD') : (pp.insurerCode ?? null);
  const prevPolicyNo = forProposal ? (pp.policyNo || 'NA') : (pp.policyNo ?? null);
  // POLICY_TYPE nusar previous policy type jुळvto. HDFC line 13110
  // (OTHEUW_VALIDATION) — TP Only ghetana previous COMPREHENSIVE dilyas claim
  // validation adte. TP Only -> previous pan Liability. OD/Comprehensive ->
  // Comprehensive Package.
  const isTpOnly = String(p.policyType || '').toUpperCase().includes('TP ONLY') ||
                   String(p.policyType || '').toUpperCase() === 'LIABILITY';
  const defaultPrevType = isTpOnly ? 'Liability Only Package' : 'Comprehensive Package';
  // TP Only asel tar previous type FORCE Liability (frontend ne COMPREHENSIVE
  // pathvle tari), karan tya combination var HDFC validation adte.
  const prevType = forProposal
    ? (isTpOnly ? 'Liability Only Package' : (pp.type || defaultPrevType))
    : (pp.type ?? null);
  const prevEnd = pp.endDate
    ? new Date(pp.endDate)
    : (forProposal ? new Date(startDate.getTime() - 86400000) : null);
  // TP policy details — HDFC underwriting needs these (with claim) for Roll Over.
  // Defaults for proposal when caller doesn't supply. TP start = 1 yr before end.
  const tpEnd = pp.tpEndDate ? new Date(pp.tpEndDate) : (forProposal ? prevEnd : null);
  const tpStart = pp.tpStartDate
    ? new Date(pp.tpStartDate)
    : (forProposal && tpEnd ? new Date(tpEnd.getTime() - 365 * 86400000) : null);
  const tpInsurer = forProposal ? (pp.tpInsurer || prevInsurer) : (pp.tpInsurer ?? null);
  const tpPolicyNo = forProposal ? (pp.tpPolicyNo || prevPolicyNo) : (pp.tpPolicyNo ?? null);
  return {
    PolicyStartDate: toHdfcDate(startDate),
    ProposalDate: toHdfcDate(proposalDate),
    AgreementType: fin.agreementType ?? null,
    FinancierCode: fin.financierCode ?? null,
    BranchName: fin.branchName ?? null,
    PreviousPolicy_CorporateCustomerId_Mandatary: prevInsurer,
    PreviousPolicy_NCBPercentage: num(pp.ncbPercentage),
    PreviousPolicy_PolicyEndDate: prevEnd ? toHdfcDate(prevEnd) : toHdfcDate(pp.endDate),
    PreviousPolicy_PolicyStartDate: toHdfcDate(pp.startDate),
    PreviousPolicy_PolicyNo: prevPolicyNo,
    PreviousPolicy_PolicyClaim: normalizeClaim(pp.claim),
    PreviousPolicy_PreviousPolicyType: prevType,
    PreviousPolicyBusinessType: null,
    PreviousPolicy_TPENDDATE: tpEnd ? toHdfcDate(tpEnd) : toHdfcDate(pp.tpEndDate),
    PreviousPolicy_TPSTARTDATE: tpStart ? toHdfcDate(tpStart) : toHdfcDate(pp.tpStartDate),
    PreviousPolicy_TPINSURER: tpInsurer,
    PreviousPolicy_TPPOLICYNO: tpPolicyNo,
    BusinessType_Mandatary: 'Roll Over',
    VehicleModelCode: String(v.modelCode),
    DateofDeliveryOrRegistration: deliveryOrRegDate(v, startDate),
    DateofFirstRegistration: v.firstRegistrationDate ? toHdfcDate(v.firstRegistrationDate) : null,
    YearOfManufacture: yearOnly(v.manufactureYear, startDate),
    Registration_No: null, // collection uses null in premium
    EngineNumber: v.engineNumber ? String(v.engineNumber).trim() : null,
    ChassisNumber: v.chassisNumber ? String(v.chassisNumber).trim() : null,
    RTOLocationCode: String(v.rtoCode),
    Vehicle_IDV: num(v.idv),
    PreviousPolicy_IsZeroDept_Cover: boolTF(pp.hadZeroDep),
    PreviousPolicy_IsRTI_Cover: boolTF(pp.hadRti),
  };
}

function policyDetails_Used(req) {
  const v = req.vehicle || {};
  const p = req.policy || {};
  const startDate = p.startDate ? new Date(p.startDate) : new Date();
  return {
    PolicyStartDate: toHdfcDate(startDate),
    PreviousPolicy_PolicyStartDate: null,
    PreviousPolicy_PolicyNo: null,
    PreviousPolicy_PreviousPolicyType: null,
    PreviousPolicy_TPENDDATE: null,
    PreviousPolicy_TPSTARTDATE: null,
    PreviousPolicy_TPINSURER: null,
    PreviousPolicy_TPPOLICYNO: null,
    BusinessType_Mandatary: 'Used Car',
    VehicleModelCode: String(v.modelCode),
    DateofDeliveryOrRegistration: deliveryOrRegDate(v, startDate),
    DateofFirstRegistration: toHdfcDate(v.firstRegistrationDate),
    YearOfManufacture: yearOnly(v.manufactureYear, startDate),
    Registration_No: null, // collection uses null in premium
    EngineNumber: v.engineNumber ? String(v.engineNumber).trim() : null,
    ChassisNumber: v.chassisNumber ? String(v.chassisNumber).trim() : null,
    RTOLocationCode: String(v.rtoCode),
    Vehicle_IDV: num(v.idv),
    PolicyEndDate: null,
    EndorsementEffectiveDate: null,
    SumInsured: 0,
    Premium: 0,
  };
}

/* ==================== STEP 03: CalculatePremium ========================= */
function buildCalculatePremium(req) {
  const bt = resolveBusinessType(req);
  let policyDetails;
  if (bt === 'Roll Over') policyDetails = policyDetails_Rollover(req);
  else if (bt === 'Used Car') policyDetails = policyDetails_Used(req);
  else policyDetails = policyDetails_New(req);

  return {
    TransactionID: req.transactionId || generateTransactionId('QB'),
    Policy_Details: policyDetails,
    Req_PvtCar: reqPvtCarFor(bt, req),
  };
}

/* ========================= Customer block =============================== */
// Matches the collection Customer_Details exactly. New/Used include a trailing
// BusinessType_Mandatary:null (collection does this for Used & Renewal); we add
// it only for those cases to mirror the samples.
function buildCustomerDetails(c = {}, { trailingBusinessType = false } = {}) {
  const cd = {
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
  if (trailingBusinessType) cd.BusinessType_Mandatary = null;
  return cd;
}

/* ==================== STEP 04: CreateProposal =========================== */
function buildCreateProposal(req) {
  const v = req.vehicle || {};
  const bt = resolveBusinessType(req);

  // CreateProposal needs the REAL registration number. HDFC's own collection
  // sample uses DASH format: "MH-01-QQ-7878" — NOT MH01QQ7878, and NO
  // registrationNumberSection* fields. So format with dashes, no sections.
  const rawReg = v.registrationNo && String(v.registrationNo).trim().toUpperCase() !== 'NULL'
    ? String(v.registrationNo).trim().toUpperCase()
    : null;
  const realRegNo = formatRegWithDashes(rawReg);   // MH12XT5251 -> MH-12-XT-5251

  // HDFC expects only Registration_No (dash format). No section fields.
  const applyReg = (pd, regNo) => {
    pd.Registration_No = regNo;
    return pd;
  };

  if (bt === 'Roll Over') {
    const pd = applyReg(policyDetails_Rollover(req, { forProposal: true }), realRegNo);
    return {
      TransactionID: req.transactionId || generateTransactionId('PROP'),
      Customer_Details: buildCustomerDetails(req.customer),
      Policy_Details: pd,
      Req_PvtCar: reqPvtCar_Rollover(req),
    };
  }

  if (bt === 'Used Car') {
    const pd = applyReg(policyDetails_Used(req), realRegNo);
    return {
      TransactionID: req.transactionId || generateTransactionId('PROP'),
      Customer_Details: buildCustomerDetails(req.customer, { trailingBusinessType: true }),
      Policy_Details: pd,
      Req_PvtCar: reqPvtCar_Used(req),
    };
  }

  // New Vehicle: collection uses DateofFirstRegistration = "" (empty string).
  const pd = applyReg(policyDetails_New(req), realRegNo || 'New');
  pd.DateofFirstRegistration = v.firstRegistrationDate ? toHdfcDate(v.firstRegistrationDate) : '';
  return {
    TransactionID: req.transactionId || generateTransactionId('PROP'),
    Customer_Details: buildCustomerDetails(req.customer),
    Policy_Details: pd,
    Req_PvtCar: reqPvtCar_New(req),
  };
}

/* ============= STEP 05 / 07: Proposal & Policy documents ================ */
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

/* ==================== STEP 06: SubmitPaymentDetails ===================== */
// Simple envelope (Comprehensive/Rollover/Used/Renewal). Amount is a string.
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

/* ==================== Renewal flow (Req_Renewal based) ================== */
function buildRenewalExtract(req) {
  return {
    TransactionID: req.transactionId || generateTransactionId('REN'),
    Req_Renewal: { Policy_No: req.previousPolicyNo },
  };
}

function buildRenewalCalculatePremium(req) {
  const v = req.vehicle || {};
  const p = req.policy || {};
  const a = req.addons || {};
  return {
    TransactionID: req.transactionId || generateTransactionId('REN'),
    Policy_Details: { Vehicle_IDV: num(v.idv) },
    Req_Renewal: {
      Policy_No: req.previousPolicyNo,
      Vehicle_Regn_No: v.registrationNo ?? '',
    },
    Req_PvtCar: {
      POSP_CODE: a.pospCode ?? null,
      POLICY_TYPE: p.policyType || 'OD Only',
      POLICY_TENURE: num(p.tenure, 1),
      ExtensionCountryCode: 0.0,
      ExtensionCountryName: null,
      BreakIN_ID: null,
      BreakInStatus: null,
      BreakInInspectionFlag: null,
      BreakinWaiver: false,
      BreakinInspectionDate: null,
      Effectivedrivinglicense: boolTF(a.effectiveDrivingLicense),
      NumberOfEmployees: 0,
      BiFuelType: a.biFuelType ?? null,
      BiFuel_Kit_Value: num(a.biFuelKitValue),
      LLPaiddriver: num(a.llPaidDriver),
      PAPaiddriverSI: num(a.paPaidDriverSI),
      Owner_Driver_Nominee_Name: a.nomineeName ?? null,
      Owner_Driver_Nominee_Age: a.nomineeAge ?? 0,
      Owner_Driver_Nominee_Relationship: a.nomineeRelationship ?? null,
      Owner_Driver_Appointee_Name: a.appointeeName ?? null,
      Owner_Driver_Appointee_Relationship: a.appointeeRelationship ?? null,
      IsZeroDept_Cover: bool01(a.zeroDep),
      IsTyreSecure_Cover: bool01(a.tyreSecure),
      ElecticalAccessoryIDV: num(a.electricalAccessoryIdv),
      NonElecticalAccessoryIDV: num(a.nonElectricalAccessoryIdv),
      OtherLoadDiscRate: 0.0,
      AntiTheftDiscFlag: boolTF(a.antiTheftDisc),
      HandicapDiscFlag: boolTF(a.handicapDisc),
      IsNCBProtection_Cover: bool01(a.ncbProtection),
      IsRTI_Cover: bool01(a.rti),
      IsCOC_Cover: bool01(a.consumables),
      IsEngGearBox_Cover: bool01(a.engineProtect),
      IsLossofUseDownTimeProt_Cover: bool01(a.downtimeProtect),
      IsEA_Cover: bool01(a.roadsideAssistance),
      IsEAW_Cover: bool01(a.roadsideAssistanceWorldwide),
      IsEAAdvance_Cover: bool01(a.roadsideAssistanceAdvance),
      IsTowing_Cover: bool01(a.towing),
      Towing_Limit: a.towingLimit ?? null,
      IsEMIProtector_Cover: bool01(a.emiProtector),
      NoOfEmi: a.noOfEmi ?? null,
      EMIAmount: num(a.emiAmount),
      NoofUnnamedPerson: num(a.unnamedPersons),
      UnnamedPersonSI: num(a.unnamedPersonSI),
      Voluntary_Excess_Discount: num(a.voluntaryExcess),
      IsLimitedtoOwnPremises: 0,
      TPPDLimit: 0.0,
      NoofnamedPerson: num(a.namedPersons),
      namedPersonSI: num(a.namedPersonSI),
      NamedPersons: a.namedPersonsList ?? null,
      AutoMobile_Assoication_No: a.automobileAssociationNo ?? '',
      fuel_type: null,
      CPA_Tenure: a.cpaTenure != null ? num(a.cpaTenure) : 1,
      payAsYouDrive: a.payAsYouDrive ?? null,
      initialOdometerReading: a.initialOdometerReading ?? null,
      initialOdometerReadingDate: toHdfcDate(a.initialOdometerReadingDate),
      IsHighProtection_Cover: bool01(a.highProtection),
      HigherTowingLimit: num(a.higherTowingLimit),
      IsLossOfPersonalBelongings_Cover: bool01(a.lossOfPersonalBelongings),
      LossOfPersonalBelonging_SI: num(a.lossOfPersonalBelongingsSI),
      isCoPassengerOptedForLOPB: bool01(a.coPassengerLOPB),
    },
  };
}

function buildRenewalCreateProposal(req) {
  const v = req.vehicle || {};
  const prem = buildRenewalCalculatePremium(req);
  return {
    TransactionID: req.transactionId || generateTransactionId('REN'),
    Policy_Details: { Vehicle_IDV: num(v.idv) },
    Req_Renewal: {
      Policy_No: req.previousPolicyNo,
      Vehicle_Regn_No: v.registrationNo ?? '',
    },
    Customer_Details: buildCustomerDetails(req.customer, { trailingBusinessType: true }),
    Req_PvtCar: prem.Req_PvtCar,
  };
}

module.exports = {
  buildGetCalculateIDV,
  buildCalculatePremium,
  buildCreateProposal,
  buildGetProposalDocument,
  buildGetPolicyDocument,
  buildSubmitPaymentDetails,
  buildRenewalExtract,
  buildRenewalCalculatePremium,
  buildRenewalCreateProposal,
  buildCustomerDetails,
  resolveBusinessType,
  isEV,
};
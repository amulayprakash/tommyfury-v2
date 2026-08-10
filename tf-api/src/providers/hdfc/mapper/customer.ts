import { toHdfcDate } from "../format.ts";
import type { HdfcCustomer } from "../types.ts";

export interface CustomerDetailsOptions {
  /** The Used Car and Renewal samples carry a trailing null BusinessType. */
  trailingBusinessType?: boolean;
}

/**
 * Customer_Details, ported verbatim. HDFC wants empty strings rather than
 * missing keys for unset optional fields.
 *
 * `Customer_Type` was hardcoded "Individual", which made a corporate
 * policyholder inexpressible even though HDFC's own block already carries the
 * three keys a company needs — `Customer_Type`, `Company_Name` and
 * `Customer_GSTIN_Number`. It now follows the canonical
 * `MotorFullQuoteRequest.customerType`, so this is a VALUE change only and the
 * proposal fixtures' key sets are untouched.
 *
 * Note the vendor kit ships a SEPARATE corporate e-KYC document
 * ("Pehchaan Integration KIT - Corporate.docx"), so a corporate proposal also
 * needs a corporate Pehchaan journey — not wired here.
 */
export function buildCustomerDetails(
  c: HdfcCustomer,
  opts: CustomerDetailsOptions = {},
): Record<string, unknown> {
  const corporate = c.customerType === "Corporate";
  const cd: Record<string, unknown> = {
    GC_CustomerID: "",
    IsCustomer_modify: null,
    Company_Name: corporate ? (c.companyName ?? "") : "",
    Customer_Type: corporate ? "Corporate" : "Individual",
    Customer_FirstName: c.firstName ?? "",
    Customer_MiddleName: c.middleName ?? "",
    Customer_LastName: c.lastName ?? "",
    Customer_DateofBirth: toHdfcDate(c.dob),
    Customer_Email: c.email ?? "",
    Customer_Mobile: c.mobile ?? "",
    Customer_Telephone: "",
    Customer_PanNo: c.panNo ?? "",
    Customer_AnnualIncome: null,
    Customer_OrganisationType: null,
    Customer_PepStatus: null,
    Customer_Salutation: c.salutation ?? "MR",
    Customer_Gender: c.gender ?? "MALE",
    Customer_Perm_Address1: c.permAddress1 ?? "",
    Customer_Perm_Address2: c.permAddress2 ?? "",
    Customer_Perm_Apartment: "",
    Customer_Perm_Street: "",
    Customer_Perm_CityDistrictCode: "",
    Customer_Perm_CityDistrict: c.permCityDistrict ?? "",
    Customer_Perm_StateCode: "",
    Customer_Perm_State: c.permState ?? "",
    Customer_Perm_PinCode: c.permPinCode ?? "",
    Customer_Perm_PinCodeLocality: "",
    Customer_Mailing_Address1: c.permAddress1 ?? "",
    Customer_Mailing_Address2: c.permAddress2 ?? "",
    Customer_Mailing_Apartment: "",
    Customer_Mailing_Street: "",
    Customer_Mailing_CityDistrictCode: "",
    Customer_Mailing_CityDistrict: c.permCityDistrict ?? "",
    Customer_Mailing_StateCode: "",
    Customer_Mailing_State: c.permState ?? "",
    Customer_Mailing_PinCode: c.permPinCode ?? "",
    Customer_Mailing_PinCodeLocality: "",
    Customer_GSTIN_Number: c.gstin ?? "",
    Customer_GSTIN_State: "",
    Customer_Professtion: null,
    Customer_MaritalStatus: null,
    Customer_EIA_Number: null,
    Customer_IDProof: null,
    Customer_IDProofNo: null,
    Customer_Nationality: null,
    Customer_UniqueRefNo: null,
    Customer_GSTDetails: null,
    // Pehchaan kyc_id. HDFC refuses issuance when KYC is unverified.
    Customer_Pehchaan_id: c.pehchaanId ?? "",
  };
  if (opts.trailingBusinessType) cd.BusinessType_Mandatary = null;
  return cd;
}

import { vendorClient } from "@/lib/api/vendor-client";
import type {
  ApiEnvelope,
  CanonicalQuote,
  CkycRequest,
  CompareQuotesRequest,
  CompareResponseData,
  CompareResult,
  KycResult,
  MotorFullQuoteRequest,
  OvdDocType,
  OvdResult,
  PolicyStatusResult,
  ProviderInfo,
  ProvidersResponse,
} from "./types";

// ─── Master data (canonical typeahead) ──────────────────────────────────────────

export interface MmvItem {
  id: number;
  makeId: string;
  makeName: string;
  modelId: string;
  modelName: string;
  variantId?: string | null;
  variantName?: string | null;
  fuelType: string;
  engineCC?: number | null;
  category: string;
}

export interface RtoItem {
  id: number;
  code: string;
  city: string;
  state: string;
  stateCode: string;
}

export interface InsurerItem {
  id: number;
  code: string;
  name: string;
  shortName?: string | null;
  logoUrl?: string | null;
}

export async function getProviders(): Promise<ProviderInfo[]> {
  const { data } = await vendorClient.get<ProvidersResponse>("/providers");
  return data.providers;
}

/** A provider's own add-on cover (FG: from the master "Add On Covers" sheet). */
export interface ProviderAddon {
  code: string;
  label: string;
  maxAgeYears?: number | null;
  requiresZeroDep: boolean;
}

export async function getProviderAddons(
  slug: string,
  params: { category: string; fuel?: string },
): Promise<ProviderAddon[]> {
  const { data } = await vendorClient.get<{ addons: ProviderAddon[] }>(
    `/providers/${slug}/addons`,
    { params },
  );
  return data.addons;
}

export async function searchMmv(params: {
  make?: string;
  model?: string;
  category?: string;
}): Promise<MmvItem[]> {
  const { data } = await vendorClient.get<{ results: MmvItem[] }>("/masters/mmv", { params });
  return data.results;
}

export async function searchRto(q: string): Promise<RtoItem[]> {
  const { data } = await vendorClient.get<{ results: RtoItem[] }>("/masters/rto", {
    params: { q },
  });
  return data.results;
}

export async function listInsurers(): Promise<InsurerItem[]> {
  const { data } = await vendorClient.get<{ results: InsurerItem[] }>("/masters/insurers");
  return data.results;
}

// ─── Quotes & lifecycle ─────────────────────────────────────────────────────────

export async function compareQuotes(req: CompareQuotesRequest): Promise<CompareResult[]> {
  const { data } = await vendorClient.post<ApiEnvelope<CompareResponseData>>(
    "/motor/quotes/compare",
    req,
  );
  return data.response.results;
}

export async function fetchFullQuote(
  providerSlug: string,
  req: MotorFullQuoteRequest,
): Promise<CanonicalQuote> {
  const { data } = await vendorClient.post<ApiEnvelope<CanonicalQuote>>(
    `/${providerSlug}/motor/full-quote`,
    req,
  );
  return data.response;
}

export async function completeCkyc(
  providerSlug: string,
  req: CkycRequest,
): Promise<KycResult> {
  const { data } = await vendorClient.post<ApiEnvelope<KycResult>>(
    `/${providerSlug}/kyc/ckyc`,
    req,
  );
  return data.response;
}

export interface OvdUploadBody {
  transactionId: string;
  proofOfIdentityType: OvdDocType;
  proofOfAddressType: OvdDocType;
  proofOfIdentity: File;
  proofOfAddress: File;
}

/** Alternate KYC: uploads ID + address proofs (multipart) to the OVD endpoint. */
export async function initiateOvd(
  providerSlug: string,
  body: OvdUploadBody,
): Promise<OvdResult> {
  const form = new FormData();
  form.append("transactionId", body.transactionId);
  form.append("proofOfIdentityType", body.proofOfIdentityType);
  form.append("proofOfAddressType", body.proofOfAddressType);
  form.append("policyType", "motor");
  form.append("proofOfIdentity", body.proofOfIdentity);
  form.append("proofOfAddress", body.proofOfAddress);
  const { data } = await vendorClient.post<ApiEnvelope<OvdResult>>(
    `/${providerSlug}/kyc/ovd`,
    form,
  );
  return data.response;
}

export async function getPolicyStatus(
  providerSlug: string,
  transactionId: string,
): Promise<PolicyStatusResult> {
  const { data } = await vendorClient.post<ApiEnvelope<PolicyStatusResult>>(
    `/${providerSlug}/policy/status`,
    { transactionId },
  );
  return data.response;
}

// ─── Payment (FG web-aggregator gateway form) ────────────────────────────────

export interface PaymentForm {
  /** Hosted gateway action URL the browser must POST to. */
  url: string;
  /** Signed hidden fields (incl. CheckSum) to submit verbatim. */
  fields: Record<string, string>;
}

export interface PaymentInitiateBody {
  quoteNo: string;
  premiumAmount: number;
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
}

/** Asks the API to build the checksum-signed gateway form for the browser to auto-submit. */
export async function initiatePayment(
  providerSlug: string,
  body: PaymentInitiateBody,
): Promise<PaymentForm> {
  const { data } = await vendorClient.post<{ form: PaymentForm }>(
    `/${providerSlug}/payment/initiate`,
    body,
  );
  return data.form;
}

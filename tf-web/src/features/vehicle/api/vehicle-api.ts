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

import { useMutation, useQuery } from "@tanstack/react-query";

import { lookupRc } from "./rc-lookup";
import {
  compareQuotes,
  completeCkyc,
  fetchFullQuote,
  getPolicyStatus,
  getProviderAddons,
  getProviders,
  initiateOvd,
  initiatePayment,
  listInsurers,
  searchMmv,
  searchRto,
  type OvdUploadBody,
  type PaymentInitiateBody,
} from "./vehicle-api";
import type { CkycRequest, CompareQuotesRequest, MotorFullQuoteRequest } from "./types";

export function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: getProviders,
    staleTime: 5 * 60_000,
  });
}

export function useRcLookup() {
  return useMutation({ mutationFn: (rcNumber: string) => lookupRc(rcNumber) });
}

export function useMmvSearch(
  params: { make?: string; model?: string; category?: string },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["mmv", params],
    queryFn: () => searchMmv(params),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** RTO typeahead (by code or city) — backs the new-vehicle manual-entry form. */
export function useRtoSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["rto", q],
    queryFn: () => searchRto(q),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useInsurers() {
  return useQuery({ queryKey: ["insurers"], queryFn: listInsurers, staleTime: 10 * 60_000 });
}

/** A selected provider's own add-on catalog (enabled once a provider is chosen). */
export function useProviderAddons(
  slug: string | null,
  category: string,
  fuel: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["provider-addons", slug, category, fuel],
    queryFn: () => getProviderAddons(slug as string, { category, fuel }),
    enabled: enabled && Boolean(slug),
    staleTime: 5 * 60_000,
  });
}

export function useCompareQuotes() {
  return useMutation({ mutationFn: (req: CompareQuotesRequest) => compareQuotes(req) });
}

/** Auto-refetching compare query — refreshes whenever the request changes. */
export function useCompareQuotesQuery(req: CompareQuotesRequest | null) {
  return useQuery({
    queryKey: ["compare", req],
    queryFn: () => compareQuotes(req as CompareQuotesRequest),
    enabled: req !== null,
    staleTime: 30_000,
  });
}

export function useFullQuote() {
  return useMutation({
    mutationFn: ({ provider, req }: { provider: string; req: MotorFullQuoteRequest }) =>
      fetchFullQuote(provider, req),
  });
}

export function useCkyc() {
  return useMutation({
    mutationFn: ({ provider, req }: { provider: string; req: CkycRequest }) =>
      completeCkyc(provider, req),
  });
}

export function useOvd() {
  return useMutation({
    mutationFn: ({ provider, body }: { provider: string; body: OvdUploadBody }) =>
      initiateOvd(provider, body),
  });
}

export function usePolicyStatus() {
  return useMutation({
    mutationFn: ({ provider, transactionId }: { provider: string; transactionId: string }) =>
      getPolicyStatus(provider, transactionId),
  });
}

export function useInitiatePayment() {
  return useMutation({
    mutationFn: ({ provider, body }: { provider: string; body: PaymentInitiateBody }) =>
      initiatePayment(provider, body),
  });
}

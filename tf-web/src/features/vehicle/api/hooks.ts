import { useMutation, useQuery } from "@tanstack/react-query";

import { lookupRc } from "./rc-lookup";
import {
  compareQuotes,
  completeCkyc,
  fetchFullQuote,
  getPolicyStatus,
  getProviders,
  listInsurers,
  searchMmv,
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

export function useInsurers() {
  return useQuery({ queryKey: ["insurers"], queryFn: listInsurers, staleTime: 10 * 60_000 });
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

export function usePolicyStatus() {
  return useMutation({
    mutationFn: ({ provider, transactionId }: { provider: string; transactionId: string }) =>
      getPolicyStatus(provider, transactionId),
  });
}

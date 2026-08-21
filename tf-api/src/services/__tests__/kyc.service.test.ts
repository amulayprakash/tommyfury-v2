import { describe, it, expect, vi, afterEach } from "vitest";
import { completeCkyc } from "@/services/kyc.service.ts";
import { registerProvider, clearRegistry } from "@/providers/provider-registry.ts";
import type { KycCapableProvider } from "@/providers/insurance-provider.ts";
import type { ProviderOperation } from "@/contracts/enums.ts";
import type { CkycRequest, KycResult } from "@/contracts/kyc.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";

// The gate must reject *before* anything is persisted, so the repository is
// stubbed: a corporate request that reached this would be the bug under test.
const attachKyc = vi.fn(async () => undefined);
vi.mock("@/repositories/quote.repository.ts", () => ({
  attachKyc: (...args: unknown[]) => attachKyc(...(args as [])),
}));

const completeCkycSpy = vi.fn(async () => ({ isKycSuccess: true, kycId: "K1" }) as KycResult);

/** A provider declaring plain `ckyc` only — the shape every provider has today. */
function fakeKycProvider(slug: string, operations: ProviderOperation[]): KycCapableProvider {
  return {
    slug,
    displayName: slug,
    capabilities: new Set(),
    operations: new Set(operations),
    motorCapabilities: {},
    getQuote: async () => ({}) as CanonicalQuoteResult,
    getFullQuote: async () => ({}) as CanonicalQuoteResult,
    completeCkyc: completeCkycSpy,
    initiateOvd: async () => ({ isKycSuccess: true }),
  } as unknown as KycCapableProvider;
}

const corporateReq = {
  transactionId: "TXN-1",
  dob: "2007-11-20",
  customerType: "corporate",
  entityPan: "AADCC2489H",
  dateOfIncorporation: "2007-11-20",
  entityType: "company",
  policyType: "motor",
} as CkycRequest;

const individualReq = {
  transactionId: "TXN-2",
  dob: "1996-07-22",
  panNumber: "BXGPG2512P",
  policyType: "motor",
} as CkycRequest;

afterEach(() => {
  clearRegistry();
  attachKyc.mockClear();
  completeCkycSpy.mockClear();
});

describe("kyc.service completeCkyc — corporate capability gate", () => {
  it("rejects a corporate request for a provider that does not declare corporateCkyc", async () => {
    // FG/ICICI/ITGI are in exactly this position: they do e-KYC, but only for
    // individuals. Dispatching an entity-shaped request at them would send
    // entity fields to a mapper that silently ignores every one of them.
    registerProvider(fakeKycProvider("fg-like", ["ckyc"]));

    await expect(completeCkyc("fg-like", corporateReq)).rejects.toMatchObject({
      statusCode: 422,
      code: "PROVIDER_OPERATION_ERROR",
      message: expect.stringContaining("corporateCkyc"),
    });
    expect(completeCkycSpy).not.toHaveBeenCalled();
  });

  it("lets a corporate request through once the provider declares corporateCkyc", async () => {
    registerProvider(fakeKycProvider("hdfc-like", ["ckyc", "corporateCkyc"]));

    const out = await completeCkyc("hdfc-like", corporateReq);
    expect(out.kycId).toBe("K1");
    expect(completeCkycSpy).toHaveBeenCalledOnce();
  });

  it("never applies the corporate gate to an individual request", async () => {
    // Proves the gate keys off customerType, not off the provider alone.
    registerProvider(fakeKycProvider("fg-like", ["ckyc"]));

    const out = await completeCkyc("fg-like", individualReq);
    expect(out.kycId).toBe("K1");
    expect(attachKyc).toHaveBeenCalledWith("fg-like", "TXN-2", "K1");
  });

  it("still rejects a provider that declares neither ckyc nor corporateCkyc", async () => {
    registerProvider(fakeKycProvider("no-kyc", ["quote"]));

    await expect(completeCkyc("no-kyc", individualReq)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('"ckyc"'),
    });
  });
});

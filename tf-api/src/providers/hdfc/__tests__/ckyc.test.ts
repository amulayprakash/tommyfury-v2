import { describe, it, expect, vi, beforeEach } from "vitest";
import { hdfcCompleteCkyc, toPehchaanParams, normalizePehchaan } from "../ckyc.ts";
import type { HdfcConfig } from "../config.ts";
import type { CkycRequest } from "@/contracts/kyc.ts";
import { tokenManager } from "@/providers/token-manager.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "S",
  channelId: "C",
  credential: "x",
  productCode: "2311",
  tokenTtlSeconds: 1500,
  kyc: {
    baseUrl: "https://kyc.example/e-kyc",
    apiKey: "api-key-1",
    tokenTtlSeconds: 480,
    returnUrl: "https://app.example/kyc-return",
  },
};

const req: CkycRequest = {
  transactionId: "TXN-1",
  dob: "1996-07-22",
  panNumber: "BXGPG2512P",
  policyType: "motor",
} as CkycRequest;

describe("toPehchaanParams", () => {
  it("converts the canonical request into Pehchaan's query parameters", () => {
    const p = toPehchaanParams(req, config);
    expect(p.pan).toBe("BXGPG2512P");
    // Pehchaan wants DD/MM/YYYY, not ISO.
    expect(p.dob).toBe("22/07/1996");
    expect(p.redirect_url).toBe("https://app.example/kyc-return");
  });

  it("uses ckycNumber as the kyc_id lookup key when supplied", () => {
    // This is how the status poll works after the hosted journey returns.
    const p = toPehchaanParams({ ...req, panNumber: undefined, ckycNumber: "KYC-99" }, config);
    expect(p.kyc_id).toBe("KYC-99");
    expect(p.pan).toBeUndefined();
  });

  it("forwards name and mobile when present", () => {
    const p = toPehchaanParams({ ...req, fullName: "MAHENDRA", mobile: "7387005111" }, config);
    expect(p.name).toBe("MAHENDRA");
    expect(p.mobile).toBe("7387005111");
  });

  it("omits empty values entirely rather than sending blanks", () => {
    const p = toPehchaanParams({ ...req, fullName: "" } as CkycRequest, config);
    expect("name" in p).toBe(false);
  });
});

describe("normalizePehchaan", () => {
  it("maps a verified response onto the canonical KycResult", () => {
    const out = normalizePehchaan({
      status: true,
      data: {
        iskycVerified: 1,
        kyc_id: "KYC-99",
        name: "MAHENDRA GHANCHI",
        dob: "22/07/1996",
        email: "m@example.com",
        mobile: "7387005111",
        pan: "BXGPG2512P",
        permanentAddress: "12 Main St",
        status: "approved",
      },
    });
    expect(out.isKycSuccess).toBe(true);
    expect(out.kycId).toBe("KYC-99");
    expect(out.name).toBe("MAHENDRA GHANCHI");
    expect(out.permanentAddress).toBe("12 Main St");
    expect(out.requiresRedirect).toBeFalsy();
  });

  it("maps a not-found response onto the redirect shape FG already uses", () => {
    const out = normalizePehchaan({
      status: false,
      data: { redirection_link: "https://pehchaan.example/j/abc", txn_id: "TX-7" },
    });
    expect(out.isKycSuccess).toBe(false);
    expect(out.requiresRedirect).toBe(true);
    expect(out.redirectUrl).toBe("https://pehchaan.example/j/abc");
    expect(out.ckycRefId).toBe("TX-7");
  });

  it("treats a pending verification as unverified", () => {
    const out = normalizePehchaan({ data: { iskycVerified: 0, status: "pending for verification" } });
    expect(out.isKycSuccess).toBe(false);
    expect(out.displayMessage).toContain("pending");
  });

  it("treats a rejected KYC as unverified", () => {
    const out = normalizePehchaan({ data: { iskycVerified: 0, status: "rejected" } });
    expect(out.isKycSuccess).toBe(false);
  });
});

describe("hdfcCompleteCkyc", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // The Pehchaan JWT is cached in the shared tokenManager singleton, which
    // persists across tests in this file — invalidate so each test mints its
    // own token instead of reusing one cached by an earlier test.
    tokenManager.invalidate("hdfc:kyc");
  });

  function jsonResponse(body: unknown, status = 200) {
    return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
  }

  it("mints a token then calls the verified-KYC endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1", expiry: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { iskycVerified: 1, kyc_id: "K1" } }));

    const out = await hdfcCompleteCkyc(config, req);
    expect(out.kycId).toBe("K1");

    const tokenCall = fetchMock.mock.calls[0]!;
    expect(String(tokenCall[0])).toContain("/tgt/generate-token");
    expect((tokenCall[1] as RequestInit).headers).toMatchObject({ api_key: "api-key-1" });

    const kycCall = fetchMock.mock.calls[1]!;
    expect(String(kycCall[0])).toContain("/primary/kyc-verified");
    expect((kycCall[1] as RequestInit).headers).toMatchObject({ token: "jwt-1" });
  });

  it("refreshes the token once and retries on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1" } }))
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-2" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { iskycVerified: 1, kyc_id: "K1" } }));

    const out = await hdfcCompleteCkyc(config, req);
    expect(out.kycId).toBe("K1");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails clearly when the api_key is not configured", async () => {
    const noKey = { ...config, kyc: { ...config.kyc, apiKey: "" } };
    await expect(hdfcCompleteCkyc(noKey, req)).rejects.toThrow(/HDFC_KYC_API_KEY/);
  });
});

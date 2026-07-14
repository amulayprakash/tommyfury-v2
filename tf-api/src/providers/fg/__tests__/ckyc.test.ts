import { describe, it, expect, vi, afterEach } from "vitest";
import { fgVerifyCkyc, fgGetCkycStatus } from "../ckyc.ts";
import { FgProvider } from "../fg.provider.ts";
import type { FgConfig } from "../config.ts";
import type { CkycRequest } from "@/contracts/kyc.ts";
import type { ProviderContext } from "@/providers/insurance-provider.ts";

const config = {
  vendorCode: "Webagg",
  ckyc: {
    baseUrl: "https://uat.example.com:8243/GCKYC/3.0.0",
    tokenUrl: "https://uat.example.com:9443/oauth2/token",
    clientBasic: "Y2t5YzpiYXNpYw==",
    subscriptionToken: "sub-token",
  },
} as unknown as FgConfig;

const baseReq: CkycRequest = {
  transactionId: "0000771450",
  dob: "1990-01-01",
  panNumber: "ABCDE1234F",
  fullName: "John Doe",
  mobile: "9876543210",
  gender: "M",
  policyType: "motor",
} as CkycRequest;

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async (_url: string, init?: { body?: string; headers?: Record<string, string> }) => ({
    ok,
    status: ok ? 200 : 502,
    text: async () => JSON.stringify(body),
    _init: init,
  })) as unknown as typeof fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("FG VerifyCKYC", () => {
  it("posts the mapped body with the subscription Token header", async () => {
    const fetchMock = mockFetch({ apiStatus: "Success", response: { proposal_id: "PR_1" } });
    vi.stubGlobal("fetch", fetchMock);

    await fgVerifyCkyc(config, baseReq, "tok");

    const calls = (fetchMock as unknown as { mock: { calls: [string, { body: string; headers: Record<string, string> }][] } }).mock.calls;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://uat.example.com:8243/GCKYC/3.0.0/Web/VerifyCKYC");
    expect(init.headers.Token).toBe("sub-token");
    expect(init.headers.Authorization).toBe("Bearer tok");
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({
      id_type: "PAN",
      id_num: "ABCDE1234F",
      dob: "1990-01-01",
      mobile: "9876543210",
      full_name: "John Doe",
      customer_type: "I",
      system_name: "Webagg",
    });
  });

  it("maps an auto-match to a successful KycResult", async () => {
    vi.stubGlobal("fetch", mockFetch({ apiStatus: "Success", kycStatus: 1, response: { proposal_id: "PR_2" } }));
    const r = await fgVerifyCkyc(config, baseReq, "tok");
    expect(r.isKycSuccess).toBe(true);
    expect(r.proposalId).toBe("PR_2");
  });

  it("captures the CKYC number a registry hit delivers directly in the response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        apiStatus: "Success",
        kycStatus: 1,
        response: {
          req_id: "REQ_5",
          proposal_id: "PR_5",
          ckyc_remarks: "OK",
          ckyc_number: "40053862382888",
          url: null,
        },
      }),
    );
    const r = await fgVerifyCkyc(config, baseReq, "tok");
    expect(r.isKycSuccess).toBe(true);
    expect(r.ckycNumber).toBe("40053862382888");
    expect(r.kycId).toBe("40053862382888");
    expect(r.ckycRefId).toBe("PR_5");
  });

  it("surfaces the manual-KYC redirect when no record is found", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        apiStatus: "Success",
        kycStatus: 0,
        response: { proposal_id: "PR_3", ckyc_remarks: "No record found", url: "https://ekyc-uat.fggeneral.in/kyc?access=x" },
      }),
    );
    const r = await fgVerifyCkyc(config, baseReq, "tok");
    expect(r.isKycSuccess).toBe(false);
    expect(r.requiresRedirect).toBe(true);
    expect(r.redirectUrl).toContain("ekyc-uat.fggeneral.in");
    expect(r.proposalId).toBe("PR_3");
  });

  it("returns a failure result on apiStatus Failed", async () => {
    vi.stubGlobal("fetch", mockFetch({ apiStatus: "Failed", errorMessage: "Error Calling KYC Services" }));
    const r = await fgVerifyCkyc(config, baseReq, "tok");
    expect(r.isKycSuccess).toBe(false);
    expect(r.displayMessage).toContain("Error Calling KYC");
  });

  it("rejects when mobile/full name are missing (FG-mandatory)", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    await expect(
      fgVerifyCkyc(config, { ...baseReq, mobile: undefined, fullName: undefined } as CkycRequest, "tok"),
    ).rejects.toThrow(/mobile and full name/i);
  });
});

describe("FG GetKycStatus", () => {
  it("posts {proposal_id, system_name} to /Verify/GetKycStatus and digs the nested ckycNumber", async () => {
    const fetchMock = mockFetch({
      apiStatus: "Success",
      kycStatus: 1,
      response: {
        finalStatus: "1",
        proposalId: "PR_1",
        success: true,
        message: "KYC completed",
        uploadedDocuments: { full_name: "John Doe", ckycNumber: "40012345678901" },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await fgGetCkycStatus(config, "PR_1", "tok");

    const calls = (fetchMock as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://uat.example.com:8243/GCKYC/3.0.0/Verify/GetKycStatus");
    expect(JSON.parse(init.body)).toEqual({ proposal_id: "PR_1", system_name: "Webagg" });
    expect(r.ckycNumber).toBe("40012345678901");
    expect(r.success).toBe(true);
    expect(r.status).toBe("1");
  });

  it("reports an incomplete KYC (no number) without failing", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        apiStatus: "Success",
        kycStatus: 1,
        response: {
          finalStatus: "0",
          proposalId: "PR_1",
          success: false,
          message: "KYC not completed",
          uploadedDocuments: { ckycNumber: null },
        },
      }),
    );
    const r = await fgGetCkycStatus(config, "PR_1", "tok");
    expect(r.ckycNumber).toBeUndefined();
    expect(r.success).toBe(false);
    expect(r.message).toBe("KYC not completed");
  });
});

describe("FG token 401 retry", () => {
  it("mints a fresh token and retries once when FG rejects the cached one", async () => {
    let mints = 0;
    const provider = new FgProvider({
      config,
      ckycTokenProvider: async () => `tok${++mints}`,
    });

    // First token is rejected by the gateway (the live-observed early
    // invalidation); the retry's fresh token succeeds.
    const fetchMock = vi.fn(
      async (_url: string, init?: { headers?: Record<string, string> }) => {
        if (init?.headers?.Authorization === "Bearer tok1") {
          return { ok: false, status: 401, text: async () => '{"code":"900901"}' };
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ apiStatus: "Success", kycStatus: 1, response: { proposal_id: "PR_9" } }),
        };
      },
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const r = await provider.completeCkyc(baseReq, { requestId: "test" } as ProviderContext);

    expect(r.isKycSuccess).toBe(true);
    expect(r.proposalId).toBe("PR_9");
    // Call 1: VerifyCKYC with tok1 → 401. Call 2: retried with fresh tok2 →
    // success. Call 3: the follow-up GetKycStatus (its own get(), tok3 — the
    // real TokenManager would serve the cached tok2 here; the test override
    // mints per call).
    const auths = (fetchMock as unknown as { mock: { calls: [string, { headers: Record<string, string> }][] } })
      .mock.calls.map(([, init]) => init.headers.Authorization);
    expect(auths).toEqual(["Bearer tok1", "Bearer tok2", "Bearer tok3"]);
    expect(mints).toBe(3);
  });
});

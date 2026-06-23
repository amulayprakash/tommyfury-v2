import { describe, it, expect, vi, afterEach } from "vitest";
import { fgVerifyCkyc } from "../ckyc.ts";
import type { FgConfig } from "../config.ts";
import type { CkycRequest } from "@/contracts/kyc.ts";

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

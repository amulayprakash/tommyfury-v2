import { describe, it, expect, vi, afterEach } from "vitest";
import { fgVerifyCkyc, fgGetCkycStatus, fgUploadDocBytes, fgCkycDocType } from "../ckyc.ts";
import { FgProvider } from "../fg.provider.ts";
import type { FgConfig } from "../config.ts";
import type { CkycRequest, OvdRequest, OvdFile } from "@/contracts/kyc.ts";
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
      // FG wants dd-mm-yyyy, not the canonical ISO yyyy-mm-dd on the request.
      dob: "01-01-1990",
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

describe("FG UploadDocBytes", () => {
  it("posts the doc bytes + system_name to /Verify/UploadDocBytes", async () => {
    const fetchMock = mockFetch({
      extracted_data: { name: "BIRESHWAR", dob: "17-01-2001", address: "C-38 …" },
      doc_type: "aadhar",
      image_quality: "good",
      req_id: "REQ_1",
      success: true,
      error_message: "",
      verify_data: { status: true, code: 200, message: "" },
      proposal_id: "PR_OX61LYNZVO",
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await fgUploadDocBytes(
      config,
      { reqId: "REQ_1", proposalId: "PR_OX61LYNZVO", docType: "pdf", docBase64: "JVBERi0=" },
      "tok",
    );

    const calls = (fetchMock as unknown as { mock: { calls: [string, { body: string; headers: Record<string, string> }][] } }).mock.calls;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://uat.example.com:8243/GCKYC/3.0.0/Verify/UploadDocBytes");
    expect(init.headers.Token).toBe("sub-token");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      req_id: "REQ_1",
      proposal_id: "PR_OX61LYNZVO",
      doc_type: "pdf",
      // Live UAT 400s without doc_bytes + system_name; doc_base64 is kept for
      // deployments that follow FGI-CKYC-API-DOC.docx §4.
      doc_bytes: "JVBERi0=",
      doc_base64: "JVBERi0=",
      system_name: "Webagg",
    });
    expect(r.isVerified).toBe(true);
    expect(r.extractedName).toBe("BIRESHWAR");
    expect(r.imageQuality).toBe("good");
    expect(r.proposalId).toBe("PR_OX61LYNZVO");
  });

  it("treats a rejected document (verify_data.status false, code 422) as not verified", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        extracted_data: { name: null },
        doc_type: "aadhar",
        image_quality: null,
        req_id: "REQ_2",
        success: true,
        error_message: "",
        verify_data: { status: false, code: 422, message: "Invalid Aadhaar Number" },
        proposal_id: "PR_2",
      }),
    );
    const r = await fgUploadDocBytes(
      config,
      { reqId: "REQ_2", proposalId: "PR_2", docType: "aadhar", docBase64: "AAAA" },
      "tok",
    );
    expect(r.isVerified).toBe(false);
    expect(r.message).toBe("Invalid Aadhaar Number");
    expect(r.proposalId).toBe("PR_2");
  });

  // Live UAT (2026-08-04) answers with the VerifyCKYC-style envelope, not the
  // flat body the vendor doc shows. Reading only the flat shape made isVerified
  // permanently false for a document FG had actually accepted.
  it("reads the live envelope shape (apiStatus + kycStatus 1) as verified", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        uid: "6ad5b195fc9f4c26a41583f3e04be6d4",
        apiStatus: "Success",
        kycStatus: 1,
        response: {
          image_quality: "average",
          doc_type: "pancard",
          req_id: "REQ_3",
          proposal_id: "PR_3",
          ckyc_remarks: null,
        },
        errorMessage: null,
      }),
    );
    const r = await fgUploadDocBytes(
      config,
      { reqId: "REQ_3", proposalId: "PR_3", docType: "pan", docBase64: "AAAA" },
      "tok",
    );
    expect(r.isVerified).toBe(true);
    expect(r.imageQuality).toBe("average");
    expect(r.proposalId).toBe("PR_3");
  });

  it("treats a non-accepting envelope (kycStatus 0) as not verified", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        apiStatus: "Success",
        kycStatus: 0,
        response: { proposal_id: "PR_4", ckyc_remarks: "Image quality too poor" },
        errorMessage: null,
      }),
    );
    const r = await fgUploadDocBytes(
      config,
      { reqId: "REQ_4", proposalId: "PR_4", docType: "pan", docBase64: "AAAA" },
      "tok",
    );
    expect(r.isVerified).toBe(false);
    expect(r.message).toBe("Image quality too poor");
  });

  it("fgCkycDocType maps pdf mime to 'pdf' and Aadhaar image to 'aadhar'", () => {
    expect(fgCkycDocType("application/pdf", "AADHAAR")).toBe("pdf");
    expect(fgCkycDocType("image/jpeg", "AADHAAR")).toBe("aadhar");
    expect(fgCkycDocType("image/png", "PAN")).toBe("pan");
  });
});

describe("FgProvider.initiateOvd", () => {
  const ovdReq: OvdRequest = {
    transactionId: "0000771450",
    proofOfIdentityType: "AADHAAR",
    proofOfAddressType: "AADHAAR",
    policyType: "motor",
    proposalId: "PR_OX61LYNZVO",
  } as OvdRequest;

  const file: OvdFile = {
    fieldName: "proofOfIdentity",
    originalName: "aadhaar.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("hello-doc"),
  };

  it("uploads the document base64 and maps a verified result to isKycSuccess", async () => {
    const fetchMock = mockFetch({
      extracted_data: { name: "John Doe" },
      doc_type: "aadhar",
      image_quality: "good",
      req_id: "test",
      success: true,
      error_message: "",
      verify_data: { status: true, code: 200, message: "" },
      proposal_id: "PR_OX61LYNZVO",
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new FgProvider({ config, ckycTokenProvider: async () => "tok" });
    const r = await provider.initiateOvd(ovdReq, [file], { requestId: "test" } as ProviderContext);

    const calls = (fetchMock as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://uat.example.com:8243/GCKYC/3.0.0/Verify/UploadDocBytes");
    const sent = JSON.parse(init.body);
    expect(sent.proposal_id).toBe("PR_OX61LYNZVO");
    expect(sent.doc_type).toBe("pdf");
    expect(sent.doc_base64).toBe(Buffer.from("hello-doc").toString("base64"));
    expect(r.isKycSuccess).toBe(true);
    expect(r.customerName).toBe("John Doe");
    expect(r.proposalId).toBe("PR_OX61LYNZVO");
    expect(r.kycId).toBe("PR_OX61LYNZVO");
  });

  it("rejects when the CKYC proposalId is missing", async () => {
    const provider = new FgProvider({ config, ckycTokenProvider: async () => "tok" });
    await expect(
      provider.initiateOvd({ ...ovdReq, proposalId: undefined } as OvdRequest, [file], {
        requestId: "test",
      } as ProviderContext),
    ).rejects.toThrow(/proposalId/i);
  });
});

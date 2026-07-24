import { describe, it, expect, vi, afterEach } from "vitest";
import { FetchTransport, assertFgSuccess, parseSoapResponse, classifyFgError } from "../http.ts";

afterEach(() => vi.unstubAllGlobals());

describe("FetchTransport — JSON mode (motor)", () => {
  it("POSTs a JSON body with bearer + json headers and parses the JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ Root: { Client: { QuotationNo: "0000925782" } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const body = await new FetchTransport().request({
      method: "POST",
      url: "https://gw.example.com/MotorAPI/1.0.0/GetQuote",
      token: "tok-123",
      jsonBody: { Uid: "req-1", VendorCode: "Webagg" },
    });

    expect(body).toEqual({ Root: { Client: { QuotationNo: "0000925782" } } });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://gw.example.com/MotorAPI/1.0.0/GetQuote");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok-123");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.accept).toBe("*/*");
    expect(JSON.parse(init.body as string)).toEqual({ Uid: "req-1", VendorCode: "Webagg" });
  });

  it("throws a ProviderError carrying the upstream status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    await expect(
      new FetchTransport().request({ method: "POST", url: "https://gw/x", token: "t", jsonBody: {} }),
    ).rejects.toMatchObject({ upstreamStatus: 401, providerSlug: "fg" });
  });

  it("marks a FG 5xx (IIS outage) as UPSTREAM_UNAVAILABLE with a friendly message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>500 - Internal server error</html>", { status: 500 })),
    );
    await expect(
      new FetchTransport().request({ method: "POST", url: "https://gw/x", token: "t", jsonBody: {} }),
    ).rejects.toMatchObject({ upstreamStatus: 500, code: "UPSTREAM_UNAVAILABLE" });
  });
});

describe("classifyFgError", () => {
  it("classifies FG BANCS reinsurance/system exceptions as UPSTREAM_UNAVAILABLE (transient)", () => {
    expect(classifyFgError("POLICY HAS NOT BEEN ISSUED due to User-Defined Exception from Reinsurance")).toBe(
      "UPSTREAM_UNAVAILABLE",
    );
    expect(classifyFgError("Error During Quote Issuance")).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("keeps user-actionable declines/KYC/break-in as their specific codes", () => {
    expect(classifyFgError("Referral due to: Declined Vehicle")).toBe("REFERRAL_DECLINED");
    expect(classifyFgError("CKYC error: No record exist.")).toBe("KYC_INCOMPLETE");
    expect(classifyFgError("This is a break-in scenario")).toBe("INSPECTION_REQUIRED");
  });
});

describe("assertFgSuccess — JSON business failures (HTTP 200)", () => {
  it("passes when every block Status is Successful", () => {
    const root = {
      Client: { Status: "Successful", QuotationNo: "0000925782" },
      Receipt: { Status: "Successful" },
      Policy: { Status: "Successful" },
    };
    expect(() => assertFgSuccess(root, "get-quote")).not.toThrow();
  });

  it("surfaces the vendor-validation failure with a VENDOR_CONFIG code", () => {
    const root = {
      Policy: { Status: "Fail" },
      Error: "Vendor Validation Failed",
      ErrorMessage: "VendorCode and VendorUserId must be same",
    };
    try {
      assertFgSuccess(root, "get-quote");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/VendorCode and VendorUserId must be same/);
      expect((err as { code?: string }).code).toBe("VENDOR_CONFIG");
    }
  });

  it("unwraps a nested CKYC error and classifies it as KYC_INCOMPLETE", () => {
    const root = {
      Client: {},
      Policy: { Status: "Fail" },
      Error: "CKYC error",
      ErrorMessage:
        '{"Success":false,"Final_Status":"0","message":"No record exist.","Proposal_ID":"PR_4UTNLVSSP87"}',
    };
    try {
      assertFgSuccess(root, "create-proposal");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toBe("FG create-proposal failed: CKYC error: No record exist.");
      expect((err as { code?: string }).code).toBe("KYC_INCOMPLETE");
    }
  });
});

describe("parseSoapResponse — retained health SOAP path", () => {
  it("unwraps a SOAP envelope's escaped inner <Root> into the business object", () => {
    const envelope =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
      "<soap:Body>" +
      '<GetQuoteResponse xmlns="http://tempuri.org/">' +
      "<GetQuoteResult>" +
      "&lt;Root&gt;&lt;Client&gt;&lt;QuotationNo&gt;0000925782&lt;/QuotationNo&gt;&lt;/Client&gt;&lt;/Root&gt;" +
      "</GetQuoteResult>" +
      "</GetQuoteResponse>" +
      "</soap:Body>" +
      "</soap:Envelope>";

    const root = parseSoapResponse(envelope) as { Client: { QuotationNo: string } };
    expect(root.Client.QuotationNo).toBe("0000925782");
  });
});

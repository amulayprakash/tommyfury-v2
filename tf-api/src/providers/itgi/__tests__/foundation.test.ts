import { describe, it, expect } from "vitest";
import {
  ITGI_SLUG,
  ITGI_DISPLAY_NAME,
  ITGI_CAPABILITIES,
  ITGI_OPERATIONS,
  ITGI_COVERAGE,
  itgiCoverageName,
} from "../config.ts";
import {
  assertItgiSuccess,
  classifyItgiError,
  ItgiUnmappedCodeError,
  isItgiSuccessMessage,
} from "../errors.ts";
import {
  toItgiDate,
  toItgiDateTime,
  splitRegistrationNumber,
  makeUniqueQuoteId,
  itgiContractType,
  xmlEscape,
} from "../format.ts";
import { parseItgiSoap, soapEnvelope, FetchItgiTransport } from "../http.ts";
import { ProviderError } from "@/errors/app-error.ts";

describe("itgi config", () => {
  it("identifies the provider", () => {
    expect(ITGI_SLUG).toBe("itgi");
    expect(ITGI_DISPLAY_NAME).toBe("IFFCO-Tokio");
  });

  it("supports car, two-wheeler and new vehicle but not commercial", () => {
    expect(ITGI_CAPABILITIES.has("fourWheeler")).toBe(true);
    expect(ITGI_CAPABILITIES.has("twoWheeler")).toBe(true);
    expect(ITGI_CAPABILITIES.has("newVehicle")).toBe(true);
    expect(ITGI_CAPABILITIES.has("commercial")).toBe(false);
  });

  it("declares only the lifecycle operations it actually implements", () => {
    for (const op of ["quote", "proposal", "ckyc", "ovd", "issuance", "policyStatus", "coi"] as const) {
      expect(ITGI_OPERATIONS.has(op), op).toBe(true);
    }
  });

  it("omits operations the vendor exposes no API for", () => {
    // ITGI has no retrieve-quote-by-id, no renewal API, and no create-inspection
    // endpoint. Declaring them would make the capability type-guards lie.
    // (OD renewal is still supported as a policy TYPE; break-in is still
    // supported as a modifier inside the normal quote/proposal flow.)
    expect(ITGI_OPERATIONS.has("retrieveQuote")).toBe(false);
    expect(ITGI_OPERATIONS.has("renewal")).toBe(false);
    expect(ITGI_OPERATIONS.has("inspection")).toBe(false);
  });

  it("uses the vendor's exact coverage name strings", () => {
    expect(ITGI_COVERAGE.IDV_BASIC).toBe("IDV Basic");
    expect(ITGI_COVERAGE.PA_OWNER_DRIVER).toBe("PA Owner / Driver");
    expect(ITGI_COVERAGE.TOWING).toBe("Towing & Related");
    expect(itgiCoverageName("zeroDep")).toBe("Depreciation Waiver");
    expect(itgiCoverageName("tyreProtect")).toBe("Tyre Protection");
    expect(itgiCoverageName("engineProtect")).toBe("Engine Gear Box Protection");
  });
});

describe("itgi errors", () => {
  it("passes when no error field is present", () => {
    expect(() => assertItgiSuccess({ orderNo: "0001", traceNo: "12" }, "proposal")).not.toThrow();
  });

  it("detects the vendor's misspelled erorMessage field", () => {
    expect(() => assertItgiSuccess({ erorMessage: "Invalid RTO" }, "idv")).toThrow(ProviderError);
  });

  it("detects errorMessage and error", () => {
    expect(() => assertItgiSuccess({ errorMessage: "bad make" }, "premium")).toThrow(ProviderError);
    expect(() => assertItgiSuccess({ error: "boom" }, "premium")).toThrow(ProviderError);
  });

  it("ignores nil-valued error fields", () => {
    expect(() => assertItgiSuccess({ erorMessage: "", errorMessage: null }, "idv")).not.toThrow();
  });

  it("recognises the P400 success sentinels", () => {
    expect(isItgiSuccessMessage("SUCCESSFULLY_SUBMITTED_IN_P400")).toBe(true);
    expect(isItgiSuccessMessage("SUCCESSFULLY_UPDATED_IN_P400")).toBe(true);
    expect(isItgiSuccessMessage("PAYMENT_ACCEPTED_BREAK_IN")).toBe(true);
    expect(isItgiSuccessMessage("TRANCTION_DECLINED")).toBe(false);
  });

  it("classifies transient upstream faults as retryable", () => {
    expect(classifyItgiError("Read timed out")).toBe("UPSTREAM_UNAVAILABLE");
    expect(classifyItgiError("Service Unavailable")).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("classifies declines and validation faults", () => {
    expect(classifyItgiError("Vehicle make is declined")).toBe("REFERRAL_DECLINED");
    expect(classifyItgiError("KYC details not found")).toBe("KYC_INCOMPLETE");
    expect(classifyItgiError("Inspection is required for break-in")).toBe("INSPECTION_REQUIRED");
  });

  it("carries the unmapped-code error as a no-quote signal", () => {
    const err = new ItgiUnmappedCodeError("RTO", "MH12");
    expect(err.code).toBe("UNMAPPED_CODE");
    expect(err.message).toContain("MH12");
  });
});

describe("itgi formatting", () => {
  it("formats dates as MM/DD/YYYY", () => {
    expect(toItgiDate("2026-02-26")).toBe("02/26/2026");
  });

  it("formats datetimes as MM/DD/YYYY HH:mm:ss", () => {
    expect(toItgiDateTime("2026-02-26", "00:00:00")).toBe("02/26/2026 00:00:00");
    expect(toItgiDateTime("2027-02-25", "23:59:59")).toBe("02/25/2027 23:59:59");
  });

  it("splits a registration number into the vendor's four parts", () => {
    expect(splitRegistrationNumber("DL10AH4567")).toEqual({
      p1: "DL",
      p2: "10",
      p3: "AH",
      p4: "4567",
    });
    expect(splitRegistrationNumber("MH-02-BF-1234")).toEqual({
      p1: "MH",
      p2: "02",
      p3: "BF",
      p4: "1234",
    });
  });

  it("handles a single-letter series", () => {
    expect(splitRegistrationNumber("KA05A1234")).toEqual({
      p1: "KA",
      p2: "05",
      p3: "A",
      p4: "1234",
    });
  });

  it("returns null for an unparseable registration number", () => {
    expect(splitRegistrationNumber("NEW")).toBeNull();
  });

  it("mints a unique quote id between 12 and 20 characters", () => {
    const id = makeUniqueQuoteId("req-abc");
    expect(id.length).toBeGreaterThanOrEqual(12);
    expect(id.length).toBeLessThanOrEqual(20);
  });

  it("maps vehicle categories to the vendor contract type", () => {
    expect(itgiContractType("fourWheeler")).toBe("PCP");
    expect(itgiContractType("twoWheeler")).toBe("TWP");
  });

  it("escapes XML special characters", () => {
    expect(xmlEscape("Towing & Related")).toBe("Towing &amp; Related");
    expect(xmlEscape("a<b>c")).toBe("a&lt;b&gt;c");
  });
});

describe("itgi soap helpers", () => {
  it("wraps a body in a SOAP 1.1 envelope with an empty header", () => {
    const xml = soapEnvelope("<getVehicleIdv/>", {
      prem: "http://premiumwrapper.motor.itgi.com",
    });
    expect(xml).toContain('xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"');
    expect(xml).toContain('xmlns:prem="http://premiumwrapper.motor.itgi.com"');
    expect(xml).toContain("<soapenv:Header/>");
    expect(xml).toContain("<getVehicleIdv/>");
  });

  it("unwraps the SOAP body and strips namespace prefixes", () => {
    const res = parseItgiSoap(`<?xml version="1.0"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body>
          <getVehicleIdvResponse xmlns="http://premiumwrapper.motor.itgi.com">
            <getVehicleIdvReturn><idv>415695</idv></getVehicleIdvReturn>
          </getVehicleIdvResponse>
        </soapenv:Body>
      </soapenv:Envelope>`) as {
      getVehicleIdvResponse: { getVehicleIdvReturn: { idv: string } };
    };
    expect(res.getVehicleIdvResponse.getVehicleIdvReturn.idv).toBe("415695");
  });

  it("keeps repeated premium blocks as arrays", () => {
    const res = parseItgiSoap(
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body><r>
          <getMotorPremiumReturn><autocoverage>false</autocoverage></getMotorPremiumReturn>
          <getMotorPremiumReturn><autocoverage>true</autocoverage></getMotorPremiumReturn>
        </r></soapenv:Body></soapenv:Envelope>`,
    ) as { r: { getMotorPremiumReturn: unknown[] } };
    expect(Array.isArray(res.r.getMotorPremiumReturn)).toBe(true);
    expect(res.r.getMotorPremiumReturn).toHaveLength(2);
  });

  it("surfaces an upstream 5xx as a retryable provider error", async () => {
    const transport = new FetchItgiTransport(
      async () => new Response("boom", { status: 503 }),
    );
    await expect(transport.soap("http://x", "<a/>", { requestId: "r1" })).rejects.toThrow(
      /temporarily unavailable/i,
    );
  });

  it("sends an empty SOAPAction header", async () => {
    let seen: Record<string, string> = {};
    const transport = new FetchItgiTransport(async (_url, init) => {
      seen = (init?.headers ?? {}) as Record<string, string>;
      return new Response(
        "<soapenv:Envelope xmlns:soapenv='http://schemas.xmlsoap.org/soap/envelope/'><soapenv:Body><ok/></soapenv:Body></soapenv:Envelope>",
        { status: 200 },
      );
    });
    await transport.soap("http://x", "<a/>", { requestId: "r1" });
    expect(seen.SOAPAction).toBe("");
    expect(seen["Content-Type"]).toContain("text/xml");
  });

  it("adds basic auth only when credentials are supplied", async () => {
    let seen: Record<string, string> = {};
    const transport = new FetchItgiTransport(async (_url, init) => {
      seen = (init?.headers ?? {}) as Record<string, string>;
      return new Response("{}", { status: 200 });
    });
    await transport.json("http://x", {}, { requestId: "r1" });
    expect(seen.Authorization).toBeUndefined();
    await transport.json("http://x", {}, { requestId: "r1", basicAuth: { user: "u", password: "p" } });
    expect(seen.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });
});

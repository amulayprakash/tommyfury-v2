import { describe, it, expect } from "vitest";
import { buildSoapEnvelope } from "../mapper.ts";
import { parseSoapResponse, assertFgSuccess } from "../http.ts";
import { normalizeQuote } from "../normalizer.ts";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const soapWrap = (op: string, rootXml: string) =>
  `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
  `<${op}Response xmlns="http://tempuri.org/"><${op}Result>${esc(rootXml)}</${op}Result></${op}Response>` +
  `</s:Body></s:Envelope>`;

describe("buildSoapEnvelope", () => {
  it("wraps the Root payload as CDATA XML in the SOAP body", () => {
    const xml = buildSoapEnvelope("getQuote", {
      Uid: "1",
      VendorCode: "Webagg",
      Risk: { RiskType: "FPV", Addon: [{ CoverCode: "ZCETR" }] },
    });
    expect(xml).toContain("<tem:GetQuote>");
    expect(xml).toContain("<tem:Product>MOTOR</tem:Product>");
    expect(xml).toContain("<![CDATA[<Root>");
    expect(xml).toContain("<RiskType>FPV</RiskType>");
    expect(xml).toContain("<Addon><CoverCode>ZCETR</CoverCode></Addon>");
  });
});

describe("parseSoapResponse", () => {
  const successRoot =
    "<Root>" +
    "<Client><Status>Successful</Status><ClientId>59181900</ClientId><QuotationNo>0000621254</QuotationNo></Client>" +
    "<Policy><Status>Successful</Status><PolicyNo></PolicyNo><NewDataSet>" +
    "<Table1><Code>OD</Code><Description>Total Basic OD Premium</Description><Type>OD</Type><BOValue>7390.93</BOValue></Table1>" +
    "<Table1><Code>Gross Premium</Code><Type>OD</Type><BOValue>16478.06</BOValue></Table1>" +
    "<Table1><Code>ServTax</Code><Type>OD</Type><BOValue>2966.05</BOValue></Table1>" +
    "</NewDataSet><VehicleIDV>562,818</VehicleIDV></Policy></Root>";

  it("unwraps the SOAP envelope + entity-escaped Root and normalizes a quote", () => {
    const root = parseSoapResponse(soapWrap("GetQuote", successRoot)) as Record<string, unknown>;
    const q = normalizeQuote(root, {
      requestId: "r",
      policyType: "comprehensive",
      vehicleCategory: "fourWheeler",
    });
    expect(q.quoteNo).toBe("0000621254");
    expect(q.idvValue).toBe(562818);
    expect(q.basicOdPremium).toBe(7390.93);
    expect(q.netPremium).toBeCloseTo(16478.06, 2);
  });

  it("surfaces the vendor-validation failure message", () => {
    const failRoot =
      "<Root><Policy><Status>Fail</Status></Policy><QuotationNo></QuotationNo>" +
      "<Error>Vendor Validation Failed</Error><ErrorMessage>VendorCode and VendorUserId must be same</ErrorMessage></Root>";
    const root = parseSoapResponse(soapWrap("GetQuote", failRoot)) as Record<string, unknown>;
    expect(() => assertFgSuccess(root, "get-quote")).toThrowError(
      /VendorCode and VendorUserId must be same/,
    );
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { fgRenewalQuote, fgRenewalCreatePolicy } from "../renewal.ts";
import type { FgConfig } from "../config.ts";

const config = {
  vendorCode: "Webagg",
  renewal: { baseUrl: "https://uat.example.com:8243/motorRenewal/1.0.0/TCS-Renewal/API/MotorRenewal" },
} as unknown as FgConfig;

// Trimmed from TCS-RENEWAL-API-ENQ.txt sample response.
const ENQ_XML = `<Root>
  <QuotationNo>00VA500235</QuotationNo>
  <PremiumBreakup><NewDataSet>
    <Table><RskNo>1</RskNo><Code>Final Premium</Code><Type>NA</Type><BOValue>6124</BOValue></Table>
    <Table><RskNo>1</RskNo><Code>Gross Premium</Code><Type>OD</Type><BOValue>3036</BOValue></Table>
    <Table><RskNo>1</RskNo><Code>Gross Premium</Code><Type>TP</Type><BOValue>2154</BOValue></Table>
    <Table><RskNo>1</RskNo><Code>ServTax</Code><Type>OD</Type><BOValue>546.48</BOValue></Table>
    <Table><RskNo>1</RskNo><Code>ServTax</Code><Type>TP</Type><BOValue>387.72</BOValue></Table>
    <Table><RskNo>1</RskNo><Code>VehicaleIDV</Code><Type>OD</Type><BOValue>265720</BOValue></Table>
  </NewDataSet></PremiumBreakup>
</Root>`;

const CREATE_XML = `<Root><Policy><Status>Successful</Status><PolicyNo>VA500236</PolicyNo><ApplicationNo>AP99</ApplicationNo></Policy><Receipt><ReceiptNo>R12</ReceiptNo></Receipt></Root>`;

function mockFetch(text: string) {
  return vi.fn(async () => ({ ok: true, status: 200, text: async () => text })) as unknown as typeof fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("FG renewal", () => {
  it("prices a renewal from the PremiumBreakup table", async () => {
    vi.stubGlobal("fetch", mockFetch(ENQ_XML));
    const q = await fgRenewalQuote(
      config,
      { policyNo: "VA500235" },
      "tok",
      { requestId: "r1", vehicleCategory: "fourWheeler", policyType: "comprehensive" },
    );
    expect(q.quoteNo).toBe("00VA500235");
    expect(q.grossPremium).toBe(6124);
    expect(q.netPremium).toBe(5190);
    expect(q.serviceTaxAmount).toBeCloseTo(934.2, 1);
    expect(q.idvValue).toBe(265720);
    expect(q.basicOdPremium).toBe(3036);
    expect(q.thirdPartyPremium).toBe(2154);
  });

  it("issues a renewal returning the PolicyNo", async () => {
    vi.stubGlobal("fetch", mockFetch(CREATE_XML));
    const r = await fgRenewalCreatePolicy(
      config,
      {
        policyNo: "VA500235",
        quoteNo: "00VA500235",
        receipt: {
          uniqueTranKey: "TP1",
          transactionDate: "27/05/2025",
          receiptType: "IVR",
          amount: 6124,
          tranRefNo: "REF1",
          tranRefNoDate: "27/05/2025",
          pgType: "PAYU",
        },
      },
      "tok",
    );
    expect(r.status).toBe("ISSUED");
    expect(r.policyNumber).toBe("VA500236");
    expect(r.applicationNo).toBe("AP99");
    expect(r.receiptNo).toBe("R12");
  });
});

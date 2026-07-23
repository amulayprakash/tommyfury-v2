import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  paymentChecksum,
  buildPaymentForm,
  decryptPaymentResponse,
  desAvailable,
  parsePgFields,
  pgSucceeded,
  pgResultToReceipt,
} from "../payment.ts";
import type { FgConfig } from "../config.ts";
import { AppError } from "@/errors/app-error.ts";

// DES-CBC params from NewPaymentIntegration_v1.40.pdf (do not change).
const DES_KEY = Buffer.from("&%#@?,:*", "utf8");
const DES_IV = Buffer.from([18, 50, 80, 125, 140, 170, 205, 230]);
function encrypt(text: string): string {
  const c = crypto.createCipheriv("des-cbc", DES_KEY, DES_IV);
  return c.update(text, "utf8", "base64") + c.final("base64");
}
// .NET encrypted-response mode needs legacy single-DES (off by default in
// OpenSSL 3). We default to PHP plain-param mode, so guard the crypto tests.
const desIt = desAvailable() ? it : it.skip;

describe("FG payment checksum", () => {
  it("matches the documented SHA-256 vector (.NET format, trailing pipe, no timestamp)", () => {
    const hash = paymentChecksum({
      TransactionID: "AJ123456789",
      PaymentOption: "3",
      ResponseURL: "http://fglpg001.futuregenerali.in/ECOM_NL/WEBAPPLN/UI/Common/WebAggData.aspx",
      ProposalNumber: "A321456987",
      PremiumAmount: "1000",
      UserIdentifier: "TestAgg",
      UserId: "456",
      FirstName: "tester",
      LastName: "tester",
      Mobile: "987654321",
      Email: "test@test.com",
    });
    expect(hash).toBe("b27f0d7b168c58818164ad732f55a185d51469abc564daa7ac15c1b6367d087a");
  });

  it("matches the documented Node.js SHA-256 vector (11-field, trailing pipe)", () => {
    // v1.41 PDF p7 Node.js example.
    const hash = paymentChecksum({
      TransactionID: "AJ026789",
      PaymentOption: "3",
      ResponseURL: "http://localhost:48658/ECOM/WEBAPPLN/UI/Common/WebAggData.htm",
      ProposalNumber: "A321456987",
      PremiumAmount: "1000",
      UserIdentifier: "TestAgg",
      UserId: "456",
      FirstName: "tester",
      LastName: "tester",
      Mobile: "987654321",
      Email: "test@test.com",
    });
    expect(hash).toBe("5d597e923b13bd897c0ff4401d167b06961d91c8b1856e98ddd5a1f0b912862d");
  });

  // CHANGE-DETECTION LOCK — not a live-FG conformance vector. The `php12` hash
  // below is computed over the .NET example's ResponseURL + timestamp, NOT the
  // v1.41 PDF's printed PHP example string (that uses
  // `digiuat.generalicentralinsurance.com` and shows a trailing space after
  // "AM"). This only pins our 12-field implementation against accidental change;
  // it does NOT prove the checksum matches what FG's live gateway computes. The
  // exact 12th-field format (trailing space, AM/PM 12-hour, local timezone) is an
  // open confirmation — validate against a real UAT txn (see open confirmations).
  it("PHP mode appends a 12th timestamp field (change-detection lock, not a live-FG vector)", () => {
    const base = {
      TransactionID: "AJ123456789",
      PaymentOption: "3",
      ResponseURL: "http://fglpg001.futuregenerali.in/ECOM_NL/WEBAPPLN/UI/Common/WebAggData.aspx",
      ProposalNumber: "A321456987",
      PremiumAmount: "1000",
      UserIdentifier: "TestAgg",
      UserId: "456",
      FirstName: "tester",
      LastName: "tester",
      Mobile: "987654321",
      Email: "test@test.com",
    };
    const net11 = paymentChecksum(base);
    const php12 = paymentChecksum(base, "17/04/2018 11:16:14 AM");
    expect(net11).toBe("b27f0d7b168c58818164ad732f55a185d51469abc564daa7ac15c1b6367d087a");
    expect(php12).toBe("b98c3e8f70fbed57499a42409365b15425f84785bb61c7aee42b7e92c1000733");
    expect(php12).not.toBe(net11);
  });
});

const baseConfig = (vendor: string): FgConfig =>
  ({
    vendorCode: "Webagg",
    agentCode: "60001464",
    payment: {
      url: "https://pay.example.com/WebAggPayNew.aspx",
      paymentOption: "3",
      vendor,
      responseUrl: "https://app.example.com/api/v1/fg/payment/callback",
      reconUrl: "https://pg.example.com/comservice.asmx/FetchTRNDetails",
      reconSource: "webaggregator",
    },
  }) as unknown as FgConfig;

const payInput = {
  quoteNo: "Q123",
  premiumAmount: 2530,
  firstName: "Raj",
  lastName: "Sharma",
  mobile: "9809801234",
  email: "raj@test.com",
};

describe("FG payment form (Vendor-aware)", () => {
  it("PHP mode: sends Vendor=1 and a 12-field checksum with the timestamp", () => {
    const now = new Date(2018, 3, 17, 11, 16, 14); // 17/04/2018 11:16:14 (local)
    const form = buildPaymentForm(baseConfig("1"), payInput, now);
    expect(form.fields.Vendor).toBe("1");
    const expected = paymentChecksum(
      {
        TransactionID: "Q123",
        PaymentOption: "3",
        ResponseURL: "https://app.example.com/api/v1/fg/payment/callback",
        ProposalNumber: "Q123",
        PremiumAmount: "2530",
        UserIdentifier: "Webagg",
        UserId: "60001464",
        FirstName: "Raj",
        LastName: "Sharma",
        Mobile: "9809801234",
        Email: "raj@test.com",
      },
      "17/04/2018 11:16:14 AM",
    );
    expect(form.fields.CheckSum).toBe(expected);
  });

  it(".NET mode: sends blank Vendor and an 11-field checksum (no timestamp)", () => {
    const form = buildPaymentForm(baseConfig(""), payInput);
    expect(form.fields.Vendor).toBe("");
    const expected = paymentChecksum({
      TransactionID: "Q123",
      PaymentOption: "3",
      ResponseURL: "https://app.example.com/api/v1/fg/payment/callback",
      ProposalNumber: "Q123",
      PremiumAmount: "2530",
      UserIdentifier: "Webagg",
      UserId: "60001464",
      FirstName: "Raj",
      LastName: "Sharma",
      Mobile: "9809801234",
      Email: "raj@test.com",
    });
    expect(form.fields.CheckSum).toBe(expected);
  });
});

describe("FG payment response", () => {
  desIt("decrypts a DES-CBC ResponseData and parses the PG fields (.NET mode)", () => {
    const plain = "WS_P_ID=TC101212&TID=AB123456&PGID=1332323234647&Premium=3000&Response=Success";
    const pg = parsePgFields({ ResponseData: encrypt(plain) });
    expect(pg.wsPId).toBe("TC101212");
    expect(pg.tid).toBe("AB123456");
    expect(pg.pgId).toBe("1332323234647");
    expect(pg.response).toBe("Success");
    expect(pgSucceeded(pg)).toBe(true);
  });

  desIt("substitutes `$` with `+` before base64-decoding (per the doc)", () => {
    const plain = "WS_P_ID=TC1&TID=Q1&PGID=9&Premium=10&Response=Success";
    const enc = encrypt(plain).replace(/\+/g, "$");
    expect(decryptPaymentResponse(enc)).toBe(plain);
  });

  it("reads plain PHP-mode params when ResponseData is absent", () => {
    const pg = parsePgFields({ TID: "Q9", PGID: "PG9", Premium: "500", Response: "Failure" });
    expect(pg.tid).toBe("Q9");
    expect(pgSucceeded(pg)).toBe(false);
  });
});

describe("FG payment .NET DES guard", () => {
  it("reports a boolean for DES availability", () => {
    expect(typeof desAvailable()).toBe("boolean");
  });

  it("throws a typed error when ResponseData needs DES but the runtime lacks it", () => {
    if (desAvailable()) return; // only meaningful when DES is disabled (OpenSSL 3)
    try {
      parsePgFields({ ResponseData: "BUYidAjRUV6Bklug$azoD" });
      throw new Error("expected parsePgFields to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("DES_UNAVAILABLE");
    }
  });

  // Guarded: only runs where legacy single-DES is enabled.
  const desIt2 = desAvailable() ? it : it.skip;
  desIt2("decrypts .NET ResponseData when DES is available", () => {
    // encrypt() + DES_KEY/DES_IV already defined at the top of this file.
    const plain = "WS_P_ID=TCX&TID=Q123&PGID=PGX&Premium=2530&Response=Success";
    const pg = parsePgFields({ ResponseData: encrypt(plain) });
    expect(pg.response).toBe("Success");
  });
});

describe("FG payment receipt mapping (v1.41 PG params)", () => {
  it("maps WS_P_ID → uniqueTranKey and PGID → tranRefNo", () => {
    const receipt = pgResultToReceipt(
      { wsPId: "TC101212", tid: "Q123", pgId: "1332323234647", premium: "2530", response: "Success" },
      baseConfig("1"), // PaymentOption "3" → PGType "PAYU"
      2530,
      new Date(2025, 4, 27, 16, 26, 0),
    );
    expect(receipt.uniqueTranKey).toBe("TC101212"); // WS_P_ID, NOT the TID
    expect(receipt.tranRefNo).toBe("1332323234647"); // PGID
    expect(receipt.receiptType).toBe("IVR");
    expect(receipt.amount).toBe(2530);
    expect(receipt.pgType).toBe("PAYU");
  });
});

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  paymentChecksum,
  decryptPaymentResponse,
  desAvailable,
  parsePgFields,
  pgSucceeded,
} from "../payment.ts";

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

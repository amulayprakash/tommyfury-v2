import { describe, it, expect } from "vitest";
import idvFixture from "../fixtures/responses/idv.json" with { type: "json" };
import premiumFixture from "../fixtures/responses/premium.json" with { type: "json" };
import proposalFixture from "../fixtures/responses/proposal.json" with { type: "json" };
import paymentFixture from "../fixtures/responses/payment.json" with { type: "json" };
import policyDocFixture from "../fixtures/responses/policy-document.json" with { type: "json" };
import {
  normalizeIdv,
  normalizeQuote,
  normalizeProposal,
  normalizePayment,
  normalizeCertificate,
  selectIdvForPremium,
} from "../normalizer.ts";

describe("normalizeIdv", () => {
  it("reads the recommended, min and max IDV", () => {
    expect(normalizeIdv(idvFixture)).toEqual({
      recommended: 1244800,
      min: 1182560,
      max: 1556000,
    });
  });

  it("returns nulls for an empty body rather than throwing", () => {
    expect(normalizeIdv({})).toEqual({ recommended: null, min: null, max: null });
  });
});

describe("selectIdvForPremium", () => {
  // HDFC rejects any deviation from its recommendation: "IDV Deviation not allowed".
  it("always prefers HDFC's recommended IDV over the caller's", () => {
    expect(selectIdvForPremium({ recommended: 949411, min: 800000, max: 1000000 }, 900000)).toBe(
      949411,
    );
  });

  it("falls back to a caller IDV inside the band when there is no recommendation", () => {
    expect(selectIdvForPremium({ recommended: null, min: 800000, max: 1000000 }, 900000)).toBe(
      900000,
    );
  });

  it("rejects a caller IDV outside the band", () => {
    expect(selectIdvForPremium({ recommended: null, min: 800000, max: 1000000 }, 500000)).toBeNull();
  });

  it("returns null when there is neither a recommendation nor a usable caller value", () => {
    expect(selectIdvForPremium({ recommended: null, min: null, max: null }, 0)).toBeNull();
  });
});

describe("normalizeQuote", () => {
  const ctx = {
    requestId: "req-1",
    quoteNo: "TXN-1",
    policyType: "comprehensive",
    vehicleCategory: "fourWheeler" as const,
  };

  // premium.json is a REAL HDFC UAT response captured 2026-08-07 for a TATA
  // NEXON EV at MH-1 Mumbai. Every number below came off the wire — the field
  // names are not the ones the data dictionary implies, which is exactly why
  // this fixture is a capture rather than a hand-written sample.
  it("reads the premium breakdown from Resp_PvtCar", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    // HDFC sends Basic_OD_Premium / Basic_TP_Premium, not Total_OD_/Total_TP_.
    expect(q.basicOdPremium).toBe(2861);
    expect(q.thirdPartyPremium).toBe(6712);
    expect(q.netPremium).toBe(21381);
    expect(q.serviceTaxAmount).toBe(3849);
    expect(q.grossPremium).toBe(25230);
    expect(q.idvValue).toBe(1244800);
  });

  it("reads the IDV band from the premium response too", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.minIdv).toBe(1182560);
    expect(q.maxIdv).toBe(1556000);
  });

  it("maps HDFC cover premiums onto canonical add-on keys", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    // The cover premiums carry a Vehicle_Base_ prefix on the wire.
    expect(q.addonPremiums.zeroDep).toBe(4357);
    expect(q.addonPremiums.tyreProtect).toBe(1245);
    expect(q.addonPremiums.ncbProtection).toBe(2490);
    expect(q.addonPremiums.consumables).toBe(1245);
    // EA_premium — lowercase p, unlike every sibling field.
    expect(q.addonPremiums.rsa).toBe(75);
    // A zero premium means "not selected" — omit rather than report 0.
    expect(q.addonPremiums.rti).toBeUndefined();
    expect(q.addonPremiums.engineProtect).toBeUndefined();
  });

  it("sums the three EV covers into the single canonical batteryProtect slot", () => {
    // HDFC prices ElectricMotorCover (871) + ZeroDepClaimForBattery (1369) +
    // BatteryChargerAccessory (871) separately; the contract has one slot, so
    // reporting only one of them would understate the quote by ~₹1,700.
    expect(normalizeQuote(premiumFixture, ctx).addonPremiums.batteryProtect).toBe(3111);
  });

  it("reads the NCB discount", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.discounts.ncbAmount).toBe(715);
    expect(q.discounts.ncbPercent).toBe(25);
  });

  it("stamps identity fields", () => {
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.providerSlug).toBe("hdfc");
    expect(q.insurerName).toBe("HDFC ERGO");
    expect(q.quoteNo).toBe("TXN-1");
    expect(q.transactionId).toBe("TXN-1");
    expect(q.requestId).toBe("req-1");
  });

  it("reports amounts in whole rupees, not paise", () => {
    // The whole stack is rupees end to end; a paise conversion here would show
    // a 100x premium on the compare card.
    const q = normalizeQuote(premiumFixture, ctx);
    expect(q.grossPremium).toBe(25230);
    // And the vendor's own arithmetic must reconcile: net + tax == gross.
    expect(q.netPremium + q.serviceTaxAmount).toBe(q.grossPremium);
  });
});

describe("break-in detection", () => {
  const ctx = {
    requestId: "req-1",
    quoteNo: "TXN-1",
    policyType: "comprehensive",
    vehicleCategory: "fourWheeler" as const,
  };
  /** Only the two break-in fields vary; everything else is the captured response. */
  const withBreakIn = (percent: number, premium: number) => ({
    Resp_PvtCar: {
      ...premiumFixture.Resp_PvtCar,
      BreakInLoadingPercent: percent,
      BreakIN_Premium: premium,
    },
  });

  // PVTcarTestScenarios.xls "New and Rollover" rows 3, 9 and 12 all reached the
  // customer as ordinary quotes: normalizeQuote read neither break-in field, so
  // isInspectionRequired stayed undefined and the compare card showed nothing.
  it("flags a quote HDFC charged break-in loading on", () => {
    // Live: previous policy lapsed 45 days ago → 15% / ₹220 (rows 9 and 12).
    expect(normalizeQuote(withBreakIn(15, 220), ctx).isInspectionRequired).toBe(true);
  });

  it("does not flag a clean quote", () => {
    expect(normalizeQuote(withBreakIn(0, 0), ctx).isInspectionRequired).toBe(false);
    expect(normalizeQuote(premiumFixture, ctx).isInspectionRequired).toBe(false);
  });

  it("reads the charged premium, not the loading percentage", () => {
    // The distinction is load-bearing, not cosmetic. On a LIABILITY break-in
    // HDFC returns BreakInLoadingPercent 15 with BreakIN_Premium 0, while its
    // own Break In sheet row 5 says that case needs no inspection — so keying
    // off the percentage would send every liability roll-over to an inspection
    // the insurer never asked for.
    expect(normalizeQuote(withBreakIn(15, 0), ctx).isInspectionRequired).toBe(false);
  });

  it("flags on the premium even where HDFC reported no percentage", () => {
    expect(normalizeQuote(withBreakIn(0, 1000), ctx).isInspectionRequired).toBe(true);
  });

  it("is always a boolean, never undefined", () => {
    // undefined is what the defect looked like; the UI treats it as "no
    // inspection", so an absent field must not be able to mean that again.
    expect(normalizeQuote({ Resp_PvtCar: {} }, ctx).isInspectionRequired).toBe(false);
    expect(typeof normalizeQuote({}, ctx).isInspectionRequired).toBe("boolean");
  });

  it("changes nothing else about the quote", () => {
    const clean = normalizeQuote(premiumFixture, ctx);
    const brokenIn = normalizeQuote(withBreakIn(15, 220), ctx);
    expect({ ...brokenIn, isInspectionRequired: false, _rawResponse: null }).toEqual({
      ...clean,
      _rawResponse: null,
    });
  });
});

describe("normalizeProposal", () => {
  it("reads the proposal number", () => {
    expect(normalizeProposal(proposalFixture).proposalNumber).toBe("PR2026080700123");
  });

  it("returns undefined when HDFC returned no proposal number", () => {
    expect(normalizeProposal({ StatusCode: "1" }).proposalNumber).toBeUndefined();
  });
});

describe("normalizePayment", () => {
  it("reads the policy number from PolicyNumber", () => {
    expect(normalizePayment(paymentFixture).policyNumber).toBe("2311202600012345");
  });

  it("accepts the Policy_Number spelling too", () => {
    expect(
      normalizePayment({ Policy_Details: { Policy_Number: "X1" } }).policyNumber,
    ).toBe("X1");
  });
});

describe("normalizeCertificate", () => {
  it("reads the base64 policy document", () => {
    const c = normalizeCertificate(policyDocFixture);
    expect(c.coiBase64).toBe("JVBERi0xLjQKJVBPTElDWQ==");
  });

  it("reports no policy number, because the response does not carry one", () => {
    // This asserted "2311202600012345" until 21/08/2026, on the strength of an
    // invented fixture. The kit's response sheet lists StatusCode, Message,
    // Error, Warning, TransactionID and PDF_BYTES — no policy number. The
    // caller gets it from SubmitPaymentDetails instead (normalizePayment).
    expect(normalizeCertificate(policyDocFixture).policyNumber).toBeUndefined();
  });
});

/**
 * GetPolicyDocument returns the COI in `Resp_Policy_Document.PDF_BYTES`.
 *
 * `normalizeCertificate` read `Req_Policy_Document.Document` — the REQUEST
 * container, and a field name that exists nowhere. Both came from
 * `fixtures/responses/policy-document.json`, which was invented rather than
 * captured, so the whole path was green against a fiction while live UAT
 * returned an empty `coiBase64` on a real issued policy.
 *
 * The kit is unambiguous (`PrivateCarDataDictionary.xlsx`, "07
 * GetPolicyDocument"): the request carries `Policy_Number` in
 * `Req_Policy_Document`; the response carries `PDF_BYTES` in
 * `Resp_Policy_Document`. HDFC uses the same Req_/Resp_ split for `Req_PvtCar` /
 * `Resp_PvtCar`, so reading the request container back was always wrong.
 *
 * Captured live 21/08/2026 against policy 2302201225707100000.
 */
describe("normalizeCertificate — reads the response container, not the request one", () => {
  const live = {
    StatusCode: 200,
    Message: "Pdf generated",
    Resp_Policy_Document: { PDF_BYTES: "JVBERi0xLjQKJeLjz9MK" },
  };

  it("extracts PDF_BYTES from Resp_Policy_Document", () => {
    expect(normalizeCertificate(live).coiBase64).toBe("JVBERi0xLjQKJeLjz9MK");
  });

  it("returns a base64 PDF, not an empty string", () => {
    // JVBERi0 is base64 for "%PDF-", so this also guards against returning
    // some other field that happens to be a non-empty string.
    expect(normalizeCertificate(live).coiBase64.startsWith("JVBERi0")).toBe(true);
  });

  it("still reads the older Req_Policy_Document/Document shape", () => {
    // Kept as tolerance only — no live response has ever carried it.
    expect(
      normalizeCertificate({
        Req_Policy_Document: { Document: "JVBERi0xLjQKJVBPTElDWQ==", Policy_Number: "2311202600012345" },
      }).coiBase64,
    ).toBe("JVBERi0xLjQKJVBPTElDWQ==");
  });

  it("carries the policy number when the response echoes one", () => {
    expect(
      normalizeCertificate({ Resp_Policy_Document: { PDF_BYTES: "x", Policy_Number: "2302201225707100000" } })
        .policyNumber,
    ).toBe("2302201225707100000");
  });

  it("returns an empty string rather than undefined when HDFC sends no document", () => {
    expect(normalizeCertificate({ StatusCode: 200, Resp_Policy_Document: {} }).coiBase64).toBe("");
  });
});

/**
 * The COI is ~477 KB of base64. Echoing HDFC's body verbatim into `_rawResponse`
 * shipped it TWICE — once in `coiBase64` and once in
 * `_rawResponse.Resp_Policy_Document.PDF_BYTES` — so a single certificate fetch
 * moved about a megabyte of JSON, half of it redundant. Measured live on
 * 21/08/2026: 477,488 chars in each.
 *
 * `_rawResponse` still earns its place — the `/hdfc` harness renders it as
 * certification evidence, and StatusCode / Message / the container name are
 * exactly what a tester reads back to HDFC. The PDF bytes are not evidence, so
 * they are replaced by a marker that records what was there.
 */
describe("normalizeCertificate — does not ship the PDF twice", () => {
  const live = {
    StatusCode: 200,
    Message: "Pdf generated",
    Resp_Policy_Document: { PDF_BYTES: "JVBERi0xLjQ" + "A".repeat(5000) },
  };

  it("keeps the full document in coiBase64", () => {
    expect(normalizeCertificate(live).coiBase64).toHaveLength(5011);
  });

  it("elides the PDF bytes from _rawResponse", () => {
    const raw = normalizeCertificate(live)._rawResponse as Record<string, unknown>;
    const doc = raw.Resp_Policy_Document as Record<string, unknown>;
    expect(doc.PDF_BYTES).not.toContain("AAAA");
    expect(String(doc.PDF_BYTES)).toMatch(/5011/);
  });

  it("keeps the envelope, which is the part that is actually evidence", () => {
    const raw = normalizeCertificate(live)._rawResponse as Record<string, unknown>;
    expect(raw.StatusCode).toBe(200);
    expect(raw.Message).toBe("Pdf generated");
  });

  it("leaves a body carrying no document untouched", () => {
    const body = { StatusCode: 200, Error: "BUSINESS EXCEPTION: no such policy" };
    expect(normalizeCertificate(body)._rawResponse).toEqual(body);
  });

  it("does not mutate the caller's object", () => {
    const body = { StatusCode: 200, Resp_Policy_Document: { PDF_BYTES: "JVBERi0xLjQ" } };
    normalizeCertificate(body);
    expect(body.Resp_Policy_Document.PDF_BYTES).toBe("JVBERi0xLjQ");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hdfcCompleteCkyc,
  hdfcKycStatusByKycId,
  hdfcKycStatusByTxnId,
  toPehchaanParams,
  toCorporatePehchaanParams,
  normalizePehchaan,
  normalizeKycStatus,
} from "../ckyc.ts";
import type { HdfcConfig } from "../config.ts";
import type { CkycRequest } from "@/contracts/kyc.ts";
import { CkycRequestSchema } from "@/contracts/kyc.ts";
import { tokenManager } from "@/providers/token-manager.ts";

const config: HdfcConfig = {
  baseUrl: "https://uat.example/integration/",
  source: "S",
  channelId: "C",
  credential: "x",
  productCode: "2311",
  tokenTtlSeconds: 1500,
  kyc: {
    baseUrl: "https://kyc.example/e-kyc",
    apiKey: "api-key-1",
    tokenTtlSeconds: 480,
    returnUrl: "https://app.example/kyc-return",
  },
};

const req: CkycRequest = {
  transactionId: "TXN-1",
  dob: "1996-07-22",
  panNumber: "BXGPG2512P",
  policyType: "motor",
} as CkycRequest;

describe("toPehchaanParams", () => {
  it("converts the canonical request into Pehchaan's query parameters", () => {
    const p = toPehchaanParams(req, config);
    expect(p.pan).toBe("BXGPG2512P");
    // Pehchaan wants DD/MM/YYYY, not ISO.
    expect(p.dob).toBe("22/07/1996");
    expect(p.redirect_url).toBe("https://app.example/kyc-return");
  });

  it("uses ckycNumber as the kyc_id lookup key when supplied", () => {
    // This is how the status poll works after the hosted journey returns.
    const p = toPehchaanParams({ ...req, panNumber: undefined, ckycNumber: "KYC-99" }, config);
    expect(p.kyc_id).toBe("KYC-99");
    expect(p.pan).toBeUndefined();
  });

  it("forwards name and mobile when present", () => {
    const p = toPehchaanParams({ ...req, fullName: "MAHENDRA", mobile: "7387005111" }, config);
    expect(p.name).toBe("MAHENDRA");
    expect(p.mobile).toBe("7387005111");
  });

  it("omits empty values entirely rather than sending blanks", () => {
    const p = toPehchaanParams({ ...req, fullName: "" } as CkycRequest, config);
    expect("name" in p).toBe(false);
  });
});

describe("toCorporatePehchaanParams", () => {
  it("sends entity PAN, DOI in DD/MM/YYYY, entity type, txn id and redirect url", () => {
    expect(
      toCorporatePehchaanParams(
        {
          transactionId: "TXN-1",
          dob: "2007-11-20",
          customerType: "corporate",
          entityPan: "AADCC2489H",
          dateOfIncorporation: "2007-11-20",
          entityType: "company",
        } as never,
        config,
      ),
    ).toEqual({
      ent_pan: "AADCC2489H",
      doi: "20/11/2007",
      ent_type: "company",
      txn_id: "TXN-1",
      redirect_url: "https://app.example/kyc-return",
    });
  });

  it("sends the CIN when that is the identifier supplied", () => {
    const params = toCorporatePehchaanParams(
      {
        transactionId: "TXN-2",
        dob: "2015-12-18",
        customerType: "corporate",
        entityCin: "U40100GJ2015PLC085448",
        dateOfIncorporation: "2015-12-18",
        entityType: "company",
      } as never,
      config,
    );
    expect(params.ent_cin).toBe("U40100GJ2015PLC085448");
    expect(params.ent_pan).toBeUndefined();
  });

  it("prefers an explicit redirectUrl over the configured return url", () => {
    const params = toCorporatePehchaanParams(
      {
        transactionId: "TXN-3",
        dob: "2015-12-18",
        customerType: "corporate",
        entityCkycNumber: "12345678901234",
        dateOfIncorporation: "2015-12-18",
        entityType: "llp",
        redirectUrl: "https://app.example/custom",
      } as never,
      config,
    );
    expect(params.redirect_url).toBe("https://app.example/custom");
    expect(params.ent_ckycnum).toBe("12345678901234");
  });

  it("never reads dob — a corporate entity's date is its date of incorporation", () => {
    // dob stays mandatory on the contract, so callers duplicate DOI into it.
    // If the two ever diverge, `doi` must still follow dateOfIncorporation.
    const params = toCorporatePehchaanParams(
      {
        transactionId: "TXN-4",
        dob: "1990-01-01",
        customerType: "corporate",
        entityPan: "AADCC2489H",
        dateOfIncorporation: "2015-12-18",
        entityType: "company",
      } as never,
      config,
    );
    expect(params.doi).toBe("18/12/2015");
    expect(params.dob).toBeUndefined();
  });
});

describe("normalizePehchaan", () => {
  it("maps a verified response onto the canonical KycResult", () => {
    const out = normalizePehchaan({
      status: true,
      data: {
        iskycVerified: 1,
        kyc_id: "KYC-99",
        name: "MAHENDRA GHANCHI",
        dob: "22/07/1996",
        email: "m@example.com",
        mobile: "7387005111",
        pan: "BXGPG2512P",
        permanentAddress: "12 Main St",
        status: "approved",
      },
    });
    expect(out.isKycSuccess).toBe(true);
    expect(out.kycId).toBe("KYC-99");
    expect(out.name).toBe("MAHENDRA GHANCHI");
    expect(out.permanentAddress).toBe("12 Main St");
    expect(out.requiresRedirect).toBeFalsy();
  });

  it("maps a not-found response onto the redirect shape FG already uses", () => {
    const out = normalizePehchaan({
      status: false,
      data: { redirection_link: "https://pehchaan.example/j/abc", txn_id: "TX-7" },
    });
    expect(out.isKycSuccess).toBe(false);
    expect(out.requiresRedirect).toBe(true);
    expect(out.redirectUrl).toBe("https://pehchaan.example/j/abc");
    expect(out.ckycRefId).toBe("TX-7");
  });

  it("reads redirect_link — the key Pehchaan actually emits (live, 2026-08-21)", () => {
    // Verbatim body from scripts/_hdfc-corporate-kyc-probe.ts against
    // https://ekyc-uat.hdfcergo.com/e-kyc/partner/corporate/kyc, the kit's own
    // negative test entity (ent_pan BMZPA6536P, doi 29/01/1996). Neither kit
    // ever spells it `redirection_link`; keying only on that spelling left this
    // branch dead, silently dropping the hosted-journey link on the floor and
    // reporting a bare isKycSuccess=false with nowhere for the customer to go.
    const out = normalizePehchaan({
      success: true,
      data: {
        iskycVerified: 0,
        kyc_id: null,
        txn_id: "12365",
        redirect_link:
          "https://ekyc-uat.hdfcergo.com/e-kyc/verified-partner?txnId=12365&redirectUrl=http%3A%2F%2Flocalhost%3A8080%2Fhdfc%2Fkyc%2Freturn&entity_type=company&customerType=C",
        isRpt: false,
      },
    });
    expect(out.requiresRedirect).toBe(true);
    expect(out.redirectUrl).toContain("/e-kyc/verified-partner?txnId=12365");
    expect(out.ckycRefId).toBe("12365");
    expect(out.isKycSuccess).toBe(false);
  });

  it("treats a pending verification as unverified", () => {
    const out = normalizePehchaan({ data: { iskycVerified: 0, status: "pending for verification" } });
    expect(out.isKycSuccess).toBe(false);
    expect(out.displayMessage).toContain("pending");
  });

  it("treats a rejected KYC as unverified", () => {
    const out = normalizePehchaan({ data: { iskycVerified: 0, status: "rejected" } });
    expect(out.isKycSuccess).toBe(false);
  });
});

describe("normalizePehchaan — corporate shape", () => {
  // HDFC's own verbatim UAT response from kit doc 1.2.1.
  const corporateBody = {
    success: true,
    data: {
      permanentAddress:
        "ADANI CORPORATE HOUSE,SHANTIGRAM,NEAR VAISHNO DEVI CIRCLE,S.G.HIGHWAY,KHODIYAR,AHMEDABAD, GANDHI NAGAR, ZUNDAL, pincode - 382421",
      permanentCity: ["ZUNDAL"],
      permanentPincode: "382421",
      correspondenceAddress:
        "ADANI CORPORATE HOUSE,SHANTIGRAM,NEAR VAISHNO DEVI CIRCLE,S.G.HIGHWAY,KHODIYAR,AHMEDABAD, GANDHI NAGAR, ZUNDAL, pincode - 382421",
      correspondenceCity: ["ZUNDAL"],
      correspondencePincode: "382421",
      fullName: "ADANI POWER (JHARKHAND) LIMITED",
      email: "deepak.pandya@adani.com",
      doi: "18/12/2015",
      kyc_id: "6PCT4QLC11",
      iskycVerified: 1,
      txn_id: "8563457",
    },
  };

  it("reads the entity name from fullName", () => {
    expect(normalizePehchaan(corporateBody).name).toBe("ADANI POWER (JHARKHAND) LIMITED");
  });

  it("reads the date of incorporation into dob", () => {
    expect(normalizePehchaan(corporateBody).dob).toBe("18/12/2015");
  });

  it("marks it verified and carries the Pehchaan id", () => {
    const r = normalizePehchaan(corporateBody);
    expect(r.isKycSuccess).toBe(true);
    expect(r.kycId).toBe("6PCT4QLC11");
    expect(r.ckycNumber).toBe("6PCT4QLC11");
  });

  it("carries the address and email through the shared slots", () => {
    const r = normalizePehchaan(corporateBody);
    expect(r.email).toBe("deepak.pandya@adani.com");
    expect(r.permanentAddress).toContain("ADANI CORPORATE HOUSE");
    expect(r.correspondenceAddress).toContain("ADANI CORPORATE HOUSE");
  });

  it("still reads an individual response unchanged", () => {
    const r = normalizePehchaan({
      data: {
        iskycVerified: 1,
        name: "UTKARSH VIKAS CHANDEL",
        mobile: "7666919245",
        dob: "24/12/1997",
        kyc_id: "ZCT0BOQ7SH",
      },
    });
    expect(r.name).toBe("UTKARSH VIKAS CHANDEL");
    expect(r.dob).toBe("24/12/1997");
    expect(r.phone).toBe("7666919245");
  });
});

describe("hdfcCompleteCkyc", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // The Pehchaan JWT is cached in the shared tokenManager singleton, which
    // persists across tests in this file — invalidate so each test mints its
    // own token instead of reusing one cached by an earlier test.
    tokenManager.invalidate("hdfc:kyc");
  });

  function jsonResponse(body: unknown, status = 200) {
    return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
  }

  it("mints a token then calls the verified-KYC endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1", expiry: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { iskycVerified: 1, kyc_id: "K1" } }));

    const out = await hdfcCompleteCkyc(config, req);
    expect(out.kycId).toBe("K1");

    const tokenCall = fetchMock.mock.calls[0]!;
    expect(String(tokenCall[0])).toContain("/tgt/generate-token");
    expect((tokenCall[1] as RequestInit).headers).toMatchObject({ api_key: "api-key-1" });

    const kycCall = fetchMock.mock.calls[1]!;
    expect(String(kycCall[0])).toContain("/primary/kyc-verified");
    expect((kycCall[1] as RequestInit).headers).toMatchObject({ token: "jwt-1" });
  });

  it("refreshes the token once and retries on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1" } }))
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-2" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { iskycVerified: 1, kyc_id: "K1" } }));

    const out = await hdfcCompleteCkyc(config, req);
    expect(out.kycId).toBe("K1");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails clearly when the api_key is not configured", async () => {
    const noKey = { ...config, kyc: { ...config.kyc, apiKey: "" } };
    await expect(hdfcCompleteCkyc(noKey, req)).rejects.toThrow(/HDFC_KYC_API_KEY/);
  });

  it("routes a corporate request to the corporate endpoint with entity params", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1" } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { iskycVerified: 1, kyc_id: "6PCT4QLC11", fullName: "ADANI" } }),
      );

    const out = await hdfcCompleteCkyc(config, {
      transactionId: "TXN-C",
      dob: "2007-11-20",
      customerType: "corporate",
      entityPan: "AADCC2489H",
      dateOfIncorporation: "2007-11-20",
      entityType: "company",
      policyType: "motor",
    } as CkycRequest);
    expect(out.name).toBe("ADANI");

    const url = String(fetchMock.mock.calls[1]![0]);
    expect(url).toContain("/partner/corporate/kyc");
    expect(url).toContain("ent_pan=AADCC2489H");
    expect(url).toContain("ent_type=company");
    expect(url).toContain("doi=20%2F11%2F2007");
  });

  it("keeps an individual request on the individual endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { iskycVerified: 1, kyc_id: "K1" } }));

    await hdfcCompleteCkyc(config, req);

    const url = String(fetchMock.mock.calls[1]![0]);
    expect(url).toContain("/primary/kyc-verified");
    expect(url).not.toContain("/corporate/");
    expect(url).toContain("pan=BXGPG2512P");
  });
});

describe("normalizeKycStatus", () => {
  it("maps the approved response (kit doc 1.3)", () => {
    const r = normalizeKycStatus({ success: true, data: { iskycVerified: 1, status: "approved" } }, "ZCT0BOQ7SH");
    expect(r.isKycSuccess).toBe(true);
    expect(r.displayMessage).toBe("approved");
    expect(r.kycId).toBe("ZCT0BOQ7SH");
    expect(r.ckycNumber).toBe("ZCT0BOQ7SH");
  });

  it("maps the pending response as not-yet-verified", () => {
    const r = normalizeKycStatus(
      { success: true, data: { iskycVerified: 0, status: "pending for verification" } },
      "ZCT0BOQ7SH",
    );
    expect(r.isKycSuccess).toBe(false);
    expect(r.displayMessage).toBe("pending for verification");
  });

  it("surfaces a rejection — the reason these endpoints exist", () => {
    const r = normalizeKycStatus({ success: true, data: { iskycVerified: 0, status: "rejected" } }, "ZCT0BOQ7SH");
    expect(r.isKycSuccess).toBe(false);
    expect(r.displayMessage).toBe("rejected");
  });

  it("carries the txn id and leaves kycId unset when polled by transaction (kit doc 1.4)", () => {
    const r = normalizeKycStatus(
      { success: true, data: { iskycVerified: 1, status: "approved", txn_id: "HEGI_0019281" } },
      undefined,
    );
    expect(r.ckycRefId).toBe("HEGI_0019281");
    expect(r.kycId).toBeUndefined();
    expect(r.ckycNumber).toBeUndefined();
  });
});

describe("hdfc Pehchaan status polls", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    tokenManager.invalidate("hdfc:kyc");
  });

  function jsonResponse(body: unknown, status = 200) {
    return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
  }

  it("polls by kyc id at /primary/kyc-status/:kycId", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { iskycVerified: 1, status: "approved" } }));

    const out = await hdfcKycStatusByKycId(config, "ZCT0BOQ7SH");
    expect(out.isKycSuccess).toBe(true);
    expect(out.kycId).toBe("ZCT0BOQ7SH");

    const call = fetchMock.mock.calls[1]!;
    expect(String(call[0])).toBe("https://kyc.example/e-kyc/primary/kyc-status/ZCT0BOQ7SH");
    expect((call[1] as RequestInit).headers).toMatchObject({ token: "jwt-1" });
  });

  it("polls by transaction id at /primary/kyc-status/transaction-id/:txnId", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1" } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { iskycVerified: 0, status: "rejected", txn_id: "HEGI_0019281" } }),
      );

    const out = await hdfcKycStatusByTxnId(config, "HEGI_0019281");
    expect(out.isKycSuccess).toBe(false);
    expect(out.displayMessage).toBe("rejected");
    expect(out.ckycRefId).toBe("HEGI_0019281");

    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      "https://kyc.example/e-kyc/primary/kyc-status/transaction-id/HEGI_0019281",
    );
  });

  it("refreshes the token once and retries on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-1" } }))
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { token: "jwt-2" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { iskycVerified: 1, status: "approved" } }));

    const out = await hdfcKycStatusByKycId(config, "ZCT0BOQ7SH");
    expect(out.isKycSuccess).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect((fetchMock.mock.calls[3]![1] as RequestInit).headers).toMatchObject({ token: "jwt-2" });
  });
});

describe("corporate CKYC contract", () => {
  it("accepts a corporate request keyed by entity PAN and date of incorporation", () => {
    // dob stays mandatory (see the comment on CkycRequestObjectSchema) — a
    // corporate caller currently has to duplicate dateOfIncorporation into it.
    const parsed = CkycRequestSchema.parse({
      transactionId: "TXN-1",
      dob: "2007-11-20",
      customerType: "corporate",
      entityPan: "AADCC2489H",
      dateOfIncorporation: "2007-11-20",
      entityType: "company",
    });
    expect(parsed.entityPan).toBe("AADCC2489H");
    expect(parsed.entityType).toBe("company");
  });

  it("accepts a corporate request keyed by CIN", () => {
    const parsed = CkycRequestSchema.parse({
      transactionId: "TXN-1a",
      dob: "2007-11-20",
      customerType: "corporate",
      entityCin: "U74999MH2007PLC123456",
      dateOfIncorporation: "2007-11-20",
      entityType: "company",
    });
    expect(parsed.entityCin).toBe("U74999MH2007PLC123456");
  });

  it("accepts a corporate request keyed by entity CKYC number", () => {
    const parsed = CkycRequestSchema.parse({
      transactionId: "TXN-1b",
      dob: "2007-11-20",
      customerType: "corporate",
      entityCkycNumber: "CKYC-ENT-1",
      dateOfIncorporation: "2007-11-20",
      entityType: "company",
    });
    expect(parsed.entityCkycNumber).toBe("CKYC-ENT-1");
  });

  it("falls through a blank entityCin to a populated entityCkycNumber (|| not ??)", () => {
    // Regression for the ?? bug: entityCin: "" is a *defined* value, so `??`
    // would stop there and never look at entityCkycNumber. `||` must fall through.
    const parsed = CkycRequestSchema.parse({
      transactionId: "TXN-1c",
      dob: "2007-11-20",
      customerType: "corporate",
      entityCin: "",
      entityCkycNumber: "CKYC-ENT-2",
      dateOfIncorporation: "2007-11-20",
      entityType: "company",
    });
    expect(parsed.entityCkycNumber).toBe("CKYC-ENT-2");
  });

  it("rejects a corporate request that names no entity identifier", () => {
    expect(() =>
      CkycRequestSchema.parse({
        transactionId: "TXN-2",
        dob: "2007-11-20",
        customerType: "corporate",
        entityType: "company",
        dateOfIncorporation: "2007-11-20",
      }),
    ).toThrow(/entityPan, entityCin or entityCkycNumber/);
  });

  it("rejects a corporate request missing dateOfIncorporation", () => {
    expect(() =>
      CkycRequestSchema.parse({
        transactionId: "TXN-2a",
        dob: "2007-11-20",
        customerType: "corporate",
        entityPan: "AADCC2489H",
        entityType: "company",
      }),
    ).toThrow(/dateOfIncorporation is required for a corporate request/);
  });

  it("rejects a corporate request missing entityType", () => {
    expect(() =>
      CkycRequestSchema.parse({
        transactionId: "TXN-2b",
        dob: "2007-11-20",
        customerType: "corporate",
        entityPan: "AADCC2489H",
        dateOfIncorporation: "2007-11-20",
      }),
    ).toThrow(/entityType is required for a corporate request/);
  });

  it("still accepts an individual request with no corporate fields", () => {
    const parsed = CkycRequestSchema.parse({
      transactionId: "TXN-3",
      dob: "1990-01-01",
      panNumber: "ABCPD1234E",
    });
    expect(parsed.customerType).toBeUndefined();
  });
});

describe("individual CKYC contract stays intact (escape-hatch regression)", () => {
  // These exist specifically to catch a `!==` / `===` typo in the corporate
  // escape hatch on the identifier refine — the riskiest line in the whole
  // change, since a flipped operator would silently disable identifier
  // validation for every ordinary (non-corporate) request.
  it("rejects a plain request (no customerType) with no identifier", () => {
    expect(() =>
      CkycRequestSchema.parse({ transactionId: "TXN-4", dob: "1990-01-01" }),
    ).toThrow(/One of panNumber, ckycNumber or aadhaarNumber is required/);
  });

  it("rejects an explicit customerType: individual request with no identifier", () => {
    expect(() =>
      CkycRequestSchema.parse({
        transactionId: "TXN-5",
        dob: "1990-01-01",
        customerType: "individual",
      }),
    ).toThrow(/One of panNumber, ckycNumber or aadhaarNumber is required/);
  });

  it("falls through a blank ckycNumber to a populated aadhaarNumber (|| not ??)", () => {
    // The individual half of the same `??` bug guarded on the corporate refine:
    // ckycNumber: "" is a *defined* value, so `??` would stop there and never
    // reach the populated aadhaarNumber, rejecting a perfectly valid request.
    // (panNumber can't stand in here — its regex rejects "" before the refine runs.)
    const parsed = CkycRequestSchema.parse({
      transactionId: "TXN-3a",
      dob: "1990-01-01",
      ckycNumber: "",
      aadhaarNumber: "123456789012",
      nameAsPerAadhaar: "MAHENDRA GHANCHI",
      gender: "M",
    });
    expect(parsed.aadhaarNumber).toBe("123456789012");
  });

  it("rejects any request — corporate or not — with no dob, since it stays mandatory", () => {
    expect(() =>
      CkycRequestSchema.parse({ transactionId: "TXN-6", panNumber: "ABCPD1234E" }),
    ).toThrow(/"path":\s*\[\s*"dob"\s*\]/);
  });
});

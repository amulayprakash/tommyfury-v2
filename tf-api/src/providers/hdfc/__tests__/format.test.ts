import { describe, it, expect } from "vitest";
import {
  toHdfcDate,
  formatRegWithDashes,
  yearOnly,
  normalizeClaim,
  bool01,
  boolTF,
  num,
} from "../format.ts";

describe("toHdfcDate", () => {
  it("formats an ISO date as DD/MM/YYYY", () => {
    expect(toHdfcDate("2024-03-19")).toBe("19/03/2024");
  });

  it("passes through a value already in DD/MM/YYYY", () => {
    expect(toHdfcDate("19/03/2024")).toBe("19/03/2024");
  });

  it("returns null for empty or unparseable input", () => {
    expect(toHdfcDate(undefined)).toBeNull();
    expect(toHdfcDate("")).toBeNull();
    expect(toHdfcDate("not-a-date")).toBeNull();
  });

  // Date-only ISO must not round-trip through Date: parsing gives UTC midnight,
  // and local getters would shift the day back on any host behind UTC. These
  // boundary dates are where that slip is most visible.
  it("does not shift date-only input across a year or month boundary", () => {
    expect(toHdfcDate("2024-01-01")).toBe("01/01/2024");
    expect(toHdfcDate("2026-03-01")).toBe("01/03/2026");
    expect(toHdfcDate("2026-12-31")).toBe("31/12/2026");
  });

  it("still accepts a Date instance", () => {
    expect(toHdfcDate(new Date(2024, 2, 19))).toBe("19/03/2024");
  });
});

describe("formatRegWithDashes", () => {
  // CreateProposal is rejected unless the plate carries dashes.
  it("inserts dashes into a compact registration number", () => {
    expect(formatRegWithDashes("MH12XT5251")).toBe("MH-12-XT-5251");
  });

  it("normalises spacing and case", () => {
    expect(formatRegWithDashes(" mh 01 qq 7878 ")).toBe("MH-01-QQ-7878");
  });

  it("leaves the 'New' sentinel untouched", () => {
    expect(formatRegWithDashes("New")).toBe("New");
  });

  it("returns null when there is no registration number", () => {
    expect(formatRegWithDashes(undefined)).toBeNull();
  });
});

describe("yearOnly", () => {
  // "10/2011" crashed HDFC's Blaze engine with "unexpected character".
  it("extracts a bare year from a month/year string", () => {
    expect(yearOnly("10/2011")).toBe("2011");
  });

  it("extracts a bare year from an ISO date", () => {
    expect(yearOnly("2011-10-05")).toBe("2011");
  });

  it("passes a bare year through", () => {
    expect(yearOnly("2024")).toBe("2024");
  });

  it("falls back to the supplied date's year", () => {
    expect(yearOnly(undefined, "2019-06-15")).toBe("2019");
  });
});

describe("normalizeClaim", () => {
  // HDFC's sample uses ALL CAPS; title case fails validation.
  it("returns YES for truthy claim values", () => {
    expect(normalizeClaim(true)).toBe("YES");
    expect(normalizeClaim("yes")).toBe("YES");
  });

  it("returns NO for everything else, including undefined", () => {
    expect(normalizeClaim(false)).toBe("NO");
    expect(normalizeClaim(undefined)).toBe("NO");
  });
});

describe("bool01 / boolTF / num", () => {
  it("bool01 maps truthy inputs to 1 and everything else to 0", () => {
    expect(bool01(true)).toBe(1);
    expect(bool01(1)).toBe(1);
    expect(bool01(false)).toBe(0);
    expect(bool01(undefined)).toBe(0);
  });

  it("boolTF returns a real boolean", () => {
    expect(boolTF(1)).toBe(true);
    expect(boolTF(undefined)).toBe(false);
  });

  it("num coerces safely with a default", () => {
    expect(num("1250")).toBe(1250);
    expect(num(undefined)).toBe(0);
    expect(num(undefined, 1)).toBe(1);
  });
});

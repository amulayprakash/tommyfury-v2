import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  base64ToPdfBlob,
  carriesPdf,
  coiFileName,
  CoiUnavailableError,
  saveCoi,
} from "../coi-download";

/** "%PDF-1.4\n" plus a little body — the real prefix HDFC returns. */
const PDF_B64 = btoa("%PDF-1.4\nbody");

describe("base64ToPdfBlob", () => {
  it("produces a PDF blob of the decoded length", async () => {
    const blob = base64ToPdfBlob(PDF_B64);
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe("%PDF-1.4\nbody".length);
  });

  it("round-trips the bytes exactly", async () => {
    const text = await base64ToPdfBlob(PDF_B64).text();
    expect(text).toBe("%PDF-1.4\nbody");
  });
});

describe("coiFileName", () => {
  it("names the file after the policy number", () => {
    expect(coiFileName("2302201225707100000")).toBe("HDFC-COI-2302201225707100000.pdf");
  });

  it("strips anything that would break a filename", () => {
    // Slashes, spaces and wildcards all removed; hyphens survive.
    expect(coiFileName("2302/2012 25*70?")).toBe("HDFC-COI-230220122570.pdf");
    expect(coiFileName("POL-123/456")).toBe("HDFC-COI-POL-123456.pdf");
  });

  it("falls back rather than producing a nameless file", () => {
    expect(coiFileName("///")).toBe("HDFC-COI-policy.pdf");
  });
});

describe("carriesPdf", () => {
  it("accepts a real PDF payload", () => {
    expect(carriesPdf({ coiBase64: PDF_B64 })).toBe(true);
  });

  it("rejects the empty string the endpoint returned while the bug was live", () => {
    // A 200 with coiBase64:"" must not become a 0-byte "certificate".
    expect(carriesPdf({ coiBase64: "" })).toBe(false);
  });

  it("rejects a payload that is base64 but not a PDF", () => {
    expect(carriesPdf({ coiBase64: btoa("not a pdf") })).toBe(false);
  });

  it("rejects null, undefined and a missing field", () => {
    expect(carriesPdf(null)).toBe(false);
    expect(carriesPdf(undefined)).toBe(false);
    expect(carriesPdf({})).toBe(false);
  });
});

describe("saveCoi", () => {
  const createObjectURL = vi.fn(() => "blob:fake");
  const revokeObjectURL = vi.fn();
  let clicked: HTMLAnchorElement | null = null;

  beforeEach(() => {
    clicked = null;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    // Capture the anchor saveCoi builds, without aliasing `this`.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      clicked = document.querySelector<HTMLAnchorElement>("a[download]");
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("downloads the PDF under the policy-number filename", () => {
    saveCoi({ coiBase64: PDF_B64 }, "2302201225707100000");
    expect(clicked?.download).toBe("HDFC-COI-2302201225707100000.pdf");
    expect(clicked?.href).toContain("blob:fake");
  });

  it("releases the blob url afterwards", () => {
    saveCoi({ coiBase64: PDF_B64 }, "2302201225707100000");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("refuses to download anything when HDFC sent no document", () => {
    expect(() => saveCoi({ coiBase64: "" }, "2302201225707100000")).toThrow(CoiUnavailableError);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { initiateOvd, validateOvdFile, OVD_MAX_FILE_BYTES } from "../api/vehicle-api";

const OVD_URL = "http://localhost:4000/api/v1/icici/kyc/ovd";

let captured: { contentType: string | null; form: FormData } | null = null;

const server = setupServer(
  http.post(OVD_URL, async ({ request }) => {
    captured = {
      contentType: request.headers.get("content-type"),
      form: await request.formData(),
    };
    return HttpResponse.json({
      response: { kycId: "kyc_test", isKycSuccess: true },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  captured = null;
});
afterAll(() => server.close());

const pngFile = (name: string, bytes = 32) =>
  new File([new Uint8Array(bytes).fill(7)], name, { type: "image/png" });

describe("initiateOvd", () => {
  // Regression: vendorClient defaults to `Content-Type: application/json`, which
  // makes axios serialise FormData to JSON and drop the files to `{}`. That
  // failed silently — the server just saw no files — so assert the wire format.
  it("sends a real multipart body with both files intact", async () => {
    const result = await initiateOvd("icici", {
      transactionId: "epn_test",
      proofOfIdentityType: "PAN",
      proofOfAddressType: "AADHAAR",
      proofOfIdentity: pngFile("pan.png"),
      proofOfAddress: pngFile("aadhaar.png"),
    });

    expect(result.isKycSuccess).toBe(true);

    // The assertion that matters: before the fix this was `application/json`
    // and the files arrived as `{}`, so multer never populated `req.files`.
    expect(captured?.contentType).toMatch(/^multipart\/form-data; *boundary=/);

    const form = captured!.form;
    expect(form.get("transactionId")).toBe("epn_test");
    expect(form.get("proofOfIdentityType")).toBe("PAN");
    expect(form.get("proofOfAddressType")).toBe("AADHAAR");
    expect(form.get("policyType")).toBe("motor");

    // Both parts must survive as binary rather than being stringified. jsdom's
    // XHR does not preserve filename/bytes across MSW interception (it renames
    // parts to "blob"), so assert the part *kind*, not its contents — the real
    // multipart round-trip through multer is covered in tf-api's
    // icici-integration test.
    for (const field of ["proofOfIdentity", "proofOfAddress"]) {
      const part = form.get(field);
      expect(typeof part, `${field} was stringified`).not.toBe("string");
      expect((part as Blob).type).toBe("image/png");
    }
  });
});

describe("validateOvdFile", () => {
  it("accepts JPG, PNG and PDF", () => {
    expect(validateOvdFile(pngFile("a.png"), "Identity proof")).toBeNull();
    expect(
      validateOvdFile(new File(["x"], "a.jpg", { type: "image/jpeg" }), "Identity proof"),
    ).toBeNull();
    expect(
      validateOvdFile(new File(["x"], "a.pdf", { type: "application/pdf" }), "Address proof"),
    ).toBeNull();
  });

  it("rejects an unsupported type, naming the field", () => {
    const msg = validateOvdFile(new File(["x"], "a.gif", { type: "image/gif" }), "Address proof");
    expect(msg).toBe("Address proof must be a JPG, PNG or PDF.");
  });

  it("rejects a file over the 5 MB server limit", () => {
    const big = pngFile("big.png", OVD_MAX_FILE_BYTES + 1);
    expect(validateOvdFile(big, "Identity proof")).toMatch(/limit is 5 MB/);
  });

  it("rejects an empty file", () => {
    expect(validateOvdFile(pngFile("empty.png", 0), "Identity proof")).toBe(
      "Identity proof is empty.",
    );
  });
});

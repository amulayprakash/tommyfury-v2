/**
 * Turning HDFC's base64 COI into a file the tester can actually keep.
 *
 * `GET /:provider/policy/:policyNo/certificate` answers with JSON carrying the
 * document as `coiBase64`, not a PDF stream — so pointing a link at that URL
 * just showed the tester ~477 KB of base64 in a browser tab. The certification
 * workbook wants the PDF itself attached against the policy number, which is why
 * this downloads rather than opening a viewer.
 */

/** What HDFC's certificate endpoint returns, narrowed to what we use. */
export interface CoiResponse {
  coiBase64?: string;
}

export class CoiUnavailableError extends Error {}

/**
 * Decodes base64 to a PDF blob.
 *
 * Built byte-by-byte from `atob` rather than via `fetch("data:…")` because the
 * document runs to hundreds of kilobytes and a data URL that size is refused by
 * some browsers.
 */
export function base64ToPdfBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

/** `HDFC-COI-2302201225707100000.pdf` — the policy number is the filing key. */
export function coiFileName(policyNo: string): string {
  const safe = policyNo.replace(/[^A-Za-z0-9-]/g, "") || "policy";
  return `HDFC-COI-${safe}.pdf`;
}

/**
 * True when the payload really carries a PDF.
 *
 * `JVBERi0` is base64 for `%PDF-`. Checking it matters: the endpoint returned a
 * 200 with an EMPTY `coiBase64` for weeks while the document sat unread under a
 * different key, and an empty-but-successful response must not download a 0-byte
 * file that looks like a certificate.
 */
export function carriesPdf(res: CoiResponse | null | undefined): boolean {
  const b64 = res?.coiBase64;
  return typeof b64 === "string" && b64.startsWith("JVBERi0");
}

/** Decodes and saves the COI. Throws `CoiUnavailableError` if there is no PDF. */
export function saveCoi(res: CoiResponse | null | undefined, policyNo: string): void {
  if (!carriesPdf(res)) {
    throw new CoiUnavailableError(
      "HDFC returned no certificate document for this policy. The raw response is in the exchange log below.",
    );
  }
  const url = URL.createObjectURL(base64ToPdfBlob(res!.coiBase64!));
  const a = document.createElement("a");
  try {
    a.href = url;
    a.download = coiFileName(policyNo);
    // Appended rather than clicked detached: Firefox ignores a click on an
    // anchor that is not in the document.
    document.body.appendChild(a);
    a.click();
  } finally {
    a.remove();
    // Revoking immediately is safe: the click has already handed the blob to the
    // browser's download manager.
    URL.revokeObjectURL(url);
  }
}

import crypto from "node:crypto";
import type { FgConfig } from "./config.ts";
import type { PaymentReceipt } from "@/contracts/policy.ts";

/**
 * FG Web-Aggregator payment gateway (WebAggPayNew.aspx). The aggregator builds a
 * checksum-signed HTML form that the browser POSTs to FG's hosted page; FG then
 * redirects to our ResponseURL with the (DES-encrypted) result, which we decrypt
 * and turn into the issuance Receipt. Spec: NewPaymentIntegration_v1.40.pdf.
 */

// DES-CBC params are fixed by FG's doc (do NOT change the key/IV).
const DES_KEY = Buffer.from("&%#@?,:*", "utf8"); // exactly 8 bytes
const DES_IV = Buffer.from([18, 50, 80, 125, 140, 170, 205, 230]);

/** PaymentOption → PGType used on the issuance Receipt. */
export const PG_TYPE_BY_OPTION: Record<string, string> = {
  "1": "PAYTM",
  "2": "HDFC",
  "3": "PAYU",
};

export interface PaymentInitiateInput {
  /** FG QuotationNo — used as both TransactionID and ProposalNumber. */
  quoteNo: string;
  premiumAmount: number;
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
}

export interface PaymentForm {
  url: string;
  fields: Record<string, string>;
}

/**
 * SHA-256 hex over the pipe-joined request params, trailing "|" after Email —
 * exactly the .NET format in the integration doc. No salt/secret is applied
 * (the doc's checksum is unsalted).
 */
export function paymentChecksum(fields: {
  TransactionID: string;
  PaymentOption: string;
  ResponseURL: string;
  ProposalNumber: string;
  PremiumAmount: string;
  UserIdentifier: string;
  UserId: string;
  FirstName: string;
  LastName: string;
  Mobile: string;
  Email: string;
}): string {
  const text =
    [
      fields.TransactionID,
      fields.PaymentOption,
      fields.ResponseURL,
      fields.ProposalNumber,
      fields.PremiumAmount,
      fields.UserIdentifier,
      fields.UserId,
      fields.FirstName,
      fields.LastName,
      fields.Mobile,
      fields.Email,
    ].join("|") + "|";
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** Builds the action URL + signed field set for the auto-submitting form. */
export function buildPaymentForm(config: FgConfig, input: PaymentInitiateInput): PaymentForm {
  if (!config.payment.responseUrl) {
    throw new Error("FG_PAYMENT_RESPONSE_URL is not configured");
  }
  const base = {
    TransactionID: input.quoteNo,
    PaymentOption: config.payment.paymentOption,
    ResponseURL: config.payment.responseUrl,
    ProposalNumber: input.quoteNo,
    PremiumAmount: String(Math.round(input.premiumAmount)),
    UserIdentifier: config.vendorCode,
    UserId: config.agentCode,
    FirstName: input.firstName,
    LastName: input.lastName,
    Mobile: input.mobile,
    Email: input.email,
  };
  const CheckSum = paymentChecksum(base);
  // Vendor=1 → PHP integration mode: FG returns the result as plain query/form
  // params on the ResponseURL (no DES decryption needed — portable on Node /
  // OpenSSL 3, which disables legacy single-DES). Blank/0 selects .NET mode
  // (encrypted ResponseData), handled defensively by parsePgFields.
  return { url: config.payment.url, fields: { ...base, Vendor: "1", CheckSum } };
}

export interface PgResult {
  wsPId?: string; // FG Transaction ID (WS_P_ID)
  tid?: string; // our TransactionID (== quoteNo)
  pgId?: string; // Payment Gateway ID (PGID)
  premium?: string;
  response?: string; // Success | Failure | Error
}

/** True when the runtime's OpenSSL exposes legacy single-DES (off by default in OpenSSL 3). */
export function desAvailable(): boolean {
  try {
    crypto.createDecipheriv("des-cbc", DES_KEY, DES_IV);
    return true;
  } catch {
    return false;
  }
}

/**
 * DES-CBC decrypt of the .NET `ResponseData` (base64; `$` is a `+` substitute).
 * Only used in .NET integration mode; we default to PHP mode (plain params) so
 * this rarely runs. Requires the OpenSSL legacy provider on Node ≥ 18/OpenSSL 3.
 */
export function decryptPaymentResponse(encrypted: string): string {
  const b64 = encrypted.replace(/\$/g, "+");
  const decipher = crypto.createDecipheriv("des-cbc", DES_KEY, DES_IV);
  return decipher.update(b64, "base64", "utf8") + decipher.final("utf8");
}

/** Parses decrypted/plain PG params (handles `&`-query and `|`-delimited forms). */
export function parsePgFields(raw: Record<string, unknown>): PgResult {
  // .NET integration: single encrypted `ResponseData`.
  const encrypted = typeof raw.ResponseData === "string" ? raw.ResponseData : undefined;
  let flat: Record<string, string> = {};
  if (encrypted) {
    const text = decryptPaymentResponse(encrypted);
    if (text.includes("=")) {
      for (const [k, v] of new URLSearchParams(text).entries()) flat[k] = v;
    } else {
      // pipe-delimited fallback: WS_P_ID|TID|PGID|Premium|Response
      const parts = text.split("|");
      flat = {
        WS_P_ID: parts[0] ?? "",
        TID: parts[1] ?? "",
        PGID: parts[2] ?? "",
        Premium: parts[3] ?? "",
        Response: parts[4] ?? "",
      };
    }
  } else {
    // PHP integration: fields arrive as plain query/form params.
    for (const k of ["WS_P_ID", "TID", "PGID", "Premium", "Response"]) {
      if (typeof raw[k] === "string") flat[k] = raw[k] as string;
    }
  }
  return {
    wsPId: flat.WS_P_ID,
    tid: flat.TID,
    pgId: flat.PGID,
    premium: flat.Premium,
    response: flat.Response,
  };
}

export function pgSucceeded(pg: PgResult): boolean {
  return (pg.response ?? "").trim().toLowerCase() === "success";
}

/**
 * Maps the PG result to the issuance Receipt. UniqueTranKey is our quoteNo-keyed
 * transaction id; TranRefNo is the gateway id (PGID). Dates default to now in
 * FG's DD/MM/YYYY HH:mm:ss format. NOTE: confirm the exact Receipt field mapping
 * with FG against a live UAT transaction.
 */
export function pgResultToReceipt(
  pg: PgResult,
  config: FgConfig,
  amount: number,
  now = new Date(),
): PaymentReceipt {
  const stamp = formatFgDateTime(now);
  return {
    uniqueTranKey: pg.tid ?? pg.wsPId ?? "",
    transactionDate: stamp,
    receiptType: "IVR",
    amount,
    tranRefNo: pg.pgId ?? pg.wsPId ?? "",
    tranRefNoDate: stamp,
    pgType: PG_TYPE_BY_OPTION[config.payment.paymentOption] ?? "PAYU",
  };
}

function formatFgDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

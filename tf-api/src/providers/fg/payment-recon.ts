import { XMLParser } from "fast-xml-parser";
import { ProviderError } from "@/errors/app-error.ts";
import { FG_SLUG } from "./config.ts";
import type { FgConfig } from "./config.ts";

/**
 * FG Web-Aggregator payment reconciliation (v1.41). Before issuing a policy we
 * re-verify the transaction directly against FG's PG recon SOAP service
 * (`FetchTRNDetails`) — NOT the WSO2 motor gateway, and no bearer token. Per the
 * v1.41 doc: "match the Transaction ID & transaction amount returned … against
 * that sent in transaction request. In case of mismatch, product or service
 * should not be fulfilled."
 */

/** Transport seam so tests supply a recorded response without hitting the network. */
export type ReconTransport = (url: string, soapBody: string) => Promise<string>;

export interface ReconInput {
  /**
   * The id `FetchTRNDetails` is keyed by. The caller selects it from the PG
   * result per `FG_PAYMENT_RECON_KEY`: our TransactionID (pg.tid, == quoteNo) or
   * FG's WS_P_ID (pg.wsPId). Which one FetchTRNDetails actually accepts is
   * UNVERIFIED on UAT — see open confirmations.
   */
  transactionId: string;
  /** The premium (whole rupees) we sent — the server-known proposal amount. */
  expectedAmount: number;
  /** `source` field, e.g. "webaggregator". */
  source: string;
}

export interface ReconRecord {
  status?: string;
  transactionId?: string;
  paymentAmount?: number;
  fgTransactionId?: string;
  pgTransactionId?: string;
}

export interface ReconResult extends ReconRecord {
  ok: boolean;
  /** Populated only when ok=false — why reconciliation was refused. */
  reason?: string;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false, // keep values as strings ("2530", "18387194847")
  trimValues: true,
});

/** Builds the FetchTRNDetails SOAP request body (v1.41 PDF p14 example). */
export function buildReconSoapBody(transactionId: string, source: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>` +
    `<FetchTRNDetails xmlns="http://tempuri.org/">` +
    `<transactionId>${transactionId}</transactionId>` +
    `<source>${source}</source>` +
    `</FetchTRNDetails>` +
    `</soap:Body></soap:Envelope>`
  );
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/**
 * The recon service is inconsistent across its two URL forms: the `?op=` SOAP
 * form wraps `GetQuickPayDetailsNewResult > QuickPayFields`, while the plain
 * `/FetchTRNDetails` form returns a bare `Response > listQuickPayFields >
 * QuickPayField`. Recursively find the first object carrying transaction fields.
 */
function findRecord(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const el of node) {
      const found = findRecord(el);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ("TransactionStatus" in o || "TransactionId" in o) return o;
    for (const v of Object.values(o)) {
      const found = findRecord(v);
      if (found) return found;
    }
  }
  return null;
}

/** Parses a FetchTRNDetails XML response into the transaction record, or null. */
export function parseReconResponse(xml: string): ReconRecord | null {
  const rec = findRecord(parser.parse(xml));
  if (!rec) return null;
  const amountRaw = str(rec.PaymentAmount);
  const paymentAmount = amountRaw !== undefined ? Number(amountRaw) : undefined;
  return {
    status: str(rec.TransactionStatus),
    transactionId: str(rec.TransactionId),
    paymentAmount: Number.isFinite(paymentAmount) ? paymentAmount : undefined,
    fgTransactionId: str(rec.FG_Transaction_ID),
    pgTransactionId: str(rec.PGTransactionID),
  };
}

const defaultReconTransport: ReconTransport = async (url, soapBody) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://tempuri.org/FetchTRNDetails",
    },
    body: soapBody,
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new ProviderError(
      FG_SLUG,
      response.status,
      `FG payment recon failed [${response.status}]`,
      text.slice(0, 500),
    );
  }
  return text;
};

/**
 * Calls FetchTRNDetails and validates the result against what we sent. Returns
 * `{ ok: true, … }` only when the transaction is terminally successful AND both
 * the transactionId and the paid amount match. Never throws on a business
 * mismatch — returns `ok: false` with a `reason` so the caller can decline
 * issuance and redirect to the failure page.
 */
export async function reconcilePayment(
  config: FgConfig,
  input: ReconInput,
  transport: ReconTransport = defaultReconTransport,
): Promise<ReconResult> {
  const xml = await transport(config.payment.reconUrl, buildReconSoapBody(input.transactionId, input.source));
  const rec = parseReconResponse(xml);
  if (!rec) return { ok: false, reason: "recon record not found" };

  const statusOk = (rec.status ?? "").toLowerCase().startsWith("success");
  const idOk = rec.transactionId === input.transactionId;
  const amtOk = typeof rec.paymentAmount === "number" && rec.paymentAmount === input.expectedAmount;

  if (statusOk && idOk && amtOk) return { ok: true, ...rec };

  const reasons: string[] = [];
  if (!statusOk) reasons.push(`status "${rec.status ?? ""}" not success`);
  if (!idOk) reasons.push(`transactionId mismatch (sent ${input.transactionId}, got ${rec.transactionId ?? ""})`);
  if (!amtOk) reasons.push(`amount mismatch (expected ${input.expectedAmount}, got ${rec.paymentAmount ?? ""})`);
  return { ok: false, reason: reasons.join("; "), ...rec };
}

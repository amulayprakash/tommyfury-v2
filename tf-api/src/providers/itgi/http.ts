import { XMLParser } from "fast-xml-parser";
import { ProviderError } from "@/errors/app-error.ts";
import { ITGI_SLUG } from "./config.ts";

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false, // keep values as strings (preserve leading zeros)
  processEntities: true,
  trimValues: true,
  // The premium service returns two <getMotorPremiumReturn> siblings. Without
  // this, a single-block response parses to an object and a dual-block one to an
  // array — force the elements we branch on to always be arrays.
  isArray: (name) =>
    name === "getMotorPremiumReturn" ||
    name === "getNewVehiclePremiumReturn" ||
    name === "coveragePremiumDetail",
});

/** Wraps a body fragment in a SOAP 1.1 envelope with the given prefix→uri map. */
export function soapEnvelope(body: string, namespaces: Record<string, string>): string {
  const ns = Object.entries(namespaces)
    .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
    .join("");
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"${ns}>` +
    `<soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`
  );
}

/** The two namespace families ITGI uses (see docs/itgi-integration-notes.md §3). */
export const ITGI_NS = {
  /** IDV + premium services. */
  premium: { prem: "http://premiumwrapper.motor.itgi.com" },
  /** Proposal / payment / status: operations in util, data in wrap. */
  partner: {
    util: "http://util.ptnr.itgi.com",
    wrap: "http://wrapper.data.ptnr.itgi.com",
  },
} as const;

/** Unwraps `<Envelope><Body>` and returns the parsed body content. */
export function parseItgiSoap(text: string): unknown {
  const env = parser.parse(text) as Record<string, unknown>;
  const envelope = env?.Envelope as Record<string, unknown> | undefined;
  const body = envelope?.Body as Record<string, unknown> | undefined;
  return body ?? env;
}

export interface ItgiRequestOptions {
  requestId: string;
}

export interface ItgiJsonOptions extends ItgiRequestOptions {
  basicAuth?: { user: string; password: string };
}

/** Injectable transport so tests drive fixtures without touching the network. */
export interface ItgiTransport {
  soap(url: string, xml: string, opts: ItgiRequestOptions): Promise<unknown>;
  json(url: string, body: unknown, opts: ItgiJsonOptions): Promise<unknown>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Default transport. ITGI needs no Authorization header on SOAP — auth is the
 * partner code carried in the request body plus (presumed) IP whitelisting.
 * Only the policy-download REST call uses HTTP Basic.
 */
export class FetchItgiTransport implements ItgiTransport {
  constructor(private readonly doFetch: FetchLike = fetch) {}

  async soap(url: string, xml: string, _opts: ItgiRequestOptions): Promise<unknown> {
    const response = await this.doFetch(url, {
      method: "POST",
      headers: {
        // ITGI's WSDLs declare soapAction="" on every operation.
        SOAPAction: "",
        "Content-Type": "text/xml; charset=utf-8",
      },
      body: xml,
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw httpError(response.status, text);

    const parsed = parseItgiSoap(text) as Record<string, unknown>;
    const fault = parsed?.Fault as Record<string, unknown> | undefined;
    if (fault) {
      const detail = typeof fault.faultstring === "string" ? fault.faultstring : "SOAP fault";
      throw new ProviderError(
        ITGI_SLUG,
        502,
        `ITGI request failed: ${detail}`,
        text.slice(0, 500),
        "PROVIDER_ERROR",
      );
    }
    return parsed;
  }

  async json(url: string, body: unknown, opts: ItgiJsonOptions): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      accept: "application/json",
    };
    if (opts.basicAuth) {
      const raw = `${opts.basicAuth.user}:${opts.basicAuth.password}`;
      headers.Authorization = `Basic ${Buffer.from(raw).toString("base64")}`;
    }
    const response = await this.doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw httpError(response.status, text);
    try {
      return text ? (JSON.parse(text) as unknown) : {};
    } catch {
      throw new ProviderError(
        ITGI_SLUG,
        response.status,
        "ITGI returned a non-JSON body",
        text.slice(0, 500),
      );
    }
  }
}

function httpError(status: number, text: string): ProviderError {
  const transient = status >= 500;
  return new ProviderError(
    ITGI_SLUG,
    status,
    transient
      ? "IFFCO-Tokio's service is temporarily unavailable. Please try again in a moment."
      : `ITGI request failed [${status}]`,
    text.slice(0, 500),
    transient ? "UPSTREAM_UNAVAILABLE" : "PROVIDER_ERROR",
  );
}

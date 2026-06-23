import { XMLParser } from "fast-xml-parser";
import { ProviderError } from "@/errors/app-error.ts";
import { FG_SLUG } from "./config.ts";

/**
 * Injectable transport so tests can supply a fake FG backend driven by recorded
 * fixtures (returning the parsed `Root` object) without touching the network.
 */
export interface FgTransport {
  request(args: {
    method: "GET" | "POST";
    url: string;
    token: string;
    xmlBody?: string;
    soapAction?: string;
  }): Promise<unknown>;
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false, // keep everything as strings (preserve "0000621254", "562,818")
  processEntities: true, // decode &lt;Root&gt; in the *Result text
  trimValues: true,
});

/**
 * FG returns a SOAP envelope whose `<…Result>` element contains the (entity-
 * escaped) `<Root>…</Root>` business XML. Unwrap the envelope, then parse the
 * inner Root into the same object shape the normalizer expects.
 */
export function parseSoapResponse(text: string): unknown {
  const env = xmlParser.parse(text) as Record<string, unknown>;
  const body = (env?.Envelope as Record<string, unknown> | undefined)?.Body as
    | Record<string, unknown>
    | undefined;
  if (!body) return env;

  const respKey = Object.keys(body).find((k) => k.endsWith("Response"));
  const resp = respKey ? (body[respKey] as Record<string, unknown>) : undefined;
  if (!resp || typeof resp !== "object") return body;

  const resultKey = Object.keys(resp).find((k) => k.endsWith("Result"));
  const rootXml = resultKey ? resp[resultKey] : undefined;
  if (typeof rootXml !== "string") return resp;

  const parsed = xmlParser.parse(rootXml) as Record<string, unknown>;
  return parsed.Root ?? parsed;
}

/** Default transport backed by global fetch (SOAP/XML over HTTPS). */
export class FetchTransport implements FgTransport {
  async request(args: {
    method: "GET" | "POST";
    url: string;
    token: string;
    xmlBody?: string;
    soapAction?: string;
  }): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "text/xml",
      accept: "application/json",
    };
    if (args.soapAction) headers["SOAPAction"] = args.soapAction;

    const response = await fetch(args.url, { method: args.method, headers, body: args.xmlBody });
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      throw new ProviderError(
        FG_SLUG,
        response.status,
        `FG request failed [${response.status}]`,
        text.slice(0, 500),
      );
    }
    return parseSoapResponse(text);
  }
}

/**
 * Recursively digs the most specific human error string out of a (possibly
 * nested) FG `Error`/`ErrorMessage` value — FG sometimes nests an entire `<Root>`
 * (with its own Error/ErrorMessage) inside ErrorMessage, which naively coerces to
 * "[object Object]". Returns the deepest non-generic message.
 */
export function extractFgError(value: unknown, depth = 0): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || depth > 6) return "";
  const o = value as Record<string, unknown>;
  // Prefer the inner ErrorMessage, then Error, then any nested Root, then scan.
  for (const key of ["ErrorMessage", "Error", "Message", "Root"] as const) {
    if (key in o) {
      const inner = extractFgError(o[key], depth + 1);
      if (inner) return inner;
    }
  }
  for (const v of Object.values(o)) {
    const inner = extractFgError(v, depth + 1);
    if (inner) return inner;
  }
  return "";
}

/** Classifies an FG failure message into a canonical, frontend-friendly code. */
export function classifyFgError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("referral") || m.includes("declined")) return "REFERRAL_DECLINED";
  if (m.includes("tp policy expired") || m.includes("tp policy has expired")) return "PREV_TP_EXPIRED";
  if (m.includes("previous tp") || m.includes("previous t.p")) return "PREV_TP_REQUIRED";
  if (m.includes("vehicle class")) return "VEHICLE_CLASS_REQUIRED";
  if (m.includes("addon") || m.includes("add on") || m.includes("calling vendor api"))
    return "ADDON_UNAVAILABLE";
  if (m.includes("invalid period")) return "ADDON_INELIGIBLE";
  if (m.includes("policy period")) return "INVALID_POLICY_PERIOD";
  if (m.includes("vendorcode") && m.includes("vendoruserid")) return "VENDOR_CONFIG";
  if (m.includes("unable to connect") || m.includes("remote server") || m.includes("timeout"))
    return "UPSTREAM_UNAVAILABLE";
  return "PROVIDER_ERROR";
}

/**
 * FG signals business failures via a section `Status` of "Fail"/"Failed" plus an
 * `Error`/`ErrorMessage` (sometimes a nested Root). Surface the most specific
 * message with a canonical error code.
 */
export function assertFgSuccess(root: Record<string, unknown>, context: string): void {
  const topStatus = typeof root.Status === "string" ? root.Status.trim().toLowerCase() : "";
  const sectionFailed = (["Client", "Policy", "Receipt"] as const).some((key) => {
    const s = root[key];
    if (!s || typeof s !== "object") return false;
    const st = (s as Record<string, unknown>).Status;
    return typeof st === "string" && st.trim() && !st.trim().toLowerCase().startsWith("success");
  });

  const topFailed = Boolean(topStatus) && (topStatus.startsWith("fail") || topStatus.startsWith("error"));
  if (!topFailed && !sectionFailed) return;

  const message = extractFgError(root) || "unknown error";
  throw new ProviderError(
    FG_SLUG,
    200,
    `FG ${context} failed: ${message}`,
    root,
    classifyFgError(message),
  );
}

import { XMLParser } from "fast-xml-parser";
import { ProviderError } from "@/errors/app-error.ts";
import { FG_SLUG } from "./config.ts";

/**
 * Injectable transport so tests can supply a fake FG backend driven by recorded
 * fixtures without touching the network. Motor uses `jsonBody` (JSON gateway);
 * the health line still uses `xmlBody`/`soapAction` (SOAP) through this same
 * transport, so both shapes are supported.
 */
export interface FgTransport {
  request(args: {
    method: "GET" | "POST";
    url: string;
    token: string;
    /** Motor JSON body (application/json). Presence selects JSON mode. */
    jsonBody?: unknown;
    /** Health SOAP body (text/xml). */
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

/** Default transport backed by global fetch: JSON for motor, SOAP/XML for health. */
export class FetchTransport implements FgTransport {
  async request(args: {
    method: "GET" | "POST";
    url: string;
    token: string;
    jsonBody?: unknown;
    xmlBody?: string;
    soapAction?: string;
  }): Promise<unknown> {
    const isJson = args.jsonBody !== undefined;
    const headers: Record<string, string> = isJson
      ? { "Content-Type": "application/json", accept: "*/*" }
      : { "Content-Type": "text/xml", accept: "application/json" };
    // No token → send the request unauthenticated rather than a bare "Bearer ".
    // GCI confirmed the motor endpoints do not require one, and it is verified
    // live on UAT (see providers/fg/__tests__/auth-optional.test.ts).
    if (args.token) headers.Authorization = `Bearer ${args.token}`;
    if (args.soapAction) headers["SOAPAction"] = args.soapAction;

    const body = isJson ? JSON.stringify(args.jsonBody) : args.xmlBody;
    const response = await fetch(args.url, { method: args.method, headers, body });
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      // FG's UAT BANCS backend intermittently returns bare IIS 5xx pages while
      // the gateway/token stay healthy — treat those as a transient upstream
      // outage (retryable) with a friendly message rather than a raw dump.
      const transient = response.status >= 500;
      throw new ProviderError(
        FG_SLUG,
        response.status,
        transient
          ? "FG's service is temporarily unavailable. Please try again in a moment."
          : `FG request failed [${response.status}]`,
        text.slice(0, 500),
        transient ? "UPSTREAM_UNAVAILABLE" : "PROVIDER_ERROR",
      );
    }

    if (isJson) {
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        throw new ProviderError(FG_SLUG, response.status, "FG returned a non-JSON body", text.slice(0, 500));
      }
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
  if (typeof value === "string") {
    const s = value.trim();
    // FG sometimes packs a whole JSON error blob into a string field — e.g. the
    // CKYC failure surfaces ErrorMessage='{"message":"No record exist.",…}'.
    // Unwrap it so we report "No record exist." instead of raw JSON.
    if (depth <= 6 && s.startsWith("{") && s.endsWith("}")) {
      try {
        const inner = extractFgError(JSON.parse(s) as unknown, depth + 1);
        if (inner) return inner;
      } catch {
        /* not valid JSON — fall through to the raw string */
      }
    }
    return s;
  }
  if (!value || typeof value !== "object" || depth > 6) return "";
  const o = value as Record<string, unknown>;

  // A short `Error` label (e.g. "CKYC error") is most useful prefixed onto the
  // deeper, specific message ("No record exist.") rather than returned alone.
  const label =
    typeof o.Error === "string" && o.Error.trim() && !o.Error.trim().startsWith("{")
      ? o.Error.trim()
      : "";

  // `Description` outranks `Message`: on CRT/issuance failures FG sets Message to
  // a generic stage label ("Error During UW Validation", "Error During Quote
  // Issuance") and puts the actionable reason in Description ("Vehicle Age is not
  // Configured for this Rule", "Duplicate Registration Number"). Reading Message
  // alone both hid the cause and mis-classified permanent UW rejections as
  // transient — telling users to "try again in a moment" for something that can
  // never succeed.
  for (const key of ["ErrorMessage", "message", "Description", "Message", "Root"] as const) {
    if (key in o) {
      const inner = extractFgError(o[key], depth + 1);
      if (inner && inner !== label) return label ? `${label}: ${inner}` : inner;
    }
  }
  if (label) return label;
  for (const v of Object.values(o)) {
    const inner = extractFgError(v, depth + 1);
    if (inner) return inner;
  }
  return "";
}

/** Classifies an FG failure message into a canonical, frontend-friendly code. */
export function classifyFgError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("break-in") || m.includes("breakin") || m.includes("inspection details"))
    return "INSPECTION_REQUIRED";
  if (m.includes("ckyc") || m.includes("kyc") || m.includes("no record exist"))
    return "KYC_INCOMPLETE";
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
  // FG BANCS system exceptions (not user-actionable) — the reinsurance module or
  // issuance stage flaking. Treat as a transient upstream failure (retryable).
  if (
    m.includes("reinsurance") ||
    m.includes("user-defined exception") ||
    m.includes("error during quote issuance")
  )
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
  const code = classifyFgError(message);
  // Transient FG BANCS faults (reinsurance/issuance module flaking) are not
  // user-actionable — surface the same friendly, retryable wording we use for a
  // raw FG 5xx rather than FG's internal exception text. The raw detail is kept
  // in `details` for logs/debugging.
  const userMessage =
    code === "UPSTREAM_UNAVAILABLE"
      ? "FG's service is temporarily unavailable. Please try again in a moment."
      : `FG ${context} failed: ${message}`;
  throw new ProviderError(FG_SLUG, 200, userMessage, root, code);
}

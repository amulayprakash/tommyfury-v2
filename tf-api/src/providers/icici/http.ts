import { ProviderError } from "@/errors/app-error.ts";
import { ICICI_SLUG } from "./config.ts";

/**
 * Injectable transport so tests can supply a fake ICICI backend driven by the
 * recorded PDF fixtures without touching the network.
 */
export interface IciciTransport {
  request(args: {
    method: "GET" | "POST";
    url: string;
    token: string;
    jsonBody?: unknown;
    formData?: FormData;
  }): Promise<unknown>;
}

/** Default transport backed by global fetch. */
export class FetchTransport implements IciciTransport {
  async request(args: {
    method: "GET" | "POST";
    url: string;
    token: string;
    jsonBody?: unknown;
    formData?: FormData;
  }): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${args.token}` };
    let body: string | FormData | undefined;

    if (args.formData) {
      body = args.formData; // browser/undici sets multipart boundary
    } else if (args.jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(args.jsonBody);
    }

    const response = await fetch(args.url, { method: args.method, headers, body });
    const text = await response.text().catch(() => "");
    const parsed = text ? safeJson(text) : undefined;

    if (!response.ok) {
      throw new ProviderError(
        ICICI_SLUG,
        response.status,
        `ICICI request failed [${response.status}]`,
        parsed ?? text,
      );
    }
    return parsed;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** ICICI returns Success:false (HTTP 200) for business failures — surface those. */
export function assertIciciSuccess(body: unknown, context: string): void {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.Success === false) {
      throw new ProviderError(
        ICICI_SLUG,
        200,
        `ICICI ${context} failed: ${String(b.ErrorMessage ?? b.DisplayMessage ?? "unknown")}`,
        body,
      );
    }
  }
}

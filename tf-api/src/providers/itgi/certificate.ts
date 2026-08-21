import type { ItgiConfig } from "./config.ts";
import { ITGI_ENDPOINTS, itgiBasicAuth } from "./config.ts";
import type { ItgiTransport } from "./http.ts";

export interface ItgiDownloadInput {
  policyNumber: string;
  contractType: "PCP" | "TWP";
}

export interface ItgiDownloadResult {
  url?: string;
  status: string;
  success: boolean;
}

/**
 * Policy download is the only ITGI call using HTTP Basic auth.
 *
 * NOTE: staging returns a placeholder PDF, so any non-empty link with
 * statusMessage SUCCESS is treated as success. It can also take ~3 hours after
 * issuance for the real document to become available.
 */
export async function itgiDownloadPolicy(
  cfg: ItgiConfig,
  input: ItgiDownloadInput,
  transport: ItgiTransport,
  requestId: string,
): Promise<ItgiDownloadResult> {
  const raw = (await transport.json(
    ITGI_ENDPOINTS.policyDownload(cfg),
    {
      contractType: input.contractType,
      policyDownloadNo: input.policyNumber,
      partnerDetail: { partnerCode: cfg.partnerCode },
    },
    {
      requestId,
      basicAuth: itgiBasicAuth(cfg),
    },
  )) as Record<string, unknown>;

  const url = String(raw.policyDownloadLink ?? "").trim() || undefined;
  const status = String(raw.statusMessage ?? "").trim();
  return { url, status, success: Boolean(url) && status.toUpperCase() === "SUCCESS" };
}

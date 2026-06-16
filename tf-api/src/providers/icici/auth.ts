import { expiryWithThreshold, type TokenFetcher } from "@/providers/token-manager.ts";
import { encryptPassword } from "./crypto.ts";
import type { IciciConfig } from "./config.ts";

interface IciciTokenResponse {
  token?: string;
  expiry?: string; // UTC timestamp, e.g. "2018-12-17T07:03:31Z"
  success: boolean;
  errorCode?: number;
  errorMessage?: string;
}

/**
 * ICICI auth is NOT OAuth2: POST {Login, Password(AES), LoginType:"App"} → JWT.
 * The doc text says "1500 milliseconds" but the field table says "20 Minute"
 * and the body returns an absolute `expiry` — we trust the returned timestamp
 * and refresh at 80% of its remaining life.
 */
export function iciciTokenFetcher(config: IciciConfig): TokenFetcher {
  return async () => {
    const body = JSON.stringify({
      Login: config.login,
      Password: encryptPassword(config.password, config.aesKey, config.aesMode),
      LoginType: "App",
    });

    const response = await fetch(`${config.baseUrl}/auth-api/access/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`ICICI auth failed [${response.status}]: ${text}`);
    }

    const json = (await response.json()) as IciciTokenResponse;
    if (!json.success || !json.token) {
      throw new Error(`ICICI auth rejected: ${json.errorMessage ?? "unknown error"}`);
    }

    const expiryMs = json.expiry ? Date.parse(json.expiry) : Date.now() + 20 * 60_000;
    return {
      accessToken: json.token,
      expiresAt: expiryWithThreshold(Number.isNaN(expiryMs) ? Date.now() + 20 * 60_000 : expiryMs),
    };
  };
}

import { oauth2PasswordFetcher, type TokenFetcher } from "@/providers/token-manager.ts";
import type { FgConfig, FgProductAuth } from "./config.ts";

/**
 * FG auth is a standard OAuth2 resource-owner password grant against the APIM
 * gateway: POST grant_type=password with an Authorization: Basic <client> header
 * → { access_token, token_type, expires_in:3600 }. The token is then sent as a
 * Bearer on every Motor API call.
 */
export function fgTokenFetcher(config: FgConfig): TokenFetcher {
  return oauth2PasswordFetcher({
    clientBasic: config.clientBasic,
    username: config.username,
    password: config.password,
    tokenUrl: config.tokenUrl,
  });
}

/**
 * Token fetcher for a non-motor FG product (CKYC, renewal). Same password grant
 * with the shared username/password, but the product's own client subscription
 * (clientBasic) and token URL — each WSO2 product issues its own token.
 */
export function fgProductTokenFetcher(config: FgConfig, product: FgProductAuth): TokenFetcher {
  return oauth2PasswordFetcher({
    clientBasic: product.clientBasic,
    username: config.username,
    password: config.password,
    tokenUrl: product.tokenUrl,
  });
}

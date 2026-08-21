/**
 * OPERATOR-RUN, LIVE. Not a vitest test — never runs in CI, commits no secrets.
 * Confirms which UAT CKYC host actually answers before changing
 * FG_GATEWAY.ckycBaseUrl in src/providers/fg/config.ts.
 *
 * Host comes from FG_GATEWAY.ckycBaseUrl (or --host); creds come from .env.
 * Usage from tf-api/:
 *   npx tsx --env-file=.env scripts/verify-fg-ckyc-host.ts
 *   npx tsx --env-file=.env scripts/verify-fg-ckyc-host.ts \
 *     --host https://uat-internal-apigw.futuregenerali.in:8243/GCKYC/3.0.0
 *
 * Mints a CKYC-product token (WSO2 password grant) then POSTs VerifyCKYC. HTTP
 * 200 (apiStatus Success/Failed) => the host answers; connection error / 404 =>
 * it does not. Compare both candidates, then set FG_GATEWAY.ckycBaseUrl to the
 * one that answers.
 *
 * CKYC-specific resource-owner creds: intel §9 lists distinct CKYC UAT creds
 * (GCCKYC_Dev / GCKYC@dev26) separate from the shared motor FG_USERNAME/FG_PASSWORD.
 * If the CKYC WSO2 product rejects the shared creds (mint 401s), probe with the
 * §9 creds by setting FG_CKYC_USERNAME / FG_CKYC_PASSWORD in .env — they override
 * FG_USERNAME / FG_PASSWORD here and nowhere else.
 */
import { FG_GATEWAY, FG_CHANNEL } from "@/providers/fg/config.ts";

const hostArg = process.argv.indexOf("--host");
const baseUrl = (hostArg > -1 ? process.argv[hostArg + 1] : FG_GATEWAY.ckycBaseUrl)?.replace(/\/$/, "");
const tokenUrl = FG_GATEWAY.tokenUrl;
const basic = process.env.FG_CKYC_CLIENT_BASIC ?? process.env.FG_CLIENT_BASIC;
const username = process.env.FG_CKYC_USERNAME ?? process.env.FG_USERNAME;
const password = process.env.FG_CKYC_PASSWORD ?? process.env.FG_PASSWORD;
const subToken = process.env.FG_CKYC_SUBSCRIPTION_TOKEN;
const systemName = FG_CHANNEL.vendorCode;

if (!baseUrl || !tokenUrl || !basic || !username || !password) {
  console.error(
    "Missing credentials in .env. Need FG_CKYC_CLIENT_BASIC/FG_CLIENT_BASIC and " +
      "resource-owner creds (FG_CKYC_USERNAME/FG_USERNAME + FG_CKYC_PASSWORD/FG_PASSWORD).",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  console.log(`[verify] token host : ${tokenUrl}`);
  const tokenRes = await fetch(tokenUrl!, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", username: username!, password: password! }),
  });
  const tokenText = await tokenRes.text();
  console.log(`[verify] token status: ${tokenRes.status}`);
  if (!tokenRes.ok) {
    console.error(tokenText.slice(0, 400));
    process.exit(1);
  }
  const token = (JSON.parse(tokenText) as { access_token?: string }).access_token;
  if (!token) {
    console.error("No access_token in token response");
    process.exit(1);
  }

  const url = `${baseUrl}/Web/VerifyCKYC`;
  console.log(`[verify] VerifyCKYC   : ${url}`);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "*/*",
    Authorization: `Bearer ${token}`,
  };
  if (subToken) headers.Token = subToken;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      req_id: `VERIFY_${Date.now()}`,
      proposal_id: "",
      id_type: "PAN",
      id_num: "AYDPM5057B",
      dob: "14-01-1989",
      mobile: "",
      otp: "",
      full_name: "GANESH MISAL",
      gender: "M",
      url_type: "",
      customer_type: "I",
      redirect_url: "",
      system_name: systemName,
    }),
  });
  const body = await res.text();
  console.log(`[verify] VerifyCKYC status: ${res.status}`);
  console.log(body.slice(0, 600));
  console.log(
    res.ok
      ? "[verify] HOST ANSWERS — safe to point FG_CKYC_BASE_URL here after review."
      : "[verify] host did NOT return 200 — try the other candidate host.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

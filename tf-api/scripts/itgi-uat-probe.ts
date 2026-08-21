/**
 * Live UAT probe for IFFCO-Tokio (ITGI) — READ-ONLY.
 *
 *   npx tsx --env-file=.env scripts/itgi-uat-probe.ts
 *
 * Answers the questions we cannot settle from the kit alone:
 *   1. Is ITGI's staging reachable from this host, or are we IP-blocked?
 *      (The IDV service carries NO partner code, so it isolates reachability
 *      from credentials.)
 *   2. Does the premium service accept our envelope and our partner code?
 *   3. Does rtoCity accept a plain city name ("DELHI") — which would shrink the
 *      missing-RTO-master gap — or does it demand a proprietary token?
 *   4. Do the REST services (CKYC, master data, policy download) accept our
 *      HTTP Basic partner credentials?
 *
 * Deliberately NEVER calls MotorServiceReq (proposal) or PaymentUpdateWS: those
 * create real records in ITGI's core. It also never sends another partner's
 * code — only our configured one.
 */
import { FetchItgiTransport, soapEnvelope, ITGI_NS } from "../src/providers/itgi/http.ts";
import { buildIdvPayload, buildPremiumPayload } from "../src/providers/itgi/mapper.ts";
import { selectPolicyPath } from "../src/providers/itgi/policy-types/index.ts";
import { normalizeIdv } from "../src/providers/itgi/normalizer.ts";
import { ITGI_ENDPOINTS, itgiBasicAuth, itgiConfig } from "../src/providers/itgi/config.ts";
import type { MotorQuoteRequest } from "../src/contracts/quote-request.ts";

const cfg = itgiConfig();
const transport = new FetchItgiTransport();
const requestId = "itgi-probe";

/** A plausible UAT vehicle: Maruti Swift, Delhi, using the kit's own sample codes. */
const req = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  makeId: "1",
  makeName: "MARUTI",
  modelId: "10",
  modelName: "SWIFT",
  fuelType: "petrol",
  engineCC: 1197,
  seatingCapacity: 5,
  rtoCode: "DL01",
  registrationDate: "2023-10-20",
  registrationNumber: "DL10AH4567",
  policyStartDate: "2026-08-01",
  policyEndDate: "2027-07-31",
  previousPolicyExpiryDate: "2026-07-31",
  ncbPercent: 0,
  idvValue: 0,
  paOwner: true,
  zeroDep: false,
  engineProtect: false,
  tyreProtect: false,
  rimProtect: false,
  consumables: false,
  rsa: false,
  paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false,
  claimInPreviousPolicy: false,
  isPreviousPolicyExpired: false,
} as unknown as MotorQuoteRequest;

// The kit's own sample values: MRSFT is a real ITGI Maruti code, and one curl
// sample sends the plain city name DELHI as regictrationCity.
const codes = { makeCode: "MRSFT", rtoCity: "DELHI", engineCC: 1197, seatingCapacity: 5 };

function head(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

function describeError(err: unknown): void {
  const e = err as { message?: string; statusCode?: number; details?: unknown; cause?: unknown };
  console.log(`  ✗ ${e.message ?? String(err)}`);
  if (e.statusCode) console.log(`    http status: ${e.statusCode}`);
  if (e.cause) console.log(`    cause: ${String((e.cause as Error)?.message ?? e.cause)}`);
  if (typeof e.details === "string" && e.details.trim()) {
    console.log(`    body: ${e.details.slice(0, 600)}`);
  }
}

/** IDV the vendor priced for this vehicle — fed into the premium call below. */
let quotedIdv = 0;

async function probeIdv(): Promise<void> {
  head("1. IDV service (no partner code in the request → pure reachability test)");
  const url = ITGI_ENDPOINTS.idv(cfg);
  console.log(`POST ${url}`);
  const xml = soapEnvelope(buildIdvPayload(req, codes), ITGI_NS.premium);
  console.log(`makeCode: PCP-${codes.makeCode}-2023   rtoCity: ${codes.rtoCity}`);
  try {
    const body = await transport.soap(url, xml, { requestId });
    console.log("  ✓ HTTP reachable, SOAP parsed");
    console.log(`  raw: ${JSON.stringify(body).slice(0, 400)}`);
    try {
      const idv = normalizeIdv(body);
      quotedIdv = idv.idv;
      console.log(`  ✓ IDV: ${JSON.stringify(idv)}`);
    } catch (e) {
      console.log(`  ! vendor returned a business error (transport is fine):`);
      describeError(e);
    }
  } catch (err) {
    describeError(err);
  }
}

async function probePremium(): Promise<void> {
  head("2. Premium service (authenticates on our partner code)");
  const url = ITGI_ENDPOINTS.premium(cfg);
  console.log(`POST ${url}`);
  console.log(`partnerCode: ${cfg.partnerCode ? cfg.partnerCode : "(blank — not configured)"}`);
  // ITGI rejects any IDV outside the band its own IDV service just quoted.
  const idvValue = quotedIdv || 400000;
  console.log(`idv: ${idvValue}`);
  const path = selectPolicyPath(req, new Date("2026-07-26"));
  const xml = soapEnvelope(
    buildPremiumPayload(
      { ...req, idvValue },
      codes,
      path,
      {
        partnerCode: cfg.partnerCode,
        partnerBranch: cfg.partnerBranch,
        partnerSubBranch: cfg.partnerSubBranch,
        responseUrl: cfg.responseUrl,
      },
      "1964",
    ),
    ITGI_NS.premium,
  );
  try {
    const body = await transport.soap(url, xml, { requestId });
    console.log("  ✓ HTTP reachable, SOAP parsed");
    console.log(`  raw: ${JSON.stringify(body).slice(0, 1500)}`);
  } catch (err) {
    describeError(err);
  }
}

async function probeCkyc(): Promise<void> {
  head("3. CKYC REST fetch (HTTP Basic with our partner credentials)");
  const url = ITGI_ENDPOINTS.kycFetch(cfg);
  console.log(`POST ${url}   user: ${cfg.downloadUser || "(blank)"}`);
  try {
    const body = await transport.json(
      url,
      {
        clientType: "IND",
        firstName: "Test",
        lastName: "User",
        dateofBirth: "01-01-1990",
        idType: "PAN",
        // Deliberately a syntactically valid but non-existent PAN.
        idNumber: "AAAPA0000A",
        mobileNumber: "9999999999",
      },
      { requestId, basicAuth: itgiBasicAuth(cfg) },
    );
    console.log("  ✓ HTTP reachable, JSON parsed");
    console.log(`  raw: ${JSON.stringify(body).slice(0, 800)}`);
  } catch (err) {
    describeError(err);
  }
}

async function probeMasterData(): Promise<void> {
  head("4. Master data service (the RTO master we are missing may live here)");
  const url = ITGI_ENDPOINTS.masterData(cfg);
  console.log(`POST ${url}`);
  // The kit documents no request shape for this service, so try the vendor's
  // usual partner envelope with a few plausible master names and report what
  // comes back. Read-only either way.
  const attempts: Array<Record<string, unknown>> = [
    { partnerDetail: { partnerCode: cfg.partnerCode }, masterType: "RTO", contractType: "PCP" },
    { partnerCode: cfg.partnerCode, masterName: "RTO", contractType: "PCP" },
    { partnerCode: cfg.partnerCode, dataType: "RTO" },
  ];
  for (const body of attempts) {
    console.log(`  → ${JSON.stringify(body)}`);
    try {
      const res = await transport.json(url, body, { requestId, basicAuth: itgiBasicAuth(cfg) });
      console.log(`    raw: ${JSON.stringify(res).slice(0, 600)}`);
    } catch (err) {
      describeError(err);
    }
  }
}

async function probePolicyDownload(): Promise<void> {
  head("5. Policy download (Basic-auth reachability — no real policy number)");
  const url = ITGI_ENDPOINTS.policyDownload(cfg);
  console.log(`POST ${url}`);
  try {
    const res = await transport.json(
      url,
      { contractType: "PCP", policyDownloadNo: "", partnerDetail: { partnerCode: cfg.partnerCode } },
      { requestId, basicAuth: itgiBasicAuth(cfg) },
    );
    console.log(`  raw: ${JSON.stringify(res).slice(0, 600)}`);
  } catch (err) {
    describeError(err);
  }
}

async function main(): Promise<void> {
  console.log("ITGI live UAT probe — READ-ONLY (no proposal, no payment)");
  console.log(`SOAP base: ${cfg.soapBaseUrl}`);
  console.log(`REST base: ${cfg.restBaseUrl}`);
  await probeIdv();
  await probePremium();
  await probeCkyc();
  await probeMasterData();
  await probePolicyDownload();
  head("Interpretation");
  console.log("  connect/timeout errors  → we are IP-blocked; ITGI must whitelist our IP");
  console.log("  401                     → REST credentials wrong or missing");
  console.log("  SOAP/business errors    → we ARE reachable; only payload/master data remain");
}

void main();

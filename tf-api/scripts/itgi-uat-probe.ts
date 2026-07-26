/**
 * Live UAT probe for IFFCO-Tokio (ITGI) — READ-ONLY.
 *
 *   npx tsx scripts/itgi-uat-probe.ts
 *
 * Answers the questions we cannot settle from the kit alone:
 *   1. Is ITGI's staging reachable from this host, or are we IP-blocked?
 *      (The IDV service carries NO partner code, so it isolates reachability
 *      from credentials.)
 *   2. Does the premium service accept our envelope, and what does it say about
 *      a missing/blank partner code?
 *   3. Does rtoCity accept a plain city name ("DELHI") — which would shrink the
 *      missing-RTO-master gap — or does it demand a proprietary token?
 *   4. Is the CKYC REST endpoint reachable without an auth header (i.e. is it
 *      really IP-whitelisted)?
 *
 * Deliberately NEVER calls PartnerProposalRequest or PaymentUpdateWS: those
 * create real records in ITGI's core. It also never sends another partner's
 * code — only our configured one (blank until ITGI issues it).
 */
import { FetchItgiTransport, soapEnvelope, ITGI_NS } from "../src/providers/itgi/http.ts";
import { buildIdvPayload, buildPremiumPayload } from "../src/providers/itgi/mapper.ts";
import { selectPolicyPath } from "../src/providers/itgi/policy-types/index.ts";
import { normalizeIdv } from "../src/providers/itgi/normalizer.ts";
import { ITGI_ENDPOINTS, itgiConfig } from "../src/providers/itgi/config.ts";
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
    console.log(`    body: ${e.details.slice(0, 400)}`);
  }
}

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
      console.log(`  ✓ IDV: ${JSON.stringify(normalizeIdv(body))}`);
    } catch (e) {
      console.log(`  ! vendor returned a business error (transport is fine):`);
      describeError(e);
    }
  } catch (err) {
    describeError(err);
  }
}

async function probePremium(): Promise<void> {
  head("2. Premium service (needs our partner code — blank until ITGI issues it)");
  const url = ITGI_ENDPOINTS.premium(cfg);
  console.log(`POST ${url}`);
  console.log(`partnerCode: ${cfg.partnerCode ? cfg.partnerCode : "(blank — not yet issued)"}`);
  const path = selectPolicyPath(req, new Date("2026-07-26"));
  const xml = soapEnvelope(
    buildPremiumPayload({ ...req, idvValue: 400000 }, codes, path, {
      partnerCode: cfg.partnerCode,
      partnerBranch: cfg.partnerBranch,
      partnerSubBranch: cfg.partnerSubBranch,
      responseUrl: cfg.responseUrl,
    }),
    ITGI_NS.premium,
  );
  try {
    const body = await transport.soap(url, xml, { requestId });
    console.log("  ✓ HTTP reachable, SOAP parsed");
    console.log(`  raw: ${JSON.stringify(body).slice(0, 700)}`);
  } catch (err) {
    describeError(err);
  }
}

async function probeCkyc(): Promise<void> {
  head("3. CKYC REST fetch (no auth header → is it really IP-whitelisted?)");
  const url = ITGI_ENDPOINTS.kycFetch(cfg);
  console.log(`POST ${url}`);
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
      { requestId },
    );
    console.log("  ✓ HTTP reachable, JSON parsed");
    console.log(`  raw: ${JSON.stringify(body).slice(0, 500)}`);
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
  head("Interpretation");
  console.log("  connect/timeout errors  → we are IP-blocked; ITGI must whitelist our IP");
  console.log("  SOAP/business errors    → we ARE reachable; only credentials/master data remain");
}

void main();

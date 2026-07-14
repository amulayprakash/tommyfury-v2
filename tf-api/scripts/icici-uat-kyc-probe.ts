/**
 * ICICI UAT KYC → proposal probe — tests whether a given identity clears ICICI's UAT
 * KYC gate and unblocks proposal issuance (the `443 KYC PENDING` blocker; see
 * docs/icici-uat-scenarios.md and docs/full-flow-test-cases.md §D).
 *
 * Background: ICICI's UAT CKYC lookup behaves like a real CKYC-registry search —
 * synthetic PANs (ABCPK1234F, DHQPG4064J) and ICICI's own doc-sample Aadhaar all come
 * back "no record / retry with alternate KYC". A real person's PAN that has an actual
 * CKYC record (anyone who has completed bank/insurer KYC) is expected to resolve.
 * UAT only — every proposal here is isProposalOnly + amountCollected:0, so no policy
 * is bound and no payment happens even on full success.
 *
 * ⚠️ PII: use your OWN PAN/Aadhaar or a consenting teammate's — a successful lookup
 * returns that person's real name and address from the registry and stores them
 * against the UAT proposal. Identity values are masked in all output; nothing is
 * written to disk by this script.
 *
 *   # real-PAN CKYC (the main experiment)
 *   npx tsx --env-file=.env scripts/icici-uat-kyc-probe.ts --pan=AAAAA9999A --dob=1990-05-15
 *
 *   # Aadhaar CKYC fallback
 *   npx tsx --env-file=.env scripts/icici-uat-kyc-probe.ts --aadhaar=999999999999 --name="Full Name" --gender=M --dob=1990-05-15
 *
 *   # CKYC-number direct
 *   npx tsx --env-file=.env scripts/icici-uat-kyc-probe.ts --ckyc=30001234567890 --dob=1990-05-15
 *
 *   # OVD document upload — needs NO real identity: sends a dummy 1×1 JPEG (or real
 *   # scans via --id-file/--addr-file) and then checks whether the proposal gate opens.
 *   npx tsx --env-file=.env scripts/icici-uat-kyc-probe.ts --ovd --dob=1990-05-15 --name="Test Person"
 *
 * Options: --line=fw|tw (default fw)   --kyc-only (skip proposal + status)
 *          --force-proposal (attempt proposal even after a failed KYC — reconfirms 443)
 *          --mobile= --email= (proposal contact details; defaults are test values)
 *          --id-file= --addr-file= (OVD mode: real document scans instead of the dummy)
 *
 * Resuming a transaction (e.g. after uploading documents on ICICI's hosted OVDLink
 * page that a failed CKYC prints): reuse the SAME TransactionId and tag, skip KYC,
 * and go straight to proposal + status:
 *   npx tsx --env-file=.env scripts/icici-uat-kyc-probe.ts --transaction-id=epn_xxx --tag=1234 --skip-kyc --dob=1990-05-15 --pan=AAAAA9999A
 */
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { IciciProvider, passthroughCodeResolver } from "@/providers/icici/icici.provider.ts";
import { loadIciciConfig } from "@/providers/icici/config.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CkycRequest, OvdFile, KycResult } from "@/contracts/kyc.ts";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const has = (k: string) => process.argv.includes(`--${k}`);

const PAN = arg("pan")?.toUpperCase();
const AADHAAR = arg("aadhaar");
const CKYC_NO = arg("ckyc");
const OVD = has("ovd");
const DOB = arg("dob");
const NAME = arg("name");
const GENDER = (arg("gender") ?? "M") as "M" | "F" | "O";
const LINE = (arg("line") ?? "fw") as "fw" | "tw";
const KYC_ONLY = has("kyc-only");
const SKIP_KYC = has("skip-kyc");
const FORCE_PROPOSAL = has("force-proposal");
const REUSE_TXN = arg("transaction-id");
const MOBILE = arg("mobile") ?? "9876543210";
const EMAIL = arg("email") ?? "kyc.probe@example.com";

// PANs already proven to have no CKYC record on ICICI UAT (docs/icici-uat-scenarios.md).
const KNOWN_SYNTHETIC_PANS = new Set(["ABCPK1234F", "DHQPG4064J"]);

const mask = (v: string, keepStart = 2, keepEnd = 2) =>
  v.length <= keepStart + keepEnd
    ? "•".repeat(v.length)
    : v.slice(0, keepStart) + "•".repeat(v.length - keepStart - keepEnd) + v.slice(-keepEnd);

function usageExit(msg: string): never {
  console.error(`✖ ${msg}\n`);
  console.error("Identity (one of):  --pan=AAAAA9999A | --aadhaar=999999999999 --name=... --gender=M|F | --ckyc=<number> | --ovd");
  console.error("Always required:    --dob=YYYY-MM-DD");
  console.error("Options:            --line=fw|tw --kyc-only --force-proposal --name= --mobile= --email= --id-file= --addr-file=");
  process.exit(1);
}

if (!DOB || !/^\d{4}-\d{2}-\d{2}$/.test(DOB)) usageExit("--dob=YYYY-MM-DD is required");
const modes = [PAN, AADHAAR, CKYC_NO, OVD ? "ovd" : undefined].filter(Boolean).length;
// --skip-kyc needs no KYC identity (at most a --pan to stamp on the proposer).
if (SKIP_KYC ? modes > 1 || OVD : modes !== 1)
  usageExit("Provide exactly one of --pan / --aadhaar / --ckyc / --ovd (or --skip-kyc)");
if (PAN && !/^[A-Z]{5}\d{4}[A-Z]$/.test(PAN)) usageExit(`--pan=${mask(PAN)} is not a valid PAN format (AAAAA9999A)`);
if (AADHAAR && (!/^\d{12}$/.test(AADHAAR) || !NAME)) usageExit("--aadhaar needs 12 digits plus --name= and --gender=");

// ─── Confirmed-live UAT vehicles (see scripts/icici-uat-scenarios.ts roster notes) ──
const VEHICLES = {
  fw: {
    makeCode: 13, makeName: "AUDI", modelCode: 12197, modelName: "A6 2.8 FSI",
    rtoCode: 2125, rtoCity: "Dharampur", state: "Gujarat", pincode: "396050",
    vehicleType: "fourWheeler" as const,
  },
  tw: {
    makeCode: 31, makeName: "BAJAJ", modelCode: 12637, modelName: "PULSAR 150",
    rtoCode: 2029, rtoCity: "Thane", state: "Maharashtra", pincode: "400601",
    vehicleType: "twoWheeler" as const,
  },
};

const isoOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Fresh suffix per run so repeat probes never reuse a reg/engine/chassis number.
 *  Pass --tag= to reproduce a previous run's identifiers when resuming its transaction. */
const RUN_TAG = arg("tag") ?? String(Math.floor(1000 + Math.random() * 9000));

function buildQuoteRequest(): MotorQuoteRequest {
  const v = VEHICLES[LINE];
  return {
    vehicleType: v.vehicleType,
    selectedPolicy: "comprehensive",
    businessType: "rollover",
    makeId: String(v.makeCode), makeName: v.makeName,
    modelId: String(v.modelCode), modelName: v.modelName,
    fuelType: "petrol",
    rtoCode: String(v.rtoCode),
    registrationNumber: `MH12KP${RUN_TAG}`,
    registrationDate: "2021-06-01",
    pincode: v.pincode,
    previousPolicyNumber: `OLD-KP-${RUN_TAG}`,
    previousInsurerId: "GODI", // Go Digit — ICICI short code, passed through verbatim
    previousPolicyExpiryDate: isoOffset(20), // active previous policy ⇒ no break-in
    isPreviousPolicyExpired: false,
    claimInPreviousPolicy: false,
    ncbPercent: 20,
    zeroDep: false, engineProtect: false, rsa: false, tyreProtect: false, rimProtect: false,
    rti: false, consumables: false, paOwner: true, paUnnamedPassenger: false,
    legalLiabilityPaidDriver: false, keyProtect: false, garageCash: false,
    lossOfBelongings: false, batteryProtect: false, drivingAccessories: false, ncbProtection: false,
  };
}

function buildProposalRequest(transactionId: string, kyc: KycResult | undefined): MotorFullQuoteRequest {
  const v = VEHICLES[LINE];
  // Prefer the registry-returned name so the proposal matches the KYC identity.
  const fullName = kyc?.name?.trim() || NAME || "Ravi Kumar";
  const parts = fullName.split(/\s+/);
  const firstName = parts[0] ?? "Ravi";
  const lastName = parts.slice(1).join(" ") || firstName;
  return {
    ...buildQuoteRequest(),
    quoteId: transactionId,
    isProposalOnly: true,
    amountCollected: 0,
    isVehicleUnderLoan: false,
    proposer: {
      firstName, lastName,
      email: EMAIL, mobile: MOBILE, dob: DOB!, gender: GENDER,
      ...(PAN ? { panNumber: PAN } : {}),
    },
    address: { addressLine1: "12 MG Road", city: v.rtoCity, state: v.state, pincode: v.pincode },
    vehicle: {
      engineNumber: `ENGKP${RUN_TAG}ICICIUAT`,
      chassisNumber: `CHSKP${RUN_TAG}ICICIUATVIN00`,
      financeType: "none",
    },
    nomineeName: "Sita Kumar", nomineeRelation: "spouse", nomineeAge: 30,
  };
}

// ─── OVD dummy document (1×1 white JPEG) ─────────────────────────────────────────
const DUMMY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
  "base64",
);

function ovdFile(fieldName: OvdFile["fieldName"], filePath: string | undefined, fallbackName: string): OvdFile {
  if (filePath) {
    const ext = extname(filePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".pdf" ? "application/pdf" : "image/jpeg";
    return { fieldName, originalName: basename(filePath), mimeType: mime, buffer: readFileSync(filePath) };
  }
  return { fieldName, originalName: fallbackName, mimeType: "image/jpeg", buffer: DUMMY_JPEG };
}

// ─── Error helpers (same transient-retry pattern as icici-uat-scenarios.ts) ───────
function errDetail(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const details = (e as { details?: unknown } | undefined)?.details;
  if (details === undefined) return msg;
  const body = typeof details === "string" ? details : JSON.stringify(details);
  return `${msg} :: ${body.slice(0, 400)}`;
}
const errCode = (e: unknown) => (e as { code?: string } | undefined)?.code;

function isTransient(e: unknown): boolean {
  return /\b50[234]\b|<html|ECONNRESET|ETIMEDOUT|fetch failed/i.test(errDetail(e));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e) || i >= attempts) throw e;
      console.log(`   (transient gateway error, retry ${i}/${attempts - 1})`);
      await sleep(2500);
    }
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────────
async function main() {
  const identityLabel = PAN
    ? `PAN ${mask(PAN)}`
    : AADHAAR
      ? `Aadhaar ${mask(AADHAAR, 0, 4)}`
      : CKYC_NO
        ? `CKYC no. ${mask(CKYC_NO, 0, 4)}`
        : "OVD document upload (no registry identity)";
  console.log(`ICICI UAT KYC probe — line=${LINE} identity=${identityLabel} dob=${DOB}\n`);
  if (PAN && KNOWN_SYNTHETIC_PANS.has(PAN)) {
    console.log("⚠ This PAN is a known synthetic test value with NO CKYC record — this run only");
    console.log("  validates plumbing; expect KYC to fail. Rerun with a real PAN for the experiment.\n");
  }

  const provider = new IciciProvider({ config: loadIciciConfig(), codeResolver: passthroughCodeResolver });
  const rid = (step: string) => ({ requestId: `icici-kyc-probe-${LINE}-${RUN_TAG}-${step}` });

  // [1/4] Quote — mints the TransactionId that KYC + proposal bind to.
  const v = VEHICLES[LINE];
  let transactionId: string;
  if (REUSE_TXN) {
    transactionId = REUSE_TXN;
    console.log(`[1/4] SaveQuote — skipped, reusing TransactionId=${transactionId} (tag=${RUN_TAG})\n`);
  } else {
    console.log(`[1/4] SaveQuote — ${v.makeName} ${v.modelName} @ RTO ${v.rtoCode} (${v.rtoCity})`);
    const quote = await withRetry(() => provider.getQuote(buildQuoteRequest(), rid("quote")));
    if (!quote.transactionId) throw new Error("ICICI returned no TransactionId — cannot continue");
    transactionId = quote.transactionId;
    console.log(`   OK  TransactionId=${transactionId} gross=₹${quote.grossPremium} inspectionRequired=${quote.isInspectionRequired ?? false}\n`);
  }

  // [2/4] KYC — CKYC (PAN / Aadhaar / CKYC number) or OVD upload.
  let kyc: KycResult | undefined;
  let kycError: string | undefined;
  if (SKIP_KYC) {
    console.log("[2/4] KYC — skipped (--skip-kyc; assuming it was completed out-of-band, e.g. on the hosted OVD page)\n");
  } else if (OVD) {
    console.log(`[2/4] OVD initiate — ProofOfIdentity=PAN ProofOfAddress=AADHAAR${arg("id-file") ? " (real files)" : " (dummy 1×1 JPEG)"}`);
    try {
      const ovd = await withRetry(() =>
        provider.initiateOvd(
          { transactionId, proofOfIdentityType: "PAN", proofOfAddressType: "AADHAAR", policyType: "motor" },
          [ovdFile("proofOfIdentity", arg("id-file"), "pan-card.jpg"), ovdFile("proofOfAddress", arg("addr-file"), "aadhaar-card.jpg")],
          rid("ovd"),
        ),
      );
      kyc = { isKycSuccess: ovd.isKycSuccess, kycId: ovd.kycId, name: ovd.customerName };
      console.log(`   OK  kycId=${ovd.kycId ?? "—"} isKycSuccess=${ovd.isKycSuccess} customerName=${ovd.customerName ?? "—"}\n`);
    } catch (e) {
      kycError = errDetail(e);
      console.log(`   FAIL [${errCode(e) ?? "?"}] ${kycError}\n`);
    }
  } else {
    const req: CkycRequest = {
      transactionId,
      dob: DOB!,
      policyType: "motor",
      ...(PAN ? { panNumber: PAN } : {}),
      ...(CKYC_NO ? { ckycNumber: CKYC_NO } : {}),
      ...(AADHAAR ? { aadhaarNumber: AADHAAR, nameAsPerAadhaar: NAME!, gender: GENDER } : {}),
    };
    console.log(`[2/4] CKYC lookup — ${identityLabel}`);
    try {
      kyc = await withRetry(() => provider.completeCkyc(req, rid("ckyc")));
      console.log(`   OK  isKycSuccess=${kyc.isKycSuccess} kycId=${kyc.kycId ?? "—"}`);
      console.log(`       registry name=${kyc.name ?? "—"} dob=${kyc.dob ?? "—"} gender=${kyc.gender ?? "—"}`);
      console.log(`       address returned: ${kyc.permanentAddress ? "yes" : "no"}  message: ${kyc.displayMessage ?? "—"}\n`);
    } catch (e) {
      kycError = errDetail(e);
      console.log(`   FAIL [${errCode(e) ?? "?"}] ${kycError}`);
      if (errCode(e) === "KYC_INCOMPLETE") {
        console.log("       → No CKYC record found for this identity (same failure as the synthetic PANs).");
        console.log("       → If this was a REAL PAN: double-check DOB matches the PAN record exactly,");
        console.log("         else try --aadhaar or --ovd, or ask ICICI's RM for a UAT-seeded identity.");
        // ICICI's failure body carries a hosted per-transaction OVD upload page — a
        // zero-code manual fallback (open in a browser, upload a real document scan).
        const body = (e as { details?: unknown }).details;
        const ovdLink = body && typeof body === "object" ? (body as Record<string, unknown>).OVDLink : undefined;
        if (typeof ovdLink === "string" && ovdLink) {
          console.log(`       → ICICI hosted OVD upload page for this TransactionId:\n         ${ovdLink}`);
        }
      }
      console.log("");
    }
  }

  // [3/4] Proposal — the actual gate: does it still return 443 KYC PENDING?
  let policyNumber: string | undefined;
  let proposalError: string | undefined;
  if (KYC_ONLY) {
    console.log("[3/4] Proposal — skipped (--kyc-only). To resume this transaction later:");
    console.log(`      --transaction-id=${transactionId} --tag=${RUN_TAG} --skip-kyc --dob=${DOB}\n`);
  } else if (kycError && !FORCE_PROPOSAL) {
    console.log("[3/4] Proposal — skipped (KYC failed; pass --force-proposal to fire it anyway)\n");
  } else {
    console.log(`[3/4] Proposal (isProposalOnly, ₹0 collected)`);
    try {
      const full = await provider.getFullQuote(buildProposalRequest(transactionId, kyc), rid("proposal"));
      policyNumber = full.policyNumber;
      const details = full.contractDetails ?? {};
      console.log(`   OK  PolicyNo=${full.policyNumber ?? "—"} status=${details.status ?? "—"} policyRefId=${details.policyReferenceId ?? "—"}`);
      console.log(`       paymentUrl=${full.paymentUrl ?? "—"}\n`);
    } catch (e) {
      proposalError = errDetail(e);
      console.log(`   FAIL ${proposalError}\n`);
    }
  }

  // [4/4] Policy status — reports ICICI's own view of KYC for this TransactionId.
  console.log("[4/4] Policy status");
  try {
    const st = await withRetry(() => provider.getPolicyStatus({ transactionId }, rid("status")));
    console.log(`   status=${st.status} isKycSuccess=${st.isKycSuccess ?? "—"} policyNo=${st.policyNumber ?? "—"} inspectionId=${st.inspectionId ?? "—"}\n`);
  } catch (e) {
    console.log(`   (status unavailable: ${errDetail(e).slice(0, 160)})\n`);
  }

  // ─── Verdict ───────────────────────────────────────────────────────────────────
  console.log("═══ VERDICT ═══");
  if (!kycError && policyNumber) {
    console.log(`✔ END-TO-END UNBLOCKED — KYC cleared and ICICI issued UAT PolicyNo ${policyNumber}.`);
  } else if (!kycError && !KYC_ONLY && proposalError) {
    console.log(`△ ${SKIP_KYC ? "KYC was skipped" : "KYC call succeeded"} but the proposal failed — see the error above.`);
    console.log("  If it is still 443 KYC PENDING, ICICI has not registered any KYC against this TransactionId.");
  } else if (!kycError) {
    console.log("✔ KYC call succeeded (proposal not attempted).");
  } else {
    console.log("✖ KYC failed — proposal gate remains closed for this identity.");
  }
  process.exit(kycError ? 2 : proposalError ? 3 : 0);
}

main().catch((e) => {
  console.error(`\nFATAL: ${errDetail(e)}`);
  process.exit(1);
});

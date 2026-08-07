/**
 * Read-only HDFC UAT probe: authenticate → GetCalculateIDV → CalculatePremium
 * for a vehicle from the kit's UAT test sheet. Creates nothing and binds
 * nothing, so it is safe to run repeatedly.
 *
 *   npm run hdfc:probe
 *
 * Follows the ITGI precedent (scripts/itgi-uat-probe.ts).
 */
import { loadHdfcConfig } from "@/providers/hdfc/config.ts";
import { HdfcProvider } from "@/providers/hdfc/hdfc.provider.ts";
import { passthroughCodeResolver } from "@/providers/hdfc/db-code-resolver.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";

// From PVTcarTestScenarios.xls — "UAT Test Model" and "RTO" sheets.
// TATA NEXON EV (42774) at MH-1 Mumbai (10406). passthroughCodeResolver sends
// these straight through as HDFC codes, so the probe exercises the vendor even
// before the master cross-walk has run.
//
// The registration date is deliberately about a year before the policy start.
// HDFC's UAT rules engine prices these models only for young vehicles: at
// roughly two years and older it throws an opaque "Exception while Call Blaze!"
// with a truncated stack trace and no stated reason. Calendar year is NOT the
// constraint — the same vehicle prices fine with a policy starting today. Codes
// verified priceable on UAT: 42774, 12763, 12798, 28735, 32415, 27224.
// Whether that age ceiling is a UAT data gap or a real underwriting rule is an
// open confirmation — see docs/hdfc-integration-notes.md.
const req = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  makeId: "TATA",
  makeName: "TATA MOTORS LTD",
  modelId: "42774",
  modelName: "NEXON EV",
  fuelType: "electric",
  rtoCode: "10406",
  registrationDate: "2025-07-01",
  registrationNumber: "MH01QQ7878",
  previousPolicyExpiryDate: "2026-08-31",
  isPreviousPolicyExpired: false,
  claimInPreviousPolicy: false,
  ncbPercent: 20,
  zeroDep: true,
  engineProtect: false,
  rsa: false,
  tyreProtect: false,
  rimProtect: false,
  rti: false,
  consumables: false,
  paOwner: true,
  paUnnamedPassenger: false,
  legalLiabilityPaidDriver: false,
  keyProtect: false,
  garageCash: false,
  lossOfBelongings: false,
  batteryProtect: true,
  drivingAccessories: false,
  ncbProtection: false,
} as MotorQuoteRequest;

async function main(): Promise<void> {
  const provider = new HdfcProvider({
    config: loadHdfcConfig(),
    codeResolver: passthroughCodeResolver,
  });

  console.log("Probing HDFC UAT (authenticate → IDV → premium)…");
  const quote = await provider.getQuote(req, { requestId: "hdfc-probe" });

  console.log("\nQuote:");
  console.log(`  IDV            ${quote.idvValue} (band ${quote.minIdv}–${quote.maxIdv})`);
  console.log(`  OD premium     ${quote.basicOdPremium}`);
  console.log(`  TP premium     ${quote.thirdPartyPremium}`);
  console.log(`  Net premium    ${quote.netPremium}`);
  console.log(`  GST            ${quote.serviceTaxAmount}`);
  console.log(`  Gross premium  ${quote.grossPremium}`);
  console.log("\nAll amounts are whole rupees.");
}

main().catch((err) => {
  console.error("\nProbe failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

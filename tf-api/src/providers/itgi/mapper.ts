import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";
import type { ItgiCodes } from "./db-code-resolver.ts";
import type { ItgiPolicyPath } from "./policy-types/index.ts";
import { ITGI_COVERAGE, itgiCoverageName, ITGI_ALLOWED } from "./config.ts";
import { toItgiDate, toItgiDateTime, itgiContractType, tag, xmlEscape } from "./format.ts";

export interface ItgiPartnerDetails {
  partnerCode: string;
  partnerBranch: string;
  partnerSubBranch: string;
  responseUrl: string;
}

/** True when the customer elected any cover that ITGI bundles into the
 *  `autocoverage=true` premium block. Drives which block the normalizer reads. */
export function hasElectedAddons(req: MotorQuoteRequest): boolean {
  return Boolean(
    req.zeroDep || req.engineProtect || req.tyreProtect || req.rimProtect || req.consumables || req.rsa,
  );
}

/** IDV request body (namespace prefix `prem:`). */
export function buildIdvPayload(req: MotorQuoteRequest, codes: ItgiCodes): string {
  const contractType = itgiContractType(req.vehicleType);
  const year = new Date(req.registrationDate).getFullYear();
  const inception = req.policyStartDate ?? new Date().toISOString().slice(0, 10);
  return (
    `<prem:getVehicleIdv><prem:idvWebServiceRequest>` +
    `<prem:dateOfRegistration>${toItgiDate(req.registrationDate)}</prem:dateOfRegistration>` +
    `<prem:inceptionDate>${toItgiDateTime(inception)}</prem:inceptionDate>` +
    // Composite key the vendor expects: {contractType}-{MAKE}-{yearOfManufacture}
    `<prem:makeCode>${xmlEscape(`${contractType}-${codes.makeCode}-${year}`)}</prem:makeCode>` +
    `<prem:rtoCity>${xmlEscape(codes.rtoCity)}</prem:rtoCity>` +
    `</prem:idvWebServiceRequest></prem:getVehicleIdv>`
  );
}

export interface CoverageItem {
  coverageId: string;
  sumInsured: string | number;
  number?: string | number;
}

/** Builds the coverage list — only covers the customer actually opted for. */
export function buildCoverageItems(req: MotorQuoteRequest, path: ItgiPolicyPath): CoverageItem[] {
  const items: CoverageItem[] = [];

  items.push({
    coverageId: ITGI_COVERAGE.IDV_BASIC,
    sumInsured: path.idvSumInsuredOverride ?? req.idvValue ?? 0,
  });

  // Act-only policies accept only a restricted cover set.
  if (path.zcover === "AC") {
    if (req.paOwner) items.push({ coverageId: ITGI_COVERAGE.PA_OWNER_DRIVER, sumInsured: "Y" });
    items.push({ coverageId: ITGI_COVERAGE.LL_DRIVER, sumInsured: "Y" });
    if (req.paUnnamedPassenger && req.unnamedPaSumInsured) {
      items.push({
        coverageId: ITGI_COVERAGE.PA_TO_PASSENGER,
        sumInsured: req.unnamedPaSumInsured,
      });
    }
    return items;
  }

  if (req.ncbPercent && ITGI_ALLOWED.ncbPercent.includes(req.ncbPercent)) {
    items.push({ coverageId: ITGI_COVERAGE.NCB, sumInsured: req.ncbPercent });
  }
  if (req.paOwner) items.push({ coverageId: ITGI_COVERAGE.PA_OWNER_DRIVER, sumInsured: "Y" });
  if (req.paUnnamedPassenger && req.unnamedPaSumInsured) {
    items.push({ coverageId: ITGI_COVERAGE.PA_TO_PASSENGER, sumInsured: req.unnamedPaSumInsured });
  }
  if (req.legalLiabilityPaidDriver && req.numberOfDrivers) {
    items.push({
      coverageId: ITGI_COVERAGE.LL_EMPLOYEE,
      sumInsured: "Y",
      number: req.numberOfDrivers,
    });
  }
  if (req.electricalAccessoriesSI) {
    items.push({
      coverageId: ITGI_COVERAGE.ELECTRICAL_ACCESSORIES,
      sumInsured: req.electricalAccessoriesSI,
    });
  }
  if (req.nonElectricalAccessoriesSI) {
    items.push({
      coverageId: ITGI_COVERAGE.COST_OF_ACCESSORIES,
      sumInsured: req.nonElectricalAccessoriesSI,
    });
  }
  if (req.bifuelKitSI) items.push({ coverageId: ITGI_COVERAGE.CNG_KIT, sumInsured: req.bifuelKitSI });
  if (req.hasAntiTheftDevice) items.push({ coverageId: ITGI_COVERAGE.ANTI_THEFT, sumInsured: "Y" });
  if (req.voluntaryDeductible) {
    items.push({ coverageId: ITGI_COVERAGE.VOLUNTARY_EXCESS, sumInsured: req.voluntaryDeductible });
  }

  // Opt-in add-ons: the vendor takes a literal "Y" as the sum insured.
  for (const key of ["zeroDep", "engineProtect", "tyreProtect", "rimProtect", "consumables", "rsa"] as const) {
    if (!req[key]) continue;
    const name = itgiCoverageName(key);
    if (name) items.push({ coverageId: name, sumInsured: "Y" });
  }
  if (req.odometerReading) {
    items.push({
      coverageId: ITGI_COVERAGE.PAY_AS_YOU_DRIVE,
      sumInsured: "B01",
      number: req.odometerReading,
    });
  }

  return items;
}

function renderCoverage(items: CoverageItem[]): string {
  return items
    .map(
      (i) =>
        `<item>${tag("coverageId", i.coverageId)}${tag("number", i.number)}${tag("sumInsured", i.sumInsured)}</item>`,
    )
    .join("");
}

/**
 * Premium request body.
 *
 * NOTE: `engineCpacity` and `regictrationCity` are the vendor's own
 * misspellings. They must be sent exactly as written — "correcting" them makes
 * ITGI reject the request.
 */
export function buildPremiumPayload(
  req: MotorQuoteRequest,
  codes: ItgiCodes,
  path: ItgiPolicyPath,
  partner: ItgiPartnerDetails,
): string {
  const contractType = itgiContractType(req.vehicleType);
  const inception = req.policyStartDate ?? new Date().toISOString().slice(0, 10);
  const expiry = req.policyEndDate ?? inception;
  const year = new Date(req.registrationDate).getFullYear();

  const vehicle =
    `<vehicle>` +
    tag("capacity", codes.seatingCapacity ?? req.seatingCapacity) +
    tag("engineCpacity", codes.engineCC ?? req.engineCC) +
    tag("grossVehicleWt", 0) +
    tag("make", codes.makeCode) +
    tag("regictrationCity", codes.rtoCity) +
    tag("registrationDate", toItgiDate(req.registrationDate)) +
    tag("seatingCapacity", codes.seatingCapacity ?? req.seatingCapacity) +
    tag("newVehicleFlag", path.newVehicleFlag) +
    // Single-year OD renewals are signalled by <type>OD</type> under <vehicle>.
    tag("type", path.policyType === "OD" ? "OD" : undefined) +
    tag("vehicleClass", contractType) +
    tag("vehicleSubclass", contractType) +
    `<vehicleCoverage>${renderCoverage(buildCoverageItems(req, path))}</vehicleCoverage>` +
    tag("yearOfManufacture", year) +
    tag("zcover", path.zcover) +
    `</vehicle>`;

  return (
    `<getMotorPremium>` +
    `<policy>` +
    tag("contractType", contractType) +
    tag("expiryDate", toItgiDateTime(expiry, "23:59:59")) +
    tag("inceptionDate", toItgiDateTime(inception)) +
    tag(
      "previousPolicyEndDate",
      req.previousPolicyExpiryDate ? toItgiDateTime(req.previousPolicyExpiryDate) : undefined,
    ) +
    vehicle +
    `</policy>` +
    `<partner>` +
    tag("partnerBranch", partner.partnerBranch) +
    tag("partnerCode", partner.partnerCode) +
    tag("partnerSubBranch", partner.partnerSubBranch) +
    `</partner>` +
    `</getMotorPremium>`
  );
}

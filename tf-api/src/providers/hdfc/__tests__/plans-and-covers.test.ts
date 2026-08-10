import { describe, it, expect } from "vitest";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import { toHdfcRequest, resolveBusinessType, resolvePlan } from "../mapper/canonical.ts";
import { reqPvtCarFor, reqPvtCarNew, reqPvtCarRollover, reqPvtCarUsed } from "../mapper/req-pvtcar.ts";
import { policyDetailsFor } from "../mapper/policy-details.ts";
import { buildCustomerDetails } from "../mapper/customer.ts";
import { normalizeQuote } from "../normalizer.ts";
import { HDFC_PLANS, hdfcPlanFor, HDFC_EMI_INSTALMENTS, HDFC_EMI_PLAN_TYPE } from "../config.ts";
import type { HdfcResolvedCodes } from "../types.ts";

const codes: HdfcResolvedCodes = { modelCode: "12798", rtoCode: "10406" };

function baseRequest(overrides: Partial<MotorQuoteRequest> = {}): MotorQuoteRequest {
  return {
    vehicleType: "fourWheeler",
    selectedPolicy: "comprehensive",
    businessType: "rollover",
    makeId: "MAR",
    makeName: "MARUTI",
    modelId: "12798",
    modelName: "SWIFT",
    fuelType: "petrol",
    rtoCode: "10406",
    registrationDate: "2025-08-01",
    registrationNumber: "MH01QQ7878",
    policyStartDate: "2026-08-10",
    isPreviousPolicyExpired: true,
    claimInPreviousPolicy: false,
    ncbPercent: 20,
    zeroDep: false,
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
    batteryProtect: false,
    drivingAccessories: false,
    ncbProtection: false,
    ...overrides,
  } as MotorQuoteRequest;
}

const req = (o: Partial<MotorQuoteRequest> = {}) => toHdfcRequest(baseRequest(o), codes, "T1");
const pvtCar = (o: Partial<MotorQuoteRequest> = {}) => reqPvtCarFor(req(o));

// ═══════════════════════════════════════════════════════════════════════════════
// Plan types
// ═══════════════════════════════════════════════════════════════════════════════
describe("HDFC plan types", () => {
  /**
   * The master workbook's "PlanTypes" sheet and the live GetCalculateIDV
   * response's addonPlansToCoversMapping list the SAME plans with the SAME
   * mandatory covers. This locks the catalogue to that agreed reading.
   */
  it("matches the master workbook's PlanTypes sheet cover-for-cover", () => {
    const covers = (key: string) => HDFC_PLANS[key]?.covers;
    expect(covers("silver")).toEqual(["zeroDep"]);
    expect(covers("platinum")).toEqual(["zeroDep", "ncbProtection", "engineProtect"]);
    expect(covers("titanium")).toEqual([
      "zeroDep",
      "ncbProtection",
      "engineProtect",
      "consumables",
    ]);
    expect(covers("diamond")).toEqual(["zeroDep", "consumables"]);
    expect(covers("essentialzd")).toEqual(["zeroDep", "rsa", "rsaWorldwide", "lossOfBelongings"]);
    expect(covers("essentialegp")).toEqual([
      "zeroDep",
      "engineProtect",
      "rsa",
      "rsaWorldwide",
      "lossOfBelongings",
    ]);
  });

  /**
   * "Gold Plan" is in the live addonPlansToCoversMapping but NOT in HDFC's own
   * PlanTypes sheet, is isEligibile:false on every vehicle probed on UAT, and one
   * of its two cover groups (N161521G0020) decodes to no cover any source names.
   * An unnameable cover must not end up on a customer's policy.
   */
  it("does not offer Gold, whose second cover group cannot be decoded", () => {
    expect(hdfcPlanFor("Gold Plan")).toBeUndefined();
    expect(hdfcPlanFor("Gold")).toBeUndefined();
  });

  // HDFC spells one plan three ways across its own artefacts: "Platinum Plan"
  // (live mapping), "Platinum plan" (master workbook), "Platinum" (scenario sheet).
  it("resolves a plan whatever case, spacing or 'Plan' suffix HDFC used", () => {
    for (const spelling of ["Platinum Plan", "Platinum plan", "PLATINUM", "platinum"]) {
      expect(hdfcPlanFor(spelling)?.planType).toBe("Platinum Plan");
    }
    expect(hdfcPlanFor("Essential ZD Plan")?.planType).toBe("Essential ZD Plan");
    expect(hdfcPlanFor("Menu Card Approach")?.planType).toBe("Menu Card Approach");
  });

  // The passthrough's own contract: a vendor that does not recognise a code
  // ignores it, rather than failing the quote.
  it("ignores an unrecognised providerAddonCode", () => {
    expect(resolvePlan(baseRequest({ providerAddonCodes: ["STZDP", "NONSENSE"] })).planType)
      .toBeUndefined();
  });

  it("turns on every cover the chosen plan makes mandatory", () => {
    const out = pvtCar({ providerAddonCodes: ["Titanium Plan"] });
    expect(out.IsZeroDept_Cover).toBe(1);
    expect(out.IsNCBProtection_Cover).toBe(1);
    expect(out.IsEngGearBox_Cover).toBe(1);
    expect(out.IsCOC_Cover).toBe(1);
    // Not in the Titanium bundle and not asked for.
    expect(out.IsTyreSecure_Cover).toBe(0);
    expect(out.IsRTI_Cover).toBe(0);
  });

  // A plan is additive merchandising, not a replacement for the customer's own
  // choices: it may only ADD covers.
  it("keeps covers the caller chose that the plan does not include", () => {
    const out = pvtCar({ providerAddonCodes: ["Silver Plan"], tyreProtect: true });
    expect(out.IsZeroDept_Cover).toBe(1); // from the plan
    expect(out.IsTyreSecure_Cover).toBe(1); // from the caller
  });

  /**
   * The plan NAME is inert on UAT — every value including an invented one
   * returned an identical gross premium — so it is sent only where HDFC's own
   * sample already carries the key. The New Business template does not, and
   * adding it would break the Blaze-proven key set for nothing.
   */
  it("names the plan on the Roll Over template and nowhere else", () => {
    const rollover = reqPvtCarRollover(req({ providerAddonCodes: ["Diamond Plan"] }));
    expect(rollover.PlanType).toBe("Diamond Plan");
    expect(Object.keys(reqPvtCarNew(req({ providerAddonCodes: ["Diamond Plan"] })))).not.toContain(
      "PlanType",
    );
    expect(Object.keys(reqPvtCarUsed(req({ providerAddonCodes: ["Diamond Plan"] })))).not.toContain(
      "PlanType",
    );
  });

  it("leaves PlanType null when no plan was chosen", () => {
    expect(reqPvtCarRollover(req()).PlanType).toBeNull();
  });

  // "Menu Card Approach" is the pack's name for buying covers à la carte, i.e.
  // the default behaviour — so it must add nothing of its own.
  it("adds no covers for the Menu Card Approach", () => {
    const out = pvtCar({ providerAddonCodes: ["Menu Card Approach"], zeroDep: true });
    expect(out.IsZeroDept_Cover).toBe(1);
    expect(out.IsNCBProtection_Cover).toBe(0);
    expect(out.IsEngGearBox_Cover).toBe(0);
    expect(out.IsCOC_Cover).toBe(0);
  });

  // A liability-only policy has no own-damage section, so a plan made entirely
  // of own-damage covers can attach nothing to it (see the odCover rule).
  it("attaches no plan cover to a TP-only policy", () => {
    const out = pvtCar({ providerAddonCodes: ["Titanium Plan"], selectedPolicy: "thirdParty" });
    expect(out.IsZeroDept_Cover).toBe(0);
    expect(out.IsNCBProtection_Cover).toBe(0);
    expect(out.IsEngGearBox_Cover).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// The four covers that used to be hardcoded off
// ═══════════════════════════════════════════════════════════════════════════════
describe("Emergency Assistance Wider (IsEAW_Cover)", () => {
  // HDFC sells EAW as a SECOND cover alongside ordinary Emergency Assistance and
  // prices it separately: live UAT returns EA_premium 50 AND EAW_premium 499 on
  // one quote. The flag used to be hardcoded false, so it could never be bought.
  it("follows the canonical rsaWorldwide flag, independently of rsa", () => {
    expect(pvtCar({ rsaWorldwide: true }).IsEAW_Cover).toBe(1);
    expect(pvtCar({ rsaWorldwide: true }).IsEA_Cover).toBe(0);
    expect(pvtCar({ rsa: true }).IsEAW_Cover).toBe(0);
    expect(pvtCar({ rsa: true, rsaWorldwide: true }).IsEA_Cover).toBe(1);
    expect(pvtCar().IsEAW_Cover).toBe(0);
  });

  it("is emitted on all three business-type templates", () => {
    const shape = req({ rsaWorldwide: true });
    expect(reqPvtCarNew(shape).IsEAW_Cover).toBe(1);
    expect(reqPvtCarRollover(shape).IsEAW_Cover).toBe(1);
    expect(reqPvtCarUsed(shape).IsEAW_Cover).toBe(1);
  });
});

describe("Loss of Use / Down Time Protection (IsLossofUseDownTimeProt_Cover)", () => {
  // HDFC's "Loss of Use or Down Time Protection" is the same benefit the
  // canonical contract already calls Garage Cash — a payout while the vehicle is
  // off the road — so it reuses that key rather than inventing an HDFC-shaped one.
  // Live UAT: Loss_of_Use_Premium 559 at Loss_of_Use_Premium_Rate 0.001.
  it("follows the canonical garageCash flag", () => {
    expect(pvtCar({ garageCash: true }).IsLossofUseDownTimeProt_Cover).toBe(1);
    expect(pvtCar().IsLossofUseDownTimeProt_Cover).toBe(0);
  });

  // It indemnifies the loss of the vehicle's use, so it is own-damage-side.
  it("is dropped on a liability-only policy", () => {
    expect(
      pvtCar({ garageCash: true, selectedPolicy: "thirdParty" }).IsLossofUseDownTimeProt_Cover,
    ).toBe(0);
  });
});

describe("EMI Protector (IsEMIProtector_Cover)", () => {
  /**
   * HDFC rates the cover as a percentage of the instalment, so the flag is
   * worthless without an amount — and worse than worthless, because HDFC refuses
   * the WHOLE payload ("EMI Protector Plus - Add on system rate is not
   * available") rather than just declining the cover. Proven live with
   * EMIAmount 0 and with the amount populated.
   */
  it("is dropped when the caller named no EMI amount", () => {
    const out = pvtCar({ emiProtect: true });
    expect(out.IsEMIProtector_Cover).toBe(0);
    expect(out.EMIAmount).toBe(0);
    expect(out.NoOfEmi).toBeNull();
  });

  it("carries the instalment amount, count and plan type together", () => {
    const out = pvtCar({ emiProtect: true, emiAmount: 15_000 });
    expect(out.IsEMIProtector_Cover).toBe(1);
    expect(out.EMIAmount).toBe(15_000);
    expect(out.NoOfEmi).toBe(HDFC_EMI_INSTALMENTS);
    expect(out.EMIPlanType).toBe(HDFC_EMI_PLAN_TYPE);
  });

  /**
   * KEY-SET RULE. `EMIPlanType` is not in HDFC's New Business sample, so it must
   * not appear on a New Business payload that does not buy the cover — every
   * request the certification pack has passed keeps its proven shape. It DOES
   * appear when the cover is on, because live UAT refuses the identical payload
   * without it and prices it with it.
   */
  it("adds EMIPlanType to the New Business template only when the cover is bought", () => {
    expect(Object.keys(reqPvtCarNew(req()))).not.toContain("EMIPlanType");
    const withCover = reqPvtCarNew(req({ emiProtect: true, emiAmount: 15_000 }));
    expect(Object.keys(withCover)).toContain("EMIPlanType");
    expect(withCover.EMIPlanType).toBe("A");
    // Position matches the Roll Over template: straight after EMIAmount.
    const keys = Object.keys(withCover);
    expect(keys[keys.indexOf("EMIAmount") + 1]).toBe("EMIPlanType");
  });

  // HDFC's Used Car sample carries no EMI keys at all, so the cover is simply
  // not offered on a used-car policy — the key set must not grow.
  it("adds no EMI keys to the Used Car template", () => {
    const keys = Object.keys(reqPvtCarUsed(req({ emiProtect: true, emiAmount: 15_000 })));
    expect(keys).not.toContain("EMIPlanType");
    expect(keys).not.toContain("NoOfEmi");
  });
});

describe("Higher Protection and Removal Costs (IsHighProtection_Cover)", () => {
  /**
   * HDFC-only, so it arrives through the providerAddonCodes passthrough rather
   * than a canonical flag: no other vendor we integrate sells it, and HDFC's own
   * sandbox cannot price it ("Higher Protection and Removal Costs - Add on
   * system rate is not available" at every HigherTowingLimit swept).
   */
  it("follows the HIGH_PROTECTION provider code", () => {
    expect(pvtCar({ providerAddonCodes: ["HIGH_PROTECTION"] }).IsHighProtection_Cover).toBe(1);
    expect(pvtCar({ providerAddonCodes: ["high_protection"] }).IsHighProtection_Cover).toBe(1);
    expect(pvtCar().IsHighProtection_Cover).toBe(0);
  });

  // No value of HigherTowingLimit changed HDFC's answer, so none is sent.
  it("sends no towing limit, because no value changes HDFC's answer", () => {
    expect(pvtCar({ providerAddonCodes: ["HIGH_PROTECTION"] }).HigherTowingLimit).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Used Car business type
// ═══════════════════════════════════════════════════════════════════════════════
describe("Used Car business type", () => {
  // The canonical flag is the ONLY route to HDFC's Used Car templates; before it
  // existed resolveBusinessType could never return "Used Car" and the templates
  // were dead code.
  it("selects Used Car from the canonical isUsedVehiclePurchase flag", () => {
    expect(resolveBusinessType(baseRequest({ isUsedVehiclePurchase: true }))).toBe("Used Car");
  });

  // A second-hand purchase is neither the buyer's own rollover nor a new
  // vehicle, whatever else the request happens to say.
  it("wins over businessType and the newVehicle category", () => {
    expect(
      resolveBusinessType(baseRequest({ isUsedVehiclePurchase: true, businessType: "new" })),
    ).toBe("Used Car");
    expect(
      resolveBusinessType(baseRequest({ isUsedVehiclePurchase: true, vehicleType: "newVehicle" })),
    ).toBe("Used Car");
  });

  it("leaves every other request on its existing business type", () => {
    expect(resolveBusinessType(baseRequest({ isUsedVehiclePurchase: false }))).toBe("Roll Over");
    expect(resolveBusinessType(baseRequest())).toBe("Roll Over");
  });

  it("routes both payload builders onto the Used Car templates", () => {
    const shape = req({ isUsedVehiclePurchase: true });
    expect(Object.keys(reqPvtCarFor(shape))).toContain("IsFibertank");
    expect(policyDetailsFor(shape).BusinessType_Mandatary).toBe("Used Car");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Corporate customer + hypothecation
// ═══════════════════════════════════════════════════════════════════════════════
describe("corporate policyholder", () => {
  function fullRequest(o: Partial<MotorFullQuoteRequest> = {}): MotorFullQuoteRequest {
    return {
      ...baseRequest(),
      quoteId: "Q1",
      proposer: {
        firstName: "Acme",
        lastName: "Industries",
        email: "ops@acme.example",
        mobile: "9876543210",
        dob: "1990-01-01",
      },
      address: {
        addressLine1: "1 Road",
        pincode: "400001",
        city: "Mumbai",
        state: "Maharashtra",
      },
      vehicle: { engineNumber: "E1", chassisNumber: "C1", financeType: "none" },
      isProposalOnly: false,
      isVehicleUnderLoan: false,
      ...o,
    } as MotorFullQuoteRequest;
  }

  // Customer_Details already carries Customer_Type, Company_Name and
  // Customer_GSTIN_Number, so a corporate policyholder is a VALUE change only —
  // the golden proposal fixtures' key sets do not move.
  it("sends Corporate with the company name and GSTIN, changing no keys", () => {
    const individual = buildCustomerDetails(
      toHdfcRequest(fullRequest(), codes, "T").customer ?? {},
    );
    const corporate = buildCustomerDetails(
      toHdfcRequest(
        fullRequest({ customerType: "corporate", companyName: "Acme Pvt Ltd", gstin: "27AAAAA0000A1Z5" }),
        codes,
        "T",
      ).customer ?? {},
    );
    expect(individual.Customer_Type).toBe("Individual");
    expect(individual.Company_Name).toBe("");
    expect(corporate.Customer_Type).toBe("Corporate");
    expect(corporate.Company_Name).toBe("Acme Pvt Ltd");
    expect(corporate.Customer_GSTIN_Number).toBe("27AAAAA0000A1Z5");
    expect(Object.keys(corporate)).toEqual(Object.keys(individual));
  });

  it("defaults to Individual when the caller says nothing", () => {
    expect(buildCustomerDetails(toHdfcRequest(fullRequest(), codes, "T").customer ?? {}).Customer_Type)
      .toBe("Individual");
  });
});

describe("hypothecation", () => {
  function financed(financeType: "hypothecation" | "lease" | "none") {
    return toHdfcRequest(
      {
        ...baseRequest(),
        quoteId: "Q1",
        vehicle: { engineNumber: "E1", chassisNumber: "C1", financeType },
      } as MotorFullQuoteRequest,
      codes,
      "T",
    );
  }

  // AgreementType was emitted as null on every financed vehicle even though the
  // canonical request already said whether the loan was a hypothecation or a
  // lease. FinancierCode still cannot be filled — HDFC wants a numeric code from
  // its own GENMST_FINANCIER master and there is no canonical financier master
  // to cross-walk against — and a guess is worse than a null.
  it("derives AgreementType from the canonical financeType", () => {
    expect(policyDetailsFor(financed("hypothecation")).AgreementType).toBe("Hypothecation");
    expect(policyDetailsFor(financed("lease")).AgreementType).toBe("Lease");
    expect(policyDetailsFor(financed("none")).AgreementType).toBeNull();
  });

  it("still sends no FinancierCode, because none can be resolved", () => {
    expect(policyDetailsFor(financed("hypothecation")).FinancierCode).toBeNull();
    expect(policyDetailsFor(financed("hypothecation")).BranchName).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Response side
// ═══════════════════════════════════════════════════════════════════════════════
describe("normalizer — newly-read premium fields", () => {
  const ctx = {
    requestId: "R",
    quoteNo: "Q",
    policyType: "comprehensive",
    vehicleCategory: "fourWheeler",
  } as const;

  // Every field name below was read off a live UAT CalculatePremium response.
  // `EAW_premium` has a lowercase p like its EA_premium sibling, and the
  // engine-gearbox premium is `Vehicle_Base_ENG_Premium` — the `_EGP_` spelling
  // this used to read matched nothing on the wire, so a cover the customer had
  // paid for never reached the compare card.
  it("reads EAW, Loss of Use, EMI Protector and the real engine-gearbox field", () => {
    const q = normalizeQuote(
      {
        StatusCode: 200,
        Resp_PvtCar: {
          Total_Premium: 10_000,
          EAW_premium: 499,
          Loss_of_Use_Premium: 559,
          EMI_PROTECTOR_PREMIUM: 600,
          Vehicle_Base_ENG_Premium: 783,
        },
      },
      ctx,
    );
    expect(q.addonPremiums?.rsaWorldwide).toBe(499);
    expect(q.addonPremiums?.garageCash).toBe(559);
    expect(q.addonPremiums?.emiProtect).toBe(600);
    expect(q.addonPremiums?.engineProtect).toBe(783);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { ValidationError } from "@/errors/app-error.ts";
import type { RenewalProposalRequest, RenewalCreatePolicyRequest } from "@/contracts/renewal.ts";
import { fgRenewalProposal, fgRenewalCreatePolicy } from "../renewal.ts";
import type { FgConfig } from "../config.ts";
import proposalFixture from "../fixtures/renewal-proposal.response.json";
import issuanceFixture from "../fixtures/renewal-issuance.response.json";

/**
 * REGRESSION GUARD for the renewal-contract relaxation made for HDFC.
 *
 * `productCode`, `clientCode`, `agentCode`, `branch`, `coverCode`, `clientId`
 * and `branchCode` used to be REQUIRED in the zod schemas. HDFC's renewal needs
 * none of them, so they were made optional and FG now asserts them itself with
 * `requireFields`. Without that assertion an incomplete FG renewal would sail
 * past validation and reach the vendor as a malformed payload — these tests
 * fail loudly if the assertion is ever removed.
 *
 * Deliberately stubbed with a SUCCESSFUL fetch: if `requireFields` were deleted,
 * both calls would resolve normally instead of throwing, so the only thing these
 * assertions can be detecting is the provider-side check.
 */

const config = {
  vendorCode: "Webagg",
  renewal: {
    baseUrl:
      "https://uat-internal-apigw.generalicentralinsurance.com:8243/Renewal/1.0.0/RenewalModify",
  },
} as unknown as FgConfig;

function stubSuccessfulFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch,
  );
}

afterEach(() => vi.unstubAllGlobals());

/** A complete FG proposal request; individual tests delete one field from it. */
function completeProposal(): RenewalProposalRequest {
  return {
    productCode: "FPV",
    previousPolicyNo: "VD731720",
    proposalNo: "00VD731720",
    clientCode: "72782626",
    startDate: "2025-03-31",
    expiryDate: "2026-03-30",
    agentCode: "60081262",
    branch: "12",
    coverCode: "CO",
    vehicleIdv: 603000,
    discountPercentage: -80,
    addonCodes: [],
  };
}

function completeCreatePolicy(): RenewalCreatePolicyRequest {
  return {
    policyNo: "VD731720",
    clientId: "72782626",
    proposalNo: "00VD731720",
    agentCode: "60084677",
    branchCode: "2J",
    receipt: {
      uniqueTranKey: "TD89984789",
      transactionDate: "01/12/2025",
      receiptType: "IVR",
      amount: 7783,
      tranRefNo: "24709987121",
      tranRefNoDate: "01/12/2025",
      pgType: "PAYU",
    },
  };
}

describe("FG renewal still enforces its own required fields", () => {
  const proposalFields = ["productCode", "clientCode", "agentCode", "branch", "coverCode"] as const;

  it.each(proposalFields)(
    "rejects a proposal missing %s, even though the schema now allows it",
    async (field) => {
      stubSuccessfulFetch(proposalFixture);
      const req = completeProposal();
      delete req[field];
      await expect(fgRenewalProposal(config, req, "tok", { requestId: "r1" })).rejects.toThrow(
        ValidationError,
      );
    },
  );

  it("names every missing proposal field at once, tagged with the fg slug", async () => {
    stubSuccessfulFetch(proposalFixture);
    const req = completeProposal();
    delete req.agentCode;
    delete req.branch;

    const err = await fgRenewalProposal(config, req, "tok", { requestId: "r2" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ValidationError);
    const details = (err as ValidationError).details as { path: string[]; message: string }[];
    expect(details.map((d) => d.path[0])).toEqual(["agentCode", "branch"]);
    expect(details[0]!.message).toContain("fg");
  });

  it("still accepts a complete proposal", async () => {
    stubSuccessfulFetch(proposalFixture);
    await expect(
      fgRenewalProposal(config, completeProposal(), "tok", { requestId: "r3" }),
    ).resolves.toMatchObject({ providerSlug: "fg" });
  });

  const createPolicyFields = ["clientId", "agentCode", "branchCode"] as const;

  it.each(createPolicyFields)(
    "rejects a create-policy missing %s, even though the schema now allows it",
    async (field) => {
      stubSuccessfulFetch(issuanceFixture);
      const req = completeCreatePolicy();
      delete req[field];
      await expect(fgRenewalCreatePolicy(config, req, "tok")).rejects.toThrow(ValidationError);
    },
  );

  it("still accepts a complete create-policy", async () => {
    stubSuccessfulFetch(issuanceFixture);
    await expect(fgRenewalCreatePolicy(config, completeCreatePolicy(), "tok")).resolves.toMatchObject(
      { status: "ISSUED" },
    );
  });
});

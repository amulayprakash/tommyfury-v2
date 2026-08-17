import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useHdfcUatStore, type HdfcConditions } from "../hdfc-uat-store";
import { HdfcPlansPage } from "../pages/hdfc-plans-page";

/**
 * The requirement this whole harness exists for: `/hdfc` shows HDFC quotes and
 * nothing else.
 *
 * That is asserted here on both halves of the round trip — what we ASK for and
 * what we RENDER — because either one alone can be right while the page is still
 * wrong. A request pinned to HDFC does not stop a page from rendering whatever
 * the backend chose to send back, and a page that filters by slug proves nothing
 * about the fan-out it triggered upstream. So the compare body is captured and
 * checked, and the response deliberately carries an ICICI result the page must
 * refuse to draw.
 */

const API = "http://localhost:4000/api/v1";

/** The rollover the certification presets are built on (see `test-presets.ts`). */
const CONDITIONS: HdfcConditions = {
  makeId: "12798", makeName: "MARUTI", modelId: "12798", modelName: "SWIFT ZXI",
  fuelType: "petrol", rtoCode: "10406",
  registrationNumber: "MH01QQ7878", registrationDate: "2025-08-13",
  engineNumber: "ENG1234567890123", chassisNumber: "MA3EWDE1S00123456",
  businessType: "rollover", isUsedVehiclePurchase: false,
  planType: "comprehensive", tenureYears: 1, paOwner: true,
  previousInsurerId: "", previousInsurerName: "", previousPolicyNumber: "PREVPOL0001",
  previousPolicyExpiryDate: "2026-08-24", isPreviousPolicyExpired: false,
  ncbPercent: 20, claimInPreviousPolicy: false,
};

/** A priced quote in the canonical shape, differing only by insurer and premium. */
const quote = (slug: string, insurerName: string, gross: number) => ({
  quoteNo: `Q-${slug.toUpperCase()}-1`,
  transactionId: `T-${slug}`,
  requestId: "req-1",
  providerSlug: slug,
  insurerName,
  policyType: "comprehensive",
  vehicleCategory: "fourWheeler",
  idvValue: 500_000,
  basicOdPremium: 3_000,
  thirdPartyPremium: 2_094,
  addonPremiums: {},
  discounts: { ncbPercent: 20 },
  totalAddonPremium: 0,
  totalDiscount: 0,
  netPremium: Math.round(gross / 1.18),
  serviceTaxPercent: 18,
  serviceTaxAmount: gross - Math.round(gross / 1.18),
  grossPremium: gross,
});

/** The body the page actually put on the wire, captured by the handler below. */
let comparedBody: Record<string, unknown> | null = null;

const server = setupServer(
  http.get(`${API}/providers`, () =>
    HttpResponse.json({
      status: "success",
      providers: [
        {
          slug: "hdfc",
          displayName: "HDFC ERGO",
          capabilities: ["fourWheeler"],
          operations: ["quote", "proposal", "ckyc", "issuance"],
          motorCapabilities: {
            fourWheeler: {
              policyTypes: ["comprehensive", "thirdParty", "standAloneOD"],
              addons: ["zeroDep", "rsa", "rti"],
            },
          },
        },
      ],
    }),
  ),
  http.get(`${API}/providers/hdfc/addons`, () => HttpResponse.json({ addons: [] })),
  http.post(`${API}/motor/quotes/compare`, async ({ request }) => {
    comparedBody = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      status: "success",
      message: "ok",
      requestId: "req-1",
      response: {
        results: [
          {
            providerSlug: "hdfc",
            displayName: "HDFC ERGO",
            status: "success",
            quote: quote("hdfc", "HDFC ERGO General Insurance", 5_715),
          },
          // Deliberately smuggled in. The real backend would never send this
          // when the request named only HDFC — that is exactly why the page must
          // not be trusted to have asked correctly.
          {
            providerSlug: "icici",
            displayName: "ICICI Lombard",
            status: "success",
            quote: quote("icici", "ICICI Lombard General Insurance", 8_888),
          },
        ],
      },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  comparedBody = null;
});
afterAll(() => server.close());

beforeEach(() => {
  useHdfcUatStore.setState({
    category: "fourWheeler",
    presetId: null,
    conditions: CONDITIONS,
    providerAddonCodes: [],
    quote: null,
    exchanges: [],
  });
});

function renderPlans() {
  // retry off, so a thrown request fails the test instead of hanging it.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {/* The page navigates on Continue, so it needs a router context. */}
      <MemoryRouter initialEntries={["/hdfc/plans"]}>
        <HdfcPlansPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HdfcPlansPage — the provider lock", () => {
  it("asks the compare endpoint for HDFC and nothing else", async () => {
    renderPlans();

    await screen.findByText("HDFC ERGO General Insurance");

    expect(comparedBody?.providers).toEqual(["hdfc"]);
  });

  it("renders the HDFC quote card", async () => {
    renderPlans();

    expect(await screen.findByText("HDFC ERGO General Insurance")).toBeInTheDocument();
    // The card and the breakdown below it both show the gross premium.
    expect(screen.getAllByText("₹5,715").length).toBeGreaterThan(0);
    // The shared QuoteCard's select control — the quote auto-selects as the only one.
    expect(screen.getByRole("button", { name: /select/i })).toBeInTheDocument();
  });

  it("renders no card for a non-HDFC result the response smuggles in", async () => {
    renderPlans();

    // Wait for the HDFC card first, so absence is measured after the render, not before it.
    await screen.findByText("HDFC ERGO General Insurance");

    expect(screen.queryByText(/ICICI/i)).toBeNull();
    expect(screen.queryByText("₹8,888")).toBeNull();
  });
});

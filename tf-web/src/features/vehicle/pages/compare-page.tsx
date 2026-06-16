import { ArrowRight, RefreshCw } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompareQuotesQuery, useProviders } from "../api/hooks";
import type { AddonKey, CompareResult, PolicyType } from "../api/types";
import { AddonSelector } from "../components/addon-selector";
import { IdvControl } from "../components/idv-control";
import { NcbSelect } from "../components/ncb-select";
import { PlanTypeToggle } from "../components/plan-type-toggle";
import { QuoteCard } from "../components/quote-card";
import { WizardSteps } from "../components/wizard-steps";
import { buildQuoteRequest, useVehicleQuoteStore } from "../vehicle-quote-store";

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/** Orders quote results: cheapest priced first, then unavailable, then errored. */
function rank(r: CompareResult): number {
  if (r.status === "success" && r.quote) return r.quote.grossPremium;
  if (r.status === "no_quote") return Number.MAX_SAFE_INTEGER - 1;
  return Number.MAX_SAFE_INTEGER;
}

export function ComparePage() {
  const navigate = useNavigate();
  const vehicle = useVehicleQuoteStore((s) => s.vehicle);
  const category = useVehicleQuoteStore((s) => s.category);
  const planType = useVehicleQuoteStore((s) => s.planType);
  const idvValue = useVehicleQuoteStore((s) => s.idvValue);
  const ncbPercent = useVehicleQuoteStore((s) => s.ncbPercent);
  const claimInPreviousPolicy = useVehicleQuoteStore((s) => s.claimInPreviousPolicy);
  const addons = useVehicleQuoteStore((s) => s.addons);
  const selected = useVehicleQuoteStore((s) => s.selected);

  const setPlanType = useVehicleQuoteStore((s) => s.setPlanType);
  const setIdv = useVehicleQuoteStore((s) => s.setIdv);
  const setNcb = useVehicleQuoteStore((s) => s.setNcb);
  const toggleAddon = useVehicleQuoteStore((s) => s.toggleAddon);
  const selectPlan = useVehicleQuoteStore((s) => s.selectPlan);

  const providers = useProviders();

  const { availablePlanTypes, availableAddons } = useMemo(() => {
    if (!category) return { availablePlanTypes: [] as PolicyType[], availableAddons: [] as AddonKey[] };
    const eligible = (providers.data ?? [])
      .map((p) => p.motorCapabilities[category])
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    return {
      availablePlanTypes: unique(eligible.flatMap((c) => c.policyTypes)),
      availableAddons: unique(eligible.flatMap((c) => c.addons)),
    };
  }, [providers.data, category]);

  // Keep the selected plan type within what vendors actually support.
  useEffect(() => {
    const fallback = availablePlanTypes[0];
    if (fallback && !availablePlanTypes.includes(planType)) {
      setPlanType(fallback);
    }
  }, [availablePlanTypes, planType, setPlanType]);

  const request = useMemo(
    () =>
      buildQuoteRequest({
        vehicle,
        planType,
        idvValue,
        ncbPercent,
        claimInPreviousPolicy,
        addons,
      }),
    [vehicle, planType, idvValue, ncbPercent, claimInPreviousPolicy, addons],
  );

  const compare = useCompareQuotesQuery(request);
  const results = useMemo(
    () => [...(compare.data ?? [])].sort((a, b) => rank(a) - rank(b)),
    [compare.data],
  );

  // Pull IDV bounds from whichever vendor returned them.
  const idvBounds = useMemo(() => {
    const q = (compare.data ?? []).find((r) => r.quote?.minIdv && r.quote?.maxIdv)?.quote;
    return q ? { min: q.minIdv, max: q.maxIdv } : {};
  }, [compare.data]);

  if (!vehicle || !category) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="mb-4 text-muted-foreground">Add your vehicle details to see plans.</p>
        <Button asChild>
          <Link to={ROUTES.vehicle.start}>Start over</Link>
        </Button>
      </div>
    );
  }

  const showOdControls = planType !== "thirdParty";

  return (
    <div>
      <WizardSteps current={1} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-display text-lg font-semibold">
            {[vehicle.makeName, vehicle.modelName, vehicle.variantName].filter(Boolean).join(" ")}
          </p>
          <p className="text-sm text-muted-foreground">
            {vehicle.registrationNumber} · {vehicle.rtoCode} · {vehicle.fuelType}
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to={ROUTES.vehicle.confirmDetails}>Edit</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Coverage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <PlanTypeToggle
              value={planType}
              available={availablePlanTypes}
              onChange={setPlanType}
            />

            {showOdControls ? (
              <>
                <IdvControl
                  value={idvValue}
                  min={idvBounds.min}
                  max={idvBounds.max}
                  onChange={setIdv}
                />
                <NcbSelect value={ncbPercent} onChange={setNcb} />
                <div className="space-y-2">
                  <span className="text-sm font-medium">Add-ons</span>
                  <AddonSelector
                    available={availableAddons}
                    selected={addons}
                    onToggle={toggleAddon}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Third-party cover is mandated by law and has a fixed premium — no IDV or add-ons.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold">
              {compare.isFetching ? "Fetching plans…" : `${results.length} plans`}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void compare.refetch()}
              disabled={compare.isFetching}
            >
              <RefreshCw className={compare.isFetching ? "animate-spin" : ""} /> Refresh
            </Button>
          </div>

          {compare.isPending || providers.isPending ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : compare.isError ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-destructive">
                Could not fetch quotes. Please try again.
              </CardContent>
            </Card>
          ) : results.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No vendors offer this cover for your vehicle yet.
              </CardContent>
            </Card>
          ) : (
            results.map((result) => (
              <QuoteCard
                key={result.providerSlug}
                result={result}
                selected={selected?.providerSlug === result.providerSlug}
                onSelect={(r) => r.quote && selectPlan({ providerSlug: r.providerSlug, quote: r.quote })}
              />
            ))
          )}

          {selected ? (
            <Button
              size="lg"
              className="w-full"
              onClick={() => void navigate(ROUTES.vehicle.apiForm)}
            >
              Continue with {selected.quote.insurerName ?? selected.providerSlug} <ArrowRight />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

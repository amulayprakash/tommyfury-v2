import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompareQuotesQuery, useProviderAddons, useProviders } from "../api/hooks";
import type { CompareQuotesRequest, CompareResult, PolicyType } from "../api/types";
import { IdvControl } from "../components/idv-control";
import { NcbSelect } from "../components/ncb-select";
import { PlanTypeToggle } from "../components/plan-type-toggle";
import { QuoteCard } from "../components/quote-card";
import { WizardSteps } from "../components/wizard-steps";
import { buildQuoteRequest, useVehicleQuoteStore } from "../vehicle-quote-store";

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Whole-ish years between a registration date and now (0 when unknown). */
function yearsSince(isoDate?: string): number {
  if (!isoDate) return 0;
  const t = Date.parse(isoDate);
  return Number.isNaN(t) ? 0 : (Date.now() - t) / (365.25 * 864e5);
}

/**
 * Add-on chooser for the selected insurer. Owns its own selection state and is
 * keyed by provider+plan in the parent, so switching insurer resets it. Re-quotes
 * ONLY this provider with the chosen master cover codes.
 */
function ProviderAddonPanel({
  providerSlug,
  displayName,
  category,
  fuelClass,
  vehicleAge,
  baseRequest,
  baseQuote,
}: {
  providerSlug: string;
  displayName: string;
  category: string;
  fuelClass: string;
  vehicleAge: number;
  baseRequest: CompareQuotesRequest;
  baseQuote: number;
}) {
  const navigate = useNavigate();
  const selectPlan = useVehicleQuoteStore((s) => s.selectPlan);
  const setProviderAddonCodes = useVehicleQuoteStore((s) => s.setProviderAddonCodes);
  const [codes, setCodes] = useState<string[]>([]);

  const catalog = useProviderAddons(providerSlug, category, fuelClass, true);
  const ineligible = (maxAgeYears?: number | null) =>
    maxAgeYears != null && vehicleAge > maxAgeYears;
  const request = useMemo<CompareQuotesRequest>(
    () => ({ ...baseRequest, providers: [providerSlug], providerAddonCodes: codes }),
    [baseRequest, providerSlug, codes],
  );
  const quote = useCompareQuotesQuery(request);
  const result = quote.data?.[0];
  const customQuote = result?.status === "success" ? result.quote : undefined;

  const onContinue = () => {
    setProviderAddonCodes(codes);
    if (customQuote) selectPlan({ providerSlug, quote: customQuote });
    void navigate(ROUTES.vehicle.apiForm);
  };

  const toggle = (code: string, on: boolean) =>
    setCodes((prev) => (on ? [...prev, code] : prev.filter((c) => c !== code)));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{displayName} add-ons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {catalog.isPending ? (
            <p className="text-sm text-muted-foreground">Loading add-ons…</p>
          ) : (catalog.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No optional add-ons for this plan.</p>
          ) : (
            <ul className="space-y-2">
              {catalog.data!.map((a) => {
                const disabled = ineligible(a.maxAgeYears);
                return (
                  <li key={a.code}>
                    <label
                      className={`flex items-start gap-3 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={disabled}
                        checked={codes.includes(a.code)}
                        onChange={(e) => toggle(a.code, e.target.checked)}
                      />
                      <span>
                        <span className="font-medium">{a.label}</span>
                        {disabled ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (not available for this vehicle&apos;s age)
                          </span>
                        ) : a.requiresZeroDep ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (needs a Zero-Dep add-on)
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between border-t pt-3 text-sm">
            <span className="text-muted-foreground">
              {quote.isFetching ? "Updating premium…" : "Premium with add-ons"}
            </span>
            <span className="font-display text-lg font-semibold">
              {quote.isFetching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : customQuote ? (
                inr(customQuote.grossPremium)
              ) : result?.status === "error" ? (
                <span className="text-sm text-destructive">Unavailable</span>
              ) : (
                inr(baseQuote)
              )}
            </span>
          </div>
          {result?.status === "error" && !quote.isFetching ? (
            <p className="text-xs text-muted-foreground">
              Add-on pricing is temporarily unavailable from this insurer — you can still continue
              with the base cover.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Button size="lg" className="w-full" onClick={onContinue}>
        Continue with {displayName} <ArrowRight />
      </Button>
    </>
  );
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
  const previousTp = useVehicleQuoteStore((s) => s.previousTp);
  const selected = useVehicleQuoteStore((s) => s.selected);

  const setPlanType = useVehicleQuoteStore((s) => s.setPlanType);
  const setIdv = useVehicleQuoteStore((s) => s.setIdv);
  const setNcb = useVehicleQuoteStore((s) => s.setNcb);
  const setClaim = useVehicleQuoteStore((s) => s.setClaim);
  const setPreviousTp = useVehicleQuoteStore((s) => s.setPreviousTp);
  const selectPlan = useVehicleQuoteStore((s) => s.selectPlan);

  const providers = useProviders();

  const availablePlanTypes = useMemo(() => {
    if (!category) return [] as PolicyType[];
    const eligible = (providers.data ?? [])
      .map((p) => p.motorCapabilities[category])
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    // Show every cover the providers advertise (TP/OD/Comprehensive). A cover an
    // insurer declines surfaces as a "not available" message on its quote card,
    // not by hiding the tab.
    return unique(eligible.flatMap((c) => c.policyTypes));
  }, [providers.data, category]);

  // Default to Comprehensive; keep selection within supported types.
  useEffect(() => {
    if (availablePlanTypes.length > 0 && !availablePlanTypes.includes(planType)) {
      setPlanType(
        availablePlanTypes.includes("comprehensive") ? "comprehensive" : availablePlanTypes[0]!,
      );
    }
  }, [availablePlanTypes, planType, setPlanType]);

  // Base compare across all eligible providers (no provider-specific add-ons yet).
  const baseRequest = useMemo(
    () =>
      buildQuoteRequest({
        vehicle,
        planType,
        idvValue,
        ncbPercent,
        claimInPreviousPolicy,
        addons: {},
        previousTp,
      }),
    [vehicle, planType, idvValue, ncbPercent, claimInPreviousPolicy, previousTp],
  );

  const compare = useCompareQuotesQuery(baseRequest);
  const results = useMemo(
    () => [...(compare.data ?? [])].sort((a, b) => rank(a) - rank(b)),
    [compare.data],
  );

  const idvBounds = useMemo(() => {
    const q = (compare.data ?? []).find((r) => r.quote?.minIdv && r.quote?.maxIdv)?.quote;
    return q ? { min: q.minIdv, max: q.maxIdv } : {};
  }, [compare.data]);

  // Vehicle age (years) — used to filter age-restricted add-ons.
  const vehicleAge = useMemo(
    () => yearsSince(vehicle?.registrationDate),
    [vehicle?.registrationDate],
  );

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
  const showAddons = Boolean(selected) && planType === "comprehensive";
  const fuelClass = vehicle.fuelType === "electric" ? "electric" : "standard";

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
            <PlanTypeToggle value={planType} available={availablePlanTypes} onChange={setPlanType} />
            {showOdControls ? (
              <>
                <IdvControl value={idvValue} min={idvBounds.min} max={idvBounds.max} onChange={setIdv} />
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={claimInPreviousPolicy}
                    onChange={(e) => {
                      setClaim(e.target.checked);
                      // A claim voids the NCB — keep the request consistent.
                      if (e.target.checked) setNcb(0);
                    }}
                  />
                  <span>I made a claim in my previous policy</span>
                </label>
                <NcbSelect value={ncbPercent} onChange={setNcb} disabled={claimInPreviousPolicy} />
                {planType === "standAloneOD" ? (
                  <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                    <p className="text-xs font-medium">Previous third-party policy</p>
                    <Input
                      placeholder="TP insurer"
                      value={previousTp.insurerName ?? vehicle.previousInsurerName ?? ""}
                      onChange={(e) => setPreviousTp({ ...previousTp, insurerName: e.target.value })}
                    />
                    <Input
                      placeholder="TP policy number"
                      value={previousTp.policyNumber ?? vehicle.previousPolicyNumber ?? ""}
                      onChange={(e) => setPreviousTp({ ...previousTp, policyNumber: e.target.value })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">Start</span>
                        <Input
                          type="date"
                          value={previousTp.startDate ?? ""}
                          onChange={(e) => setPreviousTp({ ...previousTp, startDate: e.target.value })}
                        />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">Expiry</span>
                        <Input
                          type="date"
                          value={previousTp.expiryDate ?? ""}
                          onChange={(e) => setPreviousTp({ ...previousTp, expiryDate: e.target.value })}
                        />
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Own-Damage cover needs an active (not expired) third-party policy.
                    </p>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Pick an insurer on the right to choose their add-ons.
                </p>
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

          {/* Provider-specific add-ons (revealed after selecting an insurer). */}
          {showAddons && selected && baseRequest ? (
            <ProviderAddonPanel
              key={`${selected.providerSlug}-${planType}`}
              providerSlug={selected.providerSlug}
              displayName={selected.quote.insurerName ?? selected.providerSlug}
              category={category}
              fuelClass={fuelClass}
              vehicleAge={vehicleAge}
              baseRequest={baseRequest}
              baseQuote={selected.quote.grossPremium}
            />
          ) : selected ? (
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

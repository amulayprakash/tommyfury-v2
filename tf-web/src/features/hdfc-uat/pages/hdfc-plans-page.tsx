import { AlertTriangle, ArrowRight } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompareQuotesQuery, useProviderAddons, useProviders } from "../../vehicle/api/hooks";
import { AddonSelector } from "../../vehicle/components/addon-selector";
import { IdvControl } from "../../vehicle/components/idv-control";
import { PremiumBreakdown } from "../../vehicle/components/premium-breakdown";
import { QuoteCard } from "../../vehicle/components/quote-card";
import type { AddonKey, CanonicalQuote, CompareResult } from "../../vehicle/api/types";
import { ALL_ADDON_KEYS } from "../../vehicle/api/types";
import { buildHdfcQuoteRequest, HDFC_SLUG } from "../build-hdfc-request";
import { PresetWarning } from "../components/condition-fields";
import { CATEGORY_LABELS } from "../hdfc-capabilities";
import { useHdfcUatStore } from "../hdfc-uat-store";
import { presetById } from "../test-presets";

/**
 * Step 3 of the HDFC certification harness — price the stated conditions at HDFC
 * (and only HDFC), pick covers, and read back what HDFC said.
 *
 * The provider lock has two halves and this page owns the second one.
 * `buildHdfcQuoteRequest` pins `providers: ["hdfc"]` on the way out; the filter
 * below drops anything that comes back under another slug. The request alone
 * would be enough against a well-behaved backend, but "well-behaved backend" is
 * an assumption, and the requirement — only HDFC quotes are shown — is about
 * what the tester SEES. Both halves are covered by
 * `__tests__/hdfc-plans-page.test.tsx`.
 *
 * Nothing here is friendly copy: a failed quote shows HDFC's raw error code and
 * message, because the tester's next action is to read it back to their team.
 * "SA_OD Policy is only allowed for Short Term Policy period" is the evidence a
 * certification sign-off rests on; "Couldn't fetch a quote" is not.
 */
export function HdfcPlansPage() {
  const navigate = useNavigate();
  const category = useHdfcUatStore((s) => s.category);
  const conditions = useHdfcUatStore((s) => s.conditions);
  const presetId = useHdfcUatStore((s) => s.presetId);
  const codes = useHdfcUatStore((s) => s.providerAddonCodes);
  const storedQuote = useHdfcUatStore((s) => s.quote);
  const setConditions = useHdfcUatStore((s) => s.setConditions);
  const setAddonCodes = useHdfcUatStore((s) => s.setAddonCodes);
  const setQuote = useHdfcUatStore((s) => s.setQuote);
  const recordExchange = useHdfcUatStore((s) => s.recordExchange);

  const request = useMemo(
    () => (category && conditions ? buildHdfcQuoteRequest(category, conditions, codes) : null),
    [category, conditions, codes],
  );

  const compare = useCompareQuotesQuery(request);

  // The second half of the provider lock. A result under any other slug is
  // dropped before it can reach a card.
  const hdfcResults = useMemo(
    () => (compare.data ?? []).filter((r) => r.providerSlug === HDFC_SLUG),
    [compare.data],
  );
  const priced = hdfcResults.find((r) => r.status === "success" && r.quote);
  const quote = priced?.quote;
  const failed = hdfcResults.find((r) => r.status === "error");

  const providers = useProviders();
  const hdfc = providers.data?.find((p) => p.slug === HDFC_SLUG);
  const canonicalAddons = useMemo<AddonKey[]>(() => {
    const motor = hdfc?.motorCapabilities as
      | Record<string, { addons?: AddonKey[] } | undefined>
      | undefined;
    // paOwner is driven by the CPA condition on the previous step, not by a tick
    // here — see `buildHdfcQuoteRequest`, where the condition wins.
    return (motor?.[category ?? ""]?.addons ?? []).filter((a) => a !== "paOwner");
  }, [hdfc, category]);

  const fuelClass = conditions?.fuelType === "electric" ? "electric" : "standard";
  const catalog = useProviderAddons(HDFC_SLUG, category ?? "", fuelClass, Boolean(category));

  // Record ONCE per priced quote. React-query hands back the same object while the
  // result is cached, so holding the last recorded one keeps re-renders (and the
  // request object churning on every add-on tick) from stacking duplicate rows.
  const recorded = useRef<CanonicalQuote | null>(null);
  useEffect(() => {
    if (!quote || recorded.current === quote) return;
    recorded.current = quote;
    setQuote(quote);
    recordExchange({
      step: "GetQuote",
      at: new Date().toISOString(),
      request,
      response: quote._rawResponse ?? priced,
    });
  }, [quote, priced, request, setQuote, recordExchange]);

  if (!category || !conditions) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          No conditions captured yet. Start from the beginning.
        </p>
        <Button asChild>
          <Link to={ROUTES.hdfcUat.start}>Start from /hdfc</Link>
        </Button>
      </div>
    );
  }

  const selectedFlags = Object.fromEntries(
    ALL_ADDON_KEYS.map((k) => [k, codes.includes(k)]),
  ) as Partial<Record<AddonKey, boolean>>;

  const toggleCanonical = (key: AddonKey, on: boolean) =>
    setAddonCodes(on ? [...codes, key] : codes.filter((c) => c !== key));

  const toggleProviderCode = (code: string, on: boolean) =>
    setAddonCodes(on ? [...codes, code] : codes.filter((c) => c !== code));

  const onSelect = (result: CompareResult) => setQuote(result.quote ?? null);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">
          Quote — {CATEGORY_LABELS[category] ?? category}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[conditions.makeName, conditions.modelName].filter(Boolean).join(" ")} ·{" "}
          {[conditions.registrationNumber, conditions.rtoCode, conditions.fuelType]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {/* Carried across from the previous step so the warning stays in front of
          the tester right up to the moment the proposal is attempted. */}
      <PresetWarning warning={presetById(presetId)?.warning} />

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Add-on covers</h2>
        {/* HDFC honours the canonical add-on flags directly, unlike FG — so these
            are the real thing, not a display of someone else's cover codes. */}
        <AddonSelector
          available={canonicalAddons}
          selected={selectedFlags}
          onToggle={toggleCanonical}
        />
        {(catalog.data?.length ?? 0) > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">HDFC&apos;s own cover bundles</p>
            <ul className="space-y-2">
              {catalog.data!.map((a) => (
                <li key={a.code}>
                  <label className="flex cursor-pointer items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={codes.includes(a.code)}
                      onChange={(e) => toggleProviderCode(a.code, e.target.checked)}
                    />
                    <span>
                      <span className="font-medium">{a.label}</span>{" "}
                      <span className="text-xs text-muted-foreground">({a.code})</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">HDFC ERGO</h2>

        {compare.isPending ? (
          <Skeleton className="h-24 w-full rounded-md" />
        ) : compare.isError ? (
          <p className="text-sm text-destructive">
            The quote request itself failed — the backend never answered.
          </p>
        ) : failed ? (
          /* HDFC's own words, verbatim. The shared QuoteCard maps error codes to
             friendly customer copy, which is exactly wrong here: the vendor's
             message IS the deliverable. */
          <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4 shrink-0" /> {failed.error?.code}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm text-destructive">
              {failed.error?.message}
            </p>
          </div>
        ) : hdfcResults.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            HDFC returned no result for these conditions.
          </p>
        ) : (
          <div className="space-y-3">
            {hdfcResults.map((r) => (
              <QuoteCard
                key={r.quote?.quoteNo ?? r.providerSlug}
                result={r}
                selected={Boolean(r.quote && storedQuote?.quoteNo === r.quote.quoteNo)}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </section>

      {quote ? (
        <>
          <section className="space-y-3 rounded-md border p-3">
            <h2 className="text-sm font-semibold">Premium</h2>
            <PremiumBreakdown quote={quote} />
            <div className="border-t pt-3 text-sm text-muted-foreground">
              Quote number <span className="font-medium text-foreground">{quote.quoteNo}</span>
            </div>
          </section>

          <section className="space-y-3 rounded-md border p-3">
            {/* Changing the IDV re-prices: it is part of the conditions, so the
                compare request rebuilds and HDFC rates it again. */}
            <IdvControl
              value={conditions.idvValue ?? null}
              min={quote.minIdv}
              max={quote.maxIdv}
              onChange={(idvValue) =>
                setConditions({ ...conditions, idvValue: idvValue ?? undefined })
              }
            />
          </section>
        </>
      ) : null}

      <Button
        size="lg"
        className="w-full"
        onClick={() => void navigate(ROUTES.hdfcUat.proposal)}
        disabled={!quote}
      >
        Continue <ArrowRight />
      </Button>

      {/*
        The raw vendor exchange, honestly empty for now. `includeRawExchange` is
        not on the compare contract on this branch — that field lands with the FG
        harness — so the backend never echoes `_rawResponse` and there is nothing
        real to show. Rather than dress the canonical request up as a vendor
        payload, this says so.
      */}
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Raw vendor exchange</summary>
        {quote?._rawResponse ? (
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted/40 p-2 text-xs">
            {JSON.stringify(quote._rawResponse, null, 2)}
          </pre>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            No raw exchange returned. The backend echoes the vendor payload only when the request
            asks for it, and the contract field that asks is not on this branch yet.
          </p>
        )}
      </details>
    </div>
  );
}

import { AlertTriangle, ArrowRight } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatInr } from "@/lib/utils";
import { isAddonSelectable, toggleAddonSelection } from "../../vehicle/addon-selection";
import { useCompareQuotesQuery, useProviderAddons } from "../../vehicle/api/hooks";
import type { AddonKey, CanonicalQuote } from "../../vehicle/api/types";
import { ADDON_LABELS } from "../../vehicle/api/types";
import { buildFgQuoteRequest } from "../build-fg-request";
import { RawExchange } from "../components/raw-exchange";
import { CATEGORY_LABELS } from "../fg-capabilities";
import { useFgUatStore } from "../fg-uat-store";

/**
 * Step 3 of the FG certification harness — price the stated conditions at FG
 * (and only FG), pick covers under FG's own combo rules, and show the premium
 * split the way the certification pack asks for it.
 *
 * Nothing here is friendly copy: a failed quote shows FG's raw error code and
 * message, because the tester's next action is to read it back to their team.
 */

/** Discount lines FG returns, in presentation order. `ncbPercent` is shown separately. */
const DISCOUNT_LABELS: Record<string, string> = {
  ncbAmount: "No-Claim Bonus",
  ownDamageDiscount: "Own-damage special discount",
  aaaMembership: "Automobile association membership",
  antiTheft: "Anti-theft device",
  voluntaryDeductible: "Voluntary deductible",
  payU: "Pay-as-you-use",
};

/** Above this, FG's underwriting rejects at CreateProposal what GetQuote granted. */
const OD_DISCOUNT_LIMIT = 40;

/** Whole-ish years between a registration date and now (0 when unknown). */
function yearsSince(isoDate?: string): number {
  if (!isoDate) return 0;
  const t = Date.parse(isoDate);
  return Number.isNaN(t) ? 0 : (Date.now() - t) / (365.25 * 864e5);
}

/** One label/amount line in the premium breakdown. */
function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 text-sm ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function FgPlansPage() {
  const navigate = useNavigate();
  const category = useFgUatStore((s) => s.category);
  const conditions = useFgUatStore((s) => s.conditions);
  const codes = useFgUatStore((s) => s.providerAddonCodes);
  const exchanges = useFgUatStore((s) => s.exchanges);
  const setAddonCodes = useFgUatStore((s) => s.setAddonCodes);
  const setQuote = useFgUatStore((s) => s.setQuote);
  const recordExchange = useFgUatStore((s) => s.recordExchange);

  const request = useMemo(
    () => (category && conditions ? buildFgQuoteRequest(category, conditions, codes) : null),
    [category, conditions, codes],
  );

  const compare = useCompareQuotesQuery(request);
  const result = compare.data?.[0];
  const quote = result?.status === "success" ? result.quote : undefined;

  const fuelClass = conditions?.fuelType === "electric" ? "electric" : "standard";
  const catalog = useProviderAddons("fg", category ?? "", fuelClass, Boolean(category));
  const vehicleAge = useMemo(
    () => yearsSince(conditions?.registrationDate),
    [conditions?.registrationDate],
  );

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
      response: quote._rawResponse ?? result,
    });
  }, [quote, result, request, setQuote, recordExchange]);

  if (!category || !conditions) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          No conditions captured yet. Start from the beginning.
        </p>
        <Button asChild>
          <Link to={ROUTES.fgUat.start}>Start from /fg</Link>
        </Button>
      </div>
    );
  }

  const toggle = (code: string, on: boolean) =>
    setAddonCodes(toggleAddonSelection(catalog.data ?? [], codes, code, on));

  const odDiscount = quote?.odDiscountPercent;
  const addonLines = quote
    ? Object.entries(quote.addonPremiums).filter(([, amount]) => typeof amount === "number")
    : [];
  const discountLines = quote
    ? Object.entries(quote.discounts).filter(
        ([key, amount]) => key !== "ncbPercent" && typeof amount === "number",
      )
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">
          Quote — {CATEGORY_LABELS[category] ?? category}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[conditions.makeName, conditions.modelName, conditions.variantName]
            .filter(Boolean)
            .join(" ")}{" "}
          · {[conditions.registrationNumber, conditions.rtoCode, conditions.fuelType]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Add-on covers</h2>
        {catalog.isPending ? (
          <p className="text-sm text-muted-foreground">Loading FG&apos;s cover catalogue…</p>
        ) : (catalog.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            FG offers no optional covers for this category and fuel.
          </p>
        ) : (
          <ul className="space-y-2">
            {catalog.data!.map((a) => {
              const tooOld = a.maxAgeYears != null && vehicleAge > a.maxAgeYears;
              // FG's covers are overlapping combos — the rules decide what a tick
              // may do, so an invalid set never reaches CreateProposal.
              const needsZeroDep = !isAddonSelectable(catalog.data ?? [], codes, a);
              const disabled = tooOld || needsZeroDep;
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
                      <span className="font-medium">{a.label}</span>{" "}
                      <span className="text-xs text-muted-foreground">({a.code})</span>
                      {tooOld ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (vehicle is over FG&apos;s {a.maxAgeYears}-year limit for this cover)
                        </span>
                      ) : a.requiresZeroDep ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (needs a Zero-Dep cover)
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Premium</h2>

        {compare.isPending ? (
          <Skeleton className="h-40 w-full rounded-md" />
        ) : compare.isError ? (
          <p className="text-sm text-destructive">
            The quote request itself failed — the backend never answered.
          </p>
        ) : result?.status === "error" ? (
          <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4 shrink-0" /> {result.error?.code}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm text-destructive">
              {result.error?.message}
            </p>
          </div>
        ) : !quote ? (
          <p className="text-sm text-muted-foreground">
            FG returned no quote for these conditions.
          </p>
        ) : (
          <div className="space-y-2">
            <Row label="Own damage" value={formatInr(quote.basicOdPremium)} />
            <Row label="Third party" value={formatInr(quote.thirdPartyPremium)} />
            {addonLines.map(([key, amount]) => (
              <Row
                key={key}
                label={ADDON_LABELS[key as AddonKey] ?? key}
                value={formatInr(amount as number)}
              />
            ))}
            {quote.discounts.ncbPercent != null ? (
              <Row label="NCB applied" value={`${quote.discounts.ncbPercent}%`} />
            ) : null}
            {discountLines.map(([key, amount]) => (
              <Row
                key={key}
                label={DISCOUNT_LABELS[key] ?? key}
                value={`− ${formatInr(amount as number)}`}
              />
            ))}
            <div className="border-t pt-2">
              <Row label="Net premium" value={formatInr(quote.netPremium)} />
              <Row
                label={`GST @ ${quote.serviceTaxPercent}%`}
                value={formatInr(quote.serviceTaxAmount)}
              />
              <Row label="Gross premium" value={formatInr(quote.grossPremium)} strong />
            </div>
            <div className="border-t pt-2">
              <Row label="IDV" value={formatInr(quote.idvValue)} />
              <Row label="Quote number" value={quote.quoteNo} />
            </div>

            {/* FG grants an OD special discount at quote that its own underwriting
                rejects at CreateProposal above ~40%. Surface it BEFORE the tester
                spends a CKYC and a proposal on a premium that can never bind. */}
            <div
              className={`rounded-md border p-3 ${
                (odDiscount ?? 0) > OD_DISCOUNT_LIMIT
                  ? "border-destructive/50 bg-destructive/10"
                  : "bg-muted/30"
              }`}
            >
              <Row
                label="OD special discount"
                value={odDiscount == null ? "not returned" : `${odDiscount}%`}
                strong
              />
              {(odDiscount ?? 0) > OD_DISCOUNT_LIMIT ? (
                <p className="mt-1 flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Above {OD_DISCOUNT_LIMIT}%, FG&apos;s underwriting rejects CreateProposal with
                  &ldquo;Special Discount Percentage&rdquo; even though GetQuote granted it. Expect
                  the proposal to fail.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <Button
        size="lg"
        className="w-full"
        onClick={() => void navigate(ROUTES.fgUat.proposal)}
        disabled={!quote}
      >
        Continue <ArrowRight />
      </Button>

      <RawExchange exchanges={exchanges} />
    </div>
  );
}

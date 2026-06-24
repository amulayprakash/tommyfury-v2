import { formatInr } from "@/lib/utils";
import { ADDON_LABELS, type AddonKey, type CanonicalQuote } from "../api/types";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={
        strong
          ? "flex items-center justify-between border-t pt-2 text-base font-semibold"
          : "flex items-center justify-between text-sm"
      }
    >
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** Premium breakdown (OD / TP / add-ons / discounts / GST / total). */
export function PremiumBreakdown({ quote }: { quote: CanonicalQuote }) {
  const addonEntries = Object.entries(quote.addonPremiums ?? {}).filter(
    ([, amount]) => typeof amount === "number" && amount > 0,
  ) as [AddonKey, number][];

  return (
    <div className="space-y-2">
      {quote.basicOdPremium > 0 ? (
        <Row label="Own Damage (OD)" value={formatInr(quote.basicOdPremium)} />
      ) : null}
      {quote.thirdPartyPremium > 0 ? (
        <Row label="Third Party (TP)" value={formatInr(quote.thirdPartyPremium)} />
      ) : null}

      {addonEntries.map(([key, amount]) => (
        <Row key={key} label={ADDON_LABELS[key] ?? key} value={formatInr(amount)} />
      ))}

      {quote.totalDiscount > 0 ? (
        <Row label="Discounts (incl. NCB)" value={`− ${formatInr(quote.totalDiscount)}`} />
      ) : null}

      <Row label="Net Premium" value={formatInr(quote.netPremium)} />
      <Row
        label={`GST (${quote.serviceTaxPercent}%)`}
        value={formatInr(quote.serviceTaxAmount)}
      />
      <Row label="Total Payable" value={formatInr(quote.grossPremium)} strong />

      {quote.isInspectionRequired ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          A vehicle inspection (break-in) is required before this policy can be issued.
          Payment is collected only after the inspection is approved.
        </p>
      ) : null}
    </div>
  );
}

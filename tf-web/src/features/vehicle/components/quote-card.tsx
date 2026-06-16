import { AlertCircle, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatInr } from "@/lib/utils";
import type { CompareResult } from "../api/types";

interface QuoteCardProps {
  result: CompareResult;
  selected: boolean;
  onSelect: (result: CompareResult) => void;
}

/** A single vendor's quote in the compare list. */
export function QuoteCard({ result, selected, onSelect }: QuoteCardProps) {
  const name = result.quote?.insurerName ?? result.displayName;

  return (
    <Card className={cn("transition-colors", selected && "border-primary ring-1 ring-primary")}>
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          {result.status === "success" && result.quote ? (
            <p className="text-xs text-muted-foreground">
              OD {formatInr(result.quote.basicOdPremium)} · TP{" "}
              {formatInr(result.quote.thirdPartyPremium)}
            </p>
          ) : result.status === "no_quote" ? (
            <p className="text-xs text-muted-foreground">No quote for this selection</p>
          ) : (
            <p className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="size-3" /> {result.error?.message ?? "Unavailable"}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {result.status === "success" && result.quote ? (
            <>
              <div className="text-right">
                <p className="font-display text-lg font-semibold">
                  {formatInr(result.quote.grossPremium)}
                </p>
                <p className="text-[11px] text-muted-foreground">incl. GST</p>
              </div>
              <Button
                size="sm"
                variant={selected ? "default" : "outline"}
                onClick={() => onSelect(result)}
              >
                {selected ? (
                  <>
                    <Check /> Selected
                  </>
                ) : (
                  "Select"
                )}
              </Button>
            </>
          ) : (
            <span className="text-sm font-medium text-muted-foreground">N/A</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

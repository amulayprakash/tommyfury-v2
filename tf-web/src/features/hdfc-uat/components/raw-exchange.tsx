import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { HdfcExchange } from "../hdfc-uat-store";

/**
 * The actual request and response of every vendor call in this journey.
 *
 * The store has recorded these since the plans page; until now nothing showed
 * them. That is the whole point of a certification harness: when HDFC refuses a
 * proposal, the tester reads HDFC's own payload off this drawer and sends it on,
 * rather than asking us to pull backend logs.
 *
 * Mirrors `features/fg-uat/components/raw-exchange.tsx` — the two harnesses are
 * meant to look like siblings.
 */
export function RawExchange({ exchanges }: { exchanges: HdfcExchange[] }) {
  const [open, setOpen] = useState(false);
  if (exchanges.length === 0) return null;

  const copy = () => {
    void navigator.clipboard.writeText(JSON.stringify(exchanges, null, 2));
  };

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between p-3">
        <button
          type="button"
          className="text-sm font-medium underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Show"} raw request / response ({exchanges.length})
        </button>
        {open ? (
          <Button variant="outline" size="sm" onClick={copy}>
            Copy JSON
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-4 border-t p-3">
          {exchanges.map((e, i) => (
            <div key={`${e.step}-${i}`} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {e.step} · {e.at}
              </p>
              <div>
                <p className="text-xs font-medium">Request</p>
                <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(e.request, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-xs font-medium">Response</p>
                <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(e.response, null, 2)}
                </pre>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const WIZARD_STEPS = ["Vehicle", "Plans", "Details", "Review", "Payment"] as const;

/** Compact progress indicator shown at the top of each wizard page. */
export function WizardSteps({ current }: { current: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2 text-xs font-medium">
      {WIZARD_STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "border-border text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "hidden sm:inline",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
            {i < WIZARD_STEPS.length - 1 ? (
              <span className={cn("h-px flex-1", done ? "bg-primary" : "bg-border")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

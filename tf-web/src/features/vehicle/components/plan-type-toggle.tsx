import { cn } from "@/lib/utils";
import { POLICY_TYPE_TABS, type PolicyType } from "../api/types";

/** Canonical display order for the tp / od / comprehensive toggle. */
const ORDER: PolicyType[] = ["thirdParty", "standAloneOD", "comprehensive"];

interface PlanTypeToggleProps {
  value: PolicyType;
  available: PolicyType[];
  onChange: (value: PolicyType) => void;
}

/** Segmented control gated by the categories supported across all vendors. */
export function PlanTypeToggle({ value, available, onChange }: PlanTypeToggleProps) {
  const options = ORDER.filter((p) => available.includes(p));
  if (options.length === 0) return null;

  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            value === option
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {POLICY_TYPE_TABS[option]}
        </button>
      ))}
    </div>
  );
}

import { Input } from "@/components/ui/input";
import { formatInr } from "@/lib/utils";

interface IdvControlProps {
  value: number | null;
  min?: number;
  max?: number;
  onChange: (value: number | null) => void;
}

/**
 * Insured Declared Value control. When the vendor returns bounds a slider is
 * shown; otherwise it falls back to a free numeric input (blank → vendor default).
 */
export function IdvControl({ value, min, max, onChange }: IdvControlProps) {
  const hasRange = typeof min === "number" && typeof max === "number" && max > min;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Insured Declared Value (IDV)</span>
        <span className="font-display text-base font-semibold">
          {value ? formatInr(value) : "Auto"}
        </span>
      </div>

      {hasRange ? (
        <>
          <input
            type="range"
            min={min}
            max={max}
            step={1000}
            value={value ?? min}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatInr(min!)}</span>
            <span>{formatInr(max!)}</span>
          </div>
        </>
      ) : (
        <Input
          type="number"
          inputMode="numeric"
          placeholder="Use vendor default"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        />
      )}
    </div>
  );
}

import { useState } from "react";

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
 *
 * **`onChange` fires when the user finishes choosing, not while they choose.**
 * Both pages that mount this control feed `onChange` straight into the compare
 * request, so every emitted value is a live premium call at the insurer. Emitting
 * per drag tick meant one slider sweep fired dozens of them: the page flickered
 * through a re-quote per step, and on the HDFC harness a shared vendor sandbox
 * absorbed the whole burst. The typed fallback was worse — a six-digit IDV cost
 * six round trips, one per keystroke.
 *
 * So the displayed number tracks the input continuously (the user has to see what
 * they are picking) while the committed value waits for the gesture to end:
 * pointer release, key release, or blur. `commit()` also drops a no-op — a click
 * on the thumb that moves nothing, or a blur after no edit, must not re-price.
 */
export function IdvControl({ value, min, max, onChange }: IdvControlProps) {
  const hasRange = typeof min === "number" && typeof max === "number" && max > min;

  // What the user sees mid-gesture. Re-synced whenever a new value arrives from
  // outside (a fresh quote moves the bounds and the recommended IDV with them),
  // using React's documented render-phase adjustment rather than an effect, so
  // the slider never paints a stale position for a frame.
  const [draft, setDraft] = useState<number | null>(value);
  const [seenValue, setSeenValue] = useState<number | null>(value);
  if (value !== seenValue) {
    setSeenValue(value);
    setDraft(value);
  }

  const commit = (): void => {
    if (draft !== value) onChange(draft);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Insured Declared Value (IDV)</span>
        <span className="font-display text-base font-semibold">
          {draft ? formatInr(draft) : "Auto"}
        </span>
      </div>

      {hasRange ? (
        <>
          <input
            type="range"
            min={min}
            max={max}
            step={1000}
            value={draft ?? min}
            // React maps onChange to the `input` event: continuous during a drag.
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
            // Touch drags on iOS can end without a pointerup reaching the input.
            onTouchEnd={commit}
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
          value={draft ?? ""}
          onChange={(e) => setDraft(e.target.value ? Number(e.target.value) : null)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      )}
    </div>
  );
}

import { ADDON_LABELS, ALL_ADDON_KEYS, type AddonKey } from "../api/types";

interface AddonSelectorProps {
  /** Add-ons supported by at least one eligible vendor for this category. */
  available: AddonKey[];
  selected: Partial<Record<AddonKey, boolean>>;
  onToggle: (key: AddonKey, on: boolean) => void;
}

/** Checkbox list of add-ons, gated by the backend capability matrix. */
export function AddonSelector({ available, selected, onToggle }: AddonSelectorProps) {
  const keys = ALL_ADDON_KEYS.filter((k) => available.includes(k));
  if (keys.length === 0) {
    return <p className="text-sm text-muted-foreground">No add-ons available for this selection.</p>;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {keys.map((key) => (
        <label
          key={key}
          className="flex cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
        >
          <input
            type="checkbox"
            checked={Boolean(selected[key])}
            onChange={(e) => onToggle(key, e.target.checked)}
            className="size-4 accent-primary"
          />
          <span>{ADDON_LABELS[key]}</span>
        </label>
      ))}
    </div>
  );
}

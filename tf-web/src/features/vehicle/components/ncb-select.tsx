const NCB_OPTIONS = [0, 20, 25, 35, 45, 50];

interface NcbSelectProps {
  value: number;
  onChange: (value: number) => void;
}

/** No Claim Bonus percentage selector (slabs mirror the IRDAI grid). */
export function NcbSelect({ value, onChange }: NcbSelectProps) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">No Claim Bonus (NCB)</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {NCB_OPTIONS.map((pct) => (
          <option key={pct} value={pct}>
            {pct === 0 ? "No NCB (0%)" : `${pct}%`}
          </option>
        ))}
      </select>
    </label>
  );
}

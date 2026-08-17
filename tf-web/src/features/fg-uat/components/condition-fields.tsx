import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { COMMERCIAL_SUBTYPE_LABELS, type CommercialSubType } from "../../vehicle/api/types";
import type { FgConditions } from "../fg-uat-store";

/**
 * The policy conditions the FG certification cases vary, grouped so the vehicle
 * page can show or hide each block independently (previous TP only matters on a
 * standalone OD, the commercial block only on a commercial category).
 *
 * The customer wizard derives most of these from the RC lookup and the chosen
 * quote. Here every one is typed by hand: a tester has to be able to set up a
 * break-in, a >90-day NCB denial or an ownership transfer without first finding
 * a real vehicle that happens to be in that state.
 */

export const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface GroupProps {
  conditions: FgConditions;
  onChange: (patch: Partial<FgConditions>) => void;
}

/** Labelled form row — the same `label > span + control` shape the wizard uses. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/** Checkbox row (the label sits beside the box, not above it). */
export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-input"
      />
      {label}
    </label>
  );
}

/** Section wrapper — one bordered block per condition group. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border p-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** "" for an unset number, so the input stays empty rather than showing 0. */
const numText = (n: number | undefined) => (n === undefined ? "" : String(n));
const numValue = (raw: string) => (raw === "" ? undefined : Number(raw));

export function PreviousPolicyFields({ conditions, onChange }: GroupProps) {
  return (
    <Group title="Previous policy">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Previous insurer">
          <Input
            value={conditions.previousInsurerName}
            onChange={(e) => onChange({ previousInsurerName: e.target.value })}
            placeholder="e.g. Future Generali India Insurance"
          />
        </Field>
        <Field label="Previous policy number">
          <Input
            value={conditions.previousPolicyNumber}
            onChange={(e) => onChange({ previousPolicyNumber: e.target.value })}
            placeholder="e.g. 2025-1234567890"
          />
        </Field>
        <Field label="Policy start date">
          <DateInput
            value={conditions.previousPolicyStartDate}
            onChange={(iso) => onChange({ previousPolicyStartDate: iso })}
          />
        </Field>
        <Field label="Policy expiry date">
          <DateInput
            value={conditions.previousPolicyExpiryDate}
            onChange={(iso) => onChange({ previousPolicyExpiryDate: iso })}
          />
        </Field>
      </div>
      <CheckField
        label="Previous policy has already expired (break-in)"
        checked={conditions.isPreviousPolicyExpired}
        onChange={(isPreviousPolicyExpired) => onChange({ isPreviousPolicyExpired })}
      />
    </Group>
  );
}

/** Standalone OD needs the still-running TP policy it sits alongside. */
export function PreviousTpFields({ conditions, onChange }: GroupProps) {
  return (
    <Group title="Previous third-party policy">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="TP policy number">
          <Input
            value={conditions.previousTpPolicyNumber ?? ""}
            onChange={(e) => onChange({ previousTpPolicyNumber: e.target.value })}
            placeholder="e.g. 2023-9876543210"
          />
        </Field>
        <Field label="TP start date">
          <DateInput
            value={conditions.previousTpStartDate}
            onChange={(iso) => onChange({ previousTpStartDate: iso })}
          />
        </Field>
        <Field label="TP expiry date">
          <DateInput
            value={conditions.previousTpExpiryDate}
            onChange={(iso) => onChange({ previousTpExpiryDate: iso })}
          />
        </Field>
      </div>
    </Group>
  );
}

export function NcbClaimFields({ conditions, onChange }: GroupProps) {
  return (
    <Group title="NCB & claims">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Existing NCB (%)">
          <Input
            type="number"
            inputMode="numeric"
            value={String(conditions.ncbPercent)}
            onChange={(e) => onChange({ ncbPercent: Number(e.target.value) || 0 })}
            placeholder="0, 20, 25, 35, 45, 50"
          />
        </Field>
        <div className="flex items-end pb-2">
          <CheckField
            label="Claim made in previous policy"
            checked={conditions.claimInPreviousPolicy}
            onChange={(claimInPreviousPolicy) => onChange({ claimInPreviousPolicy })}
          />
        </div>
      </div>
    </Group>
  );
}

/** Break-in cases quote only once FG has an accepted pre-inspection on file. */
export function BreakInFields({ conditions, onChange }: GroupProps) {
  return (
    <Group title="Break-in inspection">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Inspection report number">
          <Input
            value={conditions.inspectionReportNumber ?? ""}
            onChange={(e) => onChange({ inspectionReportNumber: e.target.value })}
            placeholder="LiveChek reference"
          />
        </Field>
        <Field label="Inspection date">
          <DateInput
            value={conditions.inspectionDate}
            onChange={(iso) => onChange({ inspectionDate: iso })}
          />
        </Field>
      </div>
    </Group>
  );
}

/**
 * Compulsory personal-accident cover for the owner-driver. It is on by default —
 * sending it off would suppress a compulsory cover on every certification quote —
 * so only the exclusion case unticks it.
 */
export function CpaFields({ conditions, onChange }: GroupProps) {
  return (
    <Group title="Owner-driver PA cover">
      <CheckField
        label="Compulsory PA cover for owner-driver"
        checked={conditions.paOwner}
        onChange={(paOwner) => onChange({ paOwner })}
      />
      <p className="text-xs text-muted-foreground">
        Untick to exercise the exclusion case — the owner already holds a personal-accident policy
        elsewhere.
      </p>
    </Group>
  );
}

export function CommercialFields({ conditions, onChange }: GroupProps) {
  return (
    <Group title="Commercial vehicle">
      <Field label="Vehicle type">
        <select
          value={conditions.commercialSubType ?? "goods"}
          onChange={(e) => onChange({ commercialSubType: e.target.value as CommercialSubType })}
          className={SELECT_CLASS}
        >
          {Object.entries(COMMERCIAL_SUBTYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Gross vehicle weight (kg)">
          <Input
            type="number"
            inputMode="numeric"
            value={numText(conditions.grossVehicleWeight)}
            onChange={(e) => onChange({ grossVehicleWeight: numValue(e.target.value) })}
            placeholder="e.g. 7500"
          />
        </Field>
        <Field label="Seating capacity">
          <Input
            type="number"
            inputMode="numeric"
            value={numText(conditions.seatingCapacity)}
            onChange={(e) => onChange({ seatingCapacity: numValue(e.target.value) })}
            placeholder="e.g. 2"
          />
        </Field>
        <Field label="Carrying capacity (kg)">
          <Input
            type="number"
            inputMode="numeric"
            value={numText(conditions.carryingCapacity)}
            onChange={(e) => onChange({ carryingCapacity: numValue(e.target.value) })}
            placeholder="e.g. 3000"
          />
        </Field>
      </div>
    </Group>
  );
}

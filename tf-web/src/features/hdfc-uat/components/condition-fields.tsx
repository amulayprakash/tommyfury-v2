import { AlertTriangle } from "lucide-react";

import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import type { CompareQuotesRequest } from "../../vehicle/api/types";
import { HDFC_RELATION_MASTER } from "../hdfc-relation-master";
import type { HdfcConditions, HdfcProposer } from "../hdfc-uat-store";

/**
 * The policy conditions HDFC's certification scenarios vary, grouped so the
 * vehicle page can show or hide each block independently (the previous TP block
 * only matters on a standalone OD).
 *
 * The customer wizard derives most of these from the RC lookup and the chosen
 * quote. Here every one is typed by hand: a tester has to be able to set up a
 * break-in, a used-car purchase or a 1+3 new-business term without first finding
 * a real vehicle that happens to be in that state.
 */

export const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface GroupProps {
  conditions: HdfcConditions;
  onChange: (patch: Partial<HdfcConditions>) => void;
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

/**
 * A condition group that starts collapsed.
 *
 * Nothing here is needed to reach a policy number — these are the inputs the
 * certification PACK turns on (accessories, used-car, the standalone-OD
 * third-party leg) and they are empty or defaulted on an ordinary issuance run.
 * Left expanded they buried the eight fields that actually matter. Collapsed
 * they are one click away, which is the difference between a form you scroll
 * past and a capability you lose.
 *
 * `<details>` rather than state: it survives re-render, works without JS, and is
 * keyboard-navigable for free. Same choice as `RawExchange`.
 */
export function AdvancedGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer p-3 text-sm font-semibold marker:text-muted-foreground">
        {title}
        <span className="ml-2 font-normal text-muted-foreground">{hint}</span>
      </summary>
      <div className="space-y-3 border-t p-3">{children}</div>
    </details>
  );
}

/** "" for an unset number, so the input stays empty rather than showing 0. */
const numText = (n: number | undefined) => (n === undefined ? "" : String(n));
const numValue = (raw: string) => (raw === "" ? undefined : Number(raw));

/**
 * A preset's warning, shown BEFORE the tester fires the request rather than
 * after HDFC refuses it.
 *
 * The break-in scenario is the reason this exists: HDFC quotes it happily —
 * break-in loading, inspection flag and all — and then refuses the proposal with
 * "Break-in ID required", for which its kit ships no endpoint. A tester who
 * learns that three steps later has spent a KYC and a proposal finding out
 * something we already know.
 */
export function PresetWarning({ warning }: { warning: string | undefined }) {
  if (!warning) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-400/70 bg-amber-50 p-3 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">Before you run this: </span>
        {warning}
      </p>
    </div>
  );
}

/**
 * Nominee identity. It lives beside the conditions rather than on the proposal
 * page because the relation is a condition HDFC validates, and a tester setting
 * up a scenario should be able to state it in the same place as everything else.
 *
 * The relation is a `<select>` over HDFC's RELATION MASTER, never free text —
 * see `../hdfc-relation-master.ts` for the live rejection that settled it.
 */
export function NomineeFields({
  proposer,
  onChange,
}: {
  proposer: HdfcProposer;
  onChange: (patch: Partial<HdfcProposer>) => void;
}) {
  return (
    <Group title="Nominee">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Nominee name">
          <Input
            value={proposer.nomineeName}
            onChange={(e) => onChange({ nomineeName: e.target.value })}
            placeholder="e.g. Test Nominee"
          />
        </Field>
        <Field label="Relation to proposer">
          <select
            value={proposer.nomineeRelation}
            onChange={(e) => onChange({ nomineeRelation: e.target.value })}
            className={SELECT_CLASS}
          >
            {HDFC_RELATION_MASTER.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nominee age">
          <Input
            type="number"
            inputMode="numeric"
            value={String(proposer.nomineeAge)}
            onChange={(e) => onChange({ nomineeAge: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Chosen from HDFC&apos;s RELATION MASTER, which it matches case-sensitively — &ldquo;Police
        Holder&rdquo; is HDFC&apos;s own spelling of the policyholder.
      </p>
    </Group>
  );
}

export function PreviousPolicyFields({ conditions, onChange }: GroupProps) {
  return (
    <Group title="Previous policy">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Previous policy number">
          <Input
            value={conditions.previousPolicyNumber}
            onChange={(e) => onChange({ previousPolicyNumber: e.target.value })}
            placeholder="e.g. PREVPOL0001"
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
      <p className="text-xs text-muted-foreground">
        Keep the expiry in the FUTURE for an ordinary rollover. A policy that lapsed yesterday is a
        break-in, and HDFC answers CreateProposal with &ldquo;Break-in ID required&rdquo;.
      </p>
    </Group>
  );
}

/**
 * The previous insurer, which a policy does NOT need to bind.
 *
 * Only 8 of HDFC's 38 insurer short-names cross-walk to our master, so this is
 * blank on most real rollovers and the backend correctly sends null rather than
 * inventing a code. Left visible it looked mandatory.
 */
export function PreviousInsurerFields({ conditions, onChange }: GroupProps) {
  return (
    <AdvancedGroup title="Previous insurer" hint="optional — sent as null when blank">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* The short name from the kit's Insurance_Company master (e.g. TATAAIG),
            not a display name — the backend maps this straight onto HDFC's
            PreviousPolicy_INSURER / _TPINSURER. */}
        <Field label="Previous insurer code">
          <Input
            value={conditions.previousInsurerId}
            onChange={(e) => onChange({ previousInsurerId: e.target.value.toUpperCase() })}
            placeholder="e.g. TATAAIG"
          />
        </Field>
        <Field label="Previous insurer name">
          <Input
            value={conditions.previousInsurerName}
            onChange={(e) => onChange({ previousInsurerName: e.target.value })}
            placeholder="e.g. Tata AIG"
          />
        </Field>
      </div>
    </AdvancedGroup>
  );
}

/** Standalone OD needs the still-running TP policy it sits alongside. */
export function PreviousTpFields({ conditions, onChange }: GroupProps) {
  return (
    <AdvancedGroup title="Previous third-party policy" hint="standalone OD only">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="TP policy number">
          <Input
            value={conditions.previousTpPolicyNumber ?? ""}
            onChange={(e) => onChange({ previousTpPolicyNumber: e.target.value })}
            placeholder="e.g. TPPOL0001"
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
      <p className="text-xs text-muted-foreground">
        Name the previous insurer above too: with none, HDFC refuses the standalone OD proposal with
        &ldquo;Valid TP policy is required to book SAOD Policy.&rdquo;
      </p>
    </AdvancedGroup>
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

/** The bi-fuel kit types the canonical contract accepts. */
const BIFUEL_KIT_TYPES: NonNullable<CompareQuotesRequest["bifuelKitType"]>[] = [
  "NA",
  "CNG",
  "LPG",
  "FactoryFittedCNG",
  "FactoryFittedLPG",
];

/**
 * Declared sums that price separately from the vehicle's own IDV.
 *
 * `unnamedPaSumInsured` is here rather than with the add-ons because the
 * `paUnnamedPassenger` flag alone prices nothing at HDFC — it needs its own sum
 * insured, which is why the "all covers" scenario carries ₹2,00,000.
 */
export function AccessoryFields({ conditions, onChange }: GroupProps) {
  return (
    <AdvancedGroup
      title="Accessories, bi-fuel & unnamed PA"
      hint="all default to nil — pack rows 25–26"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Electrical accessories sum insured (₹)">
          <Input
            type="number"
            inputMode="numeric"
            value={numText(conditions.electricalAccessoriesSI)}
            onChange={(e) => onChange({ electricalAccessoriesSI: numValue(e.target.value) })}
            placeholder="Leave blank for none"
          />
        </Field>
        <Field label="Non-electrical accessories sum insured (₹)">
          <Input
            type="number"
            inputMode="numeric"
            value={numText(conditions.nonElectricalAccessoriesSI)}
            onChange={(e) => onChange({ nonElectricalAccessoriesSI: numValue(e.target.value) })}
            placeholder="Leave blank for none"
          />
        </Field>
        <Field label="Bi-fuel kit type">
          <select
            value={conditions.bifuelKitType ?? ""}
            onChange={(e) => onChange({ bifuelKitType: e.target.value || undefined })}
            className={SELECT_CLASS}
          >
            <option value="">None</option>
            {BIFUEL_KIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bi-fuel kit sum insured (₹)">
          <Input
            type="number"
            inputMode="numeric"
            value={numText(conditions.bifuelKitSI)}
            onChange={(e) => onChange({ bifuelKitSI: numValue(e.target.value) })}
            placeholder="Leave blank for none"
          />
        </Field>
        <Field label="Unnamed passenger PA sum insured (₹)">
          <Input
            type="number"
            inputMode="numeric"
            value={numText(conditions.unnamedPaSumInsured)}
            onChange={(e) => onChange({ unnamedPaSumInsured: numValue(e.target.value) })}
            placeholder="e.g. 200000"
          />
        </Field>
      </div>
    </AdvancedGroup>
  );
}

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Field, SELECT_CLASS } from "../components/condition-fields";
import { RawExchange } from "../components/raw-exchange";
import { useFgUatStore, type FgProposer } from "../fg-uat-store";

/**
 * Step 4 of the FG certification harness — the proposer FG's CreateProposal
 * builds its Client block from.
 *
 * Prefilled with an identity that is known to clear FG's client creation, but
 * every field stays editable: the CKYC failure case (TC_37) needs a PAN and DOB
 * that deliberately do not match.
 */
export function FgProposalPage() {
  const navigate = useNavigate();
  const stored = useFgUatStore((s) => s.proposer);
  const exchanges = useFgUatStore((s) => s.exchanges);
  const setProposer = useFgUatStore((s) => s.setProposer);

  const [proposer, setLocal] = useState<FgProposer>(stored);
  const patch = (p: Partial<FgProposer>) => setLocal((c) => ({ ...c, ...p }));

  const onContinue = () => {
    setProposer(proposer);
    void navigate(ROUTES.fgUat.kyc);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Proposer details</h1>
        <p className="text-sm text-muted-foreground">
          These become FG&apos;s Client block at CreateProposal, and the identity CKYC is matched
          against on the next step.
        </p>
      </div>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Proposer</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input
              value={proposer.firstName}
              onChange={(e) => patch({ firstName: e.target.value })}
              placeholder="e.g. Rahul"
            />
          </Field>
          <Field label="Last name">
            <Input
              value={proposer.lastName}
              onChange={(e) => patch({ lastName: e.target.value })}
              placeholder="e.g. Sharma"
            />
          </Field>
          <Field label="Date of birth">
            <DateInput value={proposer.dob} onChange={(iso) => patch({ dob: iso })} />
          </Field>
          <Field label="Gender">
            <select
              value={proposer.gender}
              onChange={(e) => patch({ gender: e.target.value as FgProposer["gender"] })}
              className={SELECT_CLASS}
            >
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </Field>
          <Field label="Mobile">
            <Input
              value={proposer.mobile}
              onChange={(e) => patch({ mobile: e.target.value.replace(/\D/g, "") })}
              placeholder="10 digits"
              inputMode="numeric"
              maxLength={10}
            />
          </Field>
          <Field label="Email">
            <Input
              value={proposer.email}
              onChange={(e) => patch({ email: e.target.value })}
              placeholder="e.g. rahul.sharma@example.com"
              autoComplete="off"
            />
          </Field>
          <Field label="PAN">
            <Input
              value={proposer.panNumber}
              onChange={(e) => patch({ panNumber: e.target.value.toUpperCase() })}
              placeholder="ABCDE1234F"
              maxLength={10}
              className="uppercase"
            />
          </Field>
        </div>
        {/* FG's own quirk, surfaced before the tester spends a proposal on it. */}
        <p className="text-xs text-muted-foreground">
          FG&apos;s CreateProposal rejects the sequential dummy mobile 9876543210 with
          &ldquo;Mobile number is missing or invalid for the entered client&rdquo;. Use any other
          10-digit number.
        </p>
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Address</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Address line 1">
            <Input
              value={proposer.addressLine1}
              onChange={(e) => patch({ addressLine1: e.target.value })}
              placeholder="Flat / building / street"
            />
          </Field>
          <Field label="Address line 2">
            <Input
              value={proposer.addressLine2}
              onChange={(e) => patch({ addressLine2: e.target.value })}
              placeholder="Locality"
            />
          </Field>
          <Field label="Pincode">
            <Input
              value={proposer.pincode}
              onChange={(e) => patch({ pincode: e.target.value.replace(/\D/g, "") })}
              placeholder="e.g. 400051"
              inputMode="numeric"
              maxLength={6}
            />
          </Field>
          <Field label="City">
            <Input
              value={proposer.city}
              onChange={(e) => patch({ city: e.target.value })}
              placeholder="e.g. Mumbai"
            />
          </Field>
          <Field label="State">
            <Input
              value={proposer.state}
              onChange={(e) => patch({ state: e.target.value })}
              placeholder="e.g. Maharashtra"
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Nominee</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nominee name">
            <Input
              value={proposer.nomineeName}
              onChange={(e) => patch({ nomineeName: e.target.value })}
              placeholder="e.g. Sunita Sharma"
            />
          </Field>
          <Field label="Nominee relation">
            <Input
              value={proposer.nomineeRelation}
              onChange={(e) => patch({ nomineeRelation: e.target.value })}
              placeholder="e.g. spouse"
            />
          </Field>
          <Field label="Nominee age">
            <Input
              type="number"
              inputMode="numeric"
              value={String(proposer.nomineeAge)}
              onChange={(e) => patch({ nomineeAge: Number(e.target.value) || 0 })}
              placeholder="e.g. 34"
            />
          </Field>
        </div>
      </section>

      <Button size="lg" className="w-full" onClick={onContinue}>
        Continue to CKYC <ArrowRight />
      </Button>

      <RawExchange exchanges={exchanges} />
    </div>
  );
}

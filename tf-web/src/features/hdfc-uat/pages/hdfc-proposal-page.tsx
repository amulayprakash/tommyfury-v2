import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Field, NomineeFields, SELECT_CLASS } from "../components/condition-fields";
import { RawExchange } from "../components/raw-exchange";
import { useHdfcUatStore, type HdfcProposer } from "../hdfc-uat-store";

/**
 * Step 4 of the HDFC certification harness — the proposer HDFC's CreateProposal
 * builds its Customer_Details block from.
 *
 * Prefilled with the identity the six scenarios in
 * `tf-api/scripts/hdfc-uat-issuance.ts` bound live, so a tester who changes
 * nothing walks a path that is already proven. Every field stays editable
 * anyway: certification cases turn on the identity as much as on the vehicle.
 *
 * The PAN typed here is what the next step sends to Pehchaan. Be aware that
 * HDFC's UAT e-KYC hands back a POOLED test identity that need NOT match the PAN
 * submitted, and the proposal then carries the identity KYC returned rather than
 * the name typed here — the KYC step says so on screen and overwrites the name
 * and date of birth below when it happens.
 *
 * The nominee block is `NomineeFields`, shared with the vehicle step, so the
 * relation is the same `<select>` over HDFC's RELATION MASTER in both places —
 * one list, one source of truth (`../hdfc-relation-master.ts`).
 */
export function HdfcProposalPage() {
  const navigate = useNavigate();
  const stored = useHdfcUatStore((s) => s.proposer);
  const exchanges = useHdfcUatStore((s) => s.exchanges);
  const setProposer = useHdfcUatStore((s) => s.setProposer);

  const [proposer, setLocal] = useState<HdfcProposer>(stored);
  const patch = (p: Partial<HdfcProposer>) => setLocal((c) => ({ ...c, ...p }));

  const onContinue = () => {
    setProposer(proposer);
    void navigate(ROUTES.hdfcUat.kyc);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Proposer details</h1>
        <p className="text-sm text-muted-foreground">
          These become HDFC&apos;s Customer_Details block at CreateProposal, and the PAN the next
          step puts to Pehchaan e-KYC.
        </p>
      </div>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Proposer</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input
              value={proposer.firstName}
              onChange={(e) => patch({ firstName: e.target.value })}
              placeholder="e.g. Test"
            />
          </Field>
          <Field label="Last name">
            <Input
              value={proposer.lastName}
              onChange={(e) => patch({ lastName: e.target.value })}
              placeholder="e.g. User"
            />
          </Field>
          <Field label="Date of birth">
            {/* dd/mm/yyyy on screen, ISO in state — never a native date input,
                which renders in the browser's locale rather than the page's. */}
            <DateInput value={proposer.dob} onChange={(iso) => patch({ dob: iso })} />
          </Field>
          <Field label="Gender">
            <select
              value={proposer.gender}
              onChange={(e) => patch({ gender: e.target.value as HdfcProposer["gender"] })}
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
              placeholder="e.g. uat@example.com"
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
        <p className="text-xs text-muted-foreground">
          The PAN is what Pehchaan is asked about on the next step. On HDFC&apos;s UAT it returns a
          pooled test identity that need not match it, and the proposal is built from what KYC
          returned — so do not be surprised to see a different name after the KYC step.
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
              placeholder="e.g. 400069"
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

      {/* The same component the vehicle step uses, rather than a third copy of
          HDFC's RELATION MASTER: it is a `<select>` over that list because a live
          CreateProposal carrying "spouse" was rejected while "Spouse" bound. */}
      <NomineeFields proposer={proposer} onChange={patch} />

      <Button size="lg" className="w-full" onClick={onContinue}>
        Continue to e-KYC <ArrowRight />
      </Button>

      <RawExchange exchanges={exchanges} />
    </div>
  );
}

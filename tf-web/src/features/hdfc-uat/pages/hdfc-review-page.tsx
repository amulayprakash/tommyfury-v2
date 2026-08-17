import axios from "axios";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { isoToDisplay } from "@/components/ui/date-input";
import { apiErrorCode, apiErrorMessage } from "@/lib/api/error-message";
import { formatInr } from "@/lib/utils";
import { useFullQuote } from "../../vehicle/api/hooks";
import type { PolicyType } from "../../vehicle/api/types";
import { POLICY_TYPE_LABELS } from "../../vehicle/api/types";
import { buildHdfcFullQuoteRequest, HDFC_SLUG } from "../build-hdfc-request";
import { RawExchange } from "../components/raw-exchange";
import { useHdfcUatStore } from "../hdfc-uat-store";

/**
 * Step 6 of the HDFC certification harness — the last look at what
 * CreateProposal will carry, and the call itself.
 *
 * HDFC re-rates the proposal from the payload it receives rather than from the
 * quote it priced, which is why the request is rebuilt by
 * `buildHdfcFullQuoteRequest` from the very conditions the quote was priced
 * under rather than assembled by hand here. A second, hand-built copy that
 * drifted would quietly change the premium — and then be rejected at issuance
 * for not matching the receipt.
 *
 * Whatever HDFC answers is shown as they wrote it. This is where
 * "Break-in ID required" appears for the break-in preset: HDFC quotes a break-in
 * happily and refuses the proposal, and its kit ships no endpoint that issues
 * such an id. That is a certification finding, and it has to be readable as
 * HDFC's own sentence, not as "something went wrong".
 */

/** What we know about a rejected proposal — ours and HDFC's, kept apart. */
interface ProposalFailure {
  httpStatus?: number;
  code?: string;
  message: string;
  /** HDFC's raw error section, untouched. */
  vendor?: unknown;
}

/** Unpacks the vendor-API error envelope, keeping HDFC's own payload intact. */
function toFailure(err: unknown): ProposalFailure {
  const response = axios.isAxiosError(err) ? err.response : undefined;
  const data = response?.data as { error?: { details?: unknown } } | undefined;
  return {
    httpStatus: response?.status,
    code: apiErrorCode(err),
    message: apiErrorMessage(err, "The proposal call failed before HDFC answered."),
    vendor: data?.error?.details,
  };
}

/** One label/value line of the pre-flight summary. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

export function HdfcReviewPage() {
  const navigate = useNavigate();
  const category = useHdfcUatStore((s) => s.category);
  const conditions = useHdfcUatStore((s) => s.conditions);
  const proposer = useHdfcUatStore((s) => s.proposer);
  const codes = useHdfcUatStore((s) => s.providerAddonCodes);
  const quote = useHdfcUatStore((s) => s.quote);
  const ckyc = useHdfcUatStore((s) => s.ckyc);
  const kycRefId = useHdfcUatStore((s) => s.kycRefId);
  const exchanges = useHdfcUatStore((s) => s.exchanges);
  const setProposal = useHdfcUatStore((s) => s.setProposal);
  const setProposalNumber = useHdfcUatStore((s) => s.setProposalNumber);
  const recordExchange = useHdfcUatStore((s) => s.recordExchange);

  const fullQuote = useFullQuote();
  const [failure, setFailure] = useState<ProposalFailure | null>(null);

  // `category` rides along with the conditions — it is chosen on the first step
  // and the quote could not exist without it.
  if (!conditions || !quote || !category) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          No priced quote captured yet — CreateProposal has nothing to bind.
        </p>
        <Button asChild>
          <Link to={ROUTES.hdfcUat.start}>Start from /hdfc</Link>
        </Button>
      </div>
    );
  }

  // The id the proposal is keyed off: HDFC's own TransactionID where the vendor
  // returned one, else the quote number.
  const quoteId = quote.transactionId ?? quote.quoteNo;

  const submit = () => {
    const req = buildHdfcFullQuoteRequest(category, conditions, proposer, codes, {
      quoteId,
      kycRefId,
      ckyc,
    });

    setFailure(null);
    fullQuote.mutate(
      { provider: HDFC_SLUG, req },
      {
        onSuccess: (result) => {
          setProposal(result);
          // HDFC's Proposal_Number, which issuance sends back as `quoteNo`.
          const contract = result.contractDetails ?? {};
          const proposalNumber =
            typeof contract.proposalNumber === "string" && contract.proposalNumber
              ? contract.proposalNumber
              : (result.quoteNo ?? null);
          setProposalNumber(proposalNumber);
          recordExchange({
            step: "CreateProposal",
            at: new Date().toISOString(),
            request: req,
            response: result._rawResponse ?? result,
          });
          void navigate(ROUTES.hdfcUat.payment);
        },
        onError: (err) => {
          // A rejection is evidence too — it goes in the drawer beside the
          // successes, with HDFC's payload rather than a summary of it.
          const detail = toFailure(err);
          setFailure(detail);
          recordExchange({
            step: "CreateProposal",
            at: new Date().toISOString(),
            request: req,
            response: detail,
          });
        },
      },
    );
  };

  const planLabel = POLICY_TYPE_LABELS[conditions.planType as PolicyType] ?? conditions.planType;
  const period =
    quote.policyStartDate && quote.policyEndDate
      ? `${isoToDisplay(quote.policyStartDate)} — ${isoToDisplay(quote.policyEndDate)}`
      : "not returned by HDFC";

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Review &amp; create proposal</h1>
        <p className="text-sm text-muted-foreground">
          Everything below is what HDFC&apos;s CreateProposal will receive. Nothing binds until the
          payment receipt is recorded on the next step.
        </p>
      </div>

      <section className="space-y-2 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Policy</h2>
        <Line label="Business type" value={conditions.businessType} />
        <Line label="Used-vehicle purchase" value={conditions.isUsedVehiclePurchase ? "yes" : "no"} />
        <Line label="Plan" value={planLabel} />
        <Line label="Own-damage tenure" value={`${conditions.tenureYears} year(s)`} />
        <Line label="Policy period" value={period} />
        <Line label="IDV" value={formatInr(conditions.idvValue ?? quote.idvValue)} />
        <Line
          label="IDV source"
          value={conditions.idvValue ? "tester override" : "HDFC's quoted IDV"}
        />
        <Line label="NCB" value={`${conditions.ncbPercent}%`} />
        <Line
          label="Claim in previous policy"
          value={conditions.claimInPreviousPolicy ? "yes" : "no"}
        />
        <Line label="Add-ons selected" value={codes.length ? codes.join(", ") : "none"} />
        <Line label="Owner-driver PA" value={conditions.paOwner ? "included" : "excluded"} />
        <Line
          label="Unnamed passenger PA sum insured"
          value={conditions.unnamedPaSumInsured ? formatInr(conditions.unnamedPaSumInsured) : "—"}
        />
        <Line label="Gross premium quoted" value={formatInr(quote.grossPremium)} />
        <Line label="Quote number" value={quote.quoteNo} />
        <Line label="Transaction id" value={quoteId} />
      </section>

      <section className="space-y-2 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Vehicle</h2>
        <Line
          label="Make & model"
          value={[conditions.makeName, conditions.modelName].filter(Boolean).join(" ") || "—"}
        />
        <Line label="Fuel" value={conditions.fuelType || "—"} />
        <Line label="RTO" value={conditions.rtoCode || "—"} />
        <Line label="Registration number" value={conditions.registrationNumber || "—"} />
        <Line label="Registration date" value={isoToDisplay(conditions.registrationDate) || "—"} />
        <Line label="Engine number" value={conditions.engineNumber || "—"} />
        <Line label="Chassis number" value={conditions.chassisNumber || "—"} />
      </section>

      <section className="space-y-2 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Previous policy</h2>
        <Line label="Insurer code" value={conditions.previousInsurerId || "—"} />
        <Line label="Insurer name" value={conditions.previousInsurerName || "—"} />
        <Line label="Policy number" value={conditions.previousPolicyNumber || "—"} />
        <Line label="Start date" value={isoToDisplay(conditions.previousPolicyStartDate) || "—"} />
        <Line label="Expiry date" value={isoToDisplay(conditions.previousPolicyExpiryDate) || "—"} />
        <Line
          label="Already expired (break-in)"
          value={conditions.isPreviousPolicyExpired ? "yes" : "no"}
        />
        {conditions.planType === "standAloneOD" ? (
          <>
            <Line label="TP policy number" value={conditions.previousTpPolicyNumber || "—"} />
            <Line label="TP start date" value={isoToDisplay(conditions.previousTpStartDate) || "—"} />
            <Line
              label="TP expiry date"
              value={isoToDisplay(conditions.previousTpExpiryDate) || "—"}
            />
          </>
        ) : null}
      </section>

      <section className="space-y-2 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Proposer</h2>
        <Line label="Name" value={`${proposer.firstName} ${proposer.lastName}`.trim()} />
        <Line label="Date of birth" value={isoToDisplay(proposer.dob)} />
        <Line label="Mobile" value={proposer.mobile} />
        <Line label="Email" value={proposer.email} />
        <Line label="PAN" value={proposer.panNumber || "—"} />
        <Line
          label="Address"
          value={[
            proposer.addressLine1,
            proposer.addressLine2,
            proposer.city,
            proposer.state,
            proposer.pincode,
          ]
            .filter(Boolean)
            .join(", ")}
        />
        <Line
          label="Nominee"
          value={`${proposer.nomineeName} (${proposer.nomineeRelation}, ${proposer.nomineeAge})`}
        />
        <Line label="KYC id" value={ckyc ?? "not resolved"} />
        <Line label="KYC reference" value={kycRefId ?? "—"} />
      </section>

      {failure ? (
        <section className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4 shrink-0" /> CreateProposal rejected
            {failure.code ? ` — ${failure.code}` : ""}
            {failure.httpStatus ? ` (HTTP ${failure.httpStatus})` : ""}
          </p>
          {/* HDFC's own sentence, verbatim. The break-in scenario ends here with
              "Break-in ID required", and that wording IS the finding. */}
          <p className="whitespace-pre-wrap break-words text-sm text-destructive">
            {failure.message}
          </p>
          {failure.vendor != null ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-destructive">HDFC&apos;s response</p>
              <pre className="max-h-72 overflow-auto rounded bg-background/60 p-2 text-xs">
                {JSON.stringify(failure.vendor, null, 2)}
              </pre>
            </div>
          ) : null}
        </section>
      ) : null}

      <Button size="lg" className="w-full" onClick={submit} disabled={fullQuote.isPending}>
        {fullQuote.isPending ? (
          <>
            <Loader2 className="animate-spin" /> Creating proposal…
          </>
        ) : (
          <>
            <ShieldCheck /> Create proposal at HDFC
          </>
        )}
      </Button>

      <RawExchange exchanges={exchanges} />
    </div>
  );
}

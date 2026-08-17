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
import type { MotorFullQuoteRequest, PolicyType } from "../../vehicle/api/types";
import { POLICY_TYPE_LABELS } from "../../vehicle/api/types";
import { buildFgQuoteRequest } from "../build-fg-request";
import { RawExchange } from "../components/raw-exchange";
import { useFgUatStore } from "../fg-uat-store";

/**
 * Step 6 of the FG certification harness — the last look at what CreateProposal
 * will carry, and the call itself.
 *
 * FG re-rates the proposal from the payload it receives rather than from the
 * quote it priced, so this page echoes the quote's own numbers back (the OD
 * special discount and the IDV especially). Whatever FG answers is shown as they
 * wrote it: the tester's next action on a rejection is to read FG's Status,
 * Message and Description back to their own team.
 */

/** What we know about a rejected proposal — ours and FG's, kept apart. */
interface ProposalFailure {
  httpStatus?: number;
  code?: string;
  message: string;
  /** FG's raw section (Status / Message / Description), untouched. */
  vendor?: unknown;
}

/** Unpacks the vendor-API error envelope, keeping FG's own payload intact. */
function toFailure(err: unknown): ProposalFailure {
  const response = axios.isAxiosError(err) ? err.response : undefined;
  const data = response?.data as { error?: { details?: unknown } } | undefined;
  return {
    httpStatus: response?.status,
    code: apiErrorCode(err),
    message: apiErrorMessage(err, "The proposal call failed before FG answered."),
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

export function FgReviewPage() {
  const navigate = useNavigate();
  const category = useFgUatStore((s) => s.category);
  const conditions = useFgUatStore((s) => s.conditions);
  const proposer = useFgUatStore((s) => s.proposer);
  const codes = useFgUatStore((s) => s.providerAddonCodes);
  const quote = useFgUatStore((s) => s.quote);
  const ckyc = useFgUatStore((s) => s.ckyc);
  const kycRefId = useFgUatStore((s) => s.kycRefId);
  const exchanges = useFgUatStore((s) => s.exchanges);
  const setProposal = useFgUatStore((s) => s.setProposal);
  const recordExchange = useFgUatStore((s) => s.recordExchange);

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
          <Link to={ROUTES.fgUat.start}>Start from /fg</Link>
        </Button>
      </div>
    );
  }

  // The IDV FG will be asked to bind. FG demands it at CreateProposal and
  // re-derives its own when sent as 0, so the tester's override wins and the
  // quote's IDV is the floor — never nothing.
  const idvValue = conditions.idvValue ?? quote.idvValue;

  const submit = () => {
    const base = buildFgQuoteRequest(category, conditions, codes);
    const req: MotorFullQuoteRequest = {
      ...base,
      quoteId: quote.transactionId ?? quote.quoteNo,
      proposer: {
        firstName: proposer.firstName,
        lastName: proposer.lastName,
        email: proposer.email,
        mobile: proposer.mobile,
        dob: proposer.dob,
        gender: proposer.gender,
        // Sent exactly as typed, valid or not: the CKYC failure case needs a PAN
        // FG will reject, so silently dropping a malformed one would erase it.
        ...(proposer.panNumber.trim() ? { panNumber: proposer.panNumber.trim().toUpperCase() } : {}),
      },
      address: {
        addressLine1: proposer.addressLine1,
        addressLine2: proposer.addressLine2,
        city: proposer.city,
        state: proposer.state,
        pincode: proposer.pincode,
      },
      vehicle: {
        engineNumber: conditions.engineNumber,
        chassisNumber: conditions.chassisNumber,
        financeType: "none",
      },
      nomineeName: proposer.nomineeName,
      nomineeRelation: proposer.nomineeRelation,
      nomineeAge: proposer.nomineeAge,
      // CKYC resolved on the previous step — FG's Client block needs the number.
      ...(ckyc ? { ckyc } : {}),
      ...(kycRefId ? { kycRefId } : {}),
      // Break-in evidence; FG rejects a break-in proposal that arrives without it.
      ...(conditions.inspectionReportNumber
        ? {
            inspectionReportNumber: conditions.inspectionReportNumber,
            inspectionDate: conditions.inspectionDate,
          }
        : {}),
      // Echo FG's own quote-time OD special discount. Omitting it makes FG
      // re-rate at full own damage — roughly 2.5× the premium just quoted.
      ...(quote.odDiscountPercent ? { odDiscountPercent: quote.odDiscountPercent } : {}),
      idvValue,
      providerAddonCodes: codes,
      includeRawExchange: true,
      isProposalOnly: false,
      isVehicleUnderLoan: false,
    };

    setFailure(null);
    fullQuote.mutate(
      { provider: "fg", req },
      {
        onSuccess: (result) => {
          setProposal(result);
          recordExchange({
            step: "CreateProposal",
            at: new Date().toISOString(),
            request: req,
            response: result._rawResponse ?? result,
          });
          void navigate(ROUTES.fgUat.payment);
        },
        onError: (err) => {
          // A rejection is evidence too — it goes in the drawer beside the
          // successes, with FG's payload rather than a summary of it.
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
      : "not returned by FG";

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Review &amp; create proposal</h1>
        <p className="text-sm text-muted-foreground">
          Everything below is what FG&apos;s CreateProposal will receive. Nothing binds until
          payment.
        </p>
      </div>

      <section className="space-y-2 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Policy</h2>
        <Line label="Business type" value={conditions.businessType} />
        <Line label="Plan" value={planLabel} />
        <Line label="Policy period" value={period} />
        <Line label="IDV" value={formatInr(idvValue)} />
        <Line
          label="IDV source"
          value={conditions.idvValue ? "tester override" : "FG's quoted IDV"}
        />
        <Line
          label="OD special discount"
          value={quote.odDiscountPercent == null ? "not returned" : `${quote.odDiscountPercent}%`}
        />
        <Line label="NCB" value={`${conditions.ncbPercent}%`} />
        <Line label="Claim in previous policy" value={conditions.claimInPreviousPolicy ? "yes" : "no"} />
        <Line label="Cover codes" value={codes.length ? codes.join(", ") : "none"} />
        <Line label="Owner-driver PA" value={conditions.paOwner ? "included" : "excluded"} />
        <Line label="Gross premium quoted" value={formatInr(quote.grossPremium)} />
        <Line label="Quote number" value={quote.quoteNo} />
      </section>

      <section className="space-y-2 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Previous policy</h2>
        <Line label="Insurer" value={conditions.previousInsurerName || "—"} />
        <Line label="Policy number" value={conditions.previousPolicyNumber || "—"} />
        <Line label="Start date" value={isoToDisplay(conditions.previousPolicyStartDate) || "—"} />
        <Line label="Expiry date" value={isoToDisplay(conditions.previousPolicyExpiryDate) || "—"} />
        <Line label="Already expired (break-in)" value={conditions.isPreviousPolicyExpired ? "yes" : "no"} />
        {conditions.inspectionReportNumber ? (
          <>
            <Line label="Inspection report" value={conditions.inspectionReportNumber} />
            <Line label="Inspection date" value={isoToDisplay(conditions.inspectionDate) || "—"} />
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
          value={[proposer.addressLine1, proposer.addressLine2, proposer.city, proposer.state, proposer.pincode]
            .filter(Boolean)
            .join(", ")}
        />
        <Line
          label="Nominee"
          value={`${proposer.nomineeName} (${proposer.nomineeRelation}, ${proposer.nomineeAge})`}
        />
        <Line label="CKYC number" value={ckyc ?? "not resolved"} />
        <Line label="KYC reference" value={kycRefId ?? "—"} />
      </section>

      {failure ? (
        <section className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4 shrink-0" /> CreateProposal rejected
            {failure.code ? ` — ${failure.code}` : ""}
            {failure.httpStatus ? ` (HTTP ${failure.httpStatus})` : ""}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm text-destructive">
            {failure.message}
          </p>
          {failure.vendor != null ? (
            <div className="space-y-1">
              {/* FG's own Status / Message / Description, verbatim. Their wording
                  is frequently misleading, and rewriting it destroys the evidence. */}
              <p className="text-xs font-medium text-destructive">FG&apos;s response</p>
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
            <ShieldCheck /> Create proposal at FG
          </>
        )}
      </Button>

      <RawExchange exchanges={exchanges} />
    </div>
  );
}

import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { apiErrorCode, apiErrorMessage } from "@/lib/api/error-message";
import { formatInr } from "@/lib/utils";
import { useInitiatePayment } from "../../vehicle/api/hooks";
import type { PaymentForm } from "../../vehicle/api/vehicle-api";
import { RawExchange } from "../components/raw-exchange";
import { useFgUatStore } from "../fg-uat-store";

/**
 * Step 7 of the FG certification harness — the handoff to FG's hosted gateway.
 *
 * The policy number the workbook records is not issued here: FG's gateway calls
 * the backend's ResponseURL, which issues the policy and redirects back. That
 * URL is backend configuration, so the tester is told on screen what it has to
 * be — a remote tester who pays and then lands nowhere should be able to read
 * why without asking us.
 */

/** Builds a transient hidden form and POSTs it to FG's hosted gateway. */
function submitGatewayForm({ url, fields }: PaymentForm) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export function FgPaymentPage() {
  const proposal = useFgUatStore((s) => s.proposal);
  const proposer = useFgUatStore((s) => s.proposer);
  const exchanges = useFgUatStore((s) => s.exchanges);
  const recordExchange = useFgUatStore((s) => s.recordExchange);

  const initiate = useInitiatePayment();
  const [error, setError] = useState<string | null>(null);

  if (!proposal) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          No proposal created yet — there is nothing to pay for.
        </p>
        <Button asChild>
          <Link to={ROUTES.fgUat.review}>Back to review</Link>
        </Button>
      </div>
    );
  }

  const contract = proposal.contractDetails ?? {};
  const clientId = typeof contract.clientId === "string" ? contract.clientId : null;
  const quotationNo =
    typeof contract.quotationNo === "string" && contract.quotationNo
      ? contract.quotationNo
      : (proposal.quoteNo ?? proposal.transactionId ?? null);
  // FG's own hosted-checkout link, when the proposal came back with one.
  const paymentUrl = proposal.paymentUrl;

  const pay = () => {
    if (!quotationNo) {
      setError("FG returned no QuotationNo, so the gateway form cannot be signed.");
      return;
    }
    const body = {
      quoteNo: quotationNo,
      premiumAmount: proposal.grossPremium,
      firstName: proposer.firstName,
      lastName: proposer.lastName,
      mobile: proposer.mobile,
      email: proposer.email,
    };
    setError(null);
    initiate.mutate(
      { provider: "fg", body },
      {
        onSuccess: (form) => {
          // Recorded before the browser leaves — the checksum-signed field set is
          // the evidence for anything the gateway then rejects.
          recordExchange({
            step: "PaymentInitiate",
            at: new Date().toISOString(),
            request: body,
            response: form,
          });
          submitGatewayForm(form);
        },
        onError: (err) => {
          const message = apiErrorMessage(err, "The payment call failed before FG answered.");
          recordExchange({
            step: "PaymentInitiate",
            at: new Date().toISOString(),
            request: body,
            response: { code: apiErrorCode(err), message },
          });
          setError(message);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Payment</h1>
        <p className="text-sm text-muted-foreground">
          FG&apos;s proposal is created. Paying it binds the policy and produces the PolicyNo the
          certification workbook records.
        </p>
      </div>

      <section className="space-y-2 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Bound premium</h2>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-muted-foreground">Gross premium</span>
          <span className="text-2xl font-semibold tabular-nums">
            {formatInr(proposal.grossPremium)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">ClientId</span>
          <span className="tabular-nums">{clientId ?? "not returned"}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">QuotationNo</span>
          <span className="tabular-nums">{quotationNo ?? "not returned"}</span>
        </div>
      </section>

      {/* Configuration, not code — and the one thing that silently strands a
          remote tester after they have already paid. */}
      <section className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" /> Before paying from a remote machine
        </p>
        <p className="text-sm text-amber-700 dark:text-amber-400">
          The backend&apos;s <code>FG_PAYMENT_RESPONSE_URL</code> must point at this
          deployment&apos;s <code>/api/v1/fg/payment/callback</code>. It defaults to{" "}
          <code>localhost:4000</code>, which FG&apos;s gateway cannot reach — payment then succeeds
          at FG but never returns here, and no policy is issued.
        </p>
      </section>

      {error ? (
        <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4 shrink-0" /> Payment could not start
          </p>
          <p className="whitespace-pre-wrap break-words text-sm text-destructive">{error}</p>
        </div>
      ) : null}

      {paymentUrl ? (
        <Button asChild size="lg" className="w-full">
          <a href={paymentUrl}>
            Pay {formatInr(proposal.grossPremium)} at FG <ExternalLink />
          </a>
        </Button>
      ) : (
        <Button size="lg" className="w-full" onClick={pay} disabled={initiate.isPending}>
          {initiate.isPending ? (
            <>
              <Loader2 className="animate-spin" /> Redirecting to FG…
            </>
          ) : (
            <>
              Pay {formatInr(proposal.grossPremium)} at FG <ExternalLink />
            </>
          )}
        </Button>
      )}

      <RawExchange exchanges={exchanges} />
    </div>
  );
}

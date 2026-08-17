import axios from "axios";
import { AlertTriangle, BadgeCheck, Loader2, ReceiptText, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { DateInput, isoToDisplay } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { apiErrorCode, apiErrorMessage } from "@/lib/api/error-message";
import { formatInr } from "@/lib/utils";
import { useIssuePolicy } from "../../vehicle/api/hooks";
import type { PolicyIssuanceRequest, PolicyType } from "../../vehicle/api/types";
import { Field } from "../components/condition-fields";
import { RawExchange } from "../components/raw-exchange";
import { HDFC_SLUG } from "../build-hdfc-request";
import { useHdfcUatStore } from "../hdfc-uat-store";

/**
 * Step 7 of the HDFC certification harness — and the one place this journey
 * genuinely differs from FG's.
 *
 * HDFC ships NO payment gateway. Its `submitpaymentdetails` RECORDS a payment
 * that was collected elsewhere and then hands back the bound policy number, so
 * there is no redirect, no checksum-signed form and no callback: this page
 * writes a receipt and calls `POST /hdfc/policy/issue`, which is the issuance.
 *
 * The `amount` is prefilled with the proposal's own gross premium and labelled
 * as such, because HDFC RE-RATES at issuance and rejects a receipt whose amount
 * is not the premium it just quoted. Nothing here rounds or scales it — the
 * whole stack is whole rupees end to end.
 *
 * The defaults for `receiptType` (IVR) and `pgType` (BIZDIRECT) are the values
 * the five live UAT policies were bound with (`tf-api/scripts/hdfc-uat-issuance.ts`),
 * not the canonical contract's FG-flavoured PAYU default.
 */

/** `dd/mm/yyyy` + a clock time, which is the format HDFC passes through verbatim. */
function toTransactionDate(iso: string, time: string): string {
  return `${isoToDisplay(iso)} ${time}`.trim();
}

const today = () => new Date().toISOString().slice(0, 10);

export function HdfcPaymentPage() {
  const navigate = useNavigate();
  const category = useHdfcUatStore((s) => s.category);
  const conditions = useHdfcUatStore((s) => s.conditions);
  const quote = useHdfcUatStore((s) => s.quote);
  const proposal = useHdfcUatStore((s) => s.proposal);
  const proposalNumber = useHdfcUatStore((s) => s.proposalNumber);
  const exchanges = useHdfcUatStore((s) => s.exchanges);
  const setPolicyNo = useHdfcUatStore((s) => s.setPolicyNo);
  const recordExchange = useHdfcUatStore((s) => s.recordExchange);

  const issue = useIssuePolicy();
  const [error, setError] = useState<string | null>(null);
  const [vendor, setVendor] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const premium = proposal?.grossPremium ?? 0;

  // One reference per visit, generated once so a re-render can't change the key
  // HDFC de-duplicates receipts on.
  const [tranRefNo, setTranRefNo] = useState(() => `UAT${Date.now()}`);
  // Seeded from the same reference rather than a second `Date.now()`, which
  // would drift by a millisecond and give HDFC two keys for one payment.
  const [uniqueTranKey, setUniqueTranKey] = useState(tranRefNo);
  const [tranRefNoDate, setTranRefNoDate] = useState<string>(today);
  const [tranTime, setTranTime] = useState("12:00:00");
  const [receiptType, setReceiptType] = useState("IVR");
  const [pgType, setPgType] = useState("BIZDIRECT");
  // Prefilled with the proposal's premium — see the note in the header comment.
  const [amount, setAmount] = useState<number>(() => premium);

  if (!proposal) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          No proposal created yet — there is no premium to record a payment against.
        </p>
        <Button asChild>
          <Link to={ROUTES.hdfcUat.review}>Back to review</Link>
        </Button>
      </div>
    );
  }

  const contract = proposal.contractDetails ?? {};
  // HDFC's own Proposal_Number goes out as `quoteNo`; the cross-step correlation
  // id it threads through all seven HEI calls goes out as `transactionId`.
  const quoteNo =
    proposalNumber ??
    (typeof contract.proposalNumber === "string" ? contract.proposalNumber : null) ??
    proposal.quoteNo;
  const clientId = quote?.transactionId ?? quote?.quoteNo ?? proposal.quoteNo;
  const transactionId =
    typeof contract.transactionId === "string" && contract.transactionId
      ? contract.transactionId
      : clientId;

  const amountMatchesPremium = amount === premium;

  const submit = () => {
    const req: PolicyIssuanceRequest = {
      quoteNo,
      clientId,
      transactionId,
      vehicleCategory: (category ?? "fourWheeler") as PolicyIssuanceRequest["vehicleCategory"],
      ...(conditions?.planType
        ? { policyType: conditions.planType as PolicyType }
        : {}),
      receipt: {
        uniqueTranKey,
        transactionDate: toTransactionDate(tranRefNoDate, tranTime),
        receiptType,
        amount,
        tranRefNo,
        // ISO here; the backend's `toHdfcDate` renders HDFC's dd/mm/yyyy.
        tranRefNoDate,
        pgType,
      },
    };

    setError(null);
    setVendor(null);
    setMessage(null);
    issue.mutate(
      { provider: HDFC_SLUG, req },
      {
        onSuccess: (result) => {
          recordExchange({
            step: "SubmitPaymentDetails",
            at: new Date().toISOString(),
            request: req,
            response: result._rawResponse ?? result,
          });
          if (result.policyNumber) {
            setPolicyNo(result.policyNumber);
            void navigate(ROUTES.hdfcUat.success);
            return;
          }
          // HDFC accepted the payment but issued nothing yet — its own status and
          // message, not a guess at what they meant.
          setMessage(
            `${result.status}${result.message ? ` — ${result.message}` : ""}`,
          );
        },
        onError: (err) => {
          const response = axios.isAxiosError(err) ? err.response : undefined;
          const data = response?.data as { error?: { details?: unknown } } | undefined;
          const msg = apiErrorMessage(err, "The issuance call failed before HDFC answered.");
          const code = apiErrorCode(err);
          recordExchange({
            step: "SubmitPaymentDetails",
            at: new Date().toISOString(),
            request: req,
            response: { code, message: msg, details: data?.error?.details },
          });
          setError(code ? `${code} — ${msg}` : msg);
          setVendor(data?.error?.details ?? null);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Payment receipt &amp; issuance</h1>
        <p className="text-sm text-muted-foreground">
          HDFC has no payment gateway. It records a payment already collected and issues the policy
          in the same call — so submitting this form binds a real UAT policy.
        </p>
      </div>

      <section className="space-y-2 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Proposal</h2>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-muted-foreground">Gross premium</span>
          <span className="text-2xl font-semibold tabular-nums">{formatInr(premium)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Proposal number (quoteNo)</span>
          <span className="tabular-nums">{quoteNo}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Client id</span>
          <span className="tabular-nums">{clientId}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Transaction id</span>
          <span className="tabular-nums">{transactionId}</span>
        </div>
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Receipt</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Amount (₹) — the proposal's premium, ${formatInr(premium)}`}>
            <Input
              type="number"
              inputMode="numeric"
              value={String(amount)}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Transaction reference (tranRefNo)">
            <Input value={tranRefNo} onChange={(e) => setTranRefNo(e.target.value)} />
          </Field>
          <Field label="Unique transaction key">
            <Input value={uniqueTranKey} onChange={(e) => setUniqueTranKey(e.target.value)} />
          </Field>
          <Field label="Transaction reference date">
            {/* dd/mm/yyyy on screen, ISO in state — never a native date input. */}
            <DateInput value={tranRefNoDate} onChange={setTranRefNoDate} />
          </Field>
          <Field label="Transaction time (hh:mm:ss)">
            <Input value={tranTime} onChange={(e) => setTranTime(e.target.value)} />
          </Field>
          <Field label="Receipt type">
            <Input value={receiptType} onChange={(e) => setReceiptType(e.target.value)} />
          </Field>
          <Field label="Payment gateway type (pgType)">
            <Input value={pgType} onChange={(e) => setPgType(e.target.value)} />
          </Field>
        </div>

        {/* The single most common way this step fails, said before it is fired. */}
        <div
          className={
            amountMatchesPremium
              ? "flex items-start gap-2 rounded-md border p-3 text-xs text-muted-foreground"
              : "flex items-start gap-2 rounded-md border border-amber-400/70 bg-amber-50 p-3 text-sm text-amber-900"
          }
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-2">
            <p>
              HDFC <strong>re-rates at issuance</strong> and rejects a receipt whose amount is not
              the premium it just quoted. The field above is prefilled with the proposal&apos;s own
              gross premium, {formatInr(premium)}, for exactly that reason — change it only to
              exercise the mismatch case deliberately.
            </p>
            {amountMatchesPremium ? null : (
              <Button variant="outline" size="sm" onClick={() => setAmount(premium)}>
                <RotateCcw /> Reset to {formatInr(premium)}
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          The transaction date is sent as{" "}
          <code>{toTransactionDate(tranRefNoDate, tranTime)}</code> — HDFC passes it through
          verbatim. <code>IVR</code> and <code>BIZDIRECT</code> are the receipt and gateway types
          the live UAT policies were bound with.
        </p>
      </section>

      {message ? (
        <div className="space-y-1 rounded-md border p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <BadgeCheck className="size-4 shrink-0" /> HDFC accepted the payment
          </p>
          {/* HDFC's own status and message. */}
          <p className="whitespace-pre-wrap break-words text-sm">{message}</p>
        </div>
      ) : null}

      {error ? (
        <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4 shrink-0" /> Issuance rejected
          </p>
          {/* Verbatim, code and all: the tester reads this straight back to HDFC. */}
          <p className="whitespace-pre-wrap break-words text-sm text-destructive">{error}</p>
          {vendor != null ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-destructive">HDFC&apos;s response</p>
              <pre className="max-h-72 overflow-auto rounded bg-background/60 p-2 text-xs">
                {JSON.stringify(vendor, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      <Button size="lg" className="w-full" onClick={submit} disabled={issue.isPending}>
        {issue.isPending ? (
          <>
            <Loader2 className="animate-spin" /> Recording payment &amp; issuing…
          </>
        ) : (
          <>
            <ReceiptText /> Record {formatInr(amount)} &amp; issue policy
          </>
        )}
      </Button>

      <RawExchange exchanges={exchanges} />
    </div>
  );
}

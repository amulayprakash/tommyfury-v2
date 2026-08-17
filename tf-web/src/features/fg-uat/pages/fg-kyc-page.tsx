import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  ExternalLink,
  FileUp,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { isoToDisplay } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { apiErrorCode, apiErrorMessage } from "@/lib/api/error-message";
import { useCkyc, useOvd } from "../../vehicle/api/hooks";
import { OVD_DOC_TYPES, type CkycRequest, type OvdDocType } from "../../vehicle/api/types";
import { validateOvdFile } from "../../vehicle/api/vehicle-api";
import { Field, SELECT_CLASS } from "../components/condition-fields";
import { RawExchange } from "../components/raw-exchange";
import { useFgUatStore } from "../fg-uat-store";

/**
 * Step 5 of the FG certification harness — CKYC, which FG requires *before*
 * CreateProposal and whose resolved CKYC number goes into the Client block.
 *
 * Whatever FG says is shown verbatim. Their remarks are frequently misleading
 * (a wrong PAN comes back as "Mobile number length should be 10 digits", keyed
 * to the id number alone), and a tester has to read FG's own words back to their
 * team — a friendlier rewrite would destroy the evidence.
 */
export function FgKycPage() {
  const navigate = useNavigate();
  const quote = useFgUatStore((s) => s.quote);
  const proposer = useFgUatStore((s) => s.proposer);
  const ckycNumber = useFgUatStore((s) => s.ckyc);
  const kycRefId = useFgUatStore((s) => s.kycRefId);
  const exchanges = useFgUatStore((s) => s.exchanges);
  const setCkyc = useFgUatStore((s) => s.setCkyc);
  const recordExchange = useFgUatStore((s) => s.recordExchange);

  const ckyc = useCkyc();
  const ovd = useOvd();
  const [error, setError] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  // OVD (document-upload) fallback, for when FG holds no CKYC record.
  const [poiType, setPoiType] = useState<OvdDocType>("PAN");
  const [poaType, setPoaType] = useState<OvdDocType>("AADHAAR");
  const [poiFile, setPoiFile] = useState<File | null>(null);
  const [poaFile, setPoaFile] = useState<File | null>(null);

  if (!quote) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          No quote captured yet — CKYC is keyed to the quote&apos;s transaction id.
        </p>
        <Button asChild>
          <Link to={ROUTES.fgUat.start}>Start from /fg</Link>
        </Button>
      </div>
    );
  }

  // FG ties the CKYC record to the same transaction the quote was priced under,
  // exactly as the customer wizard does.
  const transactionId = quote.transactionId ?? quote.quoteNo ?? "kyc";
  const busy = ckyc.isPending || ovd.isPending;

  const runCkyc = () => {
    const req: CkycRequest = {
      transactionId,
      dob: proposer.dob,
      fullName: `${proposer.firstName} ${proposer.lastName}`.trim(),
      mobile: proposer.mobile,
      gender: proposer.gender,
      policyType: "motor",
      redirectUrl: `${window.location.origin}${ROUTES.fgUat.kyc}`,
      panNumber: proposer.panNumber.trim().toUpperCase() || undefined,
    };
    setError(null);
    ckyc.mutate(
      { provider: "fg", req },
      {
        onSuccess: (result) => {
          recordExchange({
            step: "VerifyCKYC",
            at: new Date().toISOString(),
            request: req,
            response: result._rawResponse ?? result,
          });
          if (result.isKycSuccess && result.ckycNumber) {
            setCkyc(result.ckycNumber, result.ckycRefId ?? result.proposalId ?? null);
            setRedirectUrl(null);
            return;
          }
          if (result.requiresRedirect && result.redirectUrl) {
            // FG's manual KYC: they finish on FG's hosted page, come back, and
            // re-run this call to pick up the CKYC number it produced.
            setCkyc(null, result.proposalId ?? null);
            setRedirectUrl(result.redirectUrl);
          }
          setError(result.displayMessage ?? "FG returned no CKYC number and no remark.");
        },
        onError: (err) => {
          const message = apiErrorMessage(err, "The CKYC call failed before FG answered.");
          recordExchange({
            step: "VerifyCKYC",
            at: new Date().toISOString(),
            request: req,
            response: { code: apiErrorCode(err), message },
          });
          setError(message);
        },
      },
    );
  };

  /** Validates on selection so a bad file is caught before the upload round-trip. */
  const pickFile = (setFile: (f: File | null) => void, label: string) => {
    return (file: File | null) => {
      const problem = file ? validateOvdFile(file, label) : null;
      setError(problem);
      setFile(problem ? null : file);
    };
  };

  const runOvd = () => {
    if (!poiFile || !poaFile) {
      setError("Upload both an identity and an address proof.");
      return;
    }
    const problem =
      validateOvdFile(poiFile, "Identity proof") ?? validateOvdFile(poaFile, "Address proof");
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const body = {
      transactionId,
      proofOfIdentityType: poiType,
      proofOfAddressType: poaType,
      proofOfIdentity: poiFile,
      proofOfAddress: poaFile,
    };
    ovd.mutate(
      { provider: "fg", body },
      {
        onSuccess: (result) => {
          recordExchange({
            step: "UploadDocBytes",
            at: new Date().toISOString(),
            // The files themselves are multipart binary — record what identifies them.
            request: {
              transactionId,
              proofOfIdentityType: poiType,
              proofOfAddressType: poaType,
              proofOfIdentity: poiFile.name,
              proofOfAddress: poaFile.name,
            },
            response: result._rawResponse ?? result,
          });
          if (result.isKycSuccess) {
            // OVD yields no CKYC number — only a reference. FG's CreateProposal
            // wants the number, so the proposal step may still reject.
            setCkyc(null, result.kycId ?? null);
            return;
          }
          setError(result.displayMessage ?? "FG rejected the uploaded documents without a remark.");
        },
        onError: (err) => {
          const message = apiErrorMessage(err, "The document upload failed before FG answered.");
          recordExchange({
            step: "UploadDocBytes",
            at: new Date().toISOString(),
            request: { transactionId, proofOfIdentityType: poiType, proofOfAddressType: poaType },
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
        <h1 className="font-display text-2xl font-semibold">CKYC verification</h1>
        <p className="text-sm text-muted-foreground">
          FG matches the proposer against the central KYC registry before it will accept a proposal.
        </p>
      </div>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Identity submitted</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="PAN">
            <Input value={proposer.panNumber} readOnly className="uppercase" />
          </Field>
          <Field label="Date of birth">
            {/* Read-only mirror of the proposer step — dd/mm/yyyy, never a native date input. */}
            <Input value={isoToDisplay(proposer.dob)} readOnly />
          </Field>
          <Field label="Transaction id">
            <Input value={transactionId} readOnly />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Change the PAN or date of birth on the{" "}
          <Link to={ROUTES.fgUat.proposal} className="underline underline-offset-2">
            proposer step
          </Link>{" "}
          — the CKYC failure case (TC_37) needs a pair that does not match.
        </p>
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Result</h2>

        {ckycNumber ? (
          <p className="flex items-center gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
            <BadgeCheck className="size-4 shrink-0" /> CKYC number {ckycNumber}
            {kycRefId ? ` · reference ${kycRefId}` : ""}
          </p>
        ) : null}

        {error ? (
          <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4 shrink-0" /> FG&apos;s response
            </p>
            {/* Verbatim. FG's remark is often keyed to the id number even when it
                talks about the mobile — a rewrite would hide that. */}
            <p className="whitespace-pre-wrap break-words text-sm text-destructive">{error}</p>
          </div>
        ) : null}

        {redirectUrl ? (
          <Button asChild variant="outline" className="w-full">
            <a href={redirectUrl} target="_blank" rel="noreferrer">
              Complete KYC on FG&apos;s page <ExternalLink />
            </a>
          </Button>
        ) : null}

        <Button className="w-full" size="lg" onClick={runCkyc} disabled={busy}>
          {ckyc.isPending ? (
            <>
              <Loader2 className="animate-spin" /> Verifying…
            </>
          ) : (
            <>
              <ShieldAlert /> {redirectUrl ? "I've completed KYC — check again" : "Verify CKYC"}
            </>
          )}
        </Button>
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Fallback — upload documents (OVD)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Identity proof">
            <select
              className={SELECT_CLASS}
              value={poiType}
              onChange={(e) => setPoiType(e.target.value as OvdDocType)}
            >
              {OVD_DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Address proof">
            <select
              className={SELECT_CLASS}
              value={poaType}
              onChange={(e) => setPoaType(e.target.value as OvdDocType)}
            >
              {OVD_DOC_TYPES.filter((t) => t !== "PAN").map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => pickFile(setPoiFile, "Identity proof")(e.target.files?.[0] ?? null)}
          />
          <Input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => pickFile(setPoaFile, "Address proof")(e.target.files?.[0] ?? null)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          JPG, PNG or PDF, up to 5 MB each. FG&apos;s UploadDocBytes returns a KYC reference but no
          CKYC number, so a proposal that needs the number can still be rejected.
        </p>
        <Button
          variant="outline"
          className="w-full"
          onClick={runOvd}
          disabled={busy || !poiFile || !poaFile}
        >
          {ovd.isPending ? (
            <>
              <Loader2 className="animate-spin" /> Uploading…
            </>
          ) : (
            <>
              <FileUp /> Upload &amp; verify
            </>
          )}
        </Button>
      </section>

      <Button
        size="lg"
        className="w-full"
        onClick={() => void navigate(ROUTES.fgUat.review)}
      >
        Continue <ArrowRight />
      </Button>

      <RawExchange exchanges={exchanges} />
    </div>
  );
}

import {
  ArrowRight,
  BadgeCheck,
  ExternalLink,
  FileUp,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { apiErrorCode, apiErrorMessage } from "@/lib/api/error-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCkyc, useOvd, useProviders } from "../api/hooks";
import { OVD_DOC_TYPES, type KycResult, type OvdDocType } from "../api/types";
import { WizardSteps } from "../components/wizard-steps";
import { PAN_REGEX } from "../lib/proposal-schema";
import { useVehicleQuoteStore } from "../vehicle-quote-store";

const AADHAAR_REGEX = /^\d{12}$/;
const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

export function KycPage() {
  const navigate = useNavigate();
  const selected = useVehicleQuoteStore((s) => s.selected);
  const proposal = useVehicleQuoteStore((s) => s.proposal);
  const kycId = useVehicleQuoteStore((s) => s.kycId);
  const setKyc = useVehicleQuoteStore((s) => s.setKyc);
  const setCkyc = useVehicleQuoteStore((s) => s.setCkyc);
  const setPan = useVehicleQuoteStore((s) => s.setPan);

  const providers = useProviders();
  const ckyc = useCkyc();
  const ovd = useOvd();
  const [pan, setPan_] = useState(useVehicleQuoteStore.getState().panNumber ?? "");
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  // Alternate KYC (revealed when PAN CKYC reports "retry with alternate options").
  const [showAlternates, setShowAlternates] = useState(false);
  const [aadhaar, setAadhaar] = useState("");
  const [aadhaarName, setAadhaarName] = useState("");
  const [poiType, setPoiType] = useState<OvdDocType>("PAN");
  const [poaType, setPoaType] = useState<OvdDocType>("AADHAAR");
  const [poiFile, setPoiFile] = useState<File | null>(null);
  const [poaFile, setPoaFile] = useState<File | null>(null);

  // CKYC runs after the proposer details are captured and before the bound
  // proposal (FG flow: Quote → CKYC → Proposal).
  if (!selected || !proposal) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="mb-4 text-muted-foreground">Fill in your details first.</p>
        <Button asChild>
          <Link to={ROUTES.vehicle.apiForm}>Back to details</Link>
        </Button>
      </div>
    );
  }

  const provider = providers.data?.find((p) => p.slug === selected.providerSlug);
  const supportsKyc = provider?.operations.includes("ckyc") ?? false;
  const supportsOvd = provider?.operations.includes("ovd") ?? false;
  const panValid = PAN_REGEX.test(pan.trim().toUpperCase());
  const aadhaarValid = AADHAAR_REGEX.test(aadhaar.trim());
  const transactionId = selected.quote.transactionId ?? selected.quote.quoteNo ?? "kyc";
  const busy = ckyc.isPending || ovd.isPending;

  // Only FG needs the resolved CKYC *number* in CreateProposal; ICICI links KYC
  // to the proposal by TransactionId, so a successful call is enough.
  const needsCkycNumber = selected.providerSlug === "fg";

  const goToProposal = () => navigate(ROUTES.vehicle.coverage);

  /** Stores a sufficient KYC result and advances; returns false if not sufficient. */
  const finishIfReady = (result: KycResult): boolean => {
    const sufficient = result.isKycSuccess && (!needsCkycNumber || Boolean(result.ckycNumber));
    if (!sufficient) return false;
    setCkyc(result.ckycNumber ?? null, result.ckycRefId ?? result.proposalId ?? null);
    setKyc(result.kycId ?? "verified");
    setRedirectUrl(null);
    toast.success("KYC verified");
    void goToProposal();
    return true;
  };

  const runCkyc = (method: "pan" | "aadhaar") => {
    const panUpper = pan.trim().toUpperCase();
    ckyc.mutate(
      {
        provider: selected.providerSlug,
        req: {
          transactionId,
          dob: proposal.dob,
          fullName: `${proposal.firstName} ${proposal.lastName}`.trim(),
          mobile: proposal.mobile,
          gender: proposal.gender,
          policyType: "motor",
          redirectUrl: `${window.location.origin}${ROUTES.vehicle.kycStatus}`,
          ...(method === "pan"
            ? { panNumber: panValid ? panUpper : undefined }
            : { aadhaarNumber: aadhaar.trim(), nameAsPerAadhaar: aadhaarName.trim() }),
        },
      },
      {
        onSuccess: (result) => {
          if (method === "pan") setPan(panUpper);
          if (finishIfReady(result)) return;
          if (result.requiresRedirect && result.redirectUrl) {
            // FG manual KYC: surface the hosted upload page. The user completes it,
            // returns, and "I’ve completed KYC" re-polls to fetch the CKYC number.
            setCkyc(null, result.proposalId ?? null);
            setRedirectUrl(result.redirectUrl);
            toast.info("Complete KYC in the new tab, then click “I’ve completed KYC”.");
          } else if (result.isKycSuccess && needsCkycNumber && !result.ckycNumber) {
            setCkyc(null, result.ckycRefId ?? result.proposalId ?? null);
            toast.info("KYC is still processing. Please wait a moment and verify again.");
          } else {
            // No match on this method — offer the alternate KYC options.
            setShowAlternates(true);
            toast.error(result.displayMessage ?? "KYC failed. Try an alternate method below.");
          }
        },
        onError: (err) => {
          if (apiErrorCode(err) === "KYC_INCOMPLETE") setShowAlternates(true);
          toast.error(apiErrorMessage(err, "KYC verification failed."));
        },
      },
    );
  };

  const runOvd = () => {
    if (!poiFile || !poaFile) {
      toast.error("Upload both an identity and an address proof.");
      return;
    }
    ovd.mutate(
      {
        provider: selected.providerSlug,
        body: {
          transactionId,
          proofOfIdentityType: poiType,
          proofOfAddressType: poaType,
          proofOfIdentity: poiFile,
          proofOfAddress: poaFile,
        },
      },
      {
        onSuccess: (result) => {
          if (result.isKycSuccess) {
            // OVD has no CKYC number; ICICI links the KYC by TransactionId.
            setCkyc(null, result.kycId ?? null);
            setKyc(result.kycId ?? "verified");
            toast.success("KYC verified");
            void goToProposal();
          } else {
            toast.error("KYC could not be completed with the uploaded documents.");
          }
        },
        onError: (err) => toast.error(apiErrorMessage(err, "Document upload failed.")),
      },
    );
  };

  const proceed = () => {
    setKyc("not-required");
    void goToProposal();
  };

  return (
    <div>
      <WizardSteps current={3} />
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BadgeCheck className="size-6" />
          </div>
          <CardTitle>KYC verification</CardTitle>
          <CardDescription>
            {supportsKyc
              ? `${selected.quote.insurerName ?? selected.providerSlug} requires KYC before issuing the policy.`
              : "This provider does not require an extra KYC step for this journey."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {kycId ? (
            <p className="flex items-center gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
              <BadgeCheck className="size-4" /> KYC complete.
            </p>
          ) : null}

          {supportsKyc ? (
            <>
              <label className="block space-y-2">
                <span className="text-sm font-medium">PAN card number</span>
                <Input
                  value={pan}
                  onChange={(e) => setPan_(e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  className="uppercase"
                />
                {pan && !panValid ? (
                  <span className="text-xs text-destructive">Enter a valid PAN (ABCDE1234F).</span>
                ) : null}
              </label>

              {redirectUrl ? (
                <div className="space-y-3">
                  <Button asChild variant="outline" className="w-full">
                    <a href={redirectUrl} target="_blank" rel="noreferrer">
                      Complete KYC verification <ExternalLink />
                    </a>
                  </Button>
                  {/* Re-poll CKYC (not a blind navigate): only advances once FG
                      returns a confirmed CKYC number for the completed upload. */}
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={() => runCkyc("pan")}
                    disabled={busy || !panValid}
                  >
                    {ckyc.isPending ? (
                      <>
                        <Loader2 className="animate-spin" /> Checking…
                      </>
                    ) : (
                      <>
                        I’ve completed KYC — continue <ArrowRight />
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => runCkyc("pan")}
                  disabled={busy || !panValid}
                >
                  {ckyc.isPending ? (
                    <>
                      <Loader2 className="animate-spin" /> Verifying…
                    </>
                  ) : (
                    <>
                      <ShieldAlert /> Verify KYC
                    </>
                  )}
                </Button>
              )}

              {showAlternates ? (
                <div className="space-y-5 rounded-lg border border-dashed p-4">
                  <p className="text-sm font-medium">
                    No PAN-based KYC record found. Try an alternate option:
                  </p>

                  {/* Alternate 1 — Aadhaar-based CKYC */}
                  <div className="space-y-2">
                    <span className="text-sm font-medium">1 · Verify with Aadhaar</span>
                    <Input
                      value={aadhaar}
                      onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))}
                      placeholder="12-digit Aadhaar number"
                      maxLength={12}
                      inputMode="numeric"
                    />
                    <Input
                      value={aadhaarName}
                      onChange={(e) => setAadhaarName(e.target.value)}
                      placeholder="Name as per Aadhaar"
                    />
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => runCkyc("aadhaar")}
                      disabled={busy || !aadhaarValid || aadhaarName.trim().length < 2}
                    >
                      {ckyc.isPending ? (
                        <>
                          <Loader2 className="animate-spin" /> Verifying…
                        </>
                      ) : (
                        "Verify with Aadhaar"
                      )}
                    </Button>
                  </div>

                  {/* Alternate 2 — OVD document upload */}
                  {supportsOvd ? (
                    <div className="space-y-2 border-t pt-4">
                      <span className="text-sm font-medium">2 · Upload documents (OVD)</span>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-xs text-muted-foreground">Identity proof</span>
                          <select
                            className={selectClass}
                            value={poiType}
                            onChange={(e) => setPoiType(e.target.value as OvdDocType)}
                          >
                            {OVD_DOC_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          <Input
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={(e) => setPoiFile(e.target.files?.[0] ?? null)}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-muted-foreground">Address proof</span>
                          <select
                            className={selectClass}
                            value={poaType}
                            onChange={(e) => setPoaType(e.target.value as OvdDocType)}
                          >
                            {OVD_DOC_TYPES.filter((t) => t !== "PAN").map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          <Input
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={(e) => setPoaFile(e.target.files?.[0] ?? null)}
                          />
                        </label>
                      </div>
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
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <Button className="w-full" size="lg" onClick={proceed}>
              Continue <ArrowRight />
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

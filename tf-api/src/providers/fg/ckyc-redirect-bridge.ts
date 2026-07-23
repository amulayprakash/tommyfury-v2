/**
 * Self-hosted CKYC redirect bridge. Replaces FG's vendor fg_kyc_redirection*.html
 * (which loads jQuery from Google's CDN — blocked under our CSP) with an
 * equivalent form that auto-submits via vanilla JS and carries OUR real return
 * URL. The form POSTs to the eKYC portal access URL that VerifyCKYC returns
 * (KycResult.redirectUrl); proposalId fills both VISoF_KYC_Req_No and IC_KYC_No.
 */

export interface KycRedirectParams {
  /** eKYC portal access URL from VerifyCKYC response.url (carries ?access=<token>). */
  actionUrl: string;
  /** VerifyCKYC proposal_id (PR_xxx) — used for VISoF_KYC_Req_No and IC_KYC_No. */
  proposalId: string;
  /** Absolute URL the eKYC portal returns the browser to (env FG_CKYC_RETURN_URL). */
  returnUrl: string;
}

/** Escapes a value for safe inclusion inside a double-quoted HTML attribute. */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Builds the self-hosted CKYC redirect HTML (no external CDN; vanilla-JS auto-submit). */
export function buildKycRedirectHtml(params: KycRedirectParams): string {
  const action = escapeHtmlAttr(params.actionUrl);
  const proposalId = escapeHtmlAttr(params.proposalId);
  const returnUrl = escapeHtmlAttr(params.returnUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redirecting to KYC portal…</title>
</head>
<body>
<p><strong>You are being redirected to the KYC portal.</strong></p>
<p>Please wait… (do not press Refresh or Back)</p>
<form id="kycRedirectionForm" method="post" action="${action}">
<input type="hidden" name="VISoF_KYC_Req_No" value="${proposalId}">
<input type="hidden" name="IC_KYC_No" value="${proposalId}">
<input type="hidden" name="VISoF_Return_URL" value="${returnUrl}">
<noscript><button type="submit">Continue to KYC</button></noscript>
</form>
<script>document.getElementById("kycRedirectionForm").submit();</script>
</body>
</html>`;
}

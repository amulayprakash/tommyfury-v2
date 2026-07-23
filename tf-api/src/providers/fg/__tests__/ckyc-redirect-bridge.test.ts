import { describe, it, expect } from "vitest";
import { buildKycRedirectHtml } from "../ckyc-redirect-bridge.ts";

const params = {
  actionUrl: "https://ekyc-uat.fggeneral.in/kyc-v2-verification?access=abc123",
  proposalId: "PR_4UT0K13BMJR",
  returnUrl: "https://app.example.com/vehicle/kyc/return",
};

describe("buildKycRedirectHtml", () => {
  it("loads no external CDN / no external script", () => {
    const html = buildKycRedirectHtml(params);
    expect(html).not.toMatch(/googleapis\.com/i);
    expect(html).not.toMatch(/jquery/i);
    // No <script src="..."> pulling anything remote.
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });

  it("sets the form action to the eKYC access URL", () => {
    const html = buildKycRedirectHtml(params);
    expect(html).toContain('action="https://ekyc-uat.fggeneral.in/kyc-v2-verification?access=abc123"');
    expect(html).toContain('method="post"');
  });

  it("emits the three hidden fields with the proposalId and our return URL", () => {
    const html = buildKycRedirectHtml(params);
    expect(html).toContain('name="VISoF_KYC_Req_No" value="PR_4UT0K13BMJR"');
    expect(html).toContain('name="IC_KYC_No" value="PR_4UT0K13BMJR"');
    expect(html).toContain('name="VISoF_Return_URL" value="https://app.example.com/vehicle/kyc/return"');
  });

  it("auto-submits the form and degrades to a button without JS", () => {
    const html = buildKycRedirectHtml(params);
    expect(html).toMatch(/\.submit\(\)/);
    expect(html).toMatch(/<noscript>/i);
  });

  it("HTML-escapes attribute values to prevent injection", () => {
    const html = buildKycRedirectHtml({
      ...params,
      proposalId: 'PR"><script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;");
  });
});

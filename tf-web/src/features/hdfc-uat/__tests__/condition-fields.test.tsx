import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AccessoryFields,
  PreviousInsurerFields,
  PreviousPolicyFields,
} from "../components/condition-fields";
import type { HdfcConditions } from "../hdfc-uat-store";

/**
 * The certification-only inputs are COLLAPSED, not deleted.
 *
 * None of them is needed to reach a policy number, and left expanded they buried
 * the handful of fields that are — so they moved into `<details>` blocks. The
 * distinction matters: accessories drive pack rows 25-26, the previous-TP block
 * drives the standalone-OD rows, and the previous-insurer cross-walk is the
 * field HDFC rejects when it is wrong. Deleting them would make those conditions
 * undrivable from the UI, so these tests assert they are still REACHABLE.
 */

const conditions = {
  previousInsurerId: "TATAAIG",
  previousInsurerName: "Tata AIG",
  previousPolicyNumber: "PREVPOL0001",
  previousPolicyStartDate: "2025-08-29",
  previousPolicyExpiryDate: "2026-08-28",
  isPreviousPolicyExpired: false,
} as HdfcConditions;

/** The nearest enclosing <details>, or null when the field is always visible. */
const enclosingDetails = (el: HTMLElement) => el.closest("details");

describe("certification-only inputs are collapsed but present", () => {
  it("keeps every accessory input in the DOM, inside a collapsed block", () => {
    render(<AccessoryFields conditions={conditions} onChange={vi.fn()} />);

    for (const label of [
      /^Electrical accessories sum insured/i,
      /Non-electrical accessories sum insured/i,
      /Bi-fuel kit sum insured/i,
      /Unnamed passenger PA sum insured/i,
    ]) {
      const field = screen.getByLabelText(label);
      expect(field).toBeInTheDocument();
      expect(enclosingDetails(field)).not.toBeNull();
      expect(enclosingDetails(field)).not.toHaveAttribute("open");
    }
  });

  it("keeps the previous-insurer cross-walk reachable", () => {
    render(<PreviousInsurerFields conditions={conditions} onChange={vi.fn()} />);

    const code = screen.getByLabelText(/Previous insurer code/i);
    expect(code).toHaveValue("TATAAIG");
    expect(enclosingDetails(code)).not.toBeNull();
  });
});

describe("issuance-critical inputs stay visible", () => {
  it("does not hide the previous policy fields a rollover needs to bind", () => {
    render(<PreviousPolicyFields conditions={conditions} onChange={vi.fn()} />);

    // The expiry date decides rollover vs break-in, so it must never be behind
    // a disclosure the tester has to know to open.
    for (const label of [/Previous policy number/i, /Policy expiry date/i, /Policy start date/i]) {
      expect(enclosingDetails(screen.getByLabelText(label))).toBeNull();
    }
  });

  it("keeps the break-in flag visible, since it changes whether HDFC will bind", () => {
    render(<PreviousPolicyFields conditions={conditions} onChange={vi.fn()} />);
    const flag = screen.getByLabelText(/already expired \(break-in\)/i);
    expect(enclosingDetails(flag)).toBeNull();
  });
});

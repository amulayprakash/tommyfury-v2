import { tag } from "./format.ts";
import { assertItgiSuccess, isItgiSuccessMessage } from "./errors.ts";
import { findReturn } from "./proposal.ts";

export interface ItgiPaymentInput {
  /** From the proposal response. */
  orderNumber: string;
  traceNumber: string;
  amount: number;
  /**
   * These originate from our own payment gateway's authorisation response. The
   * exact values ITGI expects are an open confirmation with the vendor.
   */
  authorizationCode: string;
  authorizationStatus: string;
  authorizationDecision?: "Y" | "N";
}

const u = (name: string, value: string | number | undefined) => tag(`util:${name}`, value);

/** Binds a collected payment to the proposal created by validateProposalRequest. */
export function buildPaymentPayload(input: ItgiPaymentInput, partnerCode: string): string {
  return (
    `<util:updatePaymentDetails><util:input>` +
    u("amount", input.amount) +
    u("authorizationCode", input.authorizationCode) +
    u("authorizationDecision", input.authorizationDecision ?? "Y") +
    u("authorizationStatus", input.authorizationStatus) +
    u("orderNumber", input.orderNumber) +
    u("partnerCode", partnerCode) +
    u("traceNumber", input.traceNumber) +
    `</util:input></util:updatePaymentDetails>`
  );
}

export interface ItgiPaymentResult {
  policyNumber: string;
  statusMessage: string;
  premiumPayable: number;
  success: boolean;
  /**
   * Break-in policies are accepted but only issued after ITGI's agency approves
   * the inspection; the "policy number" is the quote id until then.
   */
  isBreakInPending: boolean;
}

export function parsePaymentResponse(body: unknown): ItgiPaymentResult {
  const r = findReturn(body, "updatePaymentDetailsReturn");
  assertItgiSuccess(r, "payment");
  const statusMessage = String(r.statusMessage ?? "").trim();
  return {
    policyNumber: String(r.policyNumber ?? "").trim(),
    statusMessage,
    premiumPayable: Math.round(Number(r.premiumPayable ?? 0)),
    success: isItgiSuccessMessage(statusMessage),
    isBreakInPending: statusMessage.toUpperCase() === "PAYMENT_ACCEPTED_BREAK_IN",
  };
}

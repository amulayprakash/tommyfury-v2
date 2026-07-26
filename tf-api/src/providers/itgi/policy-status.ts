import { tag } from "./format.ts";
import { assertItgiSuccess } from "./errors.ts";
import { findReturn } from "./proposal.ts";

export interface ItgiStatusInput {
  /** The id we minted and sent on the proposal — the vendor's lookup key. */
  uniqueQuoteId: string;
  contractType: "PCP" | "TWP";
  messageId?: string;
}

const u = (name: string, value: string | number | undefined) => tag(`util:${name}`, value);

export function buildStatusPayload(input: ItgiStatusInput, partnerCode: string): string {
  return (
    `<util:getPolicyStatus><util:input>` +
    u("contractType", input.contractType) +
    u("messageId", input.messageId) +
    u("partnerCode", partnerCode) +
    u("uniqueQuoteId", input.uniqueQuoteId) +
    `</util:input></util:getPolicyStatus>`
  );
}

export interface ItgiStatusResult {
  policyNumber: string;
  status: string;
  traceNo: string;
  amount: number;
  /** authFlag: Y = payment confirmed, N = failed, blank = never attempted. */
  isPaid: boolean;
}

export function parseStatusResponse(body: unknown): ItgiStatusResult {
  const r = findReturn(body, "getPolicyStatusReturn");
  assertItgiSuccess(r, "policy-status");
  return {
    policyNumber: String(r.policyNo ?? "").trim(),
    status: String(r.status ?? "").trim(),
    traceNo: String(r.traceNo ?? "").trim(),
    amount: Math.round(Number(r.amount ?? 0)),
    isPaid: String(r.authFlag ?? "").trim().toUpperCase() === "Y",
  };
}

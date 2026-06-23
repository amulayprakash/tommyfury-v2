import type { Request, Response, NextFunction } from "express";
import { initiatePayment, handlePaymentCallback } from "@/services/payment.service.ts";

export function handlePaymentInitiate(req: Request, res: Response, next: NextFunction): void {
  try {
    const { provider } = req.params as { provider: string };
    const form = initiatePayment(provider, req.body as never);
    res.status(200).json({ status: "success", requestId: req.requestId, form });
  } catch (err) {
    next(err);
  }
}

/**
 * FG payment ResponseURL callback. FG POSTs the (encrypted) result here; on
 * success we issue the policy and 302-redirect the browser to the web result
 * page. Accepts both POST body and GET query params (PHP integration mode).
 */
export async function handlePaymentCallbackController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = req.params as { provider: string };
    const raw = { ...(req.query as Record<string, unknown>), ...(req.body as Record<string, unknown>) };
    const outcome = await handlePaymentCallback(provider, raw);
    res.redirect(302, outcome.redirectUrl);
  } catch (err) {
    next(err);
  }
}

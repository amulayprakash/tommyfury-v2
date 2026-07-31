import config from '../config/env.js';
import { encryptPaymentParams, decryptPaymentReturn } from '../services/soap.service.js';
import { PAYMENT_DEFAULTS } from '../constants/payment.constants.js';
import * as journeyService from '../services/journey.service.js';
import * as logRepo from '../repositories/log.repository.js';
import { JOURNEY_STEPS } from '../constants/journey.constants.js';
import {
  findMissingMandatoryFields,
  buildPaymentQuerystring,
  logPaymentPlaintext,
  parseReturnMessage,
  buildSafeCallbackErrorMessage,
} from '../helpers/payment.helper.js';

// Builds and encrypts the payment querystring (`encparam`). The frontend
// takes the response and auto-submits an HTML form POST to `gatewayUrl` —
// getPaymentValues.aspx is a redirect-based payment page, not a JSON API.
//
// The persisted journey_payments row created here is what makes the gateway
// callback recoverable: unqPolicyNumber is stored now so the callback, which
// arrives with no session of any kind, can be matched back to this journey.
export const initiatePayment = async (req, res) => {
  const startedAt = Date.now();
  const journeyId = req.journeyId;

  try {
    const body = {
      ...PAYMENT_DEFAULTS,
      returnPath: config.nivabupa.payment.returnUrl,
      ...req.body
    };

    const missing = findMissingMandatoryFields(body);
    if (missing.length > 0) {
      // Validation failures have no api_transactions row of their own (nothing
      // was called upstream), so they go on journey_events as an ERROR — this
      // is the case the schema's "no separate error_logs table" note covers.
      await journeyService.safeSave('paymentValidation', () => logRepo.recordError({
        journeyId,
        toStep: JOURNEY_STEPS.PAYMENT_INITIATED,
        message: 'payment/initiate rejected: missing mandatory fields',
        errorCode: 'MISSING_FIELDS',
        errorMessage: missing.join(', '),
      }));

      return res.status(400).json({
        status: 'ERROR',
        message: `Missing required payment field(s): ${missing.join(', ')}`
      });
    }

    const querystring = buildPaymentQuerystring(body);
    logPaymentPlaintext(body, querystring);

    const encparam = await encryptPaymentParams(querystring);

    console.log('📥 NivaBupa payment/initiate — final encparam:', encparam);

    const payment = await journeyService.recordPaymentInitiate({
      journeyId,
      body,
      querystring,
      encparam,
      gatewayUrl: config.nivabupa.payment.gatewayUrl,
      httpSucceeded: true,
      durationMs: Date.now() - startedAt,
      endpointUrl: config.nivabupa.payment.soapUrl,
      context: req.journeyContext,
    });

    return res.status(200).json({
      status: 'SUCCESS',
      encparam,
      gatewayUrl: config.nivabupa.payment.gatewayUrl,
      method: 'POST',
      ...(payment
        ? {
          journeyId: req.journey.uuid,
          paymentAttempt: payment.attempt_no,
          unqPolicyNumber: payment.unq_policy_number,
        }
        : {}),
    });
  } catch (error) {
    console.error('❌ NivaBupa payment encryption failed:', error.response?.data || error.message);

    await journeyService.recordPaymentInitiate({
      journeyId,
      body: req.body,
      httpSucceeded: false,
      durationMs: Date.now() - startedAt,
      endpointUrl: config.nivabupa.payment.soapUrl,
      errorMessage: error.message,
      context: req.journeyContext,
    });

    return res.status(502).json({
      status: 'ERROR',
      message: error.message,
      nivabupa_response: error.response?.data || null
    });
  }
};

// NivaBupa POSTs here (the URL registered as `returnPath`) once payment
// completes, with an encrypted `returnMessage`. This request IS the buyer's
// browser being carried back from NivaBupa's payment page (see
// initiatePayment's comment — the frontend auto-submitted a form POST to get
// there), so the response has to be a redirect back into the SPA, not a raw
// JSON body — returning JSON here would leave the buyer looking at plain
// text instead of the app.
//
// Persistence changes what this hand-off can carry. Previously every field the
// return page needed had to travel in the redirect query string because nothing
// was stored. Now the payment outcome is written to journey_payments first and
// the redirect also carries journeyId + resumeToken, so the SPA rehydrates the
// whole journey on landing instead of rebuilding it from four query params. The
// original query params are still sent, unchanged, so an existing return page
// keeps working.
export const handlePaymentReturn = async (req, res) => {
  const startedAt = Date.now();
  const frontendUrl = config.frontendUrl;

  // Logged verbatim, before any processing/decryption — req.body/req.query
  // are read but never mutated here, so this is exactly what NivaBupa sent.
  console.log('\n========== NivaBupa Callback Received ==========');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Request URL:', req.originalUrl);
  console.log('HTTP Method:', req.method);
  console.log('Headers:', req.headers);
  console.log('Query Parameters:', req.query);
  console.log('Request Body:', req.body);
  console.log('Raw Callback Payload:', req.body && Object.keys(req.body).length ? req.body : req.query);
  const encryptedResponse = req.body?.returnMessage || req.query?.returnMessage
    || req.body?.encResp || req.query?.encResp
    || req.body?.cipherText || req.query?.cipherText;
  console.log('Encrypted returnMessage / cipherText:', encryptedResponse);
  console.log('Content-Type:', req.headers['content-type']);
  console.log('===============================================');

  const { returnMessage } = req.body;
  const rawCallback = req.body && Object.keys(req.body).length ? req.body : req.query;

  try {
    if (!returnMessage) {
      throw Object.assign(new Error('returnMessage missing from NivaBupa payment callback'), { noResponse: true });
    }

    // decResp API request/response (endpoint, SOAPAction, key, payload, HTTP
    // status, full SOAP response, parsed decRespResult) are all logged inside
    // callSoap() in services/soap.service.js — shared by every SOAP call so the
    // detail is identical whether this succeeds or throws a SOAP Fault.
    const decrypted = await decryptPaymentReturn(returnMessage);
    const parsed = parseReturnMessage(decrypted);

    console.log('\n----- Decrypted Payment Details -----');
    console.log('   Transaction ID:', parsed.paymentTransactionId);
    console.log('   Payment Status:', parsed.paymentStatus, '→', parsed.paymentStatusDescription);
    console.log('   Policy Number (uniqueReferenceId):', parsed.uniqueReferenceId);
    console.log('   Amount:', parsed.payablePremium);
    console.log('   Error/Failed Reason:', parsed.failedReason || null);
    console.log('   Full decrypted record:', parsed);

    // No separate "policy creation" step happens here — for this integration
    // the policy is created via Data Push, which the frontend's return page
    // fires once it lands back in the app. This stage confirms the gateway's
    // payment outcome and now also persists it: the journey is located by the
    // unqPolicyNumber stored at initiate time (the callback echoes it back as
    // uniqueReferenceId), which is the only identity this request carries.
    const saved = await journeyService.recordPaymentCallback({
      parsed,
      decrypted,
      rawBody: rawCallback,
      durationMs: Date.now() - startedAt,
      context: { ipAddress: req.ip || null },
    });

    console.log('\n----- Backend Processing -----');
    console.log('   Payment outcome confirmed for reference =', parsed.uniqueReferenceId);
    if (saved?.journey) {
      console.log('   Correlated to journey', saved.journey.uuid, '→ step', saved.journey.current_step);
    } else {
      console.log('   ⚠️  Not correlated to any journey — see api_transactions for the unmatched callback row.');
    }

    const query = new URLSearchParams({
      status: parsed.paymentStatusDescription,
      policyNumber: parsed.uniqueReferenceId || '',
      premium: parsed.payablePremium || '',
      paymentTxnId: parsed.paymentTransactionId || '',
    });
    if (parsed.paymentStatusDescription !== 'SUCCESS' && parsed.failedReason) {
      query.set('message', parsed.failedReason);
    }
    // The resume pair. With these the return page calls
    // POST /nivabupa/journey/resume and gets the full journey back, so a buyer
    // whose browser lost its storage during the gateway round-trip still lands
    // in a restored app.
    if (saved?.journey) {
      query.set('journeyId', saved.journey.uuid);
      query.set('resumeToken', saved.journey.resume_token);
    }

    console.log('\n----- Final Callback Response (redirect to frontend) -----');
    console.log('   ', `${frontendUrl}/nivabupa-return?${query.toString()}`);

    return res.redirect(302, `${frontendUrl}/nivabupa-return?${query.toString()}`);
  } catch (error) {
    console.error('\n❌ NivaBupa payment return processing failed');
    console.error('   Error message:', error.message);
    console.error('   Error response data:', error.soapResponseData || error.response?.data || null);
    console.error('   Stack:', error.stack);

    // A callback that arrived but could not be decrypted or parsed is the worst
    // case in this flow: money may have moved with no record linking it to a
    // journey. Persisting the raw body and the failure is what makes that
    // reconcilable instead of stdout-only.
    await journeyService.recordPaymentCallbackFailure({
      rawBody: rawCallback,
      errorMessage: error.message,
      errorStack: error.stack,
      referenceId: null,
    });

    const safeMessage = error.noResponse ? error.message : buildSafeCallbackErrorMessage(error);
    const query = new URLSearchParams({ status: 'ERROR', message: safeMessage });

    console.log('\n----- Final Callback Response (redirect to frontend) -----');
    console.log('   ', `${frontendUrl}/nivabupa-return?${query.toString()}`);

    return res.redirect(302, `${frontendUrl}/nivabupa-return?${query.toString()}`);
  }
};

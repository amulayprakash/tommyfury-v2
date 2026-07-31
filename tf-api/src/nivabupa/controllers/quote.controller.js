import * as nivabupaApi from '../services/genericApi.service.js';
import * as journeyService from '../services/journey.service.js';
import config from '../config/env.js';
import { JOURNEY_STEPS } from '../constants/journey.constants.js';

// Pass-through: the caller sends the exact Reassure 3.0 premium request shape
// (policyTerm, coverageType, sumInsured, member[], policyAdjustmentList[], ...
// per the Premium Data Dictionary), the service just attaches auth and
// forwards it.
//
// The response shape is unchanged from before journey persistence existed — a
// `quoteId` field is added when a journey is in context, and nothing is
// removed, so an existing frontend build keeps working untouched.
export const getPremium = async (req, res) => {
  const startedAt = Date.now();
  // journeyContext middleware resolved this (and already stripped journeyId
  // from req.body so it is never forwarded upstream).
  const journeyId = req.journeyId;

  try {
    const data = await nivabupaApi.getPremium(req.body);

    // Autosave: the quote row, its member rows and the api_transactions entry
    // are written in one transaction. safeSave inside the service means a
    // persistence failure logs and returns null rather than turning a
    // successful NivaBupa call into a 500 for the buyer.
    const saved = await journeyService.recordPremiumCall({
      journeyId,
      journeyStep: JOURNEY_STEPS.QUOTE_GENERATED,
      requestPayload: req.body,
      responsePayload: data,
      httpSucceeded: true,
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
      endpointUrl: config.nivabupa.premiumUrl,
      context: req.journeyContext,
    });

    return res.status(200).json({
      status: 'SUCCESS',
      data,
      // Present only with a journey in context. The SPA needs it to call
      // /nivabupa/journey/:journeyId/select-quote once the buyer chooses.
      ...(saved?.quote ? { quoteId: saved.quote.uuid, journeyId: req.journey.uuid } : {}),
    });
  } catch (error) {
    console.error('❌ NivaBupa premium call failed:', error.response?.data || error.message);

    // Failures are persisted too: a FAILED quote row plus the api_transactions
    // entry is how a support query about "it wouldn't give me a price" gets
    // answered after the fact.
    await journeyService.recordPremiumCall({
      journeyId,
      journeyStep: JOURNEY_STEPS.QUOTE_GENERATED,
      requestPayload: req.body,
      responsePayload: error.response?.data || null,
      httpSucceeded: false,
      httpStatus: error.response?.status || null,
      durationMs: Date.now() - startedAt,
      endpointUrl: config.nivabupa.premiumUrl,
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

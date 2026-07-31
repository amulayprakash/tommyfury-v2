import * as nivabupaApi from '../services/genericApi.service.js';
import * as journeyService from '../services/journey.service.js';
import config from '../config/env.js';

// Pass-through: caller sends the UW request shape (Proposal.POLICY / NOMINEE
// / MEMBER[] / PROPOSER, per UW request.txt) — same auth/forward mechanics
// as Premium.
//
// Response shape unchanged (status / payload / data); uwStatus is added when a
// journey is in context.
export const getUwDecision = async (req, res) => {
  const startedAt = Date.now();
  const journeyId = req.journeyId;
  const payload = req.body;

  try {
    const data = await nivabupaApi.getUwDecision(payload);

    // Autosave: the UW decision lands on the journey's proposal row so a buyer
    // who breaks after underwriting resumes at the review screen with the
    // decision intact, instead of being underwritten a second time.
    const saved = await journeyService.recordUwDecision({
      journeyId,
      requestPayload: payload,
      responsePayload: data,
      httpSucceeded: true,
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
      endpointUrl: config.nivabupa.uwDecisionUrl,
      context: req.journeyContext,
    });

    return res.status(200).json({
      status: "SUCCESS",
      payload, // Request payload
      data,     // NivaBupa response
      ...(saved ? { uwStatus: saved.uw_status, journeyId: req.journey.uuid } : {}),
    });
  } catch (error) {
    console.error("❌ NivaBupa UW decision call failed:", error.response?.data || error.message);
    console.log("📤 Request Payload:", req.body);

    await journeyService.recordUwDecision({
      journeyId,
      requestPayload: payload,
      responsePayload: error.response?.data || null,
      httpSucceeded: false,
      httpStatus: error.response?.status || null,
      durationMs: Date.now() - startedAt,
      endpointUrl: config.nivabupa.uwDecisionUrl,
      errorMessage: error.message,
      context: req.journeyContext,
    });

    return res.status(502).json({
      status: "ERROR",
      message: error.message,
      payload: req.body, // Request payload
      nivabupa_response: error.response?.data || null
    });
  }
};

// Pass-through: caller sends the full proposal payload (per data push
// dictionary.xlsx) — pushes it to NivaBupa and returns their
// { RESPONSE: { STATUS, POLICY_CODE, STATUS_MESSAGE } } envelope.
//
// This is the step that produces the application number, so persisting its
// result is what lets a journey that breaks here check its own status later —
// POLICY_CODE is the only input /nivabupa/proposal-status accepts, and it is
// returned exactly once.
export const submitDataPush = async (req, res) => {
  const startedAt = Date.now();
  const journeyId = req.journeyId;

  try {
    const data = await nivabupaApi.submitDataPush(req.body);

    const saved = await journeyService.recordDataPush({
      journeyId,
      requestPayload: req.body,
      responsePayload: data,
      httpSucceeded: true,
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
      endpointUrl: config.nivabupa.dataPushUrl,
      context: req.journeyContext,
    });

    return res.status(200).json({
      status: 'SUCCESS',
      data,
      ...(saved
        ? {
          journeyId: req.journey.uuid,
          applicationNumber: saved.application_number,
          datapushStatus: saved.datapush_status,
        }
        : {}),
    });
  } catch (error) {
    console.error('❌ NivaBupa data push failed:', error.response?.data || error.message);

    await journeyService.recordDataPush({
      journeyId,
      requestPayload: req.body,
      responsePayload: error.response?.data || null,
      httpSucceeded: false,
      httpStatus: error.response?.status || null,
      durationMs: Date.now() - startedAt,
      endpointUrl: config.nivabupa.dataPushUrl,
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

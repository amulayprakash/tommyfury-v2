'use strict';

const cfg = require('../config/hdfc');
const hdfc = require('../services/hdfcService');
const buildCar = require('../services/payloadBuilder');        // Private Car (verified)
const buildMotor = require('../services/payloadBuilderMotor'); // TW / GCV / PCV
const mmv = require('../services/hdfcMmvService');
const rtoSvc = require('../services/hdfcRtoService');
const policyStore = require('../services/policyStore');
const { generateTransactionId, HdfcError } = require('../utils/helpers');

/** Resolve LOB + commercial sub-type from vehicleType. */
function ctx(req) {
  const vt = (req.body && req.body.vehicleType) || 'four_wheeler';
  const resolved = cfg.resolveLobForVehicleType(vt);
  return { lob: resolved.lob, subType: resolved.subType || null, vt };
}
// Back-compat: some functions only need the lob.
function lobOf(req) { return ctx(req).lob; }

/** Pick the payload builder for the LOB (car vs two-wheeler/commercial). */
function builderFor(lob) {
  return lob === cfg.LOB.PVT_CAR ? buildCar : buildMotor;
}

/**
 * Resolve the real HDFC vehicle_model_code AND rto_code from the DB tables
 * (hdfcmmv + hdfcrto_master). The frontend may send names/prefixes; HDFC needs
 * its own codes. Mutates body.vehicle in place. Throws if model can't be mapped.
 */
async function resolveVehicle(body) {
  const v = body.vehicle || {};

  // --- Model code (hdfcmmv) ---
  let modelRow = await mmv.findByCode(v.modelCode);
  if (!modelRow) {
    modelRow = await mmv.findModelCode({
      manufacturer: v.manufacturer || v.make,
      model: v.model || v.modelName,
      variant: v.variant,
      fuel: v.fuelType,
      cubicCapacity: v.cubicCapacity,
    });
  }
  if (!modelRow) {
    throw new HdfcError(
      `Could not map vehicle to an HDFC model code (make="${v.manufacturer || v.make || ''}", model="${v.model || v.modelName || ''}"). Check hdfcmmv.`,
      { step: 'modelLookup' }
    );
  }

  // --- RTO code (hdfcrto_master) ---
  let rtoRow = await rtoSvc.findByCode(v.rtoCode);
  if (!rtoRow) {
    rtoRow = await rtoSvc.findRtoCode({
      registrationNo: v.registrationNo,
      rtoName: v.rtoName,
      state: v.state,
    });
  }

  body.vehicle = {
    ...v,
    modelCode: modelRow.vehicle_model_code,
    fuelType: v.fuelType || modelRow.fuel_type,
    // keep the caller's rtoCode if the table lookup found nothing
    rtoCode: rtoRow ? rtoRow.rto_code : v.rtoCode,
  };
  return { modelRow, rtoRow };
}

/**
 * Extract a normalized premium summary. Each product returns its own response
 * block (Resp_PvtCar / Resp_TW / Resp_GCV / Resp_PCV); read whichever is present.
 */
function extractPremiumSummary(hdfcData) {
  const d = hdfcData?.response || hdfcData || {};
  const r = d.Resp_PvtCar || d.Resp_TW || d.Resp_GCV || d.Resp_PCV || d.Resp_Motor || {};
  return {
    idv: r.IDV ?? r.Vehicle_IDV ?? null,
    netPremium: r.Net_Premium ?? null,
    tax: r.Service_Tax ?? null,
    totalPremium: r.Total_Premium ?? null,
    odPremium: r.OD_Premium ?? r.Total_OD_Premium ?? null,
    tpPremium: r.TP_Premium ?? r.Total_TP_Premium ?? null,
    raw: r,
  };
}

/* --------------------------- Discrete endpoints -------------------------- */

/** Call the right builder for premium/proposal (signatures differ per module). */
function buildPremiumPayload(b, body, lob, subType) {
  return b === buildCar ? b.buildCalculatePremium(body) : b.buildCalculatePremium(body, lob, subType);
}
function buildProposalPayload(b, body, lob, subType) {
  return b === buildCar ? b.buildCreateProposal(body) : b.buildCreateProposal(body, lob, subType);
}

async function authenticate(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const token = await hdfc.authenticate(lob, { subType, force: true });
    res.json({ success: true, lob, subType, token });
  } catch (err) { next(err); }
}

async function getIDV(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const b = builderFor(lob);
    const payload = b.buildGetCalculateIDV(req.body);
    const result = await hdfc.getCalculateIDV(lob, payload, { subType });
    res.json({ success: true, step: 'getCalculateIDV', payload, response: result.data });
  } catch (err) { next(err); }
}

async function calculatePremium(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const b = builderFor(lob);
    const payload = buildPremiumPayload(b, req.body, lob, subType);
    const result = await hdfc.calculatePremium(lob, payload, { subType });
    res.json({
      success: true,
      step: 'calculatePremium',
      payload,
      summary: extractPremiumSummary(result.data),
      response: result.data,
    });
  } catch (err) { next(err); }
}

async function createProposal(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const b = builderFor(lob);
    // 4-step flow vaparta tevha he ithehi lagte (issue flow madhe aahe tase):
    // nominee -> addons merge, ani model/rto code resolve.
    const body = { ...req.body };
    if (body.nominee) {
      body.addons = {
        ...(body.addons || {}),
        nomineeName: body.nominee.name,
        nomineeAge: body.nominee.age,
        nomineeRelationship: body.nominee.relationship,
      };
    }
    if (lob === cfg.LOB.PVT_CAR) {
      await resolveVehicle(body);
    }
    const payload = buildProposalPayload(b, body, lob, subType);
    const result = await hdfc.createProposal(lob, payload, { subType });
    const proposalNumber =
      result.data?.Policy_Details?.ProposalNumber ??
      result.data?.ProposalNumber ?? null;
    res.json({ success: true, step: 'createProposal', proposalNumber, payload, response: result.data });
  } catch (err) { next(err); }
}

async function getProposalDocument(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const b = builderFor(lob);
    const payload = b.buildGetProposalDocument(req.body);
    const result = await hdfc.getProposalDocument(lob, payload, { subType });
    res.json({ success: true, step: 'getProposalDocument', payload, response: result.data });
  } catch (err) { next(err); }
}

async function submitPayment(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const b = builderFor(lob);
    const payload = b.buildSubmitPaymentDetails(req.body);
    const result = await hdfc.submitPaymentDetails(lob, payload, { subType });
    // Policy number (HDFC deto Policy_Details.PolicyNumber — underscore nahi).
    const d = result.data || {};
    const policyNumber =
      d.Policy_Details?.PolicyNumber ??
      d.Policy_Details?.Policy_Number ??
      d.PolicyNumber ?? d.Policy_Number ?? null;
    // 4-step flow madhe pan policy hdfc_policies madhe save kar (best-effort).
    if (policyNumber) {
      try {
        await policyStore.saveIssuedPolicy({
          body: req.body,
          result: {
            proposalNumber: req.body.proposalNumber,
            policyNumber,
            trail: { payment: { payload, response: d } },
          },
        });
      } catch (e) {
        console.error('policyStore.saveIssuedPolicy failed:', e.message);
      }
    }
    res.json({ success: true, step: 'submitPaymentDetails', policyNumber, payload, response: d });
  } catch (err) { next(err); }
}

async function getPolicyDocument(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const b = builderFor(lob);
    const payload = b.buildGetPolicyDocument(req.body);
    const result = await hdfc.getPolicyDocument(lob, payload, { subType });
    const policyNumber =
      result.data?.Policy_Details?.PolicyNumber ??
      result.data?.Policy_Details?.Policy_Number ??
      result.data?.PolicyNumber ??
      result.data?.Policy_Number ?? req.body.policyNumber;
    res.json({ success: true, step: 'getPolicyDocument', policyNumber, payload, response: result.data });
  } catch (err) { next(err); }
}

async function renewalExtract(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    // Renewal flow is defined for Private Car in the collection.
    const payload = buildCar.buildRenewalExtract(req.body);
    const result = await hdfc.renewalExtract(lob, payload, { subType });
    res.json({ success: true, step: 'renewalExtract', payload, response: result.data });
  } catch (err) { next(err); }
}

/**
 * RENEWAL quote: RenewalExtract -> GetCalculateIDV -> CalculatePremium.
 * The renewal flow uses Req_Renewal (policy number) rather than full vehicle
 * details, matching the collection's Renewal folder exactly.
 */
async function renewalQuote(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const txn = req.body.transactionId || generateTransactionId('REN');
    const body = { ...req.body, transactionId: txn };

    const extract = await hdfc.renewalExtract(lob, buildCar.buildRenewalExtract(body), { subType });

    // Pull IDV / vehicle basics from the extract if the caller didn't supply.
    const ex = extract.data || {};
    const idvFromExtract =
      ex.Policy_Details?.Vehicle_IDV ?? ex.Vehicle_IDV ?? body.vehicle?.idv;
    body.vehicle = { ...(body.vehicle || {}), idv: idvFromExtract };

    const premiumResult = await hdfc.calculatePremium(lob, buildCar.buildRenewalCalculatePremium(body), { subType });

    res.json({
      success: true,
      transactionId: txn,
      extract: extract.data,
      premium: extractPremiumSummary(premiumResult.data),
      premiumResponse: premiumResult.data,
    });
  } catch (err) { next(err); }
}

/**
 * RENEWAL issue: CreateProposal(Req_Renewal) -> ProposalDoc -> Payment -> PolicyDoc.
 */
async function renewalIssue(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const txn = req.body.transactionId || generateTransactionId('REN');
    const body = { ...req.body, transactionId: txn };
    const trail = {};

    const propResult = await hdfc.createProposal(lob, buildCar.buildRenewalCreateProposal(body), { subType });
    const proposalNumber =
      propResult.data?.Policy_Details?.ProposalNumber ?? propResult.data?.ProposalNumber;
    if (!proposalNumber) {
      throw new HdfcError('Renewal CreateProposal returned no proposal number', {
        step: 'createProposal', hdfc: propResult.data,
      });
    }
    trail.createProposal = propResult.data;

    trail.proposalDocument = (await hdfc.getProposalDocument(lob, {
      TransactionID: txn, Req_Policy_Document: { Proposal_Number: proposalNumber },
    }, { subType })).data;

    const payResult = await hdfc.submitPaymentDetails(lob, buildCar.buildSubmitPaymentDetails({ ...body, proposalNumber }), { subType });
    trail.payment = payResult.data;
    const policyNumber = payResult.data?.Policy_Details?.PolicyNumber ?? payResult.data?.Policy_Details?.Policy_Number ?? payResult.data?.PolicyNumber ?? payResult.data?.Policy_Number ?? null;

    let policyDoc = null;
    if (policyNumber) {
      policyDoc = (await hdfc.getPolicyDocument(lob, {
        TransactionID: txn, Req_Policy_Document: { Policy_Number: policyNumber },
      }, { subType })).data;
    }

    const result = { success: true, transactionId: txn, proposalNumber, policyNumber, policyDocument: policyDoc, trail };

    // Persist to tf_api_dev.hdfc_policies once a policy exists. Best-effort:
    // never let a storage error break the successful issue response.
    if (policyNumber) {
      try {
        const id = await policyStore.saveIssuedPolicy({ body, result });
        result.storedId = id;
      } catch (e) {
        console.error('policyStore.saveIssuedPolicy failed:', e.message);
      }
    }

    res.json(result);
  } catch (err) { next(err); }
}

/* ------------------------- Orchestrated flows ---------------------------- */

/**
 * QUOTE flow: IDV -> Premium. Returns everything the frontend needs to show a
 * quote card (IDV + premium breakup). One shared TransactionID ties the steps.
 */
async function quote(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const b = builderFor(lob);
    const txn = req.body.transactionId || generateTransactionId('QT');
    const body = { ...req.body, transactionId: txn };

    // Resolve the real HDFC model code from hdfcmmv (Private Car).
    if (lob === cfg.LOB.PVT_CAR) {
      await resolveVehicle(body);
    }

    // Rollover date sanity: HDFC requires the previous policy's end date to be
    // BEFORE the new policy's start date. If the caller's previous end date is
    // on/after the start date (common when the old policy is still active),
    // move the new policy start to the day after the previous end.
    if (body.previousPolicy?.endDate && body.policy?.startDate) {
      const prevEnd = new Date(body.previousPolicy.endDate);
      const start = new Date(body.policy.startDate);
      if (!isNaN(prevEnd) && !isNaN(start) && start <= prevEnd) {
        const newStart = new Date(prevEnd);
        newStart.setDate(newStart.getDate() + 1);
        body.policy = { ...body.policy, startDate: newStart.toISOString().slice(0, 10) };
      }
    }

    const idvPayload = b.buildGetCalculateIDV(body);
    const idvResult = await hdfc.getCalculateIDV(lob, idvPayload, { subType });

    // IDV response (per data dictionary) is under CalculatedIDV:
    //   IDV_AMOUNT, MAX_IDV_AMOUNT, MIN_IDV_AMOUNT, EX_SHOWROOM_PRICE.
    // Fall back to other shapes just in case.
    const idvBlock =
      idvResult.data?.CalculatedIDV ||
      idvResult.data?.IDV_DETAILS ||
      idvResult.data ||
      {};
    const recommendedIdv =
      idvBlock.IDV_AMOUNT ??
      idvBlock.RecommendedIDV ??
      idvBlock.IDV ??
      null;
    const minIdv = idvBlock.MIN_IDV_AMOUNT ?? idvBlock.MinIDV ?? null;
    const maxIdv = idvBlock.MAX_IDV_AMOUNT ?? idvBlock.MaxIDV ?? null;

    // IDV handling: HDFC's premium step often rejects any IDV that deviates
    // from its own recommended value ("IDV Deviation not allowed"). Safest and
    // most reliable: always use HDFC's recommended IDV for the premium call.
    // (If you later add a user-facing IDV slider, clamp it to [min,max] and only
    // then pass it through.)
    const callerIdv = Number(body.vehicle?.idv) || 0;
    const inRange =
      callerIdv > 0 &&
      (!minIdv || callerIdv >= Number(minIdv)) &&
      (!maxIdv || callerIdv <= Number(maxIdv));
    // Prefer recommended; fall back to a valid caller IDV only if no recommended.
    const idvForPremium = recommendedIdv || (inRange ? callerIdv : null);
    if (idvForPremium) {
      body.vehicle = { ...body.vehicle, idv: idvForPremium };
    }

    const premiumPayload = buildPremiumPayload(b, body, lob, subType);
    const premiumResult = await hdfc.calculatePremium(lob, premiumPayload, { subType });

    res.json({
      success: true,
      transactionId: txn,
      // Echo back the resolved vehicle + policy so the proposal screen can
      // reuse them (model code, rto code, idv, dates) without re-resolving.
      vehicle: body.vehicle,
      policy: body.policy,
      previousPolicy: body.previousPolicy || {},
      addons: body.addons || {},
      idv: {
        recommended: recommendedIdv,
        min: minIdv,
        max: maxIdv,
        response: idvResult.data,
      },
      premium: extractPremiumSummary(premiumResult.data),
      premiumResponse: premiumResult.data,
    });
  } catch (err) { next(err); }
}

/**
 * ISSUE flow: CreateProposal -> GetProposalDocument -> SubmitPayment ->
 * GetPolicyDocument. Call this after the customer has paid (or in UAT with a
 * test payment). Uses one TransactionID across steps.
 */
async function issuePolicy(req, res, next) {
  try {
    const { lob, subType } = ctx(req);
    const b = builderFor(lob);
    const txn = req.body.transactionId || generateTransactionId('ISSUE');
    const body = { ...req.body, transactionId: txn };

    // The proposal payload builder reads nominee from addons.nominee* . The
    // frontend sends a separate `nominee` object, so merge it in. Also carry
    // the customer block straight through (builder reads body.customer).
    if (body.nominee) {
      body.addons = {
        ...(body.addons || {}),
        nomineeName: body.nominee.name,
        nomineeAge: body.nominee.age,
        nomineeRelationship: body.nominee.relationship,
      };
    }

    const trail = {};

    if (lob === cfg.LOB.PVT_CAR) {
      await resolveVehicle(body);
    }

    const propPayload = buildProposalPayload(b, body, lob, subType);
    const propResult = await hdfc.createProposal(lob, propPayload, { subType });
    const proposalNumber =
      propResult.data?.Policy_Details?.ProposalNumber ??
      propResult.data?.ProposalNumber;
    if (!proposalNumber) {
      throw new HdfcError('CreateProposal did not return a proposal number', {
        step: 'createProposal', hdfc: propResult.data,
      });
    }
    trail.createProposal = { proposalNumber, response: propResult.data };

    // Fetch proposal document (CIS / proposal PDF).
    const propDocResult = await hdfc.getProposalDocument(lob, {
      TransactionID: txn,
      Req_Policy_Document: { Proposal_Number: proposalNumber },
    }, { subType });
    trail.proposalDocument = propDocResult.data;

    // Submit payment.
    const paymentBody = { ...body, proposalNumber };
    const payPayload = b.buildSubmitPaymentDetails(paymentBody);
    const payResult = await hdfc.submitPaymentDetails(lob, payPayload, { subType });
    trail.payment = { payload: payPayload, response: payResult.data };

    // HDFC returns it as Policy_Details.PolicyNumber (no underscore) in the
    // payment response; accept every spelling we've seen.
    const policyNumber =
      payResult.data?.Policy_Details?.PolicyNumber ??
      payResult.data?.Policy_Details?.Policy_Number ??
      payResult.data?.PolicyNumber ??
      payResult.data?.Policy_Number ?? null;

    // Fetch policy document once issued.
    let policyDoc = null;
    if (policyNumber) {
      const polDocResult = await hdfc.getPolicyDocument(lob, {
        TransactionID: txn,
        Req_Policy_Document: { Policy_Number: policyNumber },
      }, { subType });
      policyDoc = polDocResult.data;
    }

    res.json({
      success: true,
      transactionId: txn,
      proposalNumber,
      policyNumber,
      policyDocument: policyDoc,
      trail,
    });
  } catch (err) { next(err); }
}

module.exports = {
  authenticate,
  getIDV,
  calculatePremium,
  createProposal,
  getProposalDocument,
  submitPayment,
  getPolicyDocument,
  renewalExtract,
  renewalQuote,
  renewalIssue,
  quote,
  issuePolicy,
  extractPremiumSummary,
};

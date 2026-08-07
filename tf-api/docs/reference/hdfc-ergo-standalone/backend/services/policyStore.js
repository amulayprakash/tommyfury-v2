'use strict';

const { pool } = require('../config/db');

/**
 * Persist a successfully issued HDFC policy into tf_api_dev.hdfc_policies.
 * Called from the issue flow after a policy number is obtained. Best-effort:
 * a storage failure must NOT break the issue response to the user, so callers
 * wrap this in try/catch and log only.
 */
async function saveIssuedPolicy({ body, result }) {
  const v = body.vehicle || {};
  const c = body.customer || {};
  const premium = result.premium || {};

  const sql = `
    INSERT INTO hdfc_policies
      (transaction_id, status, vehicle_type, model_code, rto_code,
       registration_no, engine_number, chassis_number,
       customer_name, customer_pan, customer_mobile, customer_email, pehchaan_id,
       idv, net_premium, total_premium,
       proposal_number, policy_number, policy_document,
       quote_data, proposal_data, issue_response)
    VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?, ?,?,?)
  `;

  const name = [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ');

  const params = [
    body.transactionId || null,
    'issued',
    body.vehicleType || null,
    v.modelCode || null,
    v.rtoCode || null,
    v.registrationNo || null,
    v.engineNumber || null,
    v.chassisNumber || null,
    name || null,
    c.panNo || null,
    c.mobile || null,
    c.email || null,
    c.pehchaanId || null,
    Number(premium.idv) || Number(v.idv) || null,
    Number(premium.netPremium) || null,
    Number(premium.totalPremium) || null,
    result.proposalNumber || null,
    result.policyNumber || null,
    result.policyDocument || null,
    JSON.stringify(body.quoteData || body.policy || {}),
    JSON.stringify(body || {}),
    JSON.stringify(result || {}),
  ];

  const [res] = await pool.query(sql, params);
  return res.insertId;
}

/** Fetch a stored policy by policy number (for later lookups). */
async function getByPolicyNumber(policyNumber) {
  const [rows] = await pool.query(
    'SELECT * FROM hdfc_policies WHERE policy_number = ? LIMIT 1',
    [policyNumber]
  );
  return rows[0] || null;
}

module.exports = { saveIssuedPolicy, getByPolicyNumber };

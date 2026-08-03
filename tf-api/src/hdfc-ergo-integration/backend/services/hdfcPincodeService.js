'use strict';

const { pool } = require('../config/db');

/**
 * hdfc_pincodemaster lookup — resolves state code + city/district code from a
 * pincode, for the proposal's Customer address block.
 *
 * Columns (confirmed):
 *   NUM_PINCODE, NUM_STATE_CD, NUM_CITYDISTRICT_CD, TXT_PINCODE_LOCALITY
 *
 * NOTE: the codes here may or may not match HDFC's CreateProposal expected
 * codes (we saw different state codes across masters). Verify against a real
 * proposal; a mapping layer can be added if they differ.
 */

/** Look up address codes for a pincode. Returns a normalized object or null. */
async function findByPincode(pincode) {
  if (!pincode) return null;
  const [rows] = await pool.query(
    `SELECT p.NUM_PINCODE, p.NUM_STATE_CD, p.NUM_CITYDISTRICT_CD,
            p.TXT_PINCODE_LOCALITY, s.state AS state_name
     FROM hdfc_pincodemaster p
     LEFT JOIN hdfc_statecode s ON s.state_cd = p.NUM_STATE_CD
     WHERE p.NUM_PINCODE = ?
     LIMIT 1`,
    [String(pincode).trim()]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    pincode: String(r.NUM_PINCODE),
    stateCode: String(r.NUM_STATE_CD),
    state: r.state_name || null,
    cityDistrictCode: String(r.NUM_CITYDISTRICT_CD),
    locality: r.TXT_PINCODE_LOCALITY || null,
  };
}

/** List all localities for a pincode (a pincode can have several). */
async function localitiesForPincode(pincode) {
  if (!pincode) return [];
  const [rows] = await pool.query(
    `SELECT p.NUM_PINCODE, p.NUM_STATE_CD, p.NUM_CITYDISTRICT_CD,
            p.TXT_PINCODE_LOCALITY, s.state AS state_name
     FROM hdfc_pincodemaster p
     LEFT JOIN hdfc_statecode s ON s.state_cd = p.NUM_STATE_CD
     WHERE p.NUM_PINCODE = ?
     LIMIT 50`,
    [String(pincode).trim()]
  );
  return rows.map((r) => ({
    pincode: String(r.NUM_PINCODE),
    stateCode: String(r.NUM_STATE_CD),
    state: r.state_name || null,
    cityDistrictCode: String(r.NUM_CITYDISTRICT_CD),
    locality: r.TXT_PINCODE_LOCALITY || null,
  }));
}

module.exports = { findByPincode, localitiesForPincode };

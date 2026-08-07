'use strict';

const { pool } = require('../config/db');

/**
 * hdfcrto_master lookup — resolves the real HDFC RTO code.
 *
 * Actual columns (confirmed):
 *   id, rto_code, rto_name (e.g. "AP-9-Hyderabad", "GJ-38-BAVLA"),
 *   rto_code_state (e.g. "AP--9"), vehicle_class_id, state_id,
 *   state_name (e.g. "AP"), state_code
 *
 * rto_name format is STATE-NUMBER-CITY, so a registration number like
 * "MH12AB1234" maps to an rto_name containing "MH-12".
 */

async function findByCode(code) {
  if (!code) return null;
  const [rows] = await pool.query(
    'SELECT * FROM hdfcrto_master WHERE rto_code = ? LIMIT 1',
    [String(code).trim()]
  );
  return rows[0] || null;
}

/**
 * Resolve rto_code from a registration number prefix, RTO name, or state.
 * "MH12AB1234" -> state "MH", number "12" -> rto_name LIKE "MH-12-%".
 */
async function findRtoCode({ registrationNo, rtoName, state }) {
  if (registrationNo && String(registrationNo).toUpperCase() !== 'NEW') {
    const reg = String(registrationNo).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const m = reg.match(/^([A-Z]{2})(\d{1,2})/); // MH + 12
    if (m) {
      const st = m[1];
      const num = String(parseInt(m[2], 10)); // strip leading zero: "01" -> "1"
      const [rows] = await pool.query(
        `SELECT * FROM hdfcrto_master
         WHERE UPPER(rto_name) LIKE ?
            OR UPPER(REPLACE(rto_code_state,'-','')) = ?
         LIMIT 1`,
        [`${st}-${num}-%`, `${st}${num}`]
      );
      if (rows[0]) return rows[0];

      const [byState] = await pool.query(
        'SELECT * FROM hdfcrto_master WHERE UPPER(state_name) = ? LIMIT 1',
        [st]
      );
      if (byState[0]) return byState[0];
    }
  }

  if (rtoName) {
    const [rows] = await pool.query(
      'SELECT * FROM hdfcrto_master WHERE UPPER(rto_name) LIKE ? LIMIT 1',
      [`%${String(rtoName).trim().toUpperCase()}%`]
    );
    if (rows[0]) return rows[0];
  }

  if (state) {
    const [rows] = await pool.query(
      'SELECT * FROM hdfcrto_master WHERE UPPER(state_name) = ? LIMIT 1',
      [String(state).trim().toUpperCase()]
    );
    if (rows[0]) return rows[0];
  }

  return null;
}

async function searchRTO({ q, limit = 25 }) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(UPPER(rto_name) LIKE ? OR CAST(rto_code AS CHAR) LIKE ?)');
    const like = `%${String(q).trim().toUpperCase()}%`;
    params.push(like, like);
  }
  const sql =
    'SELECT rto_code, rto_name, state_name FROM hdfcrto_master' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' LIMIT ?';
  params.push(Number(limit));
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = { findByCode, findRtoCode, searchRTO };

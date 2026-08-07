'use strict';

const { pool } = require('../config/db');

/**
 * hdfcmmv lookup — turns a vehicle's make/model/variant/fuel into HDFC's
 * vehicle_model_code. This is what removes the hardcoded/static model codes:
 * the real code comes from the hdfcmmv table in tf_api_dev.
 *
 * Table columns (from the DB):
 *   id, manufacturer, vehicle_model_code, vehicle_model, number_of_wheels,
 *   cubic_capacity, gross_vehicle_weight, seating_capacity, carrying_capacity,
 *   fuel_type, variant
 */

/** Direct: is this string already a valid HDFC model code? */
async function findByCode(code) {
  if (!code) return null;
  const [rows] = await pool.query(
    'SELECT * FROM hdfcmmv WHERE vehicle_model_code = ? LIMIT 1',
    [String(code).trim()]
  );
  return rows[0] || null;
}

/**
 * Fuzzy: find the best-matching model code from make/model/variant/fuel.
 * Progressively relaxes filters so a slightly different name still resolves.
 * Returns { vehicle_model_code, ...row } or null.
 */
async function findModelCode({ manufacturer, model, variant, fuel, cubicCapacity }) {
  const mfr = clean(manufacturer);
  const mdl = clean(model);
  const vrt = clean(variant);
  const fu = clean(fuel);

  // Frontend often sends verbose names like:
  //   manufacturer = "MARUTI SUZUKI INDIA LTD"
  //   model        = "MARUTI SWIFT VDI BSIV"   (has make + variant mixed in)
  // The table stores short values ("MARUTI SUZUKI", "SWIFT"). So a plain
  // LIKE '%<full model>%' never matches. Strategy:
  //   1) try the verbose values as-is (in case they do match)
  //   2) fall back to token matching: find a table row whose vehicle_model is
  //      contained IN the frontend model string (reverse LIKE), narrowed by the
  //      manufacturer's first word and fuel.

  // 1) as-is attempts (tightest first)
  let row = await tryMatch({ mfr, mdl, vrt, fu, cc: cubicCapacity });
  if (row) return row;
  row = await tryMatch({ mfr, mdl, fu });
  if (row) return row;
  row = await tryMatch({ mfr, mdl });
  if (row) return row;

  // 2) token match: manufacturer first word + reverse-contains on model
  const mfrFirst = mfr.split(/\s+/)[0]; // "MARUTI"
  row = await tryReverseMatch({ mfrFirst, modelString: mdl, fu });
  if (row) return row;
  row = await tryReverseMatch({ mfrFirst, modelString: mdl });
  if (row) return row;

  // 3) model-only reverse (last resort)
  row = await tryReverseMatch({ modelString: mdl });
  return row;
}

async function tryMatch({ mfr, mdl, vrt, fu, cc }) {
  const where = [];
  const params = [];
  if (mfr) { where.push('UPPER(manufacturer) LIKE ?'); params.push(`%${mfr}%`); }
  if (mdl) { where.push('UPPER(vehicle_model) LIKE ?'); params.push(`%${mdl}%`); }
  if (vrt) { where.push('UPPER(variant) LIKE ?'); params.push(`%${vrt}%`); }
  if (fu) { where.push('UPPER(fuel_type) = ?'); params.push(fu); }
  if (cc) { where.push('cubic_capacity = ?'); params.push(cc); }
  if (!where.length) return null;
  const [rows] = await pool.query(
    `SELECT * FROM hdfcmmv WHERE ${where.join(' AND ')} LIMIT 1`,
    params
  );
  return rows[0] || null;
}

/**
 * Reverse match: the TABLE's vehicle_model must appear inside the frontend's
 * model string. e.g. table "SWIFT" is contained in "MARUTI SWIFT VDI BSIV".
 * Implemented with LOCATE so the DB does the containment test. Narrowed by the
 * manufacturer's first word and (optionally) fuel. Longer model names win
 * (ORDER BY length DESC) so "SWIFT DZIRE" beats "SWIFT" when both fit.
 */
async function tryReverseMatch({ mfrFirst, modelString, fu }) {
  if (!modelString) return null;
  const where = ['LOCATE(UPPER(vehicle_model), ?) > 0', "vehicle_model <> ''"];
  const params = [modelString];
  if (mfrFirst) { where.push('UPPER(manufacturer) LIKE ?'); params.push(`%${mfrFirst}%`); }
  if (fu) { where.push('UPPER(fuel_type) = ?'); params.push(fu); }
  const [rows] = await pool.query(
    `SELECT * FROM hdfcmmv
     WHERE ${where.join(' AND ')}
     ORDER BY CHAR_LENGTH(vehicle_model) DESC
     LIMIT 1`,
    params
  );
  return rows[0] || null;
}

/** Search endpoint helper: list matching models for a typeahead / dropdown. */
async function searchModels({ q, fuel, limit = 25 }) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(UPPER(manufacturer) LIKE ? OR UPPER(vehicle_model) LIKE ? OR UPPER(variant) LIKE ?)');
    const like = `%${clean(q)}%`;
    params.push(like, like, like);
  }
  if (fuel) { where.push('UPPER(fuel_type) = ?'); params.push(clean(fuel)); }
  const sql =
    'SELECT vehicle_model_code, manufacturer, vehicle_model, variant, fuel_type, cubic_capacity FROM hdfcmmv' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' LIMIT ?';
  params.push(Number(limit));
  const [rows] = await pool.query(sql, params);
  return rows;
}

function clean(s) {
  return s == null ? '' : String(s).trim().toUpperCase();
}

module.exports = { findByCode, findModelCode, searchModels };

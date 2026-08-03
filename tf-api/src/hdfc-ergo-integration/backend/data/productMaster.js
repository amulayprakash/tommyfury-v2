'use strict';

/**
 * product_master — single source of truth for HDFC ERGO product codes per LOB.
 *
 * The Postman collection stays the same for every product (same 7 endpoints);
 * only PRODUCT_CODE in the headers changes per line of business. Instead of
 * hard-coding codes across the app, they live here (and mirror the SQL
 * product_master table in data/schema.sql). To enable a product, fill in its
 * `productCode` — nothing else needs to change.
 *
 * STATUS:
 *   pvtcar     -> 2311  (from the Private Car collection header) — LIVE
 *   twowheeler -> ''    (HDFC code not yet received) — fill when available
 *   commercial -> ''    (HDFC code not yet received) — fill when available
 *
 * Commercial covers BOTH GCV (goods) and PCV (passenger). HDFC may issue ONE
 * commercial product code covering both sub-types (differentiated by the
 * Req_GCV vs Req_PCV block in the body), OR two separate codes. Both cases are
 * supported: set `productCode` for a shared code, or override per sub-type via
 * `subProducts.gcv.productCode` / `subProducts.pcv.productCode`.
 *
 * Env vars (if set) win over the values here, so you can also configure via
 * .env without editing this file.
 */

const PRODUCT_MASTER = {
  pvtcar: {
    lob: 'pvtcar',
    label: 'Private Car',
    productCode: process.env.HDFC_PRODUCT_PVTCAR || '2311',
  },
  twowheeler: {
    lob: 'twowheeler',
    label: 'Two Wheeler',
    // TODO: fill with HDFC two-wheeler product code from datatable when received
    productCode: process.env.HDFC_PRODUCT_TWOWHEELER || '',
  },
  commercial: {
    lob: 'commercial',
    label: 'Commercial Vehicle',
    // A shared commercial code (if HDFC issues one for both GCV & PCV):
    productCode: process.env.HDFC_PRODUCT_COMMERCIAL || '',
    // Per-sub-type override (if HDFC issues separate codes):
    subProducts: {
      gcv: {
        label: 'Goods Carrying Vehicle',
        productCode: process.env.HDFC_PRODUCT_GCV || '',
      },
      pcv: {
        label: 'Passenger Carrying Vehicle',
        productCode: process.env.HDFC_PRODUCT_PCV || '',
      },
    },
  },
};

/**
 * Resolve the product code for a given LOB (and optional commercial sub-type).
 * @param {string} lob            'pvtcar' | 'twowheeler' | 'commercial'
 * @param {string} [subType]      'gcv' | 'pcv'  (commercial only)
 * @returns {string} product code ('' if not configured yet)
 */
function resolveProductCode(lob, subType) {
  const entry = PRODUCT_MASTER[lob];
  if (!entry) return '';
  if (lob === 'commercial' && subType) {
    const sub = entry.subProducts && entry.subProducts[subType.toLowerCase()];
    // Sub-type code first, else fall back to the shared commercial code.
    return (sub && sub.productCode) || entry.productCode || '';
  }
  return entry.productCode || '';
}

module.exports = { PRODUCT_MASTER, resolveProductCode };

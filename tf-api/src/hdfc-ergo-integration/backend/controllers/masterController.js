'use strict';

const cfg = require('../config/hdfc');
const seed = require('../data/uatSeed');
const mmv = require('../services/hdfcMmvService');
const rtoSvc = require('../services/hdfcRtoService');
const pincodeSvc = require('../services/hdfcPincodeService');

/** Vehicle types the frontend renders as the top-level selector. */
function vehicleTypes(req, res) {
  const types = Object.values(cfg.VEHICLE_TYPES).map((v) => {
    let enabled = true;
    try { cfg.getProduct(v.lob, v.subType); } catch { enabled = false; }
    return { key: v.key, label: v.label, lob: v.lob, subType: v.subType || null, enabled };
  });
  res.json({ success: true, vehicleTypes: types });
}

/** Model search — live from the hdfcmmv table (no static data). */
async function searchModels(req, res, next) {
  try {
    const q = req.query.q || '';
    const fuel = req.query.fuel || '';
    const rows = await mmv.searchModels({ q, fuel, limit: 50 });
    // Normalize field names for the frontend.
    const models = rows.map((r) => ({
      modelCode: r.vehicle_model_code,
      manufacturer: r.manufacturer,
      model: r.vehicle_model,
      variant: r.variant,
      fuel: r.fuel_type,
      cc: r.cubic_capacity,
    }));
    res.json({ success: true, count: models.length, models });
  } catch (err) { next(err); }
}

/** RTO search — live from hdfcrto_master. */
async function searchRTO(req, res, next) {
  try {
    const rows = await rtoSvc.searchRTO({ q: req.query.q || '', limit: 50 });
    const rtos = rows.map((r) => ({ code: r.rto_code, name: r.rto_name, state: r.state_name }));
    res.json({ success: true, count: rtos.length, rtos });
  } catch (err) { next(err); }
}

/** Add-on catalog + plan types for the quote form. */
function addonCatalog(req, res) {
  res.json({ success: true, addons: seed.addonCatalog, planTypes: seed.planTypes });
}

/** Pincode lookup — returns state code + city/district code for the address. */
async function pincodeLookup(req, res, next) {
  try {
    const info = await pincodeSvc.findByPincode(req.params.pincode);
    if (!info) return res.json({ success: false, error: 'Pincode not found' });
    const localities = await pincodeSvc.localitiesForPincode(req.params.pincode);
    res.json({ success: true, ...info, localities });
  } catch (err) { next(err); }
}

module.exports = { vehicleTypes, searchModels, searchRTO, addonCatalog, pincodeLookup };

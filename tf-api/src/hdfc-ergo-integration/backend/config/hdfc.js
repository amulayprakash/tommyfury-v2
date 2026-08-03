'use strict';
require('dotenv').config();

/**
 * Central HDFC ERGO configuration.
 *
 * The Postman collection you shared is the Private Car (PRODUCT_CODE 2311)
 * product. In HDFC ERGO's HEI integration, a single product code drives many
 * "vehicle types" through payload fields, NOT separate endpoints:
 *
 *   - Four Wheeler (petrol/diesel/cng/lpg) -> product 2311, fuel-driven
 *   - EV (electric)                         -> product 2311 + EV add-on flags
 *   - New Vehicle                           -> product 2311, BusinessType_Mandatary="New Vehicle"
 *   - Used / Rollover                       -> product 2311, BusinessType differs
 *
 * Two-Wheeler and Commercial are DIFFERENT HDFC products with their own
 * product codes and (slightly) different payloads. The architecture below
 * is a registry so you can drop those in the moment you get their codes,
 * without touching the service/controller layers.
 */

const BASE_URL = process.env.HDFC_BASE_URL ||
  'https://accessuat.hdfcergo.com/cp/integration/heiintegrationservice/integration/';

// Lines of business supported by this integration.
const LOB = {
  PVT_CAR: 'pvtcar',
  TWO_WHEELER: 'twowheeler',
  COMMERCIAL: 'commercial',
};

// Vehicle "types" the frontend exposes. Each maps to an LOB + defaults.
// This is what your React dropdown ("Four Wheeler / Two Wheeler / Commercial /
// EV / New Vehicle") binds to.
const VEHICLE_TYPES = {
  FOUR_WHEELER: {
    key: 'four_wheeler',
    label: 'Four Wheeler (Private Car)',
    lob: LOB.PVT_CAR,
    defaults: { fuelHint: 'PETROL', isElectric: false },
  },
  EV: {
    key: 'ev',
    label: 'Electric Vehicle (EV Car)',
    lob: LOB.PVT_CAR,
    defaults: { fuelHint: 'ELECTRIC', isElectric: true },
  },
  NEW_VEHICLE: {
    key: 'new_vehicle',
    label: 'New Vehicle (Fresh Registration)',
    lob: LOB.PVT_CAR,
    defaults: { businessType: 'New Vehicle', isNew: true },
  },
  TWO_WHEELER: {
    key: 'two_wheeler',
    label: 'Two Wheeler',
    lob: LOB.TWO_WHEELER,
    defaults: { fuelHint: 'PETROL' },
  },
  COMMERCIAL_GCV: {
    key: 'commercial_gcv',
    label: 'Commercial — Goods Carrying (GCV)',
    lob: LOB.COMMERCIAL,
    subType: 'gcv',
    defaults: {},
  },
  COMMERCIAL_PCV: {
    key: 'commercial_pcv',
    label: 'Commercial — Passenger Carrying (PCV)',
    lob: LOB.COMMERCIAL,
    subType: 'pcv',
    defaults: {},
  },
};

// Per-LOB product code + endpoint map. Endpoints are identical across the
// motor products in the HEI integration service; only PRODUCT_CODE changes.
// Product codes come from the product_master datatable (data/productMaster.js),
// which mirrors the SQL product_master table.
const { resolveProductCode } = require('../data/productMaster');

const COMMON_ENDPOINTS = {
  authenticate: 'authenticate',
  getCalculateIDV: 'getcalculateidv',
  calculatePremium: 'calculatepremium',
  createProposal: 'createproposal',
  getProposalDocument: 'getproposaldocument',
  submitPaymentDetails: 'submitpaymentdetails',
  getPolicyDocument: 'getpolicydocument',
  renewalExtract: 'getpolicydataforrenewal',
};

const PRODUCTS = {
  [LOB.PVT_CAR]: {
    get productCode() { return resolveProductCode('pvtcar'); },
    get available() { return Boolean(resolveProductCode('pvtcar')); },
    endpoints: COMMON_ENDPOINTS,
  },
  [LOB.TWO_WHEELER]: {
    get productCode() { return resolveProductCode('twowheeler'); },
    get available() { return Boolean(resolveProductCode('twowheeler')); },
    endpoints: COMMON_ENDPOINTS,
  },
  [LOB.COMMERCIAL]: {
    // Commercial code depends on sub-type (gcv/pcv); getProduct() handles it.
    get productCode() { return resolveProductCode('commercial'); },
    get available() {
      return Boolean(
        resolveProductCode('commercial') ||
        resolveProductCode('commercial', 'gcv') ||
        resolveProductCode('commercial', 'pcv')
      );
    },
    endpoints: COMMON_ENDPOINTS,
  },
};

const CHANNEL = {
  source: process.env.HDFC_SOURCE || 'NOVACRED',
  channelId: process.env.HDFC_CHANNEL_ID || 'NOVA0001',
  credential: process.env.HDFC_CREDENTIAL || '',
};

// Token cache TTL in ms (HDFC tokens are short-lived; refresh before expiry).
const TOKEN_TTL_MS = (parseInt(process.env.HDFC_TOKEN_TTL, 10) || 1500) * 1000;

function resolveLobForVehicleType(vehicleTypeKey) {
  const vt = Object.values(VEHICLE_TYPES).find((v) => v.key === vehicleTypeKey);
  if (!vt) throw new Error(`Unknown vehicleType: ${vehicleTypeKey}`);
  return vt;
}

function getProduct(lob, subType) {
  const p = PRODUCTS[lob];
  if (!p) throw new Error(`No product config for LOB: ${lob}`);
  const code = resolveProductCode(lobKey(lob), subType);
  if (!code) {
    const which = subType ? `${lob}/${subType}` : lob;
    throw new Error(
      `Product "${which}" is not yet enabled. Add its HDFC product code to data/productMaster.js (or set the matching env var) once you receive it.`
    );
  }
  // Return a view carrying the resolved code for this specific call.
  return { productCode: code, endpoints: p.endpoints };
}

// Map internal LOB constant to product_master key (both are the same strings,
// but keep a helper so a rename never breaks the lookup).
function lobKey(lob) {
  if (lob === LOB.PVT_CAR) return 'pvtcar';
  if (lob === LOB.TWO_WHEELER) return 'twowheeler';
  if (lob === LOB.COMMERCIAL) return 'commercial';
  return lob;
}

function endpointUrl(lob, name, subType) {
  const p = getProduct(lob, subType);
  const path = p.endpoints[name];
  if (!path) throw new Error(`Endpoint "${name}" not defined for LOB "${lob}"`);
  return BASE_URL.replace(/\/?$/, '/') + path;
}

module.exports = {
  BASE_URL,
  LOB,
  VEHICLE_TYPES,
  PRODUCTS,
  CHANNEL,
  TOKEN_TTL_MS,
  resolveLobForVehicleType,
  resolveProductCode,
  getProduct,
  endpointUrl,
};

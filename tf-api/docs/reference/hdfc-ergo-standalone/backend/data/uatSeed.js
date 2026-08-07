'use strict';

/**
 * UAT seed data extracted from HDFC ERGO's "PVTcarTestScenarios" UAT Test Model
 * sheet and RTO sheet. In production, replace these lookups with MySQL queries
 * against your `tf_api_dev` Model_Master (~10,826 rows), RTO Master (~1,598),
 * and Pincode master tables. The API shape stays identical.
 */

const models = [
  { modelCode: '33432', manufacturer: 'MAHINDRA', model: 'REVA', cc: 650, variant: 'e2o T2', fuel: 'ELECTRIC' },
  { modelCode: '42774', manufacturer: 'TATA MOTORS LTD', model: 'NEXON EV', cc: 999, variant: 'XZ PLUS', fuel: 'ELECTRIC' },
  { modelCode: '12754', manufacturer: 'MARUTI', model: '800', cc: 796, variant: 'AC - BS III', fuel: 'PETROL' },
  { modelCode: '12769', manufacturer: 'MARUTI', model: 'ESTEEM', cc: 1527, variant: 'ESTEEM D', fuel: 'DIESEL' },
  { modelCode: '16993', manufacturer: 'HYUNDAI', model: 'ACCENT', cc: 1599, variant: 'GLS 1.6', fuel: 'PETROL' },
  { modelCode: '17430', manufacturer: 'HONDA', model: 'CITY', cc: 1343, variant: '1.3 EXI', fuel: 'PETROL' },
  { modelCode: '16922', manufacturer: 'AUDI', model: 'AUDI A4', cc: 1798, variant: '1.8 TFSI', fuel: 'PETROL' },
  { modelCode: '26703', manufacturer: 'BMW', model: '5-SERIES', cc: 1997, variant: '520i SEDAN', fuel: 'PETROL' },
  { modelCode: '32540', manufacturer: 'JAGUAR', model: 'XF', cc: 1999, variant: '2.0 PURE DIESEL', fuel: 'DIESEL' },
  { modelCode: '12903', manufacturer: 'SKODA', model: 'FABIA', cc: 1198, variant: 'ACTIVE 1.2 MPI', fuel: 'PETROL' },
  { modelCode: '12419', manufacturer: 'AUDI', model: 'AUDI A8', cc: 4163, variant: '4.2L QUATTRO', fuel: 'PETROL' },
  { modelCode: '12617', manufacturer: 'HONDA', model: 'CIVIC', cc: 1799, variant: '1.8 E MT', fuel: 'PETROL' },
  { modelCode: '12763', manufacturer: 'MARUTI', model: 'ALTO', cc: 796, variant: 'LXI', fuel: 'PETROL' },
  { modelCode: '12798', manufacturer: 'MARUTI', model: 'SWIFT', cc: 1197, variant: 'ZXI', fuel: 'PETROL' },
  { modelCode: '22872', manufacturer: 'RENAULT', model: 'PULSE', cc: 1461, variant: 'RXZ', fuel: 'DIESEL' },
  { modelCode: '26137', manufacturer: 'TOYOTA KIRLOSKAR', model: 'CAMRY', cc: 2494, variant: '2.5L AT', fuel: 'PETROL' },
  { modelCode: '28735', manufacturer: 'SKODA', model: 'RAPID', cc: 1498, variant: '1.5 TDI CR ACTIVE', fuel: 'DIESEL' },
  { modelCode: '31199', manufacturer: 'FORD', model: 'ENDEAVOUR', cc: 2198, variant: '2.2L 4X2 TITANIUM AT', fuel: 'DIESEL' },
  { modelCode: '31312', manufacturer: 'MAHINDRA.', model: 'XUV 500', cc: 1990, variant: '1.9L W6', fuel: 'DIESEL' },
  { modelCode: '32415', manufacturer: 'TOYOTA KIRLOSKAR', model: 'INNOVA CRYSTA', cc: 2694, variant: '2.7 GX MT 7 STR', fuel: 'PETROL' },
  { modelCode: '37473', manufacturer: 'RENAULT', model: 'CAPTUR', cc: 1498, variant: 'RXE PETROL', fuel: 'PETROL' },
  { modelCode: '38119', manufacturer: 'MARUTI', model: 'SWIFT', cc: 1197, variant: '1.2 ZXi', fuel: 'PETROL' },
];

const rtos = [
  { code: '10406', name: 'MH-1-MUMBAI', state: 'MH' },
  { code: '10416', name: 'MH-12-PUNE', state: 'MH' },
  { code: '10085', name: 'GJ-1-AHMEDABAD', state: 'GJ' },
  { code: '10401', name: 'MH-5-KALYAN', state: 'MH' },
];

// Add-ons exposed in the quote form. `key` maps to payloadBuilder addon fields.
const addonCatalog = [
  { key: 'zeroDep', label: 'Zero Depreciation' },
  { key: 'tyreSecure', label: 'Tyre Secure' },
  { key: 'ncbProtection', label: 'NCB Protection' },
  { key: 'rti', label: 'Return to Invoice (RTI)' },
  { key: 'consumables', label: 'Consumables Cover' },
  { key: 'engineProtect', label: 'Engine & Gearbox Protect' },
  { key: 'roadsideAssistance', label: 'Roadside Assistance' },
  { key: 'lossOfPersonalBelongings', label: 'Loss of Personal Belongings' },
  { key: 'emiProtector', label: 'EMI Protector' },
  // EV-only add-ons (frontend shows these only when fuel = ELECTRIC)
  { key: 'ev.motorCover', label: 'Electric Motor Cover (EV)', evOnly: true },
  { key: 'ev.zeroDepBattery', label: 'Zero Dep Battery Claim (EV)', evOnly: true },
  { key: 'ev.batteryChargerCover', label: 'Battery Charger Accessory Cover (EV)', evOnly: true },
];

const planTypes = [
  { key: 'Comprehensive', label: 'Comprehensive (OD + TP)' },
  { key: 'OD Plus TP', label: 'OD + TP (bundled)' },
  { key: 'OD Only', label: 'Own Damage Only' },
  { key: 'TP Only', label: 'Third Party Only' },
];

module.exports = { models, rtos, addonCatalog, planTypes };

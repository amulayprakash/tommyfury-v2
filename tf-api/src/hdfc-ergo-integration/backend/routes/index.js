'use strict';

const express = require('express');
const router = express.Router();
const motor = require('../controllers/motorController');
const master = require('../controllers/masterController');
const kyc = require('../controllers/kycController');

// ---- Master / lookup routes (feed the React forms) ----
router.get('/master/vehicle-types', master.vehicleTypes);
router.get('/master/models', master.searchModels);
router.get('/master/rtos', master.searchRTO);
router.get('/master/addons', master.addonCatalog);
router.get('/master/pincode/:pincode', master.pincodeLookup);

// ---- Discrete HDFC pipeline steps (useful for debugging each stage) ----
router.post('/hdfc/authenticate', motor.authenticate);
router.post('/hdfc/idv', motor.getIDV);                       // 02 GetCalculateIDV
router.post('/hdfc/premium', motor.calculatePremium);         // 03 CalculatePremium
router.post('/hdfc/proposal', motor.createProposal);          // 04 CreateProposal
router.post('/hdfc/proposal-document', motor.getProposalDocument); // 05
router.post('/hdfc/payment', motor.submitPayment);            // 06 SubmitPaymentDetails
router.post('/hdfc/policy-document', motor.getPolicyDocument);// 07 GetPolicyDocument
router.post('/hdfc/renewal-extract', motor.renewalExtract);   // Renewal

// ---- Orchestrated flows (what the frontend actually calls) ----
router.post('/hdfc/quote', motor.quote);          // IDV + Premium in one shot
router.post('/hdfc/issue', motor.issuePolicy);    // Proposal -> Doc -> Pay -> Policy
router.post('/hdfc/renewal-quote', motor.renewalQuote);  // Extract -> IDV -> Premium
router.post('/hdfc/renewal-issue', motor.renewalIssue);  // Proposal -> Doc -> Pay -> Policy

// ---- Pehchaan e-KYC (SEPARATE service, own base URL + JWT) ----
router.get('/kyc/token', kyc.token);                       // #0  generate/reuse token
router.post('/kyc/fetch', kyc.fetch);                      // #1.2 fetch (individual)
router.post('/kyc/corporate', kyc.corporate);              // #1.2.1 fetch (corporate)
router.get('/kyc/status/:kycId', kyc.statusByKycId);       // #1.3 status by kycId
router.get('/kyc/status-by-txn/:txnId', kyc.statusByTxnId);// #1.4 status by txnId

module.exports = router;

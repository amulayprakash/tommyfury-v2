import axios from 'axios';

// Standalone smoke test for NivaBupa's direct partner API (Reassure 3.0) —
// bypasses tf-api entirely so token + premium calls can be verified in
// isolation against UAT. When this passes but /nivabupa/premium fails, the
// problem is ours; when both fail, it is NivaBupa's.
// Usage: npm run nivabupa:smoke:premium

const TOKEN_URL = process.env.NIVABUPA_TOKEN_URL || 'https://digitaluat.nivabupa.com/api/generic/token';
const PREMIUM_URL = process.env.NIVABUPA_PREMIUM_URL || 'https://digitaluat.nivabupa.com/api/generic/premium';
const CLIENT_ID = process.env.NIVABUPA_CLIENT_ID || 'cdceaca20073415586ed9e28c7337ae1';

async function getToken() {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: process.env.NIVABUPA_CLIENT_SECRET || 'idcscs-91476a29-94d2-494f-bbb4-990c28984050',
    scope: process.env.NIVABUPA_SCOPE || 'https://uat.nbhi.ohi.ocs.oraclecloud.com/uat/urn::ohi-components-apis',
    Identifier: 'Partner',
    Identifier_code: process.env.NIVABUPA_IDENTIFIER_CODE || 'BR08860001'
  });

  console.log('POST', TOKEN_URL);
  const resp = await axios.post(TOKEN_URL, params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    },
    timeout: 15000
  });
  console.log('TOKEN STATUS:', resp.status);
  console.log(JSON.stringify(resp.data, null, 2));
  return resp.data.access_token;
}

async function getPremium(token) {
  // Same shape as the sample "premium request.txt" from the Reassure 3.0 UAT
  // API kit — one adult, Diamond variant, 10L SI, annual payment, 1 year term.
  const payload = {
    policyTerm: '1',
    city: 'MUMBAI',
    premiumCalculationDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '/').toUpperCase(),
    paymentFrequency: 'A',
    isPort: 'N',
    yearlyQuotation: 'N',
    otherFrequencyAdjustmentRequire: 'Y',
    coverageType: 'I',
    sumInsured: '1000000',
    adultCovered: '1',
    childCovered: '0',
    productCode: 'REASSURE30',
    premiumCalculation: 'New',
    policyNumberIfRenewal: '',
    productVariant: 'Diamond',
    state: 'MAHARASHTRA',
    flexiPayment: 'N',
    member: [
      {
        dateOfBirth: '06/Aug/1998',
        diaPedTenure: '0',
        gender: 'M',
        htnPedTenure: '0',
        insuredType: 'A',
        mbrShpNo: '1',
        portCoverageYears: '0',
        uwLoading: []
      }
    ]
  };

  console.log('\nPOST', PREMIUM_URL);
  const resp = await axios.post(PREMIUM_URL, payload, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'clientId': CLIENT_ID,
      'Content-Type': 'application/json'
    },
    timeout: 20000
  });
  console.log('PREMIUM STATUS:', resp.status);
  console.log(JSON.stringify(resp.data, null, 2));
}

try {
  const token = await getToken();
  await getPremium(token);
} catch (err) {
  console.error('ERROR STATUS:', err.response?.status);
  console.error(JSON.stringify(err.response?.data || err.message, null, 2));
}

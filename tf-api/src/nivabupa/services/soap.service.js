import axios from 'axios';
import config from '../config/env.js';
import { escapeXml, extractTag } from '../helpers/xml.helper.js';

// The encrypt/decrypt services are legacy ASMX/WCF SOAP endpoints (not the
// REST /api/generic/* family) — text/xml body, SOAPAction header, response
// value pulled out of the standard soap envelope by tag name.
async function callSoap({ method, resultTag, params }) {
  const soapUrl = config.nivabupa.payment.soapUrl;
  const soapAction = `http://tempuri.org/IService1/${method}`;

  const paramTags = Object.entries(params)
    .map(([key, value]) => `<tem:${key}>${escapeXml(value)}</tem:${key}>`)
    .join('\n         ');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
   <soapenv:Header/>
   <soapenv:Body>
      <tem:${method}>
         ${paramTags}
      </tem:${method}>
   </soapenv:Body>
</soapenv:Envelope>`;

  console.log(`\n📤 Calling ${method} API`);
  console.log('   Endpoint:', soapUrl);
  console.log('   SOAPAction:', soapAction);
  console.log('   Encryption Key used:', params.EncryptionKey);
  console.log('   Payload (SOAP XML):');
  console.log(body);

  // validateStatus: true — log the full response ourselves for every status
  // (including SOAP Faults, which WCF returns as HTTP 500) instead of losing
  // the response body to a thrown axios exception before we can see it.
  const response = await axios.post(soapUrl, body, {
    headers: {
      'Content-Type': 'text/xml',
      'SOAPAction': soapAction
    },
    timeout: config.timeouts.soap,
    validateStatus: () => true
  });

  console.log(`📥 ${method} API response — HTTP status ${response.status}`);
  console.log('   Full SOAP response:', response.data);

  if (response.status < 200 || response.status >= 300) {
    const err = new Error(`NivaBupa SOAP ${method} call failed with HTTP ${response.status}: ${response.data}`);
    err.soapStatus = response.status;
    err.soapResponseData = response.data;
    throw err;
  }

  const result = extractTag(response.data, resultTag);
  console.log(`   Parsed <${resultTag}>:`, result);
  if (result === null) {
    throw new Error(`NivaBupa SOAP response missing <${resultTag}>: ${response.data}`);
  }
  return result;
}

// Turns a pipe-separated payment querystring into the encrypted `encparam`
// value the getPaymentValues.aspx form expects.
async function encryptPaymentParams(text) {
  return callSoap({
    method: 'encResp',
    resultTag: 'encRespResult',
    params: {
      text,
      EncryptionKey: config.nivabupa.payment.encryptionKey
    }
  });
}

// Decrypts the `returnMessage` NivaBupa posts back to our registered return
// URL after payment completes, into the pipe-separated status string.
async function decryptPaymentReturn(cipherText) {
  return callSoap({
    method: 'decResp',
    resultTag: 'decRespResult',
    params: {
      cipherText,
      EncryptionKey: config.nivabupa.payment.decryptionKey
    }
  });
}

export { callSoap, encryptPaymentParams, decryptPaymentReturn };

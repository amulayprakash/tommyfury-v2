// Fields the pipe-separated payment querystring is built from, in the order
// the Juspay integration doc's sample payload uses.
const PAYMENT_QUERYSTRING_FIELDS = [
  'unqPolicyNumber', 'premiumValue', 'otherParam', 'paymentType', 'additionalComment',
  'returnPath', 'isjuspay', 'channel', 'subchannel', 'sourcingsystem', 'productname',
  'policynumber', 'mobile', 'email', 'agentid', 'suminsured', 'tenure', 'zone'
];

const PAYMENT_MANDATORY_FIELDS = [
  'unqPolicyNumber', 'premiumValue', 'paymentType', 'additionalComment',
  'returnPath', 'isjuspay', 'channel', 'subchannel', 'sourcingsystem', 'productname', 'mobile', 'email'
];

// Defaults applied to every payment/initiate request before the caller's own
// body is spread over them.
const PAYMENT_DEFAULTS = {
  paymentType: 'mxbpofflinewithoutemi',
  isjuspay: 'yes',
};

// The only paymentStatus value NivaBupa's returnMessage uses for a completed
// payment; everything else is treated as failed/other.
const PAYMENT_SUCCESS_CODE = 'M001';

export {
  PAYMENT_QUERYSTRING_FIELDS,
  PAYMENT_MANDATORY_FIELDS,
  PAYMENT_DEFAULTS,
  PAYMENT_SUCCESS_CODE,
};

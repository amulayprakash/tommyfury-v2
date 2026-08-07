'use strict';

const { HdfcError } = require('./helpers');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HdfcError) {
    return res.status(422).json({
      success: false,
      step: err.step,
      statusCode: err.statusCode,
      error: err.message,
      hdfc: err.hdfc,
    });
  }
  if (err.response) {
    // Axios-level failure from HDFC.
    return res.status(502).json({
      success: false,
      error: 'HDFC upstream error',
      status: err.response.status,
      detail: err.response.data,
    });
  }
  console.error('[UNHANDLED]', err);
  return res.status(500).json({ success: false, error: err.message || 'Internal error' });
}

module.exports = errorHandler;

/** Centralized error handler - keeps controllers thin (section 26/34). */
const { parseXeroError } = require('../utils/xeroErrorParser');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.response?.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  // If this was an Axios error bubbling up from a Xero call (e.g. retries
  // genuinely exhausted on an interactive request), surface Xero's real
  // reason instead of Axios' generic "Request failed with status code N" -
  // same parser already used for the batch import's error report, so the
  // message a user sees is consistent everywhere it appears.
  const message = err.response ? parseXeroError(err).friendlyMessage : (err.message || 'Unexpected error');
  res.status(status).json({
    error: { code, message },
  });
}

module.exports = errorHandler;

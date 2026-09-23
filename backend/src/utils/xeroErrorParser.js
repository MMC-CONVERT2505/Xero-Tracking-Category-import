/**
 * Extracts the REAL reason for a failed Xero API call out of an Axios
 * error, instead of settling for Axios' generic `error.message` (e.g.
 * "Request failed with status code 500").
 *
 * Xero's Accounting API error shape (documented, and what a
 * ValidationException actually looks like on the wire):
 *   {
 *     "ErrorNumber": 10,
 *     "Type": "ValidationException",
 *     "Message": "A validation exception occurred",   <- generic wrapper
 *     "Elements": [
 *       { "ValidationErrors": [ { "Message": "<the real, field-level reason>" } ] }
 *     ]
 *   }
 * The top-level `Message` is only ever the generic wrapper string for a
 * ValidationException - the specific reason lives in
 * Elements[].ValidationErrors[].Message, which this module reads.
 *
 * For non-JSON bodies (e.g. a gateway-level 500 that never reaches Xero's
 * own application code and returns an HTML error page instead of Xero's
 * JSON), there is no `.Message` to read at all - this module captures a
 * short, non-sensitive snippet of the raw body instead of silently
 * falling back to Axios' generic message.
 *
 * Deliberately reads ONLY response status/headers/data - never
 * err.config (which carries the Authorization header) - so there is no
 * risk of a token ever ending up in a parsed result or a log line.
 */

const RAW_BODY_SNIPPET_MAX_CHARS = 300;

function parseXeroError(err) {
  const httpStatus = err?.response?.status ?? null;
  const retryAfterHeader = err?.response?.headers?.['retry-after'] ?? null;
  const data = err?.response?.data;

  let xeroErrorType = null;
  let xeroErrorNumber = null;
  let xeroMessage = null;
  const xeroValidationMessages = [];
  let rawBodySnippet = null;

  if (data && typeof data === 'object' && !Buffer.isBuffer(data)) {
    xeroErrorType = typeof data.Type === 'string' ? data.Type : null;
    xeroErrorNumber = typeof data.ErrorNumber === 'number' ? data.ErrorNumber : null;
    xeroMessage = typeof data.Message === 'string' ? data.Message : null;

    if (Array.isArray(data.Elements)) {
      for (const element of data.Elements) {
        if (Array.isArray(element?.ValidationErrors)) {
          for (const validationError of element.ValidationErrors) {
            if (validationError?.Message) xeroValidationMessages.push(validationError.Message);
          }
        }
      }
    }
  } else if (typeof data === 'string' && data.trim()) {
    // Non-JSON body (HTML error page, plain text, etc.) - capture a short,
    // safe snippet rather than nothing. Response bodies for failed
    // requests never contain the caller's own Authorization header, so
    // this is safe to keep as-is.
    rawBodySnippet = data.trim().slice(0, RAW_BODY_SNIPPET_MAX_CHARS);
  }

  return {
    httpStatus,
    xeroErrorType,
    xeroErrorNumber,
    xeroMessage,
    xeroValidationMessages,
    retryAfter: retryAfterHeader != null ? String(retryAfterHeader) : null,
    rawBodySnippet,
    friendlyMessage: buildFriendlyMessage({ httpStatus, xeroMessage, xeroErrorType, xeroValidationMessages, rawBodySnippet }),
  };
}

/** The single string surfaced in the failed-options table / CSV export. */
function buildFriendlyMessage({ httpStatus, xeroMessage, xeroErrorType, xeroValidationMessages, rawBodySnippet }) {
  if (xeroValidationMessages.length > 0) return xeroValidationMessages.join('; ');
  if (xeroMessage) return xeroErrorType ? `${xeroMessage} (${xeroErrorType})` : xeroMessage;
  if (rawBodySnippet) return `Xero server error (HTTP ${httpStatus}): ${rawBodySnippet}`;
  if (httpStatus === 429) return 'Xero rate limit reached';
  if (httpStatus >= 500) return `Xero server error (HTTP ${httpStatus})`;
  if (httpStatus) return `Xero request failed (HTTP ${httpStatus})`;
  return 'Unknown error';
}

module.exports = { parseXeroError };

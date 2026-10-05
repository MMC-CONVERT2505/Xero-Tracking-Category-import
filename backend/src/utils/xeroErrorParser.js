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
 * For a response that HAS a status but no usable body at all (a common
 * shape for upstream/gateway-level 500s - Xero's own app never even ran,
 * so there's no JSON error to read), this is distinguished explicitly as
 * "empty body" rather than silently falling back to a generic message.
 * For a request that never got a response back at all (timeout, DNS,
 * connection reset - `err.response` doesn't exist), that's distinguished
 * too, since it means the request may not have reached Xero.
 *
 * Also reads Xero's documented rate-limit response headers
 * (X-MinLimit-Remaining / X-DayLimit-Remaining / X-AppMinLimit-Remaining /
 * Retry-After) - present only on responses that actually came from Xero's
 * API gateway, which is exactly what makes them useful for telling a real
 * Xero 429 apart from some other layer returning one.
 *
 * Deliberately reads ONLY response status/headers/data - never
 * err.config (which carries the Authorization header) - so there is no
 * risk of a token ever ending up in a parsed result or a log line.
 */

const RAW_BODY_SNIPPET_MAX_CHARS = 300;

// Allowlist only - never log/forward headers wholesale, since that could
// include Authorization on some misconfigured proxy response, or other
// values we haven't vetted. Every header actually surfaced anywhere is
// named explicitly, here and only here.
const SAFE_RESPONSE_HEADERS = [
  'retry-after',
  'x-minlimit-remaining',
  'x-daylimit-remaining',
  'x-appminlimit-remaining',
  'content-type',
];

function isEmptyBody(data) {
  if (data === undefined || data === null) return true;
  if (typeof data === 'string') return data.trim() === '';
  if (typeof data === 'object' && !Buffer.isBuffer(data)) return Object.keys(data).length === 0;
  return false;
}

function extractSafeHeaders(headers) {
  const safe = {};
  if (!headers) return safe;
  for (const key of SAFE_RESPONSE_HEADERS) {
    if (headers[key] !== undefined) safe[key] = headers[key];
  }
  return safe;
}

function parseXeroError(err) {
  const hasResponse = !!err?.response;
  const httpStatus = err?.response?.status ?? null;
  const headers = extractSafeHeaders(err?.response?.headers);
  const retryAfterHeader = headers['retry-after'] ?? null;
  const data = err?.response?.data;
  const bodyEmpty = hasResponse ? isEmptyBody(data) : null;

  let xeroErrorType = null;
  let xeroErrorNumber = null;
  let xeroMessage = null;
  const xeroValidationMessages = [];
  let rawBodySnippet = null;

  if (!bodyEmpty && data && typeof data === 'object' && !Buffer.isBuffer(data)) {
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
  } else if (!bodyEmpty && typeof data === 'string') {
    // Non-JSON body (HTML error page, plain text, etc.) - capture a short,
    // safe snippet rather than nothing. Response bodies for failed
    // requests never contain the caller's own Authorization header, so
    // this is safe to keep as-is.
    rawBodySnippet = data.trim().slice(0, RAW_BODY_SNIPPET_MAX_CHARS);
  }

  return {
    hasResponse,
    httpStatus,
    bodyEmpty,
    xeroErrorType,
    xeroErrorNumber,
    xeroMessage,
    xeroValidationMessages,
    retryAfter: retryAfterHeader != null ? String(retryAfterHeader) : null,
    rawBodySnippet,
    safeResponseHeaders: headers,
    networkErrorCode: !hasResponse ? (err?.code || null) : null,
    friendlyMessage: buildFriendlyMessage({
      hasResponse, httpStatus, bodyEmpty, xeroMessage, xeroErrorType, xeroValidationMessages, rawBodySnippet, networkErrorCode: !hasResponse ? (err?.code || null) : null,
    }),
  };
}

/** The single string surfaced in the failed-options table / CSV export. */
function buildFriendlyMessage({ hasResponse, httpStatus, bodyEmpty, xeroMessage, xeroErrorType, xeroValidationMessages, rawBodySnippet, networkErrorCode }) {
  if (xeroValidationMessages.length > 0) return xeroValidationMessages.join('; ');
  if (xeroMessage) return xeroErrorType ? `${xeroMessage} (${xeroErrorType})` : xeroMessage;
  if (rawBodySnippet) return `Xero server error (HTTP ${httpStatus}): ${rawBodySnippet}`;
  if (!hasResponse) {
    return networkErrorCode
      ? `Xero request failed before a response was received (${networkErrorCode})`
      : 'Xero request failed before a response was received';
  }
  if (bodyEmpty) return `Xero returned HTTP ${httpStatus} with an empty response body`;
  if (httpStatus === 429) return 'Xero rate limit reached';
  if (httpStatus >= 500) return `Xero server error (HTTP ${httpStatus})`;
  if (httpStatus) return `Xero request failed (HTTP ${httpStatus})`;
  return 'Unknown error';
}

module.exports = { parseXeroError };

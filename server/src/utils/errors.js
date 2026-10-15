/**
 * errors.js
 *
 * Typed errors shared by extractors, services and controllers.
 *
 * Every failure that reaches the client carries a stable machine-readable
 * `code` so the frontend can distinguish the outcomes the project spec
 * requires (unsupported URL, private/inaccessible conversation, temporary
 * network failure, platform blocking, incomplete extraction, ...) without
 * parsing human-readable messages.
 */

/**
 * Stable error codes → HTTP status + whether a retry may help.
 */
export const ERROR_CODES = {
  INVALID_REQUEST: { status: 400, retryable: false },
  UNAUTHENTICATED: { status: 401, retryable: false },    // not logged in / session expired
  FORBIDDEN: { status: 403, retryable: false },          // logged in, but the role does not allow it
  CONFLICT: { status: 409, retryable: false },           // e.g. email already registered
  UNSUPPORTED_URL: { status: 422, retryable: false },
  PLATFORM_MISMATCH: { status: 422, retryable: false },
  NOT_FOUND: { status: 404, retryable: false },           // private, deleted or never existed
  ACCESS_BLOCKED: { status: 403, retryable: false },      // platform bot-protection / access control
  UNRECOGNIZED_FORMAT: { status: 502, retryable: false }, // page/payload shape we cannot parse
  EXTRACTION_FAILED: { status: 502, retryable: true },
  VERIFICATION_FAILED: { status: 422, retryable: false },
  UPSTREAM_ERROR: { status: 502, retryable: true },       // platform returned 5xx / network error
  TIMEOUT: { status: 504, retryable: true },
  RESPONSE_TOO_LARGE: { status: 502, retryable: false },
  BUSY: { status: 503, retryable: true },                 // conversion capacity exhausted
  RATE_LIMITED: { status: 429, retryable: true },
  PDF_FAILED: { status: 500, retryable: true },
  CANCELLED: { status: 499, retryable: true },            // client went away / cancelled
  INTERNAL: { status: 500, retryable: true }
};

export class AppError extends Error {
  /**
   * @param {keyof ERROR_CODES} code
   * @param {string} message      - Safe to show to the end user (no secrets, no conversation content)
   * @param {object} [details]    - Extra structured, non-sensitive data for the response body
   */
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = ERROR_CODES[code] ? code : 'INTERNAL';
    this.statusCode = ERROR_CODES[this.code].status;
    this.retryable = ERROR_CODES[this.code].retryable;
    this.details = details;
  }
}

/**
 * Builds the predictable JSON error body used by every endpoint.
 * @param {AppError} err
 */
export function toErrorBody(err) {
  return {
    success: false,
    error: {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      retryable: err.retryable,
      ...(err.details ? { details: err.details } : {}),
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Converts low-level fetch / Playwright errors into AppErrors.
 * AppErrors pass through untouched.
 * @param {unknown} err
 * @param {string} platformName
 * @returns {AppError}
 */
export function normalizeUpstreamError(err, platformName = 'the platform') {
  if (err instanceof AppError) return err;

  const message = String(err?.message || err);
  if (err?.name === 'AbortError' && /cancel/i.test(message)) {
    return new AppError('CANCELLED', 'The conversion was cancelled.');
  }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout/i.test(message)) {
    return new AppError('TIMEOUT', `Timed out while retrieving the conversation from ${platformName}. Please retry.`);
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|net::ERR_/i.test(message)) {
    return new AppError('UPSTREAM_ERROR', `Network error while contacting ${platformName}. Please retry.`);
  }
  return new AppError('EXTRACTION_FAILED', `Could not extract the conversation from ${platformName}.`);
}

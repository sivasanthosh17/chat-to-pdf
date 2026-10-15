import { AppError, toErrorBody } from '../utils/errors.js';

/**
 * Centralized error handler returning structured, predictable JSON error responses.
 *
 * - AppErrors carry a safe, user-facing message and a stable code.
 * - Body-parser errors become 400 / 413.
 * - Anything else is logged server-side and reported as a generic 500 so
 *   internal details are never exposed to clients.
 * - Request bodies (which contain user URLs) are never logged.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args)
export function errorHandler(err, req, res, next) {
  if (res.headersSent || req.timedOut) {
    return; // a response was already sent (e.g. the 504 from requestTimeout)
  }

  let appErr;
  if (err instanceof AppError) {
    appErr = err;
  } else if (err?.type === 'entity.parse.failed') {
    appErr = new AppError('INVALID_REQUEST', 'Request body is not valid JSON.');
  } else if (err?.type === 'entity.too.large') {
    appErr = new AppError('INVALID_REQUEST', 'Request body is too large.');
    appErr.statusCode = 413;
  } else {
    appErr = new AppError('INTERNAL', 'An unexpected server error occurred. Please retry.');
  }

  if (appErr.statusCode >= 500) {
    console.error(`[error] ${req.method} ${req.path} code=${appErr.code}`, err?.stack || err);
  } else {
    console.warn(`[error] ${req.method} ${req.path} code=${appErr.code} status=${appErr.statusCode}`);
  }

  res.status(appErr.statusCode).json(toErrorBody(appErr));
}

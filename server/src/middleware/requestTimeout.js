/**
 * requestTimeout.js
 *
 * Guarantees the client receives a structured 504 if a request runs longer
 * than `ms`. Controllers can register `res.locals.onTimeout` to stop their
 * work (and, for streaming responses whose headers are already sent, to emit
 * the timeout as a stream event).
 */

import { AppError, toErrorBody } from '../utils/errors.js';

export function requestTimeout(ms) {
  return function requestTimeoutMiddleware(req, res, next) {
    const timer = setTimeout(() => {
      req.timedOut = true;
      if (!res.headersSent) {
        const err = new AppError('TIMEOUT', `The request took longer than ${Math.round(ms / 1000)} s and was stopped. Please retry.`);
        res.status(err.statusCode).json(toErrorBody(err));
      }
      if (typeof res.locals.onTimeout === 'function') res.locals.onTimeout();
    }, ms);
    timer.unref?.();

    const clear = () => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
}

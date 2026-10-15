/**
 * requestTimeout.js
 *
 * Guarantees the client receives a structured 504 if a request runs longer
 * than `ms`. Work already in progress (e.g. a browser job) is bounded by its
 * own timeouts in browser.service.js and is cleaned up there.
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
    }, ms);
    timer.unref?.();

    const clear = () => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
}

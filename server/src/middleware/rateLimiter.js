/**
 * rateLimiter.js
 *
 * Small fixed-window, in-memory rate limiter keyed by client IP.
 *
 * Written in-house rather than adding a dependency because the requirements
 * are modest (single process, a few routes). For multi-instance deployments,
 * put a shared limiter (reverse proxy or Redis-backed) in front of the app.
 *
 * Behind a reverse proxy set TRUST_PROXY so req.ip reflects the real client.
 */

import { AppError } from '../utils/errors.js';

/**
 * @param {object} options
 * @param {number} options.windowMs
 * @param {number} options.max          - requests allowed per window per IP
 * @param {string} [options.name]       - label used in the error message
 * @param {() => number} [options.now]  - injectable clock for tests
 */
export function createRateLimiter({ windowMs, max, name = 'requests', now = Date.now }) {
  const hits = new Map(); // ip → { count, resetAt }

  const sweep = setInterval(() => {
    const t = now();
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
  }, Math.max(windowMs, 10_000));
  sweep.unref?.();

  function rateLimiter(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - t) / 1000);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));
      return next(new AppError('RATE_LIMITED', `Too many ${name}. Please wait ${resetSeconds} s and try again.`));
    }
    return next();
  }

  rateLimiter.reset = () => hits.clear();
  return rateLimiter;
}

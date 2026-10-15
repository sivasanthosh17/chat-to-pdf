/**
 * auth.js — sessions, role checks and cross-site request protection.
 *
 *   loadUser       reads the session cookie and sets req.user (or null)
 *   requireUser    401 unless logged in
 *   requireAdmin   403 unless the user's role is admin
 *   checkOrigin    rejects state-changing requests sent from other websites
 *
 * The session cookie is HttpOnly (page scripts cannot read it), SameSite=Lax
 * and, in production, Secure.
 */

import { AppError } from '../utils/errors.js';
import { getSessionUser, sessionTtlMs } from '../services/session.service.js';
import { toPublicUser } from '../services/users.service.js';

export const SESSION_COOKIE = 'chatpdf_sid';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // ignore malformed cookie values
    }
  }
  return out;
}

function cookieAttributes(req, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' || req.secure;
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function setSessionCookie(req, res, token) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieAttributes(req, Math.floor(sessionTtlMs() / 1000))}`);
}

export function clearSessionCookie(req, res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(req, 0)}`);
}

export function loadUser(req, res, next) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  req.sessionToken = token || null;
  req.user = token ? toPublicUser(getSessionUser(req.app.locals.db, token)) : null;
  next();
}

export function requireUser(req, res, next) {
  if (!req.app.locals.requireAuth) return next();
  if (!req.user) return next(new AppError('UNAUTHENTICATED', 'Please log in to convert conversations.'));
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return next(new AppError('UNAUTHENTICATED', 'Please log in.'));
  if (req.user.role !== 'admin') return next(new AppError('FORBIDDEN', 'Only administrators can do this.'));
  return next();
}

/**
 * Cross-site request forgery guard: a POST/PATCH/DELETE carrying an Origin
 * header must come from an allowed origin (or this server's own host).
 * Requests without an Origin header (curl, server-to-server) are allowed —
 * browsers always send one on such requests.
 */
export function checkOrigin(allowedOrigins) {
  return function checkOriginMiddleware(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return next(new AppError('FORBIDDEN', 'Request blocked: invalid origin.'));
    }
    if (allowedOrigins.includes(origin) || host === req.headers.host) return next();
    return next(new AppError('FORBIDDEN', 'Request blocked: it came from another website.'));
  };
}

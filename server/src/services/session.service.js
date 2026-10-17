/**
 * session.service.js — server-side login sessions.
 *
 * The browser holds a random 256-bit token in an HttpOnly cookie; the
 * database stores only its SHA-256 hash, so a leaked database cannot be used
 * to log in. Sessions expire after SESSION_TTL_DAYS (default 7).
 */

import { randomBytes, createHash } from 'node:crypto';

const DAY = 24 * 60 * 60 * 1000;

export function sessionTtlMs() {
  const days = Number(process.env.SESSION_TTL_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 7) * DAY;
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** @returns {{ token: string, tokenHash: string, expiresAt: number }} */
export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = Date.now();
  const expiresAt = now + sessionTtlMs();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, userId, now, expiresAt);
  return { token, tokenHash, expiresAt };
}

/**
 * @returns {object|null} the session's active (not disabled) user row, or null
 */
export function getSessionUser(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db
    .prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0
    `)
    .get(hashToken(token), Date.now());
  return row ?? null;
}

const TOUCH_INTERVAL_MS = 60_000;
export const ONLINE_WINDOW_MS = 5 * 60_000;

/**
 * Records that a session was just used (for "online now" / last active).
 * Writes at most once a minute per session.
 */
export function touchSession(db, token) {
  const now = Date.now();
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND (last_seen_at IS NULL OR last_seen_at < ?)')
    .run(now, hashToken(token), now - TOUCH_INTERVAL_MS);
}

export function deleteSession(db, token) {
  if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function deleteUserSessions(db, userId, { except } = {}) {
  if (except) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, except);
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

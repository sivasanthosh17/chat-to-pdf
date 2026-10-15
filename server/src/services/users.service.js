/**
 * users.service.js — accounts, roles and the rules around them.
 *
 * Rules enforced here (not only in the UI):
 *   - emails are unique (case-insensitive)
 *   - the last active admin can never be demoted, disabled or deleted
 *   - admins cannot demote, disable or delete themselves
 *   - disabling a user or changing a password ends their other sessions
 */

import { AppError } from '../utils/errors.js';
import { hashPassword, verifyPassword, burnPasswordCheck } from './password.service.js';
import { deleteUserSessions } from './session.service.js';

export const ROLES = ['user', 'admin'];

/** Public shape of a user — never includes the password hash. */
export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    disabled: Boolean(row.disabled),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null
  };
}

export function findUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) ?? null;
}

export function countActiveAdmins(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get().n;
}

export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export async function createUser(db, { email, password, role = 'user' }) {
  if (!ROLES.includes(role)) throw new AppError('INVALID_REQUEST', 'Unknown role.');
  const normalized = email.trim().toLowerCase();
  if (findUserByEmail(db, normalized)) {
    throw new AppError('CONFLICT', 'An account with this email already exists.');
  }
  const passwordHash = await hashPassword(password);
  const result = db
    .prepare('INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(normalized, passwordHash, role, Date.now());
  return findUserById(db, Number(result.lastInsertRowid));
}

/**
 * @returns {Promise<object|null>} the user row, or null for a wrong email/password
 *          (the same answer for both, so accounts cannot be probed)
 */
export async function authenticate(db, email, password) {
  const user = findUserByEmail(db, email);
  if (!user) {
    await burnPasswordCheck(password);
    return null;
  }
  if (!(await verifyPassword(password, user.password_hash))) return null;
  if (user.disabled) throw new AppError('FORBIDDEN', 'This account has been disabled. Contact an administrator.');
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
  return findUserById(db, user.id);
}

export async function changePassword(db, userId, currentPassword, newPassword, keepSessionHash) {
  const user = findUserById(db, userId);
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    throw new AppError('INVALID_REQUEST', 'Your current password is not correct.');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(newPassword), userId);
  // Sign out every other device that used the old password
  deleteUserSessions(db, userId, { except: keepSessionHash });
}

/**
 * Users with their conversion counts, newest first.
 */
export function listUsers(db) {
  return db
    .prepare(`
      SELECT u.*, COUNT(g.id) AS conversions, MAX(g.created_at) AS last_conversion_at
      FROM users u LEFT JOIN usage g ON g.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `)
    .all()
    .map((row) => ({ ...toPublicUser(row), conversions: row.conversions, lastConversionAt: row.last_conversion_at ?? null }));
}

function assertCanChange(db, actor, target, { removesAdmin }) {
  if (!target) throw new AppError('NOT_FOUND', 'User not found.');
  if (removesAdmin && target.id === actor.id) {
    throw new AppError('FORBIDDEN', 'You cannot remove your own admin access or account. Ask another admin.');
  }
  if (removesAdmin && target.role === 'admin' && !target.disabled && countActiveAdmins(db) <= 1) {
    throw new AppError('FORBIDDEN', 'This is the last active admin. Make someone else an admin first.');
  }
}

export function updateUser(db, actor, targetId, { role, disabled }) {
  const target = findUserById(db, targetId);
  const demoting = role !== undefined && role !== 'admin' && target?.role === 'admin';
  const disabling = disabled === true && !target?.disabled;
  assertCanChange(db, actor, target, { removesAdmin: demoting || (disabling && target?.role === 'admin') || (disabling && target?.id === actor.id) });

  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
  if (disabled !== undefined) {
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, targetId);
    if (disabled) deleteUserSessions(db, targetId); // signed out immediately
  }
  return toPublicUser(findUserById(db, targetId));
}

export function deleteUser(db, actor, targetId) {
  const target = findUserById(db, targetId);
  assertCanChange(db, actor, target, { removesAdmin: true });
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId); // sessions cascade; usage rows keep counts anonymously
}

/**
 * Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when no admin
 * exists yet. Does nothing otherwise, so it is safe on every start.
 * @returns {Promise<string|null>} what happened, for the startup log
 */
export async function bootstrapAdmin(db, env = process.env) {
  if (countActiveAdmins(db) > 0) return null;
  const email = env.ADMIN_EMAIL?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!email || !password) {
    return 'No admin account exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD, or run "npm run user:create -- --role admin".';
  }
  if (password.length < 10) return 'ADMIN_PASSWORD must be at least 10 characters; no admin was created.';
  const existing = findUserByEmail(db, email);
  if (existing) {
    db.prepare("UPDATE users SET role = 'admin', disabled = 0 WHERE id = ?").run(existing.id);
    return `Existing account ${existing.email} was made an admin.`;
  }
  await createUser(db, { email, password, role: 'admin' });
  return `Admin account ${email.toLowerCase()} created.`;
}

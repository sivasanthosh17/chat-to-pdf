import { AppError } from '../utils/errors.js';
import { AdminCreateUserSchema, AdminUpdateUserSchema, parseOrThrow } from '../schemas/auth.schema.js';
import { listUsers, createUser, updateUser, deleteUser, toPublicUser } from '../services/users.service.js';
import { usageStats } from '../services/usage.service.js';
import { getBrowserPoolStats } from '../services/browser.service.js';

function userIdParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('INVALID_REQUEST', 'Invalid user id.');
  return id;
}

/** GET /api/admin/stats?days=7 */
export function getStats(req, res, next) {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    res.json({ success: true, data: { ...usageStats(req.app.locals.db, days), capacity: getBrowserPoolStats() } });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/users */
export function getUsers(req, res, next) {
  try {
    res.json({ success: true, data: listUsers(req.app.locals.db) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/users { email, password, role } */
export async function postUser(req, res, next) {
  try {
    const input = parseOrThrow(AdminCreateUserSchema, req.body, AppError);
    const user = await createUser(req.app.locals.db, input);
    res.status(201).json({ success: true, data: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/users/:id { role?, disabled? } */
export function patchUser(req, res, next) {
  try {
    const changes = parseOrThrow(AdminUpdateUserSchema, req.body, AppError);
    res.json({ success: true, data: updateUser(req.app.locals.db, req.user, userIdParam(req), changes) });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/admin/users/:id */
export function removeUser(req, res, next) {
  try {
    deleteUser(req.app.locals.db, req.user, userIdParam(req));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

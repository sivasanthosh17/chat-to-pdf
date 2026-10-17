import { AppError } from '../utils/errors.js';
import { AdminCreateUserSchema, AdminUpdateUserSchema, HealthLinksSchema, parseOrThrow } from '../schemas/auth.schema.js';
import { listUsers, createUser, updateUser, deleteUser, toPublicUser, findUserById } from '../services/users.service.js';
import { usageStats, userActivity, recentFailures, usageRows } from '../services/usage.service.js';
import { getBrowserPoolStats } from '../services/browser.service.js';
import { quotaFor, defaultDailyLimit } from '../services/quota.service.js';
import { healthStatus, setHealthLinks, runHealthCheck } from '../services/health.service.js';
import { toCsv } from '../utils/csv.js';

function userIdParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('INVALID_REQUEST', 'Invalid user id.');
  return id;
}

function daysParam(req, fallback = 7) {
  return Math.min(Math.max(Number(req.query.days) || fallback, 1), 365);
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : '');

function sendCsv(res, name, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}

/** GET /api/admin/stats?days=7 */
export function getStats(req, res, next) {
  try {
    const days = daysParam(req);
    res.json({
      success: true,
      data: { ...usageStats(req.app.locals.db, days), capacity: getBrowserPoolStats(), defaultDailyLimit: defaultDailyLimit() }
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/users?days=7 — accounts with activity in the period */
export function getUsers(req, res, next) {
  try {
    res.json({ success: true, data: listUsers(req.app.locals.db, { days: daysParam(req) }) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/users/:id/activity?days=30 */
export function getUserActivity(req, res, next) {
  try {
    const id = userIdParam(req);
    const user = findUserById(req.app.locals.db, id);
    if (!user) throw new AppError('NOT_FOUND', 'User not found.');
    res.json({
      success: true,
      data: {
        user: toPublicUser(user),
        quota: quotaFor(req.app.locals.db, toPublicUser(user)),
        ...userActivity(req.app.locals.db, id, daysParam(req, 30))
      }
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/failures?days=7 */
export function getFailures(req, res, next) {
  try {
    res.json({ success: true, data: recentFailures(req.app.locals.db, daysParam(req)) });
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

/** PATCH /api/admin/users/:id { role?, disabled?, dailyPdfLimit?, unlimited? } */
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

/** GET /api/admin/export/usage.csv?days=30 — one row per conversion (no links, no text) */
export function exportUsage(req, res, next) {
  try {
    const days = daysParam(req, 30);
    const csv = toCsv(
      [
        { header: 'time (UTC)', value: (r) => iso(r.created_at) },
        { header: 'account', value: (r) => r.email ?? '(deleted account)' },
        { header: 'type', value: (r) => r.kind },
        { header: 'platform', value: (r) => r.platform ?? '' },
        { header: 'succeeded', value: (r) => (r.ok ? 'yes' : 'no') },
        { header: 'result', value: (r) => r.outcome },
        { header: 'messages', value: (r) => r.message_count ?? '' },
        { header: 'pages', value: (r) => r.page_count ?? '' },
        { header: 'seconds', value: (r) => (r.duration_ms != null ? (r.duration_ms / 1000).toFixed(1) : '') }
      ],
      usageRows(req.app.locals.db, days)
    );
    sendCsv(res, `chatpdf-usage-last-${days}-days.csv`, csv);
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/export/users.csv?days=30 */
export function exportUsers(req, res, next) {
  try {
    const days = daysParam(req, 30);
    const limit = defaultDailyLimit();
    const csv = toCsv(
      [
        { header: 'account', value: (u) => u.email },
        { header: 'role', value: (u) => u.role },
        { header: 'status', value: (u) => (u.disabled ? 'disabled' : 'active') },
        { header: `PDFs (last ${days} days)`, value: (u) => u.pdfs },
        { header: `previews (last ${days} days)`, value: (u) => u.previews },
        { header: `failed (last ${days} days)`, value: (u) => u.failed },
        { header: 'PDFs (all time)', value: (u) => u.pdfsTotal },
        { header: 'daily PDF limit', value: (u) => (u.role === 'admin' || u.unlimited ? 'unlimited' : u.dailyPdfLimit ?? `default (${limit || 'none'})`) },
        { header: 'joined (UTC)', value: (u) => iso(u.createdAt) },
        { header: 'last active (UTC)', value: (u) => iso(u.lastActiveAt) }
      ],
      listUsers(req.app.locals.db, { days })
    );
    sendCsv(res, `chatpdf-accounts-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/health */
export function getHealth(req, res, next) {
  try {
    res.json({ success: true, data: healthStatus(req.app.locals.db) });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/admin/health/links { chatgpt?, gemini?, claude? } */
export async function putHealthLinks(req, res, next) {
  try {
    const links = parseOrThrow(HealthLinksSchema, req.body, AppError);
    await setHealthLinks(req.app.locals.db, links, req.app.locals.validatorOptions);
    res.json({ success: true, data: healthStatus(req.app.locals.db) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/health/run — runs the check now (can take a minute) */
export async function postHealthRun(req, res, next) {
  try {
    const results = await runHealthCheck(req.app.locals, { runBy: 'manual' });
    res.json({ success: true, data: { results, ...healthStatus(req.app.locals.db) } });
  } catch (err) {
    next(err);
  }
}

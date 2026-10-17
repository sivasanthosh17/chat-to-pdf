/**
 * quota.service.js — daily PDF allowance per account.
 *
 *   - Site default: DAILY_PDF_LIMIT (default 30; 0 = no default limit)
 *   - Per account: a custom daily limit, or "unlimited"
 *   - Admins are always unlimited
 *   - Counts successful PDFs since 00:00 UTC (previews do not count)
 */

import { AppError } from '../utils/errors.js';
import { findUserById } from './users.service.js';

const DAY = 24 * 60 * 60 * 1000;

export function defaultDailyLimit() {
  const n = Number(process.env.DAILY_PDF_LIMIT);
  return process.env.DAILY_PDF_LIMIT !== undefined && process.env.DAILY_PDF_LIMIT !== '' && Number.isInteger(n) && n >= 0 ? n : 30;
}

export function startOfUtcDay(now = Date.now()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function pdfsToday(db, userId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM usage WHERE user_id = ? AND kind = 'pdf' AND ok = 1 AND created_at >= ?")
    .get(userId, startOfUtcDay()).n;
}

/**
 * @returns {{ unlimited: boolean, limit: number|null, usedToday: number, remaining: number|null,
 *             resetsAt: number, source: 'admin'|'unlimited'|'custom'|'default'|'none' } | null}
 */
export function quotaFor(db, user) {
  if (!user) return null;
  const row = findUserById(db, user.id);
  if (!row) return null;

  const usedToday = pdfsToday(db, row.id);
  const resetsAt = startOfUtcDay() + DAY;
  const unlimitedResult = (source) => ({ unlimited: true, limit: null, usedToday, remaining: null, resetsAt, source });

  if (row.role === 'admin') return unlimitedResult('admin');
  if (row.unlimited) return unlimitedResult('unlimited');

  const custom = row.daily_pdf_limit;
  const limit = custom ?? defaultDailyLimit();
  if (custom == null && limit === 0) return unlimitedResult('none');

  return {
    unlimited: false,
    limit,
    usedToday,
    remaining: Math.max(0, limit - usedToday),
    resetsAt,
    source: custom == null ? 'default' : 'custom'
  };
}

/** Blocks a PDF conversion when the account's daily allowance is used up. */
export function enforceDailyQuota(req, res, next) {
  if (!req.user) return next(); // requireUser has already run (or login is off in tests)
  const quota = quotaFor(req.app.locals.db, req.user);
  if (quota && !quota.unlimited && quota.remaining <= 0) {
    return next(
      new AppError(
        'QUOTA_EXCEEDED',
        `You have made today's ${quota.limit} PDF${quota.limit === 1 ? '' : 's'}. Your allowance resets at 00:00 UTC.`,
        { limit: quota.limit, usedToday: quota.usedToday, resetsAt: quota.resetsAt }
      )
    );
  }
  return next();
}

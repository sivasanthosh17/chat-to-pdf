/**
 * usage.service.js — conversion log for the admin dashboard.
 *
 * One row per conversion attempt: user, time, platform, outcome (grade or
 * error code), message/page counts and duration. Share links and
 * conversation text are never written.
 */

import { ONLINE_WINDOW_MS } from './session.service.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Records a conversion. Never throws: a logging problem must not break a
 * conversion the user is waiting for.
 */
export function recordUsage(db, entry) {
  try {
    db.prepare(`
      INSERT INTO usage (user_id, kind, platform, ok, outcome, message_count, page_count, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.userId ?? null,
      entry.kind,
      entry.platform ?? null,
      entry.ok ? 1 : 0,
      entry.outcome,
      entry.messageCount ?? null,
      entry.pageCount ?? null,
      entry.durationMs ?? null,
      Date.now()
    );
  } catch (err) {
    console.error('[usage] could not record conversion:', err.message);
  }
}

/**
 * Aggregates for the last `days` days (default 7).
 */
export function usageStats(db, days = 7) {
  const since = Date.now() - days * DAY;
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);

  const totals = one(
    `SELECT COUNT(*) AS conversions, COALESCE(SUM(ok), 0) AS succeeded, COUNT(DISTINCT user_id) AS activeUsers,
            COALESCE(SUM(page_count), 0) AS pages, CAST(AVG(CASE WHEN ok = 1 THEN duration_ms END) AS INTEGER) AS avgDurationMs
     FROM usage WHERE created_at >= ?`,
    since
  );

  const byDay = all(
    `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS conversions, COALESCE(SUM(ok), 0) AS succeeded
     FROM usage WHERE created_at >= ? GROUP BY day ORDER BY day`,
    since
  );

  const onlineNow = one(
    'SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at >= ? AND expires_at > ?',
    Date.now() - ONLINE_WINDOW_MS,
    Date.now()
  ).n;

  return {
    days,
    totals: { ...totals, failed: totals.conversions - totals.succeeded },
    users: {
      ...one('SELECT COUNT(*) AS total, COALESCE(SUM(role = \'admin\'), 0) AS admins, COALESCE(SUM(disabled), 0) AS disabled FROM users'),
      onlineNow
    },
    topUsers: all(
      `SELECT u.id, u.email, COUNT(*) AS pdfs
       FROM usage g JOIN users u ON u.id = g.user_id
       WHERE g.created_at >= ? AND g.kind = 'pdf' AND g.ok = 1
       GROUP BY u.id ORDER BY pdfs DESC, u.email LIMIT 5`,
      since
    ),
    byPlatform: all(
      `SELECT platform, COUNT(*) AS conversions, COALESCE(SUM(ok), 0) AS succeeded
       FROM usage WHERE created_at >= ? AND platform IS NOT NULL GROUP BY platform ORDER BY conversions DESC`,
      since
    ),
    byOutcome: all(
      'SELECT outcome, ok, COUNT(*) AS count FROM usage WHERE created_at >= ? GROUP BY outcome, ok ORDER BY count DESC',
      since
    ),
    byDay
  };
}

/**
 * One account's activity: per platform, per day, and the latest attempts
 * (time, kind, platform, result, pages) — never links or content.
 */
export function userActivity(db, userId, days = 30) {
  const since = Date.now() - days * DAY;
  return {
    days,
    byPlatform: db.prepare(
      `SELECT platform, COUNT(*) AS conversions, COALESCE(SUM(ok), 0) AS succeeded
       FROM usage WHERE user_id = ? AND created_at >= ? AND platform IS NOT NULL
       GROUP BY platform ORDER BY conversions DESC`
    ).all(userId, since),
    byDay: db.prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS conversions, COALESCE(SUM(ok), 0) AS succeeded
       FROM usage WHERE user_id = ? AND created_at >= ? GROUP BY day ORDER BY day`
    ).all(userId, since),
    recent: db.prepare(
      `SELECT created_at AS at, kind, platform, ok, outcome, message_count AS messageCount, page_count AS pageCount, duration_ms AS durationMs
       FROM usage WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`
    ).all(userId).map((r) => ({ ...r, ok: Boolean(r.ok) }))
  };
}

/** Latest failed attempts plus counts by error and platform. */
export function recentFailures(db, days = 7, limit = 50) {
  const since = Date.now() - days * DAY;
  return {
    days,
    byOutcome: db.prepare(
      `SELECT outcome, platform, COUNT(*) AS count, MAX(created_at) AS lastAt
       FROM usage WHERE ok = 0 AND created_at >= ? GROUP BY outcome, platform ORDER BY count DESC`
    ).all(since),
    recent: db.prepare(
      `SELECT g.created_at AS at, g.kind, g.platform, g.outcome, g.duration_ms AS durationMs, u.id AS userId, u.email
       FROM usage g LEFT JOIN users u ON u.id = g.user_id
       WHERE g.ok = 0 AND g.created_at >= ? ORDER BY g.created_at DESC LIMIT ?`
    ).all(since, limit)
  };
}

/** Rows for the usage CSV export (newest first). */
export function usageRows(db, days = 30) {
  return db.prepare(
    `SELECT g.created_at, u.email, g.kind, g.platform, g.ok, g.outcome, g.message_count, g.page_count, g.duration_ms
     FROM usage g LEFT JOIN users u ON u.id = g.user_id
     WHERE g.created_at >= ? ORDER BY g.created_at DESC`
  ).all(Date.now() - days * DAY);
}

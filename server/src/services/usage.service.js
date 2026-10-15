/**
 * usage.service.js — conversion log for the admin dashboard.
 *
 * One row per conversion attempt: user, time, platform, outcome (grade or
 * error code), message/page counts and duration. Share links and
 * conversation text are never written.
 */

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

  return {
    days,
    totals: { ...totals, failed: totals.conversions - totals.succeeded },
    users: one('SELECT COUNT(*) AS total, COALESCE(SUM(role = \'admin\'), 0) AS admins, COALESCE(SUM(disabled), 0) AS disabled FROM users'),
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

/**
 * health.service.js — platform health check for admins.
 *
 * An admin saves one public test link per platform. A check runs each link
 * through the real extractor and verification (no PDF is rendered) and
 * records whether it still works — the early warning when ChatGPT, Gemini or
 * Claude change their pages. Runs on demand and on a schedule.
 *
 * These test links are the only share links the app stores, because an
 * admin explicitly saved them for this purpose.
 */

import { AppError, normalizeUpstreamError } from '../utils/errors.js';
import { validateConversationUrl } from './urlValidator.service.js';
import { verifyConversation } from '../verification/verification.service.js';
import { plural } from '../utils/wording.js';

export const HEALTH_PLATFORMS = ['chatgpt', 'gemini', 'claude'];
const LINKS_KEY = 'health_links';

/** Hours between scheduled checks (HEALTH_CHECK_INTERVAL_HOURS, default 24; 0 = off). */
export function healthScheduleHours() {
  const n = Number(process.env.HEALTH_CHECK_INTERVAL_HOURS ?? 24);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function getHealthLinks(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(LINKS_KEY);
  let saved = {};
  try {
    saved = row ? JSON.parse(row.value) : {};
  } catch {
    saved = {};
  }
  return Object.fromEntries(HEALTH_PLATFORMS.map((p) => [p, typeof saved[p] === 'string' ? saved[p] : '']));
}

/**
 * Saves test links after checking that each one belongs to its platform.
 * @param {object} links - { chatgpt?, gemini?, claude? } ('' clears one)
 */
export async function setHealthLinks(db, links, validatorOptions = {}) {
  const next = getHealthLinks(db);
  for (const platform of HEALTH_PLATFORMS) {
    if (links[platform] === undefined) continue;
    const link = links[platform].trim();
    if (link) {
      const v = await validateConversationUrl(link, validatorOptions);
      if (!v.isValid) throw new AppError('INVALID_REQUEST', `${platform}: ${v.error}`);
      if (v.platform !== platform) throw new AppError('INVALID_REQUEST', `The ${platform} test link is a ${v.platformName} link.`);
    }
    next[platform] = link;
  }
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(LINKS_KEY, JSON.stringify(next));
  return next;
}

let running = null;

export function isHealthCheckRunning() {
  return running !== null;
}

/**
 * Runs the check for every platform that has a test link, one at a time.
 * @param {{ db, extractors, validatorOptions }} deps
 * @param {{ runBy: 'manual'|'scheduled' }} options
 */
export async function runHealthCheck({ db, extractors, validatorOptions = {} }, { runBy = 'manual' } = {}) {
  if (running) throw new AppError('BUSY', 'A platform check is already running. Please wait for it to finish.');
  const links = getHealthLinks(db);

  running = (async () => {
    const results = [];
    for (const platform of HEALTH_PLATFORMS) {
      const link = links[platform];
      if (!link) continue;
      const started = Date.now();
      let row;
      try {
        const validation = await validateConversationUrl(link, validatorOptions);
        if (!validation.isValid) throw new AppError('UNSUPPORTED_URL', validation.error);
        const conversation = await extractors[platform](validation);
        const report = verifyConversation(conversation);
        row = {
          platform,
          ok: report.passed,
          outcome: report.grade,
          message: report.passed
            ? `Read ${plural(conversation.messages.length, 'message')} (${report.grade.replace(/_/g, ' ')}).`
            : report.errors[0] || 'Verification failed.',
          messageCount: conversation.messages.length
        };
      } catch (err) {
        const e = normalizeUpstreamError(err, platform);
        row = { platform, ok: false, outcome: e.code, message: e.message, messageCount: null };
      }
      row.durationMs = Date.now() - started;
      db.prepare(
        `INSERT INTO health_checks (platform, ok, outcome, message, message_count, duration_ms, run_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.platform, row.ok ? 1 : 0, row.outcome, row.message, row.messageCount, row.durationMs, runBy, Date.now());
      results.push(row);
    }
    return results;
  })();

  try {
    return await running;
  } finally {
    running = null;
  }
}

/** Latest result per platform plus the last 10 results (oldest first) for a history strip. */
export function healthStatus(db) {
  const links = getHealthLinks(db);
  const platforms = HEALTH_PLATFORMS.map((platform) => {
    const history = db
      .prepare('SELECT ok, outcome, message, message_count, duration_ms, run_by, created_at FROM health_checks WHERE platform = ? ORDER BY created_at DESC LIMIT 10')
      .all(platform)
      .map((r) => ({
        ok: Boolean(r.ok),
        outcome: r.outcome,
        message: r.message,
        messageCount: r.message_count,
        durationMs: r.duration_ms,
        runBy: r.run_by,
        at: r.created_at
      }));
    return { platform, configured: Boolean(links[platform]), latest: history[0] || null, history: history.reverse() };
  });
  return { links, platforms, running: isHealthCheckRunning(), scheduleHours: healthScheduleHours() };
}

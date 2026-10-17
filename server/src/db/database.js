/**
 * database.js
 *
 * Small SQLite store (Node's built-in node:sqlite — no extra dependency or
 * database server) for what role-based access needs:
 *   users     — accounts and roles
 *   sessions  — login sessions (only a SHA-256 hash of each token is stored)
 *   usage     — one row per conversion: who, when, platform, outcome, counts.
 *               Share links and conversation text are NEVER stored.
 *   settings  — admin settings (e.g. the platform health-check test links)
 *   health_checks — results of the platform health check
 *
 * Schema changes are applied as numbered migrations on startup.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash  TEXT    NOT NULL,
    role           TEXT    NOT NULL CHECK (role IN ('user', 'admin')),
    disabled       INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    last_login_at  INTEGER
  );

  CREATE TABLE sessions (
    token_hash  TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX sessions_by_user ON sessions(user_id);

  CREATE TABLE usage (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind           TEXT    NOT NULL CHECK (kind IN ('pdf', 'preview')),
    platform       TEXT,
    ok             INTEGER NOT NULL,
    outcome        TEXT    NOT NULL,   -- verification grade, or error code
    message_count  INTEGER,
    page_count     INTEGER,
    duration_ms    INTEGER,
    created_at     INTEGER NOT NULL
  );
  CREATE INDEX usage_by_time ON usage(created_at);
  CREATE INDEX usage_by_user ON usage(user_id);
  `,
  // 2 — activity, quotas, settings, platform health
  `
  ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;     -- "online now"
  ALTER TABLE users ADD COLUMN daily_pdf_limit INTEGER;     -- NULL = site default
  ALTER TABLE users ADD COLUMN unlimited INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  -- Results of the admin platform health check (test links are kept in settings)
  CREATE TABLE health_checks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    platform       TEXT    NOT NULL,
    ok             INTEGER NOT NULL,
    outcome        TEXT    NOT NULL,   -- grade or error code
    message        TEXT,
    message_count  INTEGER,
    duration_ms    INTEGER,
    run_by         TEXT    NOT NULL CHECK (run_by IN ('manual', 'scheduled')),
    created_at     INTEGER NOT NULL
  );
  CREATE INDEX health_by_platform ON health_checks(platform, created_at);
  `
];

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  let row = db.prepare('SELECT version FROM schema_version').get();
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    row = { version: 0 };
  }
  for (let version = row.version; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/**
 * Opens (creating if needed) the database and applies migrations.
 * @param {string} [path] - file path, or ':memory:' for tests
 * @returns {DatabaseSync}
 */
export function openDatabase(path = process.env.DB_PATH || './data/chatpdf.db') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

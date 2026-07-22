'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('./config');

fs.mkdirSync(path.dirname(config.db.path), { recursive: true });

const db = new Database(config.db.path);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    email         TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
    notify_enabled INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid    TEXT PRIMARY KEY,
    sess   TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

  CREATE TABLE IF NOT EXISTS targets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    label           TEXT NOT NULL DEFAULT '',
    url             TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    last_state      TEXT NOT NULL DEFAULT 'unknown', -- open|queue|blocked|error|unknown
    last_detail     TEXT NOT NULL DEFAULT '',
    last_signals    TEXT NOT NULL DEFAULT '[]',
    last_checked_at INTEGER,
    last_changed_at INTEGER,
    last_alert_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id  INTEGER REFERENCES targets(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,   -- state_change | check_error | notify_sent | manual_check | info
    state      TEXT,
    prev_state TEXT,
    message    TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_target ON events(target_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    level      TEXT NOT NULL DEFAULT 'info', -- info | alert | success | error
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    target_id  INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Settings (typed key/value store) ─────────────────────────────────────────
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

const settings = {
  get(key, def = null) {
    const row = getSettingStmt.get(key);
    if (!row) return def;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  },
  set(key, value) {
    setSettingStmt.run(key, JSON.stringify(value));
    return value;
  },
  all() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = r.value;
      }
    }
    return out;
  },
};

module.exports = { db, settings };

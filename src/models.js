'use strict';

const bcrypt = require('bcryptjs');
const { db } = require('./db');

const now = () => Date.now();
const BCRYPT_ROUNDS = 12;

// ── Users ────────────────────────────────────────────────────────────────────
const Users = {
  count() {
    return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  },
  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  },
  findById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },
  all() {
    return db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  },
  create({ username, password, email = '', role = 'user', notifyEnabled = true }) {
    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, email, role, notify_enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(username, hash, email, role, notifyEnabled ? 1 : 0, now());
    return Users.findById(info.lastInsertRowid);
  },
  verifyPassword(user, password) {
    return bcrypt.compareSync(password, user.password_hash);
  },
  setPassword(id, password) {
    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  },
  update(id, fields) {
    const allowed = ['email', 'role', 'notify_enabled'];
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!allowed.includes(k)) continue;
      sets.push(`${k} = ?`);
      vals.push(k === 'notify_enabled' ? (v ? 1 : 0) : v);
    }
    if (!sets.length) return Users.findById(id);
    vals.push(id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return Users.findById(id);
  },
  touchLogin(id) {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), id);
  },
  remove(id) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },
  countAdmins() {
    return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  },
};

// ── Targets ──────────────────────────────────────────────────────────────────
const Targets = {
  all() {
    return db.prepare('SELECT * FROM targets ORDER BY id ASC').all();
  },
  enabled() {
    return db.prepare('SELECT * FROM targets WHERE enabled = 1 ORDER BY id ASC').all();
  },
  findById(id) {
    return db.prepare('SELECT * FROM targets WHERE id = ?').get(id);
  },
  findByUrl(url) {
    return db.prepare('SELECT * FROM targets WHERE url = ?').get(url);
  },
  create({ url, label = '', enabled = true }) {
    const info = db
      .prepare('INSERT INTO targets (label, url, enabled, created_at) VALUES (?, ?, ?, ?)')
      .run(label, url, enabled ? 1 : 0, now());
    return Targets.findById(info.lastInsertRowid);
  },
  update(id, fields) {
    const allowed = ['label', 'url', 'enabled'];
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!allowed.includes(k)) continue;
      sets.push(`${k} = ?`);
      vals.push(k === 'enabled' ? (v ? 1 : 0) : v);
    }
    if (!sets.length) return Targets.findById(id);
    vals.push(id);
    db.prepare(`UPDATE targets SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return Targets.findById(id);
  },
  remove(id) {
    db.prepare('DELETE FROM targets WHERE id = ?').run(id);
  },
  /** Persist the outcome of a check. Returns { changed, prevState }. */
  recordCheck(id, { state, detail = '', signals = [] }) {
    const t = Targets.findById(id);
    if (!t) return { changed: false, prevState: null };
    const prevState = t.last_state;
    const changed = prevState !== state;
    const ts = now();
    db.prepare(
      `UPDATE targets
         SET last_state = ?, last_detail = ?, last_signals = ?, last_checked_at = ?,
             last_changed_at = CASE WHEN ? THEN ? ELSE last_changed_at END
       WHERE id = ?`
    ).run(state, detail, JSON.stringify(signals), ts, changed ? 1 : 0, ts, id);
    return { changed, prevState };
  },
  markAlerted(id) {
    db.prepare('UPDATE targets SET last_alert_at = ? WHERE id = ?').run(now(), id);
  },
};

// ── Events (audit log of checks / state changes) ─────────────────────────────
const Events = {
  add({ targetId = null, type, state = null, prevState = null, message = '' }) {
    const info = db
      .prepare(
        `INSERT INTO events (target_id, type, state, prev_state, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(targetId, type, state, prevState, message, now());
    return info.lastInsertRowid;
  },
  recent(limit = 100) {
    return db
      .prepare(
        `SELECT e.*, t.label AS target_label, t.url AS target_url
           FROM events e LEFT JOIN targets t ON t.id = e.target_id
          ORDER BY e.id DESC LIMIT ?`
      )
      .all(Math.min(Math.max(limit, 1), 1000));
  },
  prune(keep = 5000) {
    db.prepare(
      `DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)`
    ).run(keep);
  },
};

// ── In-app notification feed ─────────────────────────────────────────────────
const Notifications = {
  add({ level = 'info', title, body = '', targetId = null }) {
    const info = db
      .prepare(
        `INSERT INTO notifications (level, title, body, target_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(level, title, body, targetId, now());
    return db.prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid);
  },
  recent(limit = 50) {
    return db
      .prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?')
      .all(Math.min(Math.max(limit, 1), 500));
  },
  prune(keep = 500) {
    db.prepare(
      `DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ?)`
    ).run(keep);
  },
};

module.exports = { Users, Targets, Events, Notifications };

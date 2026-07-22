'use strict';

const session = require('express-session');
const { db } = require('./db');

// Minimal session store backed by the app's better-sqlite3 database, so we keep
// a single data file and sessions survive restarts (no extra native deps).
class SqliteStore extends session.Store {
  constructor() {
    super();
    this._get = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
    this._set = db.prepare(
      `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`
    );
    this._del = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this._touch = db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?');
    this._reap = db.prepare('DELETE FROM sessions WHERE expire < ?');
    // Sweep expired sessions hourly.
    this._interval = setInterval(() => this.reap(), 60 * 60 * 1000);
    if (this._interval.unref) this._interval.unref();
  }

  reap() {
    try {
      this._reap.run(Date.now());
    } catch {
      /* ignore */
    }
  }

  _expiry(sess) {
    const maxAge = sess?.cookie?.maxAge;
    if (maxAge) return Date.now() + maxAge;
    return Date.now() + 24 * 60 * 60 * 1000;
  }

  get(sid, cb) {
    try {
      const row = this._get.get(sid);
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) {
        this._del.run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.sess));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this._set.run(sid, JSON.stringify(sess), this._expiry(sess));
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this._del.run(sid);
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this._touch.run(this._expiry(sess), sid);
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }
}

module.exports = { SqliteStore };

'use strict';

require('dotenv').config();

const path = require('path');

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function str(v, def = '') {
  return v === undefined || v === null ? def : String(v);
}

const trustProxy = bool(process.env.TRUST_PROXY, false);

const config = {
  env: str(process.env.NODE_ENV, 'production'),

  server: {
    port: int(process.env.PORT, 3000),
    host: str(process.env.HOST, '127.0.0.1'),
    trustProxy,
    cookieSecure: bool(process.env.COOKIE_SECURE, trustProxy),
    sessionSecret: str(process.env.SESSION_SECRET, ''),
    publicBaseUrl: str(process.env.PUBLIC_BASE_URL, '').replace(/\/+$/, ''),
  },

  db: {
    path: path.resolve(str(process.env.DATABASE_PATH, './data/hype-drop.db')),
  },

  // These are *defaults*. Once the DB is seeded they become editable at runtime
  // through the admin panel (stored in the `settings` table).
  monitorDefaults: {
    intervalSeconds: int(process.env.CHECK_INTERVAL_SECONDS, 60),
    jitterSeconds: int(process.env.CHECK_JITTER_SECONDS, 15),
    alertCooldownSeconds: int(process.env.ALERT_COOLDOWN_SECONDS, 900),
    strategy: str(process.env.CHECK_STRATEGY, 'browser'),
    timeoutMs: int(process.env.CHECK_TIMEOUT_MS, 30000),
    userAgent: str(process.env.CHECK_USER_AGENT, ''),
    // Route the checker through a proxy (best defense against datacenter-IP
    // blocking). Supports http/https/socks5, e.g. http://user:pass@host:port.
    proxyUrl: str(process.env.CHECK_PROXY_URL, ''),
    // Run a headed browser (needs a display / xvfb-run). Headed is harder for
    // bot protection to flag but heavier; default headless.
    headless: bool(process.env.CHECK_HEADLESS, true),
    notifyOnQueue: true,
    notifyOnOpen: false,
  },

  seedTargets: str(process.env.SEED_TARGETS, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  mail: {
    host: str(process.env.SMTP_HOST, ''),
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: str(process.env.SMTP_USER, ''),
    pass: str(process.env.SMTP_PASS, ''),
    from: str(process.env.MAIL_FROM, '') || str(process.env.SMTP_USER, ''),
    get enabled() {
      return Boolean(this.host);
    },
  },

  bootstrap: {
    username: str(process.env.BOOTSTRAP_ADMIN_USERNAME, ''),
    password: str(process.env.BOOTSTRAP_ADMIN_PASSWORD, ''),
    email: str(process.env.BOOTSTRAP_ADMIN_EMAIL, ''),
  },
};

/** Fail fast on obvious misconfiguration in production. */
function validate() {
  const problems = [];
  if (!config.server.sessionSecret || config.server.sessionSecret === 'change-me-to-a-long-random-string') {
    if (config.env === 'production') {
      problems.push('SESSION_SECRET is not set to a secure value.');
    }
  } else if (config.server.sessionSecret.length < 16) {
    problems.push('SESSION_SECRET should be at least 16 characters.');
  }
  return problems;
}

module.exports = { config, validate };

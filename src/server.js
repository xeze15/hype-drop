'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const { config, validate } = require('./config');
const { settings } = require('./db');
const { Users, Targets } = require('./models');
const { SqliteStore } = require('./session-store');
const { loadUser, csrfProvider, verifyCsrf } = require('./auth');
const scheduler = require('./monitor/scheduler');

const authRoutes = require('./routes/auth.routes');
const apiRoutes = require('./routes/api.routes');
const pageRoutes = require('./routes/pages.routes');

function log(...a) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), '[server]', ...a);
}

// ── Startup housekeeping ──────────────────────────────────────────────────────
function seedOnce() {
  // Seed targets from SEED_TARGETS the first time the app runs.
  if (!settings.get('seeded', false)) {
    for (const url of config.seedTargets) {
      if (!Targets.findByUrl(url)) Targets.create({ url, label: '' });
    }
    settings.set('seeded', true);
  }
  // Optionally bootstrap an admin from env (only if no users exist yet).
  if (Users.count() === 0 && config.bootstrap.username && config.bootstrap.password) {
    Users.create({
      username: config.bootstrap.username,
      password: config.bootstrap.password,
      email: config.bootstrap.email,
      role: 'admin',
      notifyEnabled: true,
    });
    log(`Bootstrapped admin user "${config.bootstrap.username}" from environment.`);
  }
}

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.server.trustProxy) app.set('trust proxy', 1);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  const cspDirectives = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
  };
  // Only force-upgrade to HTTPS when we're actually serving over TLS; otherwise
  // explicitly remove helmet's default so plain-HTTP/localhost access isn't broken.
  cspDirectives['upgrade-insecure-requests'] = config.server.cookieSecure ? [] : null;
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: true, directives: cspDirectives },
    })
  );

  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }));

  app.use(
    session({
      name: 'hd.sid',
      store: new SqliteStore(),
      secret: config.server.sessionSecret || 'insecure-dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.server.cookieSecure,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.use(loadUser);
  app.use(csrfProvider);

  // Health check (no auth) for uptime monitoring / load balancers.
  app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

  // CSRF verification for all state-changing requests.
  app.use(verifyCsrf);

  app.use(authRoutes);
  app.use('/api', apiRoutes);
  app.use(pageRoutes);

  // 404
  app.use((req, res) => {
    if (req.accepts('json') && !req.accepts('html')) return res.status(404).json({ error: 'Not found.' });
    res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
  });

  // Error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    log('ERROR', err.stack || err.message);
    const status = err.status || 500;
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(status).json({ error: 'Server error.' });
    }
    res.status(status).render('error', { title: 'Error', message: 'Something went wrong.' });
  });

  return app;
}

function start() {
  const problems = validate();
  for (const p of problems) log('CONFIG WARNING:', p);

  seedOnce();

  const app = buildApp();
  const server = app.listen(config.server.port, config.server.host, () => {
    log(`Listening on http://${config.server.host}:${config.server.port}`);
    if (Users.count() === 0) log('No users yet — open /setup in your browser to create the first admin.');
  });

  scheduler.start();

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down…`);
    server.close();
    await scheduler.stop();
    setTimeout(() => process.exit(0), 500).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { app, server };
}

if (require.main === module) {
  start();
}

module.exports = { buildApp, start, seedOnce };

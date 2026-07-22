'use strict';

const crypto = require('crypto');
const { Users } = require('./models');

// Attach the current user (if any) to req.user for every request.
function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = Users.findById(req.session.userId);
    if (user) {
      req.user = user;
    } else {
      // Stale session (user deleted) — clear it.
      req.session.userId = null;
    }
  }
  res.locals.currentUser = req.user || null;
  next();
}

// Gate for HTML pages: redirect to /login when signed out.
function requireAuthPage(req, res, next) {
  if (req.user) return next();
  const back = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${back}`);
}

// Gate for JSON APIs: 401 when signed out.
function requireAuthApi(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: 'Not authenticated.' });
}

function requireAdminPage(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (!req.user) return res.redirect('/login');
  return res.status(403).render('error', { title: 'Forbidden', message: 'Admins only.' });
}

function requireAdminApi(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Admins only.' });
}

// ── CSRF protection (double-submit token bound to the session) ────────────────
function ensureCsrf(req) {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrf;
}

function csrfProvider(req, res, next) {
  res.locals.csrfToken = ensureCsrf(req);
  next();
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('x-csrf-token') || (req.body && req.body._csrf);
  if (token && req.session.csrf && safeEqual(token, req.session.csrf)) {
    return next();
  }
  if (req.accepts('json') && !req.accepts('html')) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }
  return res.status(403).render('error', { title: 'Forbidden', message: 'Invalid or missing CSRF token. Reload and try again.' });
}

module.exports = {
  loadUser,
  requireAuthPage,
  requireAuthApi,
  requireAdminPage,
  requireAdminApi,
  csrfProvider,
  verifyCsrf,
  ensureCsrf,
};

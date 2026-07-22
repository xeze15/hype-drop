'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { Users } = require('../models');
const { isNonEmptyString, isEmail } = require('../util');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

function safeNext(next) {
  // Only allow local, same-site redirect targets.
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}

// ── First-run setup: create the initial admin when there are no users ─────────
router.get('/setup', (req, res) => {
  if (Users.count() > 0) return res.redirect('/login');
  res.render('setup', { title: 'First-run setup', error: null, values: {} });
});

router.post('/setup', (req, res) => {
  if (Users.count() > 0) return res.redirect('/login');
  const { username, password, password2, email } = req.body;
  const values = { username, email };
  const fail = (error) => res.status(400).render('setup', { title: 'First-run setup', error, values });

  if (!isNonEmptyString(username) || username.trim().length < 3) return fail('Username must be at least 3 characters.');
  if (!isNonEmptyString(password) || password.length < 8) return fail('Password must be at least 8 characters.');
  if (password !== password2) return fail('Passwords do not match.');
  if (email && !isEmail(email)) return fail('Email address looks invalid.');

  const user = Users.create({
    username: username.trim(),
    password,
    email: (email || '').trim(),
    role: 'admin',
    notifyEnabled: true,
  });
  req.session.userId = user.id;
  Users.touchLogin(user.id);
  res.redirect('/');
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (Users.count() === 0) return res.redirect('/setup');
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', error: null, next: safeNext(req.query.next) });
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const next = safeNext(req.body.next);
  const fail = () =>
    res.status(401).render('login', { title: 'Sign in', error: 'Invalid username or password.', next });

  if (!isNonEmptyString(username) || !isNonEmptyString(password)) return fail();
  const user = Users.findByUsername(username.trim());
  if (!user) return fail();
  if (!Users.verifyPassword(user, password)) return fail();

  // Prevent session fixation: regenerate the session on privilege change.
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('error', { title: 'Error', message: 'Could not start session.' });
    req.session.userId = user.id;
    Users.touchLogin(user.id);
    res.redirect(next);
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('hd.sid');
    res.redirect('/login');
  });
});

module.exports = router;

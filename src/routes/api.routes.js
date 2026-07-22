'use strict';

const express = require('express');
const { settings } = require('../db');
const { Users, Targets, Events, Notifications } = require('../models');
const { requireAuthApi, requireAdminApi } = require('../auth');
const { normalizeUrl, isEmail, isNonEmptyString, clampInt, asyncHandler } = require('../util');
const { bus } = require('../bus');
const scheduler = require('../monitor/scheduler');
const { config } = require('../config');

const router = express.Router();

// Everything under /api requires authentication.
router.use(requireAuthApi);

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    notifyEnabled: !!u.notify_enabled,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

// ── Status / live data ────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const s = scheduler.getMonitorSettings();
  res.json({
    now: Date.now(),
    monitor: {
      strategy: s.strategy,
      intervalSeconds: s.intervalSeconds,
      jitterSeconds: s.jitterSeconds,
    },
    targets: Targets.all().map(scheduler.publicTarget),
  });
});

router.get('/events', (req, res) => {
  const limit = clampInt(req.query.limit, 1, 500, 100);
  res.json({ events: Events.recent(limit) });
});

router.get('/notifications', (req, res) => {
  const limit = clampInt(req.query.limit, 1, 200, 50);
  res.json({ notifications: Notifications.recent(limit) });
});

// ── Server-Sent Events stream of live updates ─────────────────────────────────
router.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);

  const onEvent = (payload) => {
    res.write(`event: ${payload.type}\ndata: ${JSON.stringify(payload.data)}\n\n`);
  };
  bus.on('sse', onEvent);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    bus.off('sse', onEvent);
  });
});

// ── Manual "check now" (admin) ────────────────────────────────────────────────
router.post(
  '/check-now',
  requireAdminApi,
  asyncHandler(async (req, res) => {
    const id = req.body?.targetId;
    if (id) {
      const t = Targets.findById(id);
      if (!t) return res.status(404).json({ error: 'Target not found.' });
      const { result } = await scheduler.checkTarget(t, { manual: true });
      return res.json({ ok: true, result });
    }
    const targets = Targets.enabled();
    const results = [];
    for (const t of targets) {
      const { result } = await scheduler.checkTarget(t, { manual: true });
      results.push({ id: t.id, state: result.state });
    }
    res.json({ ok: true, results });
  })
);

// ── Targets (admin) ───────────────────────────────────────────────────────────
router.get('/targets', (req, res) => {
  res.json({ targets: Targets.all().map(scheduler.publicTarget) });
});

router.post('/targets', requireAdminApi, (req, res) => {
  const url = normalizeUrl(req.body?.url);
  if (!url) return res.status(400).json({ error: 'A valid http(s) URL is required.' });
  if (Targets.findByUrl(url)) return res.status(409).json({ error: 'That URL is already monitored.' });
  const label = isNonEmptyString(req.body?.label) ? req.body.label.trim().slice(0, 120) : '';
  const enabled = req.body?.enabled !== false;
  const t = Targets.create({ url, label, enabled });
  Events.add({ targetId: t.id, type: 'info', message: `Target added: ${url}` });
  res.status(201).json({ target: scheduler.publicTarget(t) });
});

router.patch('/targets/:id', requireAdminApi, (req, res) => {
  const t = Targets.findById(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Target not found.' });
  const fields = {};
  if (req.body.label !== undefined) fields.label = String(req.body.label).slice(0, 120);
  if (req.body.enabled !== undefined) fields.enabled = !!req.body.enabled;
  if (req.body.url !== undefined) {
    const url = normalizeUrl(req.body.url);
    if (!url) return res.status(400).json({ error: 'Invalid URL.' });
    const existing = Targets.findByUrl(url);
    if (existing && existing.id !== t.id) return res.status(409).json({ error: 'Another target already uses that URL.' });
    fields.url = url;
  }
  const updated = Targets.update(t.id, fields);
  res.json({ target: scheduler.publicTarget(updated) });
});

router.delete('/targets/:id', requireAdminApi, (req, res) => {
  const t = Targets.findById(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Target not found.' });
  Targets.remove(t.id);
  res.json({ ok: true });
});

// ── Runtime config (admin) ────────────────────────────────────────────────────
const CONFIG_KEYS = {
  intervalSeconds: (v) => clampInt(v, 10, 86400, config.monitorDefaults.intervalSeconds),
  jitterSeconds: (v) => clampInt(v, 0, 3600, config.monitorDefaults.jitterSeconds),
  alertCooldownSeconds: (v) => clampInt(v, 0, 86400, config.monitorDefaults.alertCooldownSeconds),
  timeoutMs: (v) => clampInt(v, 3000, 120000, config.monitorDefaults.timeoutMs),
  strategy: (v) => (['browser', 'http', 'auto'].includes(v) ? v : config.monitorDefaults.strategy),
  userAgent: (v) => String(v || '').slice(0, 400),
  notifyOnQueue: (v) => !!v,
  notifyOnOpen: (v) => !!v,
};

router.get('/config', (req, res) => {
  res.json({ config: scheduler.getMonitorSettings() });
});

router.put('/config', requireAdminApi, (req, res) => {
  const body = req.body || {};
  const applied = {};
  for (const [key, coerce] of Object.entries(CONFIG_KEYS)) {
    if (body[key] !== undefined) {
      applied[key] = settings.set(key, coerce(body[key]));
    }
  }
  Events.add({ type: 'info', message: `Settings updated: ${Object.keys(applied).join(', ') || 'none'}` });
  res.json({ ok: true, applied });
});

// ── Users (admin) ─────────────────────────────────────────────────────────────
router.get('/users', requireAdminApi, (req, res) => {
  res.json({ users: Users.all().map(publicUser) });
});

router.post('/users', requireAdminApi, (req, res) => {
  const { username, password, email: mail, role, notifyEnabled } = req.body || {};
  if (!isNonEmptyString(username) || username.trim().length < 3)
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  if (!isNonEmptyString(password) || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (mail && !isEmail(mail)) return res.status(400).json({ error: 'Invalid email address.' });
  if (Users.findByUsername(username.trim())) return res.status(409).json({ error: 'Username already exists.' });
  const user = Users.create({
    username: username.trim(),
    password,
    email: (mail || '').trim(),
    role: role === 'admin' ? 'admin' : 'user',
    notifyEnabled: notifyEnabled !== false,
  });
  res.status(201).json({ user: publicUser(user) });
});

router.patch('/users/:id', requireAdminApi, (req, res) => {
  const target = Users.findById(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const body = req.body || {};
  const fields = {};
  if (body.email !== undefined) {
    if (body.email && !isEmail(body.email)) return res.status(400).json({ error: 'Invalid email address.' });
    fields.email = (body.email || '').trim();
  }
  if (body.notifyEnabled !== undefined) fields.notify_enabled = !!body.notifyEnabled;
  if (body.role !== undefined) {
    const newRole = body.role === 'admin' ? 'admin' : 'user';
    // Don't allow demoting the last admin.
    if (target.role === 'admin' && newRole !== 'admin' && Users.countAdmins() <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last admin.' });
    }
    fields.role = newRole;
  }
  const updated = Users.update(target.id, fields);
  if (body.password !== undefined) {
    if (String(body.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    Users.setPassword(target.id, String(body.password));
  }
  res.json({ user: publicUser(updated) });
});

router.delete('/users/:id', requireAdminApi, (req, res) => {
  const target = Users.findById(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  if (target.role === 'admin' && Users.countAdmins() <= 1)
    return res.status(400).json({ error: 'Cannot delete the last admin.' });
  Users.remove(target.id);
  res.json({ ok: true });
});

// ── Self-service profile (any signed-in user) ─────────────────────────────────
router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch('/me', (req, res) => {
  const body = req.body || {};
  const fields = {};
  if (body.email !== undefined) {
    if (body.email && !isEmail(body.email)) return res.status(400).json({ error: 'Invalid email address.' });
    fields.email = (body.email || '').trim();
  }
  if (body.notifyEnabled !== undefined) fields.notify_enabled = !!body.notifyEnabled;
  const updated = Users.update(req.user.id, fields);
  res.json({ user: publicUser(updated) });
});

router.post('/me/password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!Users.verifyPassword(req.user, String(currentPassword || '')))
    return res.status(400).json({ error: 'Current password is incorrect.' });
  if (!isNonEmptyString(newPassword) || String(newPassword).length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  Users.setPassword(req.user.id, String(newPassword));
  res.json({ ok: true });
});

module.exports = router;

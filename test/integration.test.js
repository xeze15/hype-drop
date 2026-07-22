'use strict';

// Hermetic end-to-end test: boots a fake "store" (that can toggle between a
// normal page and a Queue-it waiting room), boots the real app against a temp
// DB using the HTTP detection strategy, and drives the full flow over HTTP.

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert');

// ── Configure the app BEFORE requiring it ─────────────────────────────────────
const tmpDb = path.join(os.tmpdir(), `hd-test-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = tmpDb;
process.env.SESSION_SECRET = 'test-secret-value-1234567890';
process.env.CHECK_STRATEGY = 'http';
process.env.CHECK_JITTER_SECONDS = '0';
process.env.SMTP_HOST = ''; // email disabled
process.env.SEED_TARGETS = '';
process.env.BOOTSTRAP_ADMIN_USERNAME = '';

const { buildApp, seedOnce } = require('../src/server');
const scheduler = require('../src/monitor/scheduler');
const { Targets, Notifications } = require('../src/models');

let fixtureMode = 'open';
let fixture, fixtureUrl, app, appServer, base;

const NORMAL_HTML = '<html><head><title>Pokémon Center</title></head><body><nav>Shop</nav></body></html>';
const QUEUE_HTML =
  '<html><head><title>Waiting Room</title></head><body><h1>You are now in line</h1>' +
  '<p>Your estimated wait time is 3 minutes.</p></body></html>';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

before(async () => {
  fixture = http.createServer((req, res) => {
    if (fixtureMode === 'queue') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(QUEUE_HTML);
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(NORMAL_HTML);
    }
  });
  const fport = await listen(fixture);
  fixtureUrl = `http://127.0.0.1:${fport}/`;

  seedOnce();
  app = buildApp();
  appServer = http.createServer(app);
  const aport = await listen(appServer);
  base = `http://127.0.0.1:${aport}`;
});

after(async () => {
  await scheduler.stop().catch(() => {});
  await new Promise((r) => appServer.close(r));
  await new Promise((r) => fixture.close(r));
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) fs.rmSync(f, { force: true });
});

// ── Tiny cookie-aware HTTP client ─────────────────────────────────────────────
let cookie = '';
async function req(method, url, { body, json, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (cookie) opts.headers.cookie = cookie;
  if (json !== undefined) { opts.headers['content-type'] = 'application/json'; opts.headers.accept = 'application/json'; opts.body = JSON.stringify(json); }
  else if (body !== undefined) { opts.headers['content-type'] = 'application/x-www-form-urlencoded'; opts.body = body; }
  const res = await fetch(base + url, { ...opts, redirect: 'manual' });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const m = c.match(/^(hd\.sid=[^;]*)/);
    if (m) cookie = m[1];
  }
  const text = await res.text();
  return { status: res.status, text, location: res.headers.get('location') };
}

function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/name="csrf-token" content="([^"]+)"/);
  return m ? m[1] : null;
}

// ── The flow ──────────────────────────────────────────────────────────────────
test('first-run setup shows a form', async () => {
  const r = await req('GET', '/setup');
  assert.equal(r.status, 200);
  assert.ok(/create your admin account/i.test(r.text));
});

let csrf;
test('create the admin account', async () => {
  const form = await req('GET', '/setup');
  csrf = extractCsrf(form.text);
  assert.ok(csrf, 'csrf token present');
  const body = new URLSearchParams({ _csrf: csrf, username: 'admin', password: 'password123', password2: 'password123', email: 'admin@gmail.com' }).toString();
  const r = await req('POST', '/setup', { body });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/');
});

test('dashboard is reachable once signed in', async () => {
  const r = await req('GET', '/');
  assert.equal(r.status, 200);
  assert.ok(/Monitored targets/.test(r.text));
  csrf = extractCsrf(r.text) || csrf;
});

test('rejects a state-changing request without a CSRF token', async () => {
  const r = await req('POST', '/api/targets', { json: { url: fixtureUrl } });
  assert.equal(r.status, 403);
});

let targetId;
test('admin can add a target (with CSRF header)', async () => {
  const r = await req('POST', '/api/targets', { json: { url: fixtureUrl, label: 'Fixture' }, headers: { 'x-csrf-token': csrf } });
  assert.equal(r.status, 201);
  const data = JSON.parse(r.text);
  targetId = data.target.id;
  assert.ok(targetId);
});

test('a check against the normal page reports OPEN', async () => {
  const t = Targets.findById(targetId);
  const { result } = await scheduler.checkTarget(t, { manual: true });
  assert.equal(result.state, 'open');
});

test('when the store shows a waiting room, a check reports QUEUE and raises an alert', async () => {
  fixtureMode = 'queue';
  const before = Notifications.recent(50).length;
  const t = Targets.findById(targetId);
  const { result, changed } = await scheduler.checkTarget(t, { manual: true });
  assert.equal(result.state, 'queue');
  assert.equal(changed, true);
  const after = Notifications.recent(50).length;
  assert.ok(after > before, 'a notification was created');
  const alert = Notifications.recent(50).find((n) => n.level === 'alert');
  assert.ok(alert, 'an alert-level notification exists');
});

test('status endpoint reflects the queue state', async () => {
  const r = await req('GET', '/api/status', { headers: { accept: 'application/json' } });
  assert.equal(r.status, 200);
  const data = JSON.parse(r.text);
  const t = data.targets.find((x) => x.id === targetId);
  assert.equal(t.state, 'queue');
});

test('unauthenticated API access is rejected', async () => {
  const saved = cookie;
  cookie = '';
  const r = await req('GET', '/api/status', { headers: { accept: 'application/json' } });
  cookie = saved;
  assert.equal(r.status, 401);
});

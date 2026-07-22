'use strict';

const { settings } = require('../db');
const { Targets, Events, Notifications, Users } = require('../models');
const { check } = require('./detectors');
const { closeBrowser } = require('./browser');
const email = require('../notify/email');
const { emit } = require('../bus');
const { config } = require('../config');

let timer = null;
let running = false;
let stopped = false;

// ── Runtime settings (seeded from env defaults, editable in the admin panel) ──
function getMonitorSettings() {
  const d = config.monitorDefaults;
  return {
    intervalSeconds: settings.get('intervalSeconds', d.intervalSeconds),
    jitterSeconds: settings.get('jitterSeconds', d.jitterSeconds),
    alertCooldownSeconds: settings.get('alertCooldownSeconds', d.alertCooldownSeconds),
    strategy: settings.get('strategy', d.strategy),
    timeoutMs: settings.get('timeoutMs', d.timeoutMs),
    userAgent: settings.get('userAgent', d.userAgent),
    notifyOnQueue: settings.get('notifyOnQueue', d.notifyOnQueue),
    notifyOnOpen: settings.get('notifyOnOpen', d.notifyOnOpen),
  };
}

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), '[monitor]', ...args);
}

// ── A single check of one target, incl. state change + notifications ──────────
async function checkTarget(target, { manual = false } = {}) {
  const s = getMonitorSettings();
  let result;
  try {
    result = await check(target.url, {
      strategy: s.strategy,
      timeoutMs: s.timeoutMs,
      userAgent: s.userAgent || undefined,
    });
  } catch (err) {
    result = { state: 'error', detail: err.message, signals: ['exception'] };
  }

  const { changed, prevState } = Targets.recordCheck(target.id, result);

  if (manual) {
    Events.add({
      targetId: target.id,
      type: 'manual_check',
      state: result.state,
      prevState,
      message: result.detail,
    });
  }

  if (changed) {
    Events.add({
      targetId: target.id,
      type: 'state_change',
      state: result.state,
      prevState,
      message: result.detail,
    });
    await handleStateChange(target, result, prevState, s);
  }

  const fresh = Targets.findById(target.id);
  emit('target', publicTarget(fresh));
  return { result, changed, prevState };
}

async function handleStateChange(target, result, prevState, s) {
  const label = target.label || target.url;

  if (result.state === 'queue' && s.notifyOnQueue) {
    // Respect the per-target cooldown to avoid alert storms.
    const last = target.last_alert_at || 0;
    const cooldownMs = s.alertCooldownSeconds * 1000;
    if (Date.now() - last >= cooldownMs) {
      Targets.markAlerted(target.id);
      const note = Notifications.add({
        level: 'alert',
        title: `Queue started: ${label}`,
        body: result.detail,
        targetId: target.id,
      });
      emit('notification', note);
      log(`QUEUE detected for "${label}" — sending alerts.`);
      await sendAlerts(target, result.detail);
    } else {
      log(`QUEUE detected for "${label}" but within cooldown — alert suppressed.`);
    }
  } else if (result.state === 'open' && prevState === 'queue' && s.notifyOnOpen) {
    const note = Notifications.add({
      level: 'success',
      title: `Queue ended: ${label}`,
      body: 'The store is reachable again (queue cleared).',
      targetId: target.id,
    });
    emit('notification', note);
  }
}

async function sendAlerts(target, detail) {
  if (!email.isEnabled()) {
    Events.add({
      targetId: target.id,
      type: 'info',
      message: 'Email not sent: SMTP is not configured.',
    });
    return;
  }
  const recipients = Users.notifyRecipients().map((u) => u.email);
  if (!recipients.length) {
    Events.add({
      targetId: target.id,
      type: 'info',
      message: 'Email not sent: no users have a notification address enabled.',
    });
    return;
  }
  try {
    await email.sendQueueAlert({
      target,
      recipients,
      subjectTemplate: settings.get('subjectTemplate', '🚨 Queue started: {label}'),
      detail,
    });
    Events.add({
      targetId: target.id,
      type: 'notify_sent',
      message: `Alert emailed to ${recipients.length} recipient(s).`,
    });
  } catch (err) {
    log('Email send failed:', err.message);
    Events.add({
      targetId: target.id,
      type: 'check_error',
      message: `Email send failed: ${err.message}`,
    });
  }
}

// ── One full pass over all enabled targets (sequential to be gentle) ──────────
async function runCycle() {
  if (running || stopped) return;
  running = true;
  try {
    const targets = Targets.enabled();
    for (const t of targets) {
      if (stopped) break;
      await checkTarget(t).catch((err) => log('check failed:', err.message));
    }
    Events.prune();
    Notifications.prune();
  } finally {
    running = false;
  }
}

function nextDelayMs() {
  const s = getMonitorSettings();
  const base = Math.max(10, s.intervalSeconds) * 1000;
  const jitter = Math.max(0, s.jitterSeconds) * 1000;
  const offset = jitter ? Math.floor((Math.random() * 2 - 1) * jitter) : 0;
  return Math.max(5000, base + offset);
}

function scheduleNext() {
  if (stopped) return;
  timer = setTimeout(async () => {
    await runCycle();
    scheduleNext();
  }, nextDelayMs());
}

function start() {
  stopped = false;
  log(`Monitor started (strategy=${getMonitorSettings().strategy}).`);
  // Kick off an initial cycle shortly after boot, then schedule.
  timer = setTimeout(async () => {
    await runCycle();
    scheduleNext();
  }, 2000);
}

async function stop() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  await closeBrowser();
}

function publicTarget(t) {
  return {
    id: t.id,
    label: t.label,
    url: t.url,
    enabled: !!t.enabled,
    state: t.last_state,
    detail: t.last_detail,
    signals: safeJson(t.last_signals, []),
    lastCheckedAt: t.last_checked_at,
    lastChangedAt: t.last_changed_at,
    lastAlertAt: t.last_alert_at,
  };
}

function safeJson(s, def) {
  try {
    return JSON.parse(s);
  } catch {
    return def;
  }
}

module.exports = { start, stop, runCycle, checkTarget, getMonitorSettings, publicTarget };

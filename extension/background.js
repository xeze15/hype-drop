/* Hype Drop — background service worker: periodic checks + notifications. */
'use strict';

importScripts('detector.js');

const ALARM = 'hype-drop-check';
const DEFAULTS = {
  settings: { intervalMinutes: 2, soundEnabled: true, notifyOnQueue: true, notifyOnOpen: false },
  targets: [
    { id: 't1', url: 'https://www.pokemoncenter.com/', label: 'Pokémon Center', enabled: true, state: 'unknown', detail: '', signals: [], lastCheckedAt: null, lastChangedAt: null },
  ],
};

// ── Storage helpers ───────────────────────────────────────────────────────────
async function getState() {
  const s = await chrome.storage.local.get(['settings', 'targets']);
  return {
    settings: Object.assign({}, DEFAULTS.settings, s.settings || {}),
    targets: Array.isArray(s.targets) ? s.targets : DEFAULTS.targets.slice(),
  };
}
async function setTargets(targets) {
  await chrome.storage.local.set({ targets });
}
async function setSettings(settings) {
  await chrome.storage.local.set({ settings });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const s = await chrome.storage.local.get(['settings', 'targets']);
  if (!s.settings) await setSettings(DEFAULTS.settings);
  if (!s.targets) await setTargets(DEFAULTS.targets.slice());
  await rearm();
  checkAll();
});
chrome.runtime.onStartup.addListener(async () => {
  await rearm();
  checkAll();
});

async function rearm() {
  const { settings } = await getState();
  const period = Math.max(1, Number(settings.intervalMinutes) || 2);
  await chrome.alarms.clear(ALARM);
  chrome.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: 0.1 });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) checkAll();
});

// ── Checking ──────────────────────────────────────────────────────────────────
async function checkUrl(url) {
  try {
    const res = await fetch(url, { credentials: 'include', redirect: 'follow', cache: 'no-store' });
    const html = await res.text().catch(() => '');
    let cookieNames = [];
    try {
      const cookies = await chrome.cookies.getAll({ url });
      cookieNames = cookies.map((c) => c.name);
    } catch (e) {
      /* cookies permission optional */
    }
    return self.HDDetect.classify({ finalUrl: res.url || url, status: res.status, urls: [res.url || url], html, cookieNames });
  } catch (err) {
    return { state: 'error', detail: String(err && err.message ? err.message : err), signals: ['fetch error'] };
  }
}

async function checkAll() {
  const { targets, settings } = await getState();
  let changedAny = false;
  for (const t of targets) {
    if (!t.enabled) continue;
    const result = await checkUrl(t.url);
    if (applyResult(t, result, settings)) changedAny = true;
  }
  await setTargets(targets);
  await updateBadge(targets);
  if (changedAny) chrome.runtime.sendMessage({ type: 'state-updated' }).catch(() => {});
}

// Update a target with a check result. Returns true if state changed.
function applyResult(target, result, settings) {
  const prev = target.state;
  const changed = prev !== result.state;
  target.state = result.state;
  target.detail = result.detail;
  target.signals = result.signals || [];
  target.lastCheckedAt = Date.now();
  if (changed) {
    target.lastChangedAt = Date.now();
    if (result.state === 'queue' && settings.notifyOnQueue) {
      notify(target, 'queue');
    } else if (result.state === 'open' && prev === 'queue' && settings.notifyOnOpen) {
      notify(target, 'open');
    }
  }
  return changed;
}

// ── Notifications ─────────────────────────────────────────────────────────────
async function notify(target, kind) {
  const label = target.label || target.url;
  const title = kind === 'queue' ? '🚨 Queue started!' : '✅ Queue ended';
  const message = kind === 'queue' ? `${label} — a virtual queue is now live. Open it now!` : `${label} is reachable again.`;
  try {
    chrome.notifications.create('hd-' + target.id + '-' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
      priority: 2,
      requireInteraction: kind === 'queue',
    });
  } catch (e) {
    /* ignore */
  }
  const { settings } = await getState();
  if (kind === 'queue' && settings.soundEnabled) playSound();
}

// Clicking a notification opens the store.
chrome.notifications.onClicked.addListener(async () => {
  const { targets } = await getState();
  const queued = targets.find((t) => t.state === 'queue') || targets[0];
  if (queued) chrome.tabs.create({ url: queued.url });
});

async function updateBadge(targets) {
  const anyQueue = targets.some((t) => t.enabled && t.state === 'queue');
  try {
    await chrome.action.setBadgeText({ text: anyQueue ? '!' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: anyQueue ? '#ef4444' : '#6366f1' });
  } catch (e) {
    /* ignore */
  }
}

// ── Sound via an offscreen document (service workers can't play audio) ────────
async function playSound() {
  try {
    if (chrome.offscreen && chrome.offscreen.hasDocument) {
      const has = await chrome.offscreen.hasDocument();
      if (!has) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Play an alert tone when a queue starts.',
        });
      }
      chrome.runtime.sendMessage({ type: 'play-sound' }).catch(() => {});
    }
  } catch (e) {
    /* offscreen not supported — notification alone is fine */
  }
}

// ── Messages from popup + content scripts ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) return sendResponse({ ok: false });
    if (msg.type === 'check-now') {
      await checkAll();
      const state = await getState();
      return sendResponse({ ok: true, targets: state.targets });
    }
    if (msg.type === 'get-state') {
      return sendResponse(await getState());
    }
    if (msg.type === 'save-settings') {
      await setSettings(msg.settings);
      await rearm();
      return sendResponse({ ok: true });
    }
    if (msg.type === 'save-targets') {
      await setTargets(msg.targets);
      const state = await getState();
      await updateBadge(state.targets);
      return sendResponse({ ok: true });
    }
    if (msg.type === 'test-notification') {
      notify({ id: 'test', label: 'Test', url: 'https://www.pokemoncenter.com/' }, 'queue');
      return sendResponse({ ok: true });
    }
    // Ground-truth report from a content script observing a real page load.
    if (msg.type === 'page-observed' && msg.result && sender && sender.url) {
      const { targets, settings } = await getState();
      const pageHost = hostOf(sender.url);
      let target = targets.find((t) => hostOf(t.url) === pageHost && t.enabled);
      // A Queue-it waiting room can appear on a queue-it.net host — attribute it
      // to whichever enabled target is being watched.
      if (!target && /queue-it\.net$/i.test(pageHost)) target = targets.find((t) => t.enabled);
      if (target) {
        if (applyResult(target, msg.result, settings)) {
          await setTargets(targets);
          await updateBadge(targets);
          chrome.runtime.sendMessage({ type: 'state-updated' }).catch(() => {});
        }
      }
      return sendResponse({ ok: true });
    }
    return sendResponse({ ok: false });
  })();
  return true; // async response
});

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (e) {
    return '';
  }
}

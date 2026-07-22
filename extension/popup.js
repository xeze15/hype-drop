/* Hype Drop popup — status view + config. */
'use strict';

const $ = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function relTime(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  return Math.round(m / 60) + 'h ago';
}

function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else n.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach((c) => c && n.append(c));
  return n;
}

let targets = [];
let settings = {};

async function load() {
  const state = await send({ type: 'get-state' });
  targets = state.targets || [];
  settings = state.settings || {};
  renderTargets();
  $('interval').value = settings.intervalMinutes ?? 2;
  $('sound').checked = !!settings.soundEnabled;
  $('notifyQueue').checked = settings.notifyOnQueue !== false;
  $('notifyOpen').checked = !!settings.notifyOnOpen;
}

function renderTargets() {
  const list = $('targets');
  list.innerHTML = '';
  if (!targets.length) {
    list.append(el('li', { class: 'empty', text: 'No sites yet — add one below.' }));
    return;
  }
  for (const t of targets) {
    const li = el('li', {});
    const dotWrap = el('div', { class: 't-head' }, [
      el('span', { class: 't-dot ' + t.state }),
      el('span', { class: 't-label', text: t.label || t.url }),
      el('span', { class: 't-state ' + t.state, text: t.state }),
    ]);
    li.append(dotWrap);
    li.append(el('div', { class: 't-detail', text: t.detail || 'Waiting for first check…' }));
    const foot = el('div', { class: 't-foot' });
    foot.append(el('span', { class: 't-meta', text: 'Checked ' + relTime(t.lastCheckedAt) }));
    const links = el('div', {});
    const open = el('button', { class: 'link', text: 'Open' });
    open.addEventListener('click', () => chrome.tabs.create({ url: t.url }));
    const toggle = el('button', { class: 'link', text: t.enabled ? 'Pause' : 'Resume' });
    toggle.addEventListener('click', async () => { t.enabled = !t.enabled; await persistTargets(); });
    const del = el('button', { class: 'link danger', text: 'Remove' });
    del.addEventListener('click', async () => { targets = targets.filter((x) => x.id !== t.id); await persistTargets(); });
    links.append(open, document.createTextNode('  '), toggle, document.createTextNode('  '), del);
    foot.append(links);
    li.append(foot);
    list.append(li);
  }
}

async function persistTargets() {
  await send({ type: 'save-targets', targets });
  renderTargets();
}

async function persistSettings() {
  settings = {
    intervalMinutes: Math.max(1, Math.min(120, Number($('interval').value) || 2)),
    soundEnabled: $('sound').checked,
    notifyOnQueue: $('notifyQueue').checked,
    notifyOnOpen: $('notifyOpen').checked,
  };
  await send({ type: 'save-settings', settings });
  status('Saved');
}

function status(msg) {
  $('status').textContent = msg;
  setTimeout(() => { if ($('status').textContent === msg) $('status').textContent = ''; }, 2000);
}

// ── Events ────────────────────────────────────────────────────────────────────
$('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  let url = $('url').value.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch (_) { return status('Invalid URL'); }
  if (targets.some((t) => t.url === url)) return status('Already watching that URL');
  targets.push({ id: 't' + Date.now(), url, label: new URL(url).hostname, enabled: true, state: 'unknown', detail: '', signals: [], lastCheckedAt: null, lastChangedAt: null });
  $('url').value = '';
  await persistTargets();
  status('Added — checking…');
  await send({ type: 'check-now' });
  await load();
});

['interval', 'sound', 'notifyQueue', 'notifyOpen'].forEach((id) => $(id).addEventListener('change', persistSettings));

$('check').addEventListener('click', async () => {
  $('check').disabled = true;
  $('check').textContent = 'Checking…';
  await send({ type: 'check-now' });
  await load();
  $('check').disabled = false;
  $('check').textContent = 'Check now';
  status('Done');
});

$('test').addEventListener('click', async () => { await send({ type: 'test-notification' }); status('Sent a test alert'); });

// Live-refresh when the background updates state.
chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === 'state-updated') load(); });

load();

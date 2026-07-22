/* Dashboard: live target states, alerts feed, activity log. */
(function () {
  const { api, el, relTime, toast } = window.HD;
  const grid = document.getElementById('targets');
  const banner = document.getElementById('queue-banner');
  const bannerText = document.getElementById('queue-banner-text');
  const conn = document.getElementById('conn');
  const notifList = document.getElementById('notifications');
  const eventList = document.getElementById('events');

  const STATES = ['open', 'queue', 'blocked', 'error', 'unknown'];

  function cardFor(id) {
    return grid ? grid.querySelector(`.target[data-id="${id}"]`) : null;
  }

  function applyTarget(t) {
    const card = cardFor(t.id);
    if (!card) { refreshStatus(); return; }
    const dot = card.querySelector('.state-dot');
    dot.className = 'state-dot state-' + t.state;
    const label = card.querySelector('.state-label');
    label.className = 'state-label state-text-' + t.state;
    label.textContent = t.state;
    card.querySelector('.target-detail').textContent = t.detail || '—';
    const rel = card.querySelector('.rel');
    if (rel) { rel.setAttribute('data-ts', t.lastCheckedAt || ''); rel.textContent = relTime(t.lastCheckedAt); }
    updateBanner();
  }

  function updateBanner() {
    if (!banner) return;
    const queued = [...document.querySelectorAll('.target')].filter((c) =>
      c.querySelector('.state-dot').classList.contains('state-queue')
    );
    if (queued.length) {
      const names = queued.map((c) => c.querySelector('.target-label').textContent.trim());
      bannerText.textContent = names.join(', ');
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  async function refreshStatus() {
    try {
      const data = await api('GET', '/api/status');
      renderTargets(data.targets);
    } catch (_) { /* ignore transient */ }
  }

  function renderTargets(targets) {
    if (!grid) return;
    grid.innerHTML = '';
    for (const t of targets) {
      const card = el('article', { class: 'card target', 'data-id': t.id });
      const head = el('div', { class: 'target-head' });
      head.append(el('span', { class: 'state-dot state-' + t.state }));
      const title = el('div', { class: 'target-title' });
      title.append(el('div', { class: 'target-label', text: t.label || t.url }));
      const a = el('a', { class: 'target-url', href: t.url, target: '_blank', rel: 'noreferrer noopener', text: t.url });
      title.append(a);
      head.append(title);
      head.append(el('span', { class: 'state-label state-text-' + t.state, text: t.state }));
      card.append(head);
      card.append(el('div', { class: 'target-detail muted', text: t.detail || 'Waiting for first check…' }));
      const meta = el('div', { class: 'target-meta' });
      const checked = el('span', { class: 'checked' });
      checked.append(document.createTextNode('Last checked: '));
      checked.append(el('span', { class: 'rel', 'data-ts': t.lastCheckedAt || '', text: relTime(t.lastCheckedAt) }));
      meta.append(checked);
      if (!t.enabled) meta.append(el('span', { class: 'pill pill-muted', text: 'paused' }));
      card.append(meta);
      grid.append(card);
    }
    updateBanner();
  }

  function renderNotifications(items) {
    if (!notifList) return;
    notifList.innerHTML = '';
    if (!items.length) { notifList.append(el('li', { class: 'empty', text: 'No alerts yet.' })); return; }
    for (const n of items) notifList.append(notifItem(n));
  }

  function notifItem(n) {
    const li = el('li', { class: 'lvl-' + (n.level || 'info') });
    li.append(el('span', { class: 'f-time', text: relTime(n.created_at) }));
    li.append(el('div', { class: 'f-title', text: n.title }));
    if (n.body) li.append(el('div', { class: 'f-body', text: n.body }));
    return li;
  }

  function renderEvents(items) {
    if (!eventList) return;
    eventList.innerHTML = '';
    if (!items.length) { eventList.append(el('li', { class: 'empty', text: 'No activity yet.' })); return; }
    for (const e of items) {
      const li = el('li', {});
      li.append(el('span', { class: 'f-time', text: relTime(e.created_at) }));
      const who = e.target_label || e.target_url || 'system';
      const state = e.state ? ` → ${e.state}` : '';
      li.append(el('div', { class: 'f-title', text: `${labelFor(e.type)}${state}` }));
      li.append(el('div', { class: 'f-body', text: `${who}${e.message ? ' · ' + e.message : ''}` }));
      eventList.append(li);
    }
  }

  function labelFor(type) {
    return {
      state_change: 'State change', manual_check: 'Manual check', check_error: 'Error',
      notify_sent: 'Alert sent', info: 'Info',
    }[type] || type;
  }

  async function loadFeeds() {
    try {
      const [n, e] = await Promise.all([api('GET', '/api/notifications?limit=25'), api('GET', '/api/events?limit=40')]);
      renderNotifications(n.notifications);
      renderEvents(e.events);
    } catch (_) { /* ignore */ }
  }

  // ── SSE live stream ─────────────────────────────────────────────────────────
  function connect() {
    const es = new EventSource('/api/stream');
    es.addEventListener('hello', () => { conn.textContent = '● live'; conn.className = 'pill ok'; });
    es.addEventListener('target', (ev) => applyTarget(JSON.parse(ev.data)));
    es.addEventListener('notification', (ev) => {
      const n = JSON.parse(ev.data);
      if (notifList) {
        const empty = notifList.querySelector('.empty');
        if (empty) empty.remove();
        notifList.prepend(notifItem(n));
      }
      if (n.level === 'alert') toast('🚨 ' + n.title, 'err');
      loadFeeds();
    });
    es.onerror = () => { conn.textContent = '● reconnecting…'; conn.className = 'pill bad'; };
  }

  // ── Check now ───────────────────────────────────────────────────────────────
  const checkBtn = document.getElementById('check-now');
  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking…';
      try { await api('POST', '/api/check-now', {}); toast('Check complete', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
      finally { checkBtn.disabled = false; checkBtn.textContent = 'Check now'; loadFeeds(); }
    });
  }

  updateBanner();
  loadFeeds();
  connect();
  setInterval(loadFeeds, 30000);
})();

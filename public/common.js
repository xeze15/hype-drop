/* Shared client helpers (served with a strict CSP — no inline scripts). */
(function () {
  const meta = document.querySelector('meta[name="csrf-token"]');
  const CSRF = meta ? meta.getAttribute('content') : '';

  async function api(method, url, body) {
    const opts = { method, headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['X-CSRF-Token'] = CSRF;
      opts.body = JSON.stringify(body);
    } else if (method !== 'GET') {
      opts.headers['X-CSRF-Token'] = CSRF;
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of [].concat(children)) if (c) n.append(c);
    return n;
  }

  function relTime(ts) {
    if (!ts) return '—';
    const s = Math.round((Date.now() - Number(ts)) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    return new Date(Number(ts)).toLocaleString();
  }

  function fmtTime(ts) {
    return ts ? new Date(Number(ts)).toLocaleTimeString() : '';
  }

  let toastTimer = null;
  function toast(msg, kind) {
    let t = document.getElementById('toast');
    if (!t) { t = el('div', { id: 'toast', class: 'toast' }); document.body.append(t); }
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function refreshRelTimes() {
    document.querySelectorAll('.rel[data-ts]').forEach((n) => {
      n.textContent = relTime(n.getAttribute('data-ts'));
    });
  }
  setInterval(refreshRelTimes, 15000);
  refreshRelTimes();

  window.HD = { api, el, relTime, fmtTime, toast, refreshRelTimes, CSRF };
})();

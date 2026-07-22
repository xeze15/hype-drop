/* Admin panel: targets, monitor settings, email, users. */
(function () {
  const { api, el, relTime, toast } = window.HD;

  // ── Targets ───────────────────────────────────────────────────────────────
  const tBody = document.querySelector('#targets-table tbody');

  function targetRow(t) {
    const tr = el('tr', { 'data-id': t.id });
    tr.append(el('td', {}, el('span', { class: 'state-label state-text-' + t.state, text: t.state })));
    const info = el('td', {});
    info.append(el('div', { text: t.label || '(no label)' }));
    info.append(el('a', { class: 'u-url', href: t.url, target: '_blank', rel: 'noreferrer noopener', text: t.url }));
    tr.append(info);
    tr.append(el('td', { class: 'u-url', text: t.lastCheckedAt ? relTime(t.lastCheckedAt) : '—' }));

    const enCell = el('td', {});
    const toggle = el('button', { class: 'btn btn-sm', text: t.enabled ? 'On' : 'Paused' });
    toggle.addEventListener('click', async () => {
      try { await api('PATCH', '/api/targets/' + t.id, { enabled: !t.enabled }); loadTargets(); }
      catch (err) { toast(err.message, 'err'); }
    });
    enCell.append(toggle);
    tr.append(enCell);

    const act = el('td', { class: 'actions' });
    const check = el('button', { class: 'btn btn-sm', text: 'Check' });
    check.addEventListener('click', async () => {
      check.disabled = true;
      try { const r = await api('POST', '/api/check-now', { targetId: t.id }); toast('→ ' + r.result.state, 'ok'); loadTargets(); }
      catch (err) { toast(err.message, 'err'); }
      finally { check.disabled = false; }
    });
    const del = el('button', { class: 'btn btn-sm btn-danger', text: 'Delete' });
    del.addEventListener('click', async () => {
      if (!confirm('Delete this target?')) return;
      try { await api('DELETE', '/api/targets/' + t.id); loadTargets(); }
      catch (err) { toast(err.message, 'err'); }
    });
    act.append(check, del);
    tr.append(act);
    return tr;
  }

  async function loadTargets() {
    try {
      const data = await api('GET', '/api/targets');
      tBody.innerHTML = '';
      if (!data.targets.length) {
        const tr = el('tr', {}); tr.append(el('td', { class: 'muted', colspan: '5', text: 'No targets yet.' }));
        tBody.append(tr); return;
      }
      for (const t of data.targets) tBody.append(targetRow(t));
    } catch (err) { toast(err.message, 'err'); }
  }

  document.getElementById('add-target').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', '/api/targets', { url: f.url.value.trim(), label: f.label.value.trim() });
      f.reset(); loadTargets(); toast('Target added', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });

  document.getElementById('check-all').addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Checking…';
    try { await api('POST', '/api/check-now', {}); toast('Check complete', 'ok'); loadTargets(); }
    catch (err) { toast(err.message, 'err'); }
    finally { e.target.disabled = false; e.target.textContent = 'Check all now'; }
  });

  // ── Config ────────────────────────────────────────────────────────────────
  const cfgForm = document.getElementById('config-form');
  async function loadConfig() {
    try {
      const { config } = await api('GET', '/api/config');
      cfgForm.subjectTemplate.value = config.subjectTemplate || '';
    } catch (_) { /* ignore */ }
  }
  cfgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      intervalSeconds: +f.intervalSeconds.value,
      jitterSeconds: +f.jitterSeconds.value,
      alertCooldownSeconds: +f.alertCooldownSeconds.value,
      timeoutMs: +f.timeoutMs.value,
      strategy: f.strategy.value,
      userAgent: f.userAgent.value,
      notifyOnQueue: f.notifyOnQueue.checked,
      notifyOnOpen: f.notifyOnOpen.checked,
      subjectTemplate: f.subjectTemplate.value,
    };
    try { await api('PUT', '/api/config', body); toast('Settings saved', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  });

  // ── Email ─────────────────────────────────────────────────────────────────
  document.getElementById('test-email').addEventListener('submit', async (e) => {
    e.preventDefault();
    const to = e.target.to.value.trim();
    try { const r = await api('POST', '/api/notify/test', to ? { to } : {}); toast('Sent to ' + r.sentTo, 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  });
  const verifyBtn = document.getElementById('verify-smtp');
  if (verifyBtn) verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true;
    try { const r = await api('GET', '/api/notify/verify'); toast(r.ok ? 'SMTP OK ✅' : 'SMTP error: ' + r.reason, r.ok ? 'ok' : 'err'); }
    catch (err) { toast(err.message, 'err'); }
    finally { verifyBtn.disabled = false; }
  });

  // ── Users ─────────────────────────────────────────────────────────────────
  const uBody = document.querySelector('#users-table tbody');
  function userRow(u) {
    const tr = el('tr', { 'data-id': u.id });
    tr.append(el('td', { text: u.username }));

    const emailCell = el('td', {});
    const emailInput = el('input', { type: 'email', value: u.email || '', placeholder: 'no email' });
    emailInput.addEventListener('change', async () => {
      try { await api('PATCH', '/api/users/' + u.id, { email: emailInput.value.trim() }); toast('Saved', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
    });
    emailCell.append(emailInput);
    tr.append(emailCell);

    const roleCell = el('td', {});
    const roleSel = el('select', {});
    for (const r of ['user', 'admin']) {
      const o = el('option', { value: r, text: r }); if (u.role === r) o.selected = true; roleSel.append(o);
    }
    roleSel.addEventListener('change', async () => {
      try { await api('PATCH', '/api/users/' + u.id, { role: roleSel.value }); toast('Role updated', 'ok'); }
      catch (err) { toast(err.message, 'err'); loadUsers(); }
    });
    roleCell.append(roleSel);
    tr.append(roleCell);

    const notifyCell = el('td', {});
    const chk = el('input', { type: 'checkbox' }); chk.checked = !!u.notifyEnabled;
    chk.addEventListener('change', async () => {
      try { await api('PATCH', '/api/users/' + u.id, { notifyEnabled: chk.checked }); toast('Saved', 'ok'); }
      catch (err) { toast(err.message, 'err'); chk.checked = !chk.checked; }
    });
    notifyCell.append(chk);
    tr.append(notifyCell);

    const act = el('td', { class: 'actions' });
    const del = el('button', { class: 'btn btn-sm btn-danger', text: 'Delete' });
    del.addEventListener('click', async () => {
      if (!confirm('Delete user ' + u.username + '?')) return;
      try { await api('DELETE', '/api/users/' + u.id); loadUsers(); }
      catch (err) { toast(err.message, 'err'); }
    });
    act.append(del);
    tr.append(act);
    return tr;
  }

  async function loadUsers() {
    try {
      const data = await api('GET', '/api/users');
      uBody.innerHTML = '';
      for (const u of data.users) uBody.append(userRow(u));
    } catch (err) { toast(err.message, 'err'); }
  }

  document.getElementById('add-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', '/api/users', {
        username: f.username.value.trim(),
        email: f.email.value.trim(),
        password: f.password.value,
        role: f.role.value,
        notifyEnabled: f.notifyEnabled.checked,
      });
      f.reset(); loadUsers(); toast('User added', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });

  loadTargets();
  loadConfig();
  loadUsers();
})();

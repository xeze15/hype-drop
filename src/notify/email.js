'use strict';

const nodemailer = require('nodemailer');
const { config } = require('../config');

let transporter = null;

function getTransporter() {
  if (!config.mail.enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure, // true for 465, false for 587/25 (STARTTLS)
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  }
  return transporter;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function verify() {
  const t = getTransporter();
  if (!t) return { ok: false, reason: 'SMTP is not configured (SMTP_HOST is empty).' };
  try {
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) throw new Error('Email is disabled: SMTP is not configured.');
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipients.length) throw new Error('No recipients.');
  return t.sendMail({
    from: config.mail.from || config.mail.user,
    to: recipients.join(', '),
    subject,
    text,
    html,
  });
}

/** Compose + send the "a queue has started" alert to a list of recipients. */
async function sendQueueAlert({ target, recipients, subjectTemplate, detail }) {
  const label = target.label || target.url;
  const subject = renderTemplate(subjectTemplate || '🚨 Queue started: {label}', {
    label,
    url: target.url,
  });
  const link = config.server.publicBaseUrl || '';
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const text = [
    `A virtual queue / waiting room was just detected.`,
    ``,
    `Target: ${label}`,
    `URL:    ${target.url}`,
    `When:   ${when} (ET)`,
    detail ? `Detail: ${detail}` : ``,
    ``,
    `Open the store now: ${target.url}`,
    link ? `Dashboard: ${link}` : ``,
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px">
      <h2 style="margin:0 0 8px;color:#b91c1c">🚨 A queue just started</h2>
      <p style="margin:0 0 16px;color:#374151">A virtual waiting room was detected on your monitored target.</p>
      <table style="border-collapse:collapse;font-size:14px;color:#111827">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Target</td><td><strong>${esc(label)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">URL</td><td><a href="${esc(target.url)}">${esc(target.url)}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">When</td><td>${esc(when)} (ET)</td></tr>
        ${detail ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top">Detail</td><td>${esc(detail)}</td></tr>` : ''}
      </table>
      <p style="margin:20px 0">
        <a href="${esc(target.url)}" style="background:#dc2626;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open the store →</a>
      </p>
      ${link ? `<p style="font-size:13px;color:#6b7280">Dashboard: <a href="${esc(link)}">${esc(link)}</a></p>` : ''}
    </div>`;

  return sendMail({ to: recipients, subject, text, html });
}

function renderTemplate(tmpl, vars) {
  return String(tmpl).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

module.exports = { getTransporter, verify, sendMail, sendQueueAlert, renderTemplate, isEnabled: () => config.mail.enabled };

'use strict';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Validate + normalize an http(s) URL. Returns normalized string or null. */
function normalizeUrl(input) {
  if (!isNonEmptyString(input)) return null;
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function isGmail(v) {
  return isEmail(v) && /@(gmail|googlemail)\.com$/i.test(v.trim());
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { isNonEmptyString, normalizeUrl, isEmail, isGmail, clampInt, asyncHandler };

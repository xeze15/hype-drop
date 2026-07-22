'use strict';

const { getBrowser, isAvailable } = require('./browser');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Signal definitions ───────────────────────────────────────────────────────
// "Strong" queue markers are decisive on their own. "Weak" markers (marketing
// copy that can appear on a normal page) only contribute as supporting context.
const QUEUE_STRONG_TEXT = [
  'you are now in line',
  "you're now in line",
  'you are in line',
  'waiting room',
  'estimated wait time',
  'your estimated wait',
  'your place in line',
  'your number in line',
  'joining the queue',
  'thank you for waiting',
  'we are experiencing a high volume',
  'redirected to the website when it is your turn',
];
const QUEUE_WEAK_TEXT = ['high demand', 'please wait', 'due to high traffic'];

// Bot-protection / interstitial markers (site did not let us see the real page).
const BLOCK_TEXT = [
  'access denied', // Akamai
  'reference #', // Akamai error id
  'pardon our interruption', // PerimeterX / HUMAN
  'px-captcha',
  'just a moment', // Cloudflare
  'attention required', // Cloudflare
  'verify you are a human',
  'verifying you are human',
  'enable javascript and cookies to continue',
  'unusual traffic',
  'request unsuccessful. incapsula', // Imperva
];

const QUEUE_IT_HOST = /(^|\.)queue-it\.net$/i;

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function includesAny(haystack, needles) {
  const hits = [];
  for (const n of needles) if (haystack.includes(n)) hits.push(n);
  return hits;
}

/**
 * Classify a check from gathered evidence.
 * @returns {{state:'open'|'queue'|'blocked'|'error', detail:string, signals:string[]}}
 */
function analyze(evidence) {
  const {
    finalUrl = '',
    status = 0,
    urls = [], // every URL seen (final + redirect hops)
    cookieNames = [],
    headers = {}, // lowercased keys
    html = '',
    title = '',
    error = '',
  } = evidence;

  const signals = [];
  const lcHtml = (html || '').toLowerCase();
  const lcTitle = (title || '').toLowerCase();
  const allUrls = [finalUrl, ...urls].filter(Boolean);

  if (error) {
    return { state: 'error', detail: error, signals: ['network/error'] };
  }

  // ── QUEUE (highest priority — this is the event we care about) ─────────────
  // 1) Redirected to / landed on a Queue-it host.
  for (const u of allUrls) {
    if (QUEUE_IT_HOST.test(hostOf(u))) signals.push(`queue-it host: ${hostOf(u)}`);
  }
  // 2) Queue-it cookies (e.g. QueueITAccepted-SDFrts...).
  for (const c of cookieNames) {
    if (/queueit/i.test(c) || /^queue-it/i.test(c)) signals.push(`queue-it cookie: ${c}`);
  }
  // 3) Queue-it response headers.
  for (const k of Object.keys(headers)) {
    if (k.startsWith('x-queueit')) signals.push(`header: ${k}`);
  }
  const setCookie = String(headers['set-cookie'] || '').toLowerCase();
  if (setCookie.includes('queueitaccepted')) signals.push('set-cookie: QueueITAccepted');
  // 4) Queue-it script/asset referenced in the markup.
  if (lcHtml.includes('queue-it.net') || lcHtml.includes('queue-it.com')) {
    signals.push('markup references queue-it');
  }
  // 5) Waiting-room copy.
  const strongText = includesAny(lcHtml, QUEUE_STRONG_TEXT).concat(
    includesAny(lcTitle, QUEUE_STRONG_TEXT)
  );
  for (const t of new Set(strongText)) signals.push(`text: "${t}"`);

  const strongQueue = signals.length > 0;
  if (strongQueue) {
    return {
      state: 'queue',
      detail: `Queue detected (${signals.length} signal${signals.length === 1 ? '' : 's'}).`,
      signals,
    };
  }

  // ── BLOCKED (bot protection / interstitial) ───────────────────────────────
  const blockText = includesAny(lcHtml, BLOCK_TEXT).concat(includesAny(lcTitle, BLOCK_TEXT));
  const cfMitigated = Boolean(headers['cf-mitigated']);
  if (status === 403 || status === 429 || blockText.length || cfMitigated) {
    const bsig = [];
    if (status) bsig.push(`http ${status}`);
    for (const t of new Set(blockText)) bsig.push(`text: "${t}"`);
    if (cfMitigated) bsig.push('cloudflare challenge');
    return {
      state: 'blocked',
      detail:
        'Request was blocked by bot protection (could not observe the real page). ' +
        'Use the browser strategy and/or reduce polling frequency.',
      signals: bsig.length ? bsig : ['blocked'],
    };
  }

  // ── Weak queue hints on an otherwise-loading page ─────────────────────────
  const weak = includesAny(lcHtml, QUEUE_WEAK_TEXT);
  if (status >= 500) {
    return {
      state: 'error',
      detail: `Server returned HTTP ${status}.`,
      signals: [`http ${status}`, ...weak.map((w) => `text: "${w}"`)],
    };
  }

  // ── OPEN (store is reachable, no queue) ───────────────────────────────────
  if (status >= 200 && status < 400) {
    const detail = weak.length
      ? `Store reachable (HTTP ${status}); minor "${weak[0]}" wording seen but no queue.`
      : `Store reachable (HTTP ${status}), no queue.`;
    return { state: 'open', detail, signals: [`http ${status}`] };
  }

  return {
    state: 'error',
    detail: status ? `Unexpected HTTP ${status}.` : 'No response.',
    signals: status ? [`http ${status}`] : ['no response'],
  };
}

// ── HTTP strategy: fast, header-based. Usually blocked by Pokémon Center. ─────
async function httpCheck(url, { timeoutMs = 30000, userAgent } = {}) {
  const ua = userAgent || DEFAULT_UA;
  const urls = [];
  let current = url;
  let status = 0;
  let headers = {};
  let html = '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop < 10; hop++) {
      urls.push(current);
      const res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': ua,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
      });
      status = res.status;
      headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
      if (status >= 300 && status < 400 && headers.location) {
        current = new URL(headers.location, current).toString();
        continue;
      }
      html = await res.text().catch(() => '');
      break;
    }
    return analyze({ finalUrl: current, status, urls, headers, html });
  } catch (err) {
    const msg = err.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : err.message;
    return analyze({ finalUrl: current, error: msg });
  } finally {
    clearTimeout(timer);
  }
}

// ── Browser strategy: real Chromium. Needed for bot-protected sites. ──────────
async function browserCheck(url, { timeoutMs = 30000, userAgent } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: userAgent || DEFAULT_UA,
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    javaScriptEnabled: true,
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Give client-side redirects (Queue-it JS connector) a moment to fire.
    await page.waitForTimeout(1500);

    const finalUrl = page.url();
    const urls = [];
    let status = 0;
    let headers = {};
    if (response) {
      status = response.status();
      headers = response.headers();
      // Walk the redirect chain that led to the main response.
      let req = response.request();
      let guard = 0;
      while (req && guard++ < 15) {
        urls.push(req.url());
        req = req.redirectedFrom();
      }
    }
    const [html, title, cookies] = await Promise.all([
      page.content().catch(() => ''),
      page.title().catch(() => ''),
      context.cookies().catch(() => []),
    ]);
    const cookieNames = cookies.map((c) => c.name);
    return analyze({ finalUrl, status, urls, headers, html, title, cookieNames });
  } catch (err) {
    const msg = /timeout/i.test(err.message) ? `Navigation timed out after ${timeoutMs}ms` : err.message;
    return analyze({ finalUrl: url, error: msg });
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Run a check using the configured strategy.
 * @param {string} url
 * @param {{strategy?:string, timeoutMs?:number, userAgent?:string}} opts
 */
async function check(url, opts = {}) {
  const strategy = opts.strategy || 'browser';
  if (strategy === 'http') return httpCheck(url, opts);
  if (strategy === 'browser') return browserCheck(url, opts);
  // auto: cheap HTTP first; escalate to a real browser if blocked/errored.
  const http = await httpCheck(url, opts);
  if (http.state === 'blocked' || http.state === 'error') {
    if (isAvailable()) {
      const browser = await browserCheck(url, opts);
      browser.signals = ['(auto: escalated from http)', ...browser.signals];
      return browser;
    }
  }
  return http;
}

module.exports = { check, httpCheck, browserCheck, analyze, DEFAULT_UA };

/*
 * Shared queue detector for the Hype Drop browser extension.
 *
 * Runs in three contexts, so it must not depend on Node or DOM globals at load:
 *   - content script (reads the real page the user is on)
 *   - background service worker (classifies a fetch() it made)
 *   - Node (unit tests)
 *
 * classify(evidence) -> { state: 'open'|'queue'|'blocked'|'error', detail, signals[] }
 */
(function (root) {
  'use strict';

  var QUEUE_STRONG_TEXT = [
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
  var QUEUE_WEAK_TEXT = ['high demand', 'please wait', 'due to high traffic'];
  var BLOCK_TEXT = [
    'access denied',
    'reference #',
    'pardon our interruption',
    'px-captcha',
    'just a moment',
    'attention required',
    'verify you are a human',
    'verifying you are human',
    'enable javascript and cookies to continue',
    'unusual traffic',
    'request unsuccessful. incapsula',
  ];
  var QUEUE_IT_HOST = /(^|\.)queue-it\.net$/i;

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch (e) {
      return '';
    }
  }

  function includesAny(haystack, needles) {
    var hits = [];
    for (var i = 0; i < needles.length; i++) {
      if (haystack.indexOf(needles[i]) !== -1) hits.push(needles[i]);
    }
    return hits;
  }

  function uniq(arr) {
    return arr.filter(function (v, i) {
      return arr.indexOf(v) === i;
    });
  }

  function classify(evidence) {
    evidence = evidence || {};
    var finalUrl = evidence.finalUrl || '';
    var status = evidence.status || 0;
    var urls = evidence.urls || [];
    var cookieNames = evidence.cookieNames || [];
    var html = (evidence.html || '').toLowerCase();
    var title = (evidence.title || '').toLowerCase();
    var error = evidence.error || '';

    if (error) return { state: 'error', detail: error, signals: ['network/error'] };

    var signals = [];
    var allUrls = [finalUrl].concat(urls).filter(Boolean);

    // ── QUEUE ────────────────────────────────────────────────────────────────
    for (var i = 0; i < allUrls.length; i++) {
      var h = hostOf(allUrls[i]);
      if (QUEUE_IT_HOST.test(h)) signals.push('queue-it host: ' + h);
    }
    for (var c = 0; c < cookieNames.length; c++) {
      if (/queueit/i.test(cookieNames[c]) || /^queue-it/i.test(cookieNames[c])) {
        signals.push('queue-it cookie: ' + cookieNames[c]);
      }
    }
    if (html.indexOf('queue-it.net') !== -1 || html.indexOf('queue-it.com') !== -1) {
      signals.push('markup references queue-it');
    }
    var strongText = includesAny(html, QUEUE_STRONG_TEXT).concat(includesAny(title, QUEUE_STRONG_TEXT));
    uniq(strongText).forEach(function (t) {
      signals.push('text: "' + t + '"');
    });

    if (signals.length) {
      return {
        state: 'queue',
        detail: 'Queue detected (' + signals.length + ' signal' + (signals.length === 1 ? '' : 's') + ').',
        signals: signals,
      };
    }

    // ── BLOCKED ────────────────────────────────────────────────────────────────
    var blockText = includesAny(html, BLOCK_TEXT).concat(includesAny(title, BLOCK_TEXT));
    if (status === 403 || status === 429 || blockText.length) {
      var bsig = [];
      if (status) bsig.push('http ' + status);
      uniq(blockText).forEach(function (t) {
        bsig.push('text: "' + t + '"');
      });
      return {
        state: 'blocked',
        detail: 'Blocked by bot protection (could not observe the real page).',
        signals: bsig.length ? bsig : ['blocked'],
      };
    }

    // ── ERROR / OPEN ──────────────────────────────────────────────────────────
    var weak = includesAny(html, QUEUE_WEAK_TEXT);
    if (status >= 500) {
      return { state: 'error', detail: 'Server returned HTTP ' + status + '.', signals: ['http ' + status] };
    }
    if (status >= 200 && status < 400) {
      var detail = weak.length
        ? 'Store reachable (HTTP ' + status + '); minor "' + weak[0] + '" wording but no queue.'
        : 'Store reachable (HTTP ' + status + '), no queue.';
      return { state: 'open', detail: detail, signals: ['http ' + status] };
    }
    return {
      state: 'error',
      detail: status ? 'Unexpected HTTP ' + status + '.' : 'No response.',
      signals: status ? ['http ' + status] : ['no response'],
    };
  }

  // Convenience: classify the document the content script is running in.
  function classifyDocument(doc, loc, cookieString) {
    var cookieNames = (cookieString || '')
      .split(';')
      .map(function (p) {
        return p.split('=')[0].trim();
      })
      .filter(Boolean);
    var text = '';
    try {
      text = (doc.body && doc.body.innerText) || doc.documentElement.innerText || '';
    } catch (e) {
      text = '';
    }
    var scriptSrc = '';
    try {
      var scripts = doc.querySelectorAll('script[src]');
      for (var i = 0; i < scripts.length; i++) scriptSrc += scripts[i].src + ' ';
    } catch (e) {
      /* ignore */
    }
    return classify({
      finalUrl: loc.href,
      status: 200, // we successfully rendered a real page
      html: text + ' ' + scriptSrc,
      title: doc.title || '',
      cookieNames: cookieNames,
    });
  }

  var api = { classify: classify, classifyDocument: classifyDocument };
  root.HDDetect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

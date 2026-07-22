'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { analyze } = require('../src/monitor/detectors');

test('normal store homepage → open', () => {
  const r = analyze({
    finalUrl: 'https://www.pokemoncenter.com/',
    status: 200,
    urls: ['https://www.pokemoncenter.com/'],
    headers: { 'content-type': 'text/html' },
    html: '<html><head><title>Pokémon Center Official Site</title></head><body><nav>Shop New Arrivals</nav></body></html>',
    title: 'Pokémon Center Official Site',
    cookieNames: ['session'],
  });
  assert.equal(r.state, 'open');
});

test('redirect to a queue-it host → queue', () => {
  const r = analyze({
    finalUrl: 'https://pokemoncenter.queue-it.net/?c=pokemoncenter&e=drop',
    status: 200,
    urls: ['https://www.pokemoncenter.com/', 'https://pokemoncenter.queue-it.net/?c=pokemoncenter&e=drop'],
    headers: {},
    html: '<html><body>You are now in line.</body></html>',
    title: 'Waiting Room',
    cookieNames: [],
  });
  assert.equal(r.state, 'queue');
  assert.ok(r.signals.some((s) => s.includes('queue-it host')));
});

test('waiting-room copy on page → queue', () => {
  const r = analyze({
    finalUrl: 'https://www.pokemoncenter.com/',
    status: 200,
    urls: [],
    headers: {},
    html: '<h1>You are now in line</h1><p>Your estimated wait time is 5 minutes.</p>',
    title: '',
    cookieNames: [],
  });
  assert.equal(r.state, 'queue');
});

test('Queue-it cookie present → queue', () => {
  const r = analyze({
    finalUrl: 'https://www.pokemoncenter.com/',
    status: 200,
    urls: [],
    headers: {},
    html: '<html><body>loading</body></html>',
    title: '',
    cookieNames: ['QueueITAccepted-SDFrts345E-V3_pokemoncenter'],
  });
  assert.equal(r.state, 'queue');
});

test('queue-it script reference → queue', () => {
  const r = analyze({
    finalUrl: 'https://www.pokemoncenter.com/',
    status: 200,
    urls: [],
    headers: {},
    html: '<script src="https://static.queue-it.net/script/queueclient.min.js"></script>',
    title: 'Pokemon Center',
    cookieNames: [],
  });
  assert.equal(r.state, 'queue');
});

test('Akamai 403 access denied → blocked', () => {
  const r = analyze({
    finalUrl: 'https://www.pokemoncenter.com/',
    status: 403,
    urls: [],
    headers: { server: 'AkamaiGHost' },
    html: '<html><body>Access Denied. Reference #18.abcd</body></html>',
    title: 'Access Denied',
    cookieNames: [],
  });
  assert.equal(r.state, 'blocked');
});

test('Cloudflare challenge → blocked', () => {
  const r = analyze({
    finalUrl: 'https://www.pokemoncenter.com/',
    status: 403,
    urls: [],
    headers: { 'cf-mitigated': 'challenge' },
    html: '<title>Just a moment...</title>',
    title: 'Just a moment...',
    cookieNames: [],
  });
  assert.equal(r.state, 'blocked');
});

test('HTTP 429 rate limit → blocked', () => {
  const r = analyze({ finalUrl: 'https://x.com/', status: 429, urls: [], headers: {}, html: '', title: '' });
  assert.equal(r.state, 'blocked');
});

test('server 500 → error', () => {
  const r = analyze({ finalUrl: 'https://x.com/', status: 503, urls: [], headers: {}, html: 'oops', title: '' });
  assert.equal(r.state, 'error');
});

test('network error → error', () => {
  const r = analyze({ finalUrl: 'https://x.com/', error: 'getaddrinfo ENOTFOUND' });
  assert.equal(r.state, 'error');
});

test('queue signal wins even if block text also present', () => {
  const r = analyze({
    finalUrl: 'https://pokemoncenter.queue-it.net/',
    status: 200,
    urls: ['https://pokemoncenter.queue-it.net/'],
    headers: {},
    html: 'access denied maybe, but you are now in line',
    title: '',
  });
  assert.equal(r.state, 'queue');
});

test('weak "high demand" wording alone does not trigger a queue', () => {
  const r = analyze({
    finalUrl: 'https://www.pokemoncenter.com/',
    status: 200,
    urls: [],
    headers: {},
    html: '<p>These items are in high demand — shop now!</p>',
    title: 'Pokemon Center',
    cookieNames: [],
  });
  assert.equal(r.state, 'open');
});

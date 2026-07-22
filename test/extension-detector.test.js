'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const HDDetect = require('../extension/detector');

test('extension detector: normal page → open', () => {
  const r = HDDetect.classify({ finalUrl: 'https://www.pokemoncenter.com/', status: 200, html: '<nav>Shop</nav>', title: 'Pokémon Center' });
  assert.equal(r.state, 'open');
});

test('extension detector: queue-it final url → queue', () => {
  const r = HDDetect.classify({
    finalUrl: 'https://pokemoncenter.queue-it.net/?c=pokemoncenter',
    status: 200,
    urls: ['https://pokemoncenter.queue-it.net/'],
    html: 'you are now in line',
  });
  assert.equal(r.state, 'queue');
});

test('extension detector: waiting-room text → queue', () => {
  const r = HDDetect.classify({ finalUrl: 'https://www.pokemoncenter.com/', status: 200, html: '<h1>You are now in line</h1>' });
  assert.equal(r.state, 'queue');
});

test('extension detector: queue-it cookie → queue', () => {
  const r = HDDetect.classify({ finalUrl: 'https://www.pokemoncenter.com/', status: 200, html: 'loading', cookieNames: ['QueueITAccepted-SDFrts345E-V3_pc'] });
  assert.equal(r.state, 'queue');
});

test('extension detector: 403 → blocked', () => {
  const r = HDDetect.classify({ finalUrl: 'https://www.pokemoncenter.com/', status: 403, html: 'Access Denied' });
  assert.equal(r.state, 'blocked');
});

test('extension detector: weak "high demand" alone → open', () => {
  const r = HDDetect.classify({ finalUrl: 'https://www.pokemoncenter.com/', status: 200, html: 'items in high demand', title: 'PC' });
  assert.equal(r.state, 'open');
});

test('extension detector: classifyDocument reads a fake DOM', () => {
  const fakeDoc = {
    title: 'Waiting Room',
    body: { innerText: 'You are now in line' },
    documentElement: { innerText: '' },
    querySelectorAll: () => [],
  };
  const r = HDDetect.classifyDocument(fakeDoc, { href: 'https://pokemoncenter.queue-it.net/' }, 'QueueITAccepted-x=1');
  assert.equal(r.state, 'queue');
});

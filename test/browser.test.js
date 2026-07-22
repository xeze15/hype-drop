'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseProxy } = require('../src/monitor/browser');

test('parseProxy: http with credentials', () => {
  assert.deepEqual(parseProxy('http://user:pass@host:7000'), {
    server: 'http://host:7000',
    username: 'user',
    password: 'pass',
  });
});

test('parseProxy: url-encoded credentials are decoded', () => {
  assert.deepEqual(parseProxy('http://user:p%40ss@host:7000'), {
    server: 'http://host:7000',
    username: 'user',
    password: 'p@ss',
  });
});

test('parseProxy: socks5 without credentials', () => {
  assert.deepEqual(parseProxy('socks5://127.0.0.1:1080'), { server: 'socks5://127.0.0.1:1080' });
});

test('parseProxy: empty → null', () => {
  assert.equal(parseProxy(''), null);
  assert.equal(parseProxy(null), null);
});

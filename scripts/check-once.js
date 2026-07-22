#!/usr/bin/env node
'use strict';

// One-off queue check from the command line — handy for testing detection or
// running under an external cron. Exit code: 0 open, 2 queue, 3 blocked, 4 error.
//   npm run check -- https://www.pokemoncenter.com/
//   npm run check -- --strategy http https://www.pokemoncenter.com/

const { check } = require('../src/monitor/detectors');
const { closeBrowser } = require('../src/monitor/browser');

async function main() {
  const argv = process.argv.slice(2);
  let strategy = 'browser';
  const urls = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--strategy') strategy = argv[++i];
    else urls.push(argv[i]);
  }
  if (!urls.length) {
    console.error('Usage: npm run check -- [--strategy browser|http|auto] <url> [url2 ...]');
    process.exit(64);
  }

  const codes = { open: 0, queue: 2, blocked: 3, error: 4 };
  let worst = 0;
  for (const url of urls) {
    const t0 = Date.now();
    const r = await check(url, { strategy, timeoutMs: 30000 });
    const ms = Date.now() - t0;
    console.log(`\n${url}`);
    console.log(`  state:   ${r.state.toUpperCase()}  (${ms}ms, strategy=${strategy})`);
    console.log(`  detail:  ${r.detail}`);
    if (r.signals && r.signals.length) console.log(`  signals: ${r.signals.join(' | ')}`);
    worst = Math.max(worst, codes[r.state] ?? 4);
  }

  await closeBrowser();
  process.exit(worst);
}

main().catch(async (err) => { console.error(err); await closeBrowser(); process.exit(4); });

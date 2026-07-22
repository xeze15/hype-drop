'use strict';

// Lazily-launched, shared Chromium instance (via Playwright).
// The host image ships a browser under PLAYWRIGHT_BROWSERS_PATH, so Playwright
// resolves it automatically; CHROME_EXECUTABLE_PATH can override if needed.

const fs = require('fs');
const path = require('path');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  // Playwright not installed — browser strategy will report a clear error.
}

let browserPromise = null;

// Resolve a Chromium binary. Priority:
//   1) CHROME_EXECUTABLE_PATH (explicit override)
//   2) a chromium-<build>/chrome-linux/chrome under PLAYWRIGHT_BROWSERS_PATH
//      (host images pre-install a browser here; this sidesteps npm/browser
//       version drift where Playwright wants a build the image doesn't ship)
//   3) null → let Playwright resolve its own managed browser (normal case after
//      `npx playwright install chromium`)
function resolveExecutablePath() {
  if (process.env.CHROME_EXECUTABLE_PATH) return process.env.CHROME_EXECUTABLE_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root) return null;
  try {
    const builds = fs
      .readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
    for (const dir of builds.reverse()) {
      for (const rel of [['chrome-linux', 'chrome'], ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']]) {
        const p = path.join(root, dir, ...rel);
        if (fs.existsSync(p)) return p;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
];

async function getBrowser() {
  if (!chromium) {
    throw new Error(
      'Playwright is not available. Run `npm install`, or set CHECK_STRATEGY=http.'
    );
  }
  if (!browserPromise) {
    const opts = { headless: true, args: LAUNCH_ARGS };
    const exe = resolveExecutablePath();
    if (exe) opts.executablePath = exe;
    browserPromise = chromium.launch(opts).catch((err) => {
      browserPromise = null; // allow retry on next call
      throw err;
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      await b.close();
    } catch {
      /* ignore */
    }
    browserPromise = null;
  }
}

function isAvailable() {
  return Boolean(chromium);
}

module.exports = { getBrowser, closeBrowser, isAvailable };

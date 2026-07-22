#!/usr/bin/env node
'use strict';

// Interactive CLI to create (or promote) an admin user.
//   npm run create-admin
//   npm run create-admin -- --username alice --email alice@gmail.com --password 'secret123'

const readline = require('readline');
const { Users } = require('../src/models');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

function ask(rl, q, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(q, resolve);
    const stdout = process.stdout;
    const onData = (char) => {
      char = char.toString();
      if (['\n', '\r', ''].includes(char)) return;
      stdout.write('\x1b[2K\x1b[200D' + q + '*'.repeat(rl.line.length));
    };
    process.stdin.on('data', onData);
    rl.question(q, (val) => { process.stdin.removeListener('data', onData); stdout.write('\n'); resolve(val); });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const username = (args.username || (await ask(rl, 'Username: '))).trim();
  if (username.length < 3) { console.error('Username must be at least 3 characters.'); process.exit(1); }

  const email = (args.email || (await ask(rl, 'Notification email (optional): '))).trim();

  let password = args.password;
  if (!password) {
    password = await ask(rl, 'Password (min 8): ', { hidden: true });
    const confirm = await ask(rl, 'Confirm password: ', { hidden: true });
    if (password !== confirm) { console.error('Passwords do not match.'); process.exit(1); }
  }
  if (!password || password.length < 8) { console.error('Password must be at least 8 characters.'); process.exit(1); }

  rl.close();

  const existing = Users.findByUsername(username);
  if (existing) {
    Users.setPassword(existing.id, password);
    Users.update(existing.id, { role: 'admin', email: email || existing.email });
    console.log(`Updated existing user "${username}" → admin, password reset.`);
  } else {
    Users.create({ username, password, email, role: 'admin', notifyEnabled: true });
    console.log(`Created admin user "${username}".`);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });

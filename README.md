# Hype Drop 🔴 — Pokémon Center queue monitor

A small, self-hostable web app that watches the [Pokémon Center](https://www.pokemoncenter.com/)
store (or any [Queue-it](https://queue-it.com/)-protected site) and tells you the
moment a **virtual waiting-room queue** goes live — on a login-protected
dashboard **and** by **email** to the people you choose.

Built to run on a cheap VPS. Login + password protected. Email alerts go only to
registered users who have a notification address and have alerts enabled.

![states: open / queue / blocked / error](public/favicon.svg)

---

## What it does

- **Checks on a schedule** (configurable interval + jitter) whether your target
  URLs are showing a queue.
- **Classifies every check** into one of four states:
  | State | Meaning |
  |-------|---------|
  | 🟢 `open`    | Store reachable, no queue. |
  | 🔴 `queue`   | A Queue-it waiting room / virtual line is active. **This is what triggers alerts.** |
  | 🟠 `blocked` | The site blocked the check (bot protection). Not a queue — the check couldn't see the real page. |
  | ⚪ `error`   | Network/timeout/other error. |
- **Alerts on the transition into `queue`**:
  - an on-site banner + real-time alert feed (via Server-Sent Events), and
  - an **email** to every user who has a notification address and alerts enabled.
- **Login-protected** with per-user accounts, an admin panel, and self-service
  profile settings.
- Persists everything in a single **SQLite** file — no external database.

### How queue detection works (and its limits)

Pokémon Center uses **Queue-it**, a third-party virtual waiting room. When a drop
is busy, visiting a protected page redirects you into a waiting room on a
`*.queue-it.net` host that shows *"You are now in line"* and an estimated wait.

Hype Drop detects a queue from **any** of these signals:

- a redirect to / landing on a `*.queue-it.net` host,
- Queue-it cookies (e.g. `QueueITAccepted-…`) or `x-queueit-*` response headers,
- Queue-it scripts referenced in the page,
- waiting-room copy (*"you are now in line"*, *"estimated wait time"*, *"waiting room"*, …).

> **Important reality check.** Pokémon Center sits behind **Akamai bot
> protection**. A plain HTTP request is answered with `403 Forbidden`, so the
> default detection strategy is a **real headless Chromium browser** (via
> Playwright). Even then, aggressive polling from a datacenter IP can get
> throttled or blocked — which Hype Drop reports honestly as `blocked` rather
> than pretending the store is `open`. For best results:
> - keep the interval reasonable (default 60s, with jitter),
> - monitor a specific product/drop URL rather than only the homepage,
> - if you get persistent `blocked`, run from a residential-ish IP or add a proxy
>   (`CHROME_EXECUTABLE_PATH`/proxy options), and lengthen the interval.
>
> The queue is often only applied to certain pages during a drop, so add the
> exact product URLs you care about in the admin panel.

---

## Quick start (local)

```bash
git clone <your-fork-url> hype-drop && cd hype-drop
npm install
npx playwright install chromium      # download the matching browser (bare-metal only)
cp .env.example .env                 # then edit SESSION_SECRET (required)
npm start
```

Open <http://localhost:3000> — the first visit takes you to **/setup** to create
your admin account. Add a target (e.g. `https://www.pokemoncenter.com/`) in the
**Admin** page and you're monitoring.

Generate a strong session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Deploy on a VPS

### Option A — Docker (recommended)

The image is based on the official Playwright image, so Chromium and all its
system libraries are already included (nothing to `apt install`).

```bash
cp .env.example .env      # edit SESSION_SECRET, SMTP_*, PUBLIC_BASE_URL, TRUST_PROXY=1, COOKIE_SECURE=1
docker compose up -d --build
docker compose logs -f
```

Then put a TLS reverse proxy in front (see `deploy/nginx.conf.example` +
`certbot`). The container listens on `127.0.0.1:3000` by default.

> If you bump the `playwright` version in `package.json`, bump the
> `mcr.microsoft.com/playwright:vX.Y.Z-jammy` tag in the `Dockerfile` to match.

### Option B — bare metal (systemd + nginx)

```bash
# as root
sudo useradd -r -m -d /opt/hype-drop -s /usr/sbin/nologin hypedrop
sudo -u hypedrop git clone <your-fork-url> /opt/hype-drop
cd /opt/hype-drop
sudo -u hypedrop npm ci --omit=dev
# Chromium + OS deps for the checker:
sudo npx playwright install --with-deps chromium
sudo -u hypedrop cp .env.example .env
sudo -u hypedrop nano .env          # set SESSION_SECRET, SMTP_*, TRUST_PROXY=1, COOKIE_SECURE=1, PUBLIC_BASE_URL

# service
sudo cp deploy/hype-drop.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hype-drop
journalctl -u hype-drop -f

# TLS reverse proxy
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/hype-drop
sudo ln -s /etc/nginx/sites-available/hype-drop /etc/nginx/sites-enabled/
# edit the server_name, then:
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d queue.example.com
```

Create the first admin without a browser if you prefer:

```bash
sudo -u hypedrop npm run create-admin
```

---

## Email alerts (SMTP)

Email is optional but needed for the "alert me" part. Any SMTP provider works.

**Gmail** (use an **App Password**, not your normal password — requires 2FA on
the Google account: <https://myaccount.google.com/apppasswords>):

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=youraddress@gmail.com
SMTP_PASS=your-16-char-app-password
MAIL_FROM="Hype Drop <youraddress@gmail.com>"
```

Other providers (SendGrid, Mailgun, Amazon SES, Postmark, …) all expose SMTP
credentials that drop straight into the same variables.

In **Admin → Email alerts** you can **send a test email** and **verify SMTP**.
Alerts are sent to every user who has a notification address **and** "Receives
alerts" enabled — set these per user in **Admin → Users**, or per person in
**Profile**.

---

## Configuration reference

All settings live in `.env` (see `.env.example` for the annotated list). The
monitoring settings are **also editable live** in the admin panel (stored in the
database; the `.env` values are just the initial defaults).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Listen address (keep on localhost behind a proxy). |
| `SESSION_SECRET` | — | **Required.** Long random string signing session cookies. |
| `TRUST_PROXY` / `COOKIE_SECURE` | `0` / auto | Set both to `1` behind a TLS proxy. |
| `PUBLIC_BASE_URL` | — | Public URL, used in alert emails. |
| `DATABASE_PATH` | `./data/hype-drop.db` | SQLite file location. |
| `CHECK_INTERVAL_SECONDS` | `60` | Seconds between checks per target. |
| `CHECK_JITTER_SECONDS` | `15` | Random ± jitter added to the interval. |
| `ALERT_COOLDOWN_SECONDS` | `900` | Min seconds between repeat alerts for one target. |
| `CHECK_STRATEGY` | `browser` | `browser`, `http`, or `auto`. |
| `CHECK_TIMEOUT_MS` | `30000` | Per-check timeout. |
| `CHECK_USER_AGENT` | (modern default) | Override the checker's User-Agent. |
| `SEED_TARGETS` | `https://www.pokemoncenter.com/` | URLs to seed on first run. |
| `SMTP_*` / `MAIL_FROM` | — | Email delivery (see above). |
| `BOOTSTRAP_ADMIN_*` | — | Auto-create an admin on first run (optional). |
| `CHROME_EXECUTABLE_PATH` | auto | Force a specific Chromium binary. |

---

## Command-line tools

```bash
npm run create-admin                 # create/promote an admin (interactive)
npm run check -- https://www.pokemoncenter.com/            # one-off check (browser)
npm run check -- --strategy http https://www.pokemoncenter.com/
npm test                             # run the test suite
```

`npm run check` exit codes: `0` open · `2` queue · `3` blocked · `4` error — handy
if you'd rather drive checks from an external cron.

---

## Security notes

- Passwords hashed with **bcrypt**; server-side sessions in SQLite.
- **CSRF protection** on all state-changing requests; **rate-limited** login.
- Strict **Content-Security-Policy**, `helmet` headers, no inline scripts.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` behind TLS.
- Keep the app behind HTTPS (`TRUST_PROXY=1`, `COOKIE_SECURE=1`) in production.
- The SQLite DB and `.env` are git-ignored — never commit real secrets.

## Responsible use

This tool is for personally monitoring public store availability. Respect
Pokémon Center's Terms of Service, don't hammer their servers (keep a sane
interval), and note that it only *notifies* you — it does not add to cart,
checkout, or bypass the queue. Bots that do are what queues exist to stop.

## Project layout

```
src/
  server.js            Express app wiring, security, startup, shutdown
  config.js            Environment configuration
  db.js  models.js     SQLite schema + data access
  auth.js              Sessions, CSRF, role gates
  session-store.js     SQLite-backed session store
  monitor/
    detectors.js       Detection strategies + queue/blocked classifier
    browser.js         Shared headless Chromium (Playwright)
    scheduler.js       Periodic loop, state changes, alert dispatch
  notify/email.js      Nodemailer transport + alert templates
  routes/              auth · api · pages
  views/               EJS templates (login, setup, dashboard, admin, profile)
public/                CSS + client JS (dashboard live view, admin, profile)
scripts/               create-admin, check-once CLIs
deploy/                systemd unit + nginx example
test/                  detector unit tests + hermetic end-to-end test
```

## License

MIT — see `LICENSE`.

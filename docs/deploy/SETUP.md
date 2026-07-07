# TripSplit — manual deploy setup (owner-only steps)

This is a one-time checklist for things that **cannot be scripted** by an
agent: they require a real Telegram account, real DNS control, and real
SSH access to the VPS. Everything else (repo scaffold, deploy.sh, nginx
vhost template, pm2 config) is already in this repo — this doc is the
"do this by hand once" complement to it.

Nothing in this checklist has been run. Work through it top to bottom;
each section notes what to verify before moving to the next.

---

## 1. BotFather — create the bot + Mini App

All in a chat with [@BotFather](https://t.me/BotFather) in Telegram.

- [ ] `/newbot` → choose a display name and a unique `@username` ending in
      `bot`. **Save the bot token it gives you** — this is `BOT_TOKEN` in
      `.env` (server-side only, never in git, never in the client).
- [ ] `/newapp` → select the bot you just created, then provide:
  - Title (e.g. "TripSplit")
  - Short description
  - A **640×360 px** placeholder photo (branding/logo comes in Phase 7;
    any placeholder image at the right dimensions works for now)
  - **short_name** (e.g. `split`) — this becomes part of the deep link:
    `https://t.me/<bot_username>/<short_name>?startapp=<code>`
    Record it as `MINI_APP_SHORT_NAME` in `.env`.
- [ ] In BotFather, open **Bot Settings → Menu Button** (or `/setmenubutton`
      via the API/BotFather flow) and set the menu button URL to the
      production Mini App URL once step 4 (HTTPS) is live, e.g.
      `https://split.<yourdomain>/`.
- [ ] In BotFather, open **Bot Settings → Configure Mini App / Main Mini
      App** and **enable "Main Mini App"** — this makes the bot's profile
      show a "Launch app" button and makes `t.me/<bot_username>?startapp=`
      links work (not just `t.me/<bot_username>/<short_name>`).

**Verify:** the bot exists, replies to `/start` (even with the default
"no handler" behavior for now — real `/start` handling via grammY is a
later phase), and its profile shows a Mini App entry point.

---

## 2. DNS — subdomain for the Mini App

- [ ] In your domain's DNS provider, add an **A record** (or AAAA for
      IPv6) for `split.<yourdomain>` pointing at the VPS's public IP.
- [ ] Wait for propagation, then verify:
      `dig +short split.<yourdomain>` returns the VPS IP.

---

## 3. VPS — deploy user + directory layout

SSH into the VPS as an admin/root user, then:

- [ ] Create a dedicated deploy user (do not deploy as root):
      `adduser <deploy-user>` (pick a real username; this doc uses
      `<deploy-user>` as a placeholder throughout).
- [ ] Add your SSH public key to `~<deploy-user>/.ssh/authorized_keys`
      for that user so `deploy.sh` can `rsync`/`ssh` in non-interactively.
- [ ] Create the app directory layout expected by `deploy.sh` and
      `ecosystem.config.cjs` (adjust the base path to taste, e.g.
      `/home/<deploy-user>/apps/tripsplit`):
      ```
      apps/tripsplit/
        ecosystem.config.cjs      <- rsynced by deploy.sh
        server/
          dist/                  <- rsynced by deploy.sh
          package.json           <- rsynced by deploy.sh
          .env                   <- YOU create this by hand (see below), never overwritten by deploy.sh
        web/
          dist/                  <- rsynced by deploy.sh
        data/                    <- SQLite DB lives here (Phase 1); back this up
        logs/                    <- pm2 out/error logs
      ```
      `mkdir -p apps/tripsplit/{server,web/dist,data,logs}`
- [ ] Create `apps/tripsplit/server/.env` by hand from this repo's
      `.env.example`, filled in with the **real** `BOT_TOKEN` from step 1
      and a real `PUBLIC_URL` (`https://split.<yourdomain>`). This file
      never leaves the server and is never committed anywhere.
- [ ] Install Node 22+ on the VPS (matches `engines.node` in the repo's
      root `package.json`) and pm2 globally: `npm install -g pm2`.
- [ ] `pm2 startup` once, following its printed instructions, so pm2
      survives a VPS reboot.

**Verify:** you can `ssh <deploy-user>@split.<yourdomain>` (or by IP)
without a password prompt (key-based), and the directory tree above
exists with correct ownership.

---

## 4. nginx vhost + HTTPS

- [ ] Install nginx and certbot if not already present (`apt install
      nginx certbot python3-certbot-nginx` on Debian/Ubuntu, or the
      equivalent for your distro).
- [ ] Copy `docs/deploy/nginx.split.conf.sample` from this repo to the
      VPS, fill in the placeholders (`<DOMAIN>`, `<APP_ROOT>`,
      `<API_PORT>` — `<API_PORT>` must match `PORT` in `server/.env`),
      and install it:
      ```
      sudo cp nginx.split.conf.sample /etc/nginx/sites-available/split.conf
      # edit the copy in place
      sudo ln -s /etc/nginx/sites-available/split.conf /etc/nginx/sites-enabled/
      sudo nginx -t
      sudo systemctl reload nginx
      ```
- [ ] Obtain HTTPS: `sudo certbot --nginx -d split.<yourdomain>`. This
      rewrites the vhost to add the 443/ssl server block and an
      HTTP→HTTPS redirect, and sets up auto-renewal.
- [ ] Confirm auto-renewal is registered: `sudo certbot renew --dry-run`.

**Verify:** `curl -I https://split.<yourdomain>/` returns `200` (once
`web/dist` has at least a placeholder `index.html` — see step 5) and the
certificate is valid (no browser warning).

---

## 5. First deploy

- [ ] From your machine, in this repo: `cp .env.deploy.example
      .env.deploy` and fill in `DEPLOY_HOST` / `DEPLOY_PATH` (and
      `DEPLOY_USER` if `DEPLOY_HOST` isn't already a `user@host` or an
      `~/.ssh/config` alias).
- [ ] Run `./deploy.sh`. It builds `web` + `server` and rsyncs both to
      the VPS, then reloads pm2.
- [ ] `ssh` in and check `pm2 status` shows `tripsplit-server` as
      `online`, and `pm2 logs tripsplit-server` shows the health log
      line from `server/src/index.ts`.

**Verify:**
- `curl https://split.<yourdomain>/api/health` → `{"ok":true,"db":"up","lastRateFetch":...,"uptimeSeconds":...}`
  (Phase 8.2 — see §6 below for the full shape and what each field means)
- `https://split.<yourdomain>/` in a normal browser shows the Phase 0
  placeholder page.
- Opening the bot in Telegram (profile → "Launch app", or the menu
  button from step 1) shows the same placeholder page inside the
  Telegram WebView, over HTTPS.

This last check is the Phase 0 acceptance criterion from
`IMPLEMENTATION_PLAN.md`: *"opening the bot's Mini App on a real phone
shows the deployed placeholder page over HTTPS."*

---

## 6. Backups, monitoring & process resilience (Phase 8)

Everything in this section is a **one-time owner setup step** on the real
VPS — the scripts themselves (`scripts/backup.sh`, `scripts/uptime-ping.sh`)
are already in this repo and have been tested locally (dated-file creation,
integrity check, 14-day rotation, the offsite-copy hook, and the
guarded/no-op behavior when unconfigured — see the Phase 8 report). Nothing
below has been run against the real server.

### 6.1 Nightly backup cron

- [ ] Confirm `sqlite3` is installed on the VPS (`sqlite3 --version`) — it's
      the CLI the backup script shells out to for the safe, WAL-aware
      `.backup` command (never a raw file copy).
- [ ] Add a nightly cron entry (`crontab -e` as the deploy user), adjusting
      the paths to your real `DEPLOY_PATH`:
      ```
      0 3 * * * DB_PATH=/home/<deploy-user>/apps/tripsplit/data/tripsplit.db \
        BACKUP_DIR=/home/<deploy-user>/apps/tripsplit/backups \
        /home/<deploy-user>/apps/tripsplit/scripts/backup.sh \
        >> /home/<deploy-user>/apps/tripsplit/logs/backup.log 2>&1
      ```
- [ ] Optional offsite copy: add `BACKUP_OFFSITE_TARGET=<rsync destination>`
      (e.g. another host's `user@host:/path`, or a mounted network share) to
      the same cron line's env vars. Leave it unset to keep backups local
      only — the script no-ops that step cleanly either way.
- [ ] Optional retention override: `BACKUP_RETENTION_DAYS=<n>` (default 14).

**Verify:** run the cron line's command by hand once, confirm a new dated
file appears under `BACKUP_DIR` and `sqlite3 <file> 'PRAGMA integrity_check;'`
returns `ok`.

### 6.2 Restore-from-backup drill (do this once, before relying on it)

- [ ] Stop the app: `pm2 stop tripsplit-server`.
- [ ] Move the live DB aside (don't delete it yet): `mv data/tripsplit.db
      data/tripsplit.db.pre-restore` (and the `-wal`/`-shm` sidecar files,
      if present).
- [ ] Copy the backup file you want to restore into place:
      `cp backups/tripsplit-<timestamp>.db data/tripsplit.db`.
- [ ] Sanity-check it before trusting it: `sqlite3 data/tripsplit.db
      'PRAGMA integrity_check;'` → `ok`, and spot-check a table, e.g.
      `sqlite3 data/tripsplit.db 'SELECT COUNT(*) FROM trips;'`.
- [ ] Restart: `pm2 start tripsplit-server` (or `pm2 restart`).
- [ ] Verify `GET /api/health` → `db:"up"`, and that a real client (your
      phone's Mini App) shows the restored trip data.
- [ ] Once confirmed good, remove the `.pre-restore` copy (or keep it around
      a while longer if you want an extra margin of safety).

### 6.3 Uptime monitor cron

- [ ] Add a cron entry that runs every few minutes (5 is a reasonable
      balance of "hear about it fast" vs. cron/log noise):
      ```
      */5 * * * * HEALTH_URL=https://split.<yourdomain>/api/health \
        BOT_TOKEN=<real-bot-token> OWNER_CHAT_ID=<your-telegram-user-id> \
        /home/<deploy-user>/apps/tripsplit/scripts/uptime-ping.sh \
        >> /home/<deploy-user>/apps/tripsplit/logs/uptime-ping.log 2>&1
      ```
- [ ] Get your own Telegram user id for `OWNER_CHAT_ID` from any "what's my
      id" bot (e.g. @userinfobot) — message it once and it replies with your
      numeric id.
- [ ] **Verify the alert path actually works**, not just the happy path:
      temporarily point `HEALTH_URL` at a wrong port (or `pm2 stop
      tripsplit-server` briefly) and run the script by hand once — confirm
      you receive a Telegram message before restoring the real service.

### 6.4 pm2 process resilience

`ecosystem.config.cjs` already has `autorestart: true`, `max_restarts: 10`,
and `restart_delay: 2000` — pm2 restarts the process automatically on a
crash. Two things still need doing by hand, once, on the VPS:

- [ ] `pm2 startup` (prints a command to run once as root — makes pm2 itself
      survive a VPS reboot) and `pm2 save` (persists the current process
      list so `pm2 resurrect`/the startup script brings `tripsplit-server`
      back after a reboot, not just after a crash).
- [ ] Install log rotation so `logs/server.out.log`/`server.error.log` don't
      grow unbounded: `pm2 install pm2-logrotate`. Defaults are reasonable;
      tune with `pm2 set pm2-logrotate:max_size 10M` /
      `pm2 set pm2-logrotate:retain 14` if you want to match the backup
      retention window.

**Verify (the `kill -9` drill):** find the process id (`pm2 status` or `pm2
pid tripsplit-server`), `kill -9 <pid>`, then `pm2 status` again within a few
seconds — it should show `tripsplit-server` back to `online` with a bumped
restart count, with no manual intervention.

---

## Reference: which `.env` values come from where

| Variable | Source |
|---|---|
| `BOT_TOKEN` | BotFather `/newbot` (step 1) |
| `BOT_USERNAME` | the `@username` you chose in `/newbot` (step 1) |
| `MINI_APP_SHORT_NAME` | the `short_name` you chose in `/newapp` (step 1) |
| `PUBLIC_URL` | `https://split.<yourdomain>` (steps 2 + 4) |
| `PORT` | your choice (default `8080`); must match nginx's `<API_PORT>` |
| `DB_PATH` | default `./data/tripsplit.db`, relative to `server/` on the VPS |
| `OWNER_CHAT_ID` | your own Telegram user id (§6.3) — only read by `scripts/uptime-ping.sh`, not the API server |

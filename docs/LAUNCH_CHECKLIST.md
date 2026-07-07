# TripSplit — MVP launch checklist

Phase 9.1 (IMPLEMENTATION_PLAN.md, "MVP Launch & Field Test"). This is the
**one runbook that ties together every manual step deferred across Phases
0–8**, in the order to actually do them, ending in the on-device acceptance
run that proves the MVP is ready for a real trip.

Everything with a `[ ]` below is a real action to take — check it off as you
go. Nothing in this file has been run by the agent that wrote it; it only
had file/shell access, never a Telegram account, DNS control, or SSH access
to a real VPS. See each linked doc for the detail behind a given step.

Once every box here is checked, move on to **[FIELD_TEST.md](./FIELD_TEST.md)**
for the first real trip day, and keep **[FAST_FOLLOW.md](./FAST_FOLLOW.md)**
open next to it to capture friction as it happens.

---

## 0. Before you start — what's already done vs what's yours

- **Done (code-complete, build/lint/test-verified, see each phase's own
  report):** repo, deploy pipeline, backend (DB/auth/expenses/currency
  engine/balances/settlements), frontend shell, i18n, branding assets,
  hardening (backups/health/rate-limit), and this phase's seed/reset
  scripts + docs.
- **Yours (cannot be scripted by an agent):** a real Telegram account to
  talk to @BotFather, real DNS control, real SSH access to a VPS, and two
  real phones. Every section below that needs one of those is marked
  **[owner-manual]**.

---

## 1. BotFather — bot + Mini App **[owner-manual]**

Full detail: **[docs/deploy/SETUP.md §1](./deploy/SETUP.md#1-botfather--create-the-bot--mini-app)**.

- [ ] `/newbot` → save the bot token as `BOT_TOKEN` (server-side only, never
      committed).
- [ ] `/newapp` → title, short description, **640×360 photo**
      (`branding/miniapp-photo-640x360.png` — see
      **[branding/README.md](../branding/README.md)** for what's already
      generated), and a `short_name` → `MINI_APP_SHORT_NAME`.
- [ ] `/setuserpic` → bot avatar (`branding/bot-avatar-512.png`).
- [ ] `/setdescription` and `/setabouttext` → paste the EN copy from
      **[branding/bot-texts.md](../branding/bot-texts.md)** (that file also
      has the RU/UK variants ready for whenever a localized bot description
      becomes relevant — see its own "Notes" section for why EN is the
      pragmatic default for the BotFather fields themselves).
- [ ] Bot Settings → **Menu Button** → set the URL to the production Mini
      App URL (do this once HTTPS is live — step 4 below).
- [ ] Bot Settings → **Configure Mini App / Main Mini App** → enable it (so
      the bot's profile shows a "Launch app" button and bare
      `t.me/<bot>?startapp=` links work).

**Verify:** the bot exists, its profile shows a Mini App entry point.

---

## 2. DNS **[owner-manual]**

Full detail: **[docs/deploy/SETUP.md §2](./deploy/SETUP.md#2-dns--subdomain-for-the-mini-app)**.

- [ ] A/AAAA record for `split.<yourdomain>` → the VPS's IP.
- [ ] `dig +short split.<yourdomain>` returns that IP.

---

## 3. VPS — deploy user, directories, nginx, HTTPS **[owner-manual]**

Full detail: **[docs/deploy/SETUP.md §3–4](./deploy/SETUP.md#3-vps--deploy-user--directory-layout)**.

- [ ] Deploy user + SSH key, directory layout, Node 22+, pm2 installed.
- [ ] `server/.env` created by hand from **[.env.example](../.env.example)**
      with the real `BOT_TOKEN`/`PUBLIC_URL`/etc.
- [ ] nginx vhost from
      **[docs/deploy/nginx.split.conf.sample](./deploy/nginx.split.conf.sample)**,
      installed and reloaded.
- [ ] `certbot --nginx -d split.<yourdomain>` → HTTPS live, auto-renewal
      confirmed (`certbot renew --dry-run`).

**Verify:** `curl -I https://split.<yourdomain>/` doesn't error (may still
404/empty until step 4 actually deploys `web/dist`).

---

## 4. First deploy

- [ ] **[owner-manual]** `cp .env.deploy.example .env.deploy`, fill in
      `DEPLOY_HOST`/`DEPLOY_PATH` (see
      **[docs/deploy/SETUP.md §5](./deploy/SETUP.md#5-first-deploy)**).
- [ ] Run `./deploy.sh` from the repo root. It builds `shared`→`server`→`web`
      and rsyncs both to the VPS, then reloads pm2.
- [ ] **[owner-manual]** `ssh` in, confirm `pm2 status` shows
      `tripsplit-server` online.

**Verify:**
- `curl https://split.<yourdomain>/api/health` →
  `{"ok":true,"db":"up",...}`.
- Opening the bot's "Launch app" on a real phone shows the app over HTTPS.

---

## 5. Env recap — where every value comes from

See **[docs/deploy/SETUP.md's reference table](./deploy/SETUP.md#reference-which-env-values-come-from-where)**
and **[.env.example](../.env.example)** for the full annotated list
(`BOT_TOKEN`, `BOT_USERNAME`, `MINI_APP_SHORT_NAME`, `PUBLIC_URL`, `PORT`,
`DB_PATH`, `OWNER_CHAT_ID`, rate-limit/backup overrides). Nothing new for
this phase — `scripts/seed.ts`/`scripts/reset.ts` below reuse `DB_PATH`
exactly like the server itself does.

- [ ] Backups (`scripts/backup.sh`) and the uptime monitor
      (`scripts/uptime-ping.sh`) are cron-installed per
      **[docs/deploy/SETUP.md §6](./deploy/SETUP.md#6-backups-monitoring--process-resilience-phase-8)**
      — do this now, before real trip data exists, not after.

---

## 6. Pre-flight: clear any leftover test data

Before the real trip starts, make sure the production DB doesn't have stray
dev/demo rows in it from your own testing.

- [ ] If you seeded demo data anywhere near this DB_PATH while testing,
      wipe it first:
      ```sh
      npm run reset --workspace=server -- --yes
      ```
      (Refuses without `--yes`; refuses on a production-looking path
      without `--force` too — see `scripts/reset.ts`'s own doc comment for
      exactly what "looks like production" means. Row-wipe by default,
      keeps the migrated schema; add `--delete-file` to remove the DB file
      itself instead.)
- [ ] Confirm it's actually empty: `GET /api/me` from a fresh phone should
      show zero trips.

(Optional, for a dry run of the flow below before doing it for real: `npm
run seed --workspace=server` populates a 3-user, 10-expense, 4-currency demo
trip — see its own doc comment. Reset it again afterwards with the command
above before the real acceptance run.)

---

## 7. On-device acceptance run

This is the actual MVP acceptance test from IMPLEMENTATION_PLAN.md Phase 9.1
— **[owner-manual]**, needs both real phones (Android + iPhone) and both of
you. Do this fresh, i.e. after step 6's reset, so it's a true "zero to
first trip" run, not a continuation of test data.

### Fresh install, both phones
- [ ] Phone A (Android): open the bot, tap "Launch app" (or the menu
      button) for the first time.
- [ ] Phone B (iPhone): same.
- [ ] Both land on the empty/create-trip state (no stale trips visible).

### Create + invite (Phone A)
- [ ] Create a trip: title + base currency.
- [ ] Open trip settings → copy/share the invite link.
- [ ] Send the invite link to Phone B (any channel — Telegram DM, chat,
      whatever's convenient).

### Join (Phone B)
- [ ] Tap the invite link → lands on the join-confirmation screen showing
      the right trip title.
- [ ] Confirm join → Phone A's member list updates (refetch/reopen if
      needed) to show both members with avatars (or initials fallback).

### 10 expenses across 4 currencies
Log at least 10 expenses split across **4 different currencies** (e.g.
THB, VND, EUR, USDT — or whatever fits your actual trip), covering all
three split modes at least once each:
- [ ] Equal split (both members).
- [ ] Solo split ("only for me").
- [ ] Custom split (uneven amounts).
- [ ] At least one expense with a category set.
- [ ] At least one expense with the auto-filled rate left as-is, and at
      least one with the rate manually overridden.
- [ ] Confirm the happy path really is ≤3 interactions: type amount, tap
      the MainButton — nothing more required for a default equal split.

### Settle
- [ ] Open the Balance screen — confirm the net line and transfer
      suggestion make sense given what was logged.
- [ ] Tap "Settle" on a suggested transfer, adjust the amount (partial
      settlement), confirm in a **different currency** than the trip base
      (Phase 6.4's cross-currency settle) — confirm the balance updates
      correctly afterwards.

### Language switch
- [ ] Settings → Language → switch to a different locale (EN/RU/UK) on one
      phone — confirm every screen updates immediately, no untranslated
      strings, no layout overflow.
- [ ] Force-quit and reopen the Mini App — confirm the language choice
      persisted (not reset to auto-detect).

### Final check
- [ ] Both phones, in **dark Telegram theme**, still show the app fully
      light (white cards, `#F4F4F7` background, white header/bottom bar) —
      see **[web/DEVICE_CHECKLIST.md](../web/DEVICE_CHECKLIST.md)** for the
      full chrome/safe-area/keyboard checklist this reuses.
- [ ] Balances are internally consistent: pull `GET /api/trips/:id/balances`
      (or just eyeball the screen) and confirm the numbers match what you
      expect from the 10 expenses + settlement you just logged.

**Once every box above is checked:** the MVP is launched. Move to
**[FIELD_TEST.md](./FIELD_TEST.md)** for the first real trip day.

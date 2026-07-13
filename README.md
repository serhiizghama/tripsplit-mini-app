# TripSplit

A Telegram Mini App for splitting travel expenses in a group. Log shared
expenses in any currency, see who owes whom, settle debts — no signup,
just Telegram identity and a deep link.

Full product spec, architecture, data model, and phased implementation
plan: **[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)**. This
README covers the repo itself; that file covers the product.

> **Status:** All 9 phases code-complete: repo scaffold and deploy
> pipeline (0); SQLite + Drizzle, Telegram `initData` auth (1);
> Telegram-native React shell (2); trips, invites, avatars (3); expenses
> with equal/solo/custom splits (4); multi-currency engine with daily
> rate fetch (5); balances and settlements (6); i18n (EN/RU/UK,
> hand-rolled `t()` + ICU-lite plurals), branding, empty/edge states,
> and mobile polish (7); backups, health checks, rate-limiting, and a
> security pass (8); demo seed/reset scripts and the launch/field-test/
> fast-follow runbooks for this final phase (9). Every automated check
> (`npm run typecheck`/`lint`/`build`/`test`) is green. What's genuinely
> **not done** — because it requires a real Telegram account, real DNS/
> VPS access, and two real phones, none of which an agent has — is the
> actual launch and field test themselves. **Start here:**
> **[docs/LAUNCH_CHECKLIST.md](./docs/LAUNCH_CHECKLIST.md)** is the
> owner's step-by-step runbook from "BotFather doesn't exist yet" to "MVP
> acceptance run passed on both phones." See its own "What's already done
> vs what's yours" section for the exact line between the two.

> **Post-MVP:** two backlog items from
> [docs/FAST_FOLLOW.md](./docs/FAST_FOLLOW.md) are implemented — **group-chat
> nudges** (add the bot to the trip's Telegram group and send
> `/link <inviteCode>` there; expenses and settlements get announced, and
> `/summary` posts totals on demand) and **export** ("Share summary" on the
> Balance screen posts the same summary to the linked chat, or DMs it to you
> if no chat is linked). Design record:
> [docs/EXPORT_NUDGES_PLAN.md](./docs/EXPORT_NUDGES_PLAN.md).
> Also implemented: **Trip Wrap** — "Finish trip" in Settings archives the
> trip (read-only afterwards, reopenable) and opens a celebratory wrap page
> (confetti, headline totals, member awards like Sponsor / Bookkeeper /
> category champions), with a farewell card posted to the linked group chat.
> Design record: [docs/TRIP_WRAP_PLAN.md](./docs/TRIP_WRAP_PLAN.md).

## Monorepo layout

npm workspaces, three packages:

```
tripsplit/
  shared/    @tripsplit/shared — shared TS types + full 167-currency
             registry + expense categories, consumed by both web and server
  server/    @tripsplit/server — Node 22 + Hono API (/api/* only)
  web/       @tripsplit/web    — Vite + React 18 + TS SPA, built to web/dist
             and served as static files by nginx (see docs/deploy/)
```

`server` never serves static files or the SPA — in production nginx
serves `web/dist` at `/` and reverse-proxies `/api` to the Node process.
See `docs/deploy/nginx.split.conf.sample`.

## Requirements

- Node.js **22+** (see `engines.node` in the root `package.json`)
- npm 10+ (npm workspaces)

## Install

```sh
npm install
```

Installs and links all three workspaces from the repo root.

## Dev

```sh
npm run dev
```

Runs, in parallel (via `concurrently`):
- `shared` in `tsc --watch` mode (rebuilds `shared/dist` on change)
- `server` via `tsx watch` (Hono API, default `http://localhost:8080`)
- `web` via `vite` (SPA dev server, default `http://localhost:5173`)

To test inside an actual Telegram client during development, tunnel the
Vite dev server over HTTPS and point BotFather (or its test environment)
at the tunnel URL:

```sh
./scripts/dev-tunnel.sh                # cloudflared (default)
TUNNEL=ngrok ./scripts/dev-tunnel.sh    # or ngrok
```

Append `?eruda=1` to the tunnel URL to load an in-page debug console
(see `web/src/eruda.ts`) — useful since the Telegram WebView has no
attached devtools.

## Build

```sh
npm run build
```

Builds `shared` → `server` (bundled with `tsup` to `server/dist`) →
`web` (type-checked with `tsc -b`, bundled with `vite` to `web/dist`).

## Typecheck / lint / format

```sh
npm run typecheck   # tsc --noEmit across shared/server/web + scripts/ (builds shared first)
npm run lint         # eslint . (flat config at repo root, covers all packages + scripts/)
npm run lint:fix
npm run format       # prettier --write .
npm run format:check
```

## Test

```sh
npm run test
```

Runs `npm run test --workspaces --if-present` (Vitest) across both
`server` (auth/expenses/balances/rates API tests, plus a Phase 9 smoke
test that spawns the real seed/reset CLI against a throwaway temp DB) and
`web` (i18n plural selector + locale-dictionary completeness tests, Phase 7).

## Scripts

| Script | Purpose |
|---|---|
| `npm run seed --workspace=server` | Populates the DB at `DB_PATH` (or `--db <path>`) with a realistic, obviously-fake demo trip — 3 "Demo <Name>" users, 10 expenses across 4 currencies (equal/solo/custom splits), one settlement. Built entirely from the real `createExpense`/`createSettlement` service helpers — see `scripts/seed.ts`'s own doc comment. |
| `npm run reset --workspace=server -- --yes` | Wipes ALL app data (every row, every table) so you can clear test/demo data before real use. Refuses without `--yes` (or `CONFIRM=1`), and refuses a second time on a production-looking path unless also `--force`d — see `scripts/reset.ts`. |
| `./scripts/backup.sh` | Nightly-cron-friendly SQLite backup (WAL-safe `.backup`, integrity check, retention, optional offsite copy) — Phase 8.1. |
| `./scripts/uptime-ping.sh` | Cron job hitting `GET /api/health`, pages you on Telegram if it's down — Phase 8.2. |
| `./scripts/dev-tunnel.sh` | HTTPS tunnel (cloudflared/ngrok) for testing the Vite dev server inside a real Telegram client — see "Dev" above. |

**Never point `seed`/`reset` at a real trip's database unless you actually
mean to** — see each script's own doc comment for the exact safety
behavior, and **[docs/LAUNCH_CHECKLIST.md §6](./docs/LAUNCH_CHECKLIST.md#6-pre-flight-clear-any-leftover-test-data)**
for when to run `reset` as part of a real launch.

## Deploy

`deploy.sh` builds everything and rsyncs `web/dist` + the built `server`
to a VPS, then reloads the `pm2` process defined in
`ecosystem.config.cjs`. It reads connection details from environment
variables (or a gitignored `.env.deploy` file) — no host/IP/domain is
hardcoded in the script itself.

The one-time manual setup this depends on (BotFather, DNS, nginx,
certbot, the deploy user) is **not** part of this script — see
**[docs/deploy/SETUP.md](./docs/deploy/SETUP.md)** for that checklist.

## Environment variables

See `.env.example` (server runtime config) and `.env.deploy.example`
(deploy-script SSH target config). Copy each to the non-`.example`
filename and fill in real values locally / on the VPS — both are
gitignored.

## Launching for real — what's owner-manual

This repo is code-complete and every automated check
(`npm run typecheck`/`lint`/`build`/`test`) passes, but an agent has no
Telegram account, no DNS/VPS access, and no phones — so the following are
genuinely **not done yet**, by design, and can't be faked:

- **BotFather**: creating the bot, uploading branding, enabling the Main
  Mini App.
- **VPS**: DNS, nginx, certbot/HTTPS, the deploy user, the first real
  `./deploy.sh` run.
- **Device tests**: every phase's acceptance criterion that says "on a
  real Android/iPhone" (Phase 2.5, 7's RU/UK/EN + dark-Telegram walkthrough,
  `web/DEVICE_CHECKLIST.md`) and the Phase 9 on-device acceptance run.
- **The actual field test**: a real travel day, both of you, real phones —
  this is the whole point of the MVP, not something to simulate.

Three docs cover this end-to-end, in order:

1. **[docs/LAUNCH_CHECKLIST.md](./docs/LAUNCH_CHECKLIST.md)** — fresh-launch
   runbook: BotFather → DNS/nginx/HTTPS → first deploy → on-device
   acceptance run.
2. **[docs/FIELD_TEST.md](./docs/FIELD_TEST.md)** — friction-log template
   for the first real trip day.
3. **[docs/FAST_FOLLOW.md](./docs/FAST_FOLLOW.md)** — triages friction-log
   items into hotfix-now vs. the post-MVP backlog (pre-seeded from
   IMPLEMENTATION_PLAN.md §13).

# Export & Group Nudges — implementation plan

Two post-MVP backlog items from FAST_FOLLOW.md, implemented together because
they share all their infrastructure (bot delivery, summary formatting,
trip↔chat binding):

1. **Export** — a formatted trip summary (totals, per-currency totals,
   balances, suggested transfers) posted to chat on demand.
2. **Bot chat nudges** — the bot posts "X added an expense …" / settlement
   events into the trip's group chat.

---

## Key design decisions

### Trip ↔ group chat binding (`/link`)

The app currently has no notion of a group chat — the bot only ever talks
1-on-1 (`/start`). Nudges are **opt-in by linking**:

1. Someone adds the bot to the trip's Telegram group.
2. Any trip member sends `/link <inviteCode>` in that group.
3. The bot verifies the code, stores the binding in `trip_chats`, confirms.

Notes:
- Telegram privacy mode is fine: bots in groups always receive messages
  starting with `/`, so `/link`, `/unlink`, `/summary` work with default
  BotFather settings.
- `/unlink` in the group removes the binding. If sending ever fails with
  "bot was kicked"/"chat not found", the binding is auto-removed.
- A trip may be linked to multiple chats; a chat may host multiple trips
  (PK is `(trip_id, chat_id)`).

### Delivery rules

- **Nudges** go **only** to linked group chats. No DM spam: linking is the
  explicit opt-in. No linked chat → no nudges (silently).
- **Export** goes to the linked group chat(s) if any, otherwise the bot DMs
  the summary to the requesting user (who can forward it). The requester has
  always `/start`-ed the bot (that's how Mini Apps launch), so the DM path
  can't 403 in practice.
- All sends are fire-and-forget from the API request path (never block or
  fail a mutation because Telegram hiccuped); failures are logged.

### Server-side i18n for bot messages

Bot texts live server-side (web i18n is client-only). A tiny dictionary
module (`server/src/lib/botMessages.ts`) mirrors web tone in en/ru/uk.
Language pick: the acting user's stored `lang` (the person who added the
expense / requested the export / sent the command); unknown sender → `en`.

### Events that nudge

- expense created / updated / deleted (paid ones; planned expenses don't
  affect balances — still nudge on create for visibility, marked as planned)
- settlement recorded
- `/summary` command in a linked group posts the same summary as Export.

Message content: actor name, action, amount + currency, description/category,
and a one-line "top debt" hint (largest suggested transfer) for social
pressure. Full balances go through `/summary` / Export, not every nudge.

---

## Task breakdown (sequential)

| # | Task | Touches |
|---|------|---------|
| T1 | `trip_chats` table: schema + drizzle migration | `server/src/db/schema.ts`, `server/drizzle/` |
| T2 | Bot message i18n dicts + trip summary formatter + unit tests | `server/src/lib/botMessages.ts`, `server/src/lib/summary.ts` |
| T3 | Bot refactor: command routing, `/link`, `/unlink`, `/summary`, `trip_chats` service, resilient `sendToChat` with auto-unlink | `server/src/bot.ts`, `server/src/lib/tripChats.ts` |
| T4 | Nudge hooks on expense create/update/delete + settlement create (fire-and-forget) + tests | `server/src/routes/trips.ts`, `server/src/routes/expenses.ts`, `server/src/lib/notify.ts` |
| T5 | `POST /api/trips/:id/export` + linked-chat info in trip detail + tests | `server/src/routes/trips.ts` |
| T6 | Web: Export button on BalanceScreen (+ API client + toasts + i18n en/ru/uk) | `web/src/api/*`, `web/src/screens/BalanceScreen.tsx`, `web/src/i18n/*.json` |
| T7 | Web: Settings "Group notifications" section — linked chats status + how-to-link instructions + i18n | `web/src/screens/SettingsScreen.tsx` |
| T8 | Full green run (typecheck/lint/test/build), docs updates (README status, FAST_FOLLOW checkboxes) | docs |

Definition of done per task: `npm run typecheck && npm run lint && npm run test`
green; money/balance-touching logic covered by a test (project rule from
FAST_FOLLOW.md "Hotfix definition of done").

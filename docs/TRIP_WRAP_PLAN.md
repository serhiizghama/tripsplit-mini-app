# Trip Wrap — finish a trip with a celebratory stats page

> **Status: implemented.** All five tasks below landed (git history from
> `feat(wrap): trip wrap metrics engine…` onward). Kept as the design record.

Close ("finish") a trip and get a **Trip Wrapped** page — a celebratory,
Spotify-Wrapped-style final report: headline numbers, fun member awards,
category champions, plus a farewell card posted to the linked group chat.
The trip stays browsable afterwards (read-only), and can be reopened.

`trips.archivedAt` already exists in the schema and flows through every
trip response — nothing sets it yet and the web ignores it. This feature
gives it meaning.

---

## Metrics (computed server-side from existing data)

All from `expenses` + `expense_shares` + `users` + existing balance/insight
engines — no new data collection. Scope rules mirror `lib/insights.ts`
(paid, non-deleted; settlements counted separately, never as spend).

**Headline:**
- total spent (base currency), expense count, day count (first→last
  `spentOn`), average per day, number of distinct currencies used

**Per member (table):**
- paid total, fair-share total, expenses-paid count

**Awards (the fun part — each an emoji + member + value):**
- 💰 **Sponsor** — biggest paid total
- 🧾 **Bookkeeper** — most expenses logged (`createdBy`)
- 💥 **Big spender moment** — the single largest expense (payer, amount,
  description/category)
- ⚡ **Busiest day** — date with most transactions (+ count)
- 📉 **Priciest day** — date with the largest total (+ amount)
- 🌍 **Currency collector** — member who paid in the most distinct
  currencies (shown when > 1)
- Per-category champions for the top 3 categories by total (e.g. 🍺 —
  who paid the most for drinks): emoji + member + category total
- 🤝 settlements recorded: count + total volume

Awards with no meaningful data (zero expenses, single member ties where
everyone is equal) are simply omitted — the builder returns only earned
awards. Ties broken deterministically (higher value first, then lower
user id).

**Settle state at close:** settled (all zero) vs outstanding transfers
remaining — the wrap page shows a "everyone's settled" ✅ or the remaining
debts list.

## Flow

1. Settings → "Finish trip" button (visible while active). Confirm dialog;
   if debts are unsettled the dialog warns but allows closing anyway
   (user's call — force-close is legitimate).
2. `POST /api/trips/:id/close` → sets `archivedAt` (409 `trip_archived` if
   already closed), fire-and-forget posts a farewell card (compact wrap
   summary) to linked group chats, returns the wrap payload.
3. Web navigates to the Wrap screen: confetti burst (hand-rolled canvas,
   no new deps), hero card, awards, member table, settle state. A "share"
   button re-posts the farewell card (reuses export delivery: group chat
   else DM).
4. Archived trip afterwards: mutations are blocked server-side
   (409 `trip_archived` on expense create/update/delete + settlement
   create), web shows a "Trip finished — view wrap" banner on Feed/Balance,
   hides add-expense/settle CTAs, marks the trip in the switcher.
   `GET /api/trips/:id/wrap` serves the wrap page anytime later.
5. Settings on an archived trip: "Reopen trip" (`POST /:id/reopen`,
   clears `archivedAt`) — the undo path.

## Task breakdown (sequential)

| # | Task | Touches |
|---|------|---------|
| W1 | Wrap engine: `computeTripWrap` (pure) + DB assembler + shared types + tests | `server/src/lib/wrap.ts`, `shared/src/types.ts` |
| W2 | Routes: close / reopen / GET wrap; archived-mutation guard; farewell bot card (+botMessages i18n) + tests | `server/src/routes/trips.ts`, `expenses.ts`, `lib/botMessages.ts` |
| W3 | Web: wrap screen + confetti + share button + route + i18n | `web/src/screens/WrapScreen.tsx`, router, api |
| W4 | Web: finish/reopen flow in Settings, archived banners + read-only affordances, switcher badge + i18n | `SettingsScreen.tsx`, `FeedScreen.tsx`, `BalanceScreen.tsx`, `TripSwitcher*` |
| W5 | Docs, full green run, push | README, FAST_FOLLOW |

Definition of done per task: `npm run typecheck && npm run lint && npm run test`
green; wrap math covered by unit tests over a crafted fixture trip.

# TripSplit — fast-follow triage

Phase 9.4 (IMPLEMENTATION_PLAN.md, "MVP Launch & Field Test"). Take
whatever landed in **[FIELD_TEST.md](./FIELD_TEST.md)**'s friction log and
sort each item into one of two lanes below: **hotfix now**, or **post-MVP
backlog** (deferred, revisit later). Nothing needs to happen the moment a
friction-log row exists — that's the whole point of triage.

---

## Triage rule of thumb

Ask, in order:
1. **Does it block real use of the app** (data loss, wrong balance math,
   can't add an expense at all)? → **hotfix**, immediately.
2. **Would fixing it take real effort** (new screen, new data model
   field, a whole new split mode)? → **backlog**, no matter how annoying.
3. **Everything else** (a wrong default, a missing curated currency, a
   translation string) → **hotfix**, it's cheap and worth doing before the
   next trip.

When unsure, default to **backlog** — the MVP's whole premise (§2's "why
these choices") is a hard-cut scope; re-opening it for every minor
annoyance is how a 3-day project becomes a 3-week one.

---

## Hotfix definition of done

Same bar as every other phase in this project (IMPLEMENTATION_PLAN.md §11,
"Definition of Done... per the user's rule"), applied to a single small
fix instead of a whole phase:

- [ ] `npm run build`, `npm run lint`, `npm run test` all pass.
- [ ] If the fix touches money math, split logic, or balances — a test
      covers the specific scenario that was wrong, not just a manual check.
- [ ] **Device-verified**: the actual fix confirmed on a real phone (or
      both, if it's a cross-platform concern), not just "should work now."
- [ ] Deployed via `./deploy.sh` and spot-checked live before considering
      the friction-log row closed.

Don't mark a hotfix row done in the table below until all four boxes are
true — "I fixed the code" and "done" are different states.

---

## Active triage board

Copy new rows in from the friction log as you process them.

| From (friction-log timestamp/screen) | Item | Decision | Status |
|---|---|---|---|
| _e.g. 14:32, Add expense_ | _e.g. currency picker doesn't persist last-used per trip_ | hotfix | not started |
| | | | |
| | | | |

---

## Post-MVP backlog

Pre-seeded from IMPLEMENTATION_PLAN.md §13 (deliberately cut from MVP
scope, validated by the competitive research in Appendix A) — re-prioritize
freely based on what the field test actually surfaces. Check items off (or
re-order them) as they get picked up; add new rows for anything from the
friction log that lands here instead of as a hotfix.

- [x] **Bot chat nudges** — post balance summaries / "you were added an
      expense" into the group chat (Tallycents' social-pressure feature;
      TG-native superpower). Done — see
      [EXPORT_NUDGES_PLAN.md](./EXPORT_NUDGES_PLAN.md): `/link <code>` in the
      group, then expenses/settlements are announced; `/summary` posts totals.
- [ ] **Natural-language quick add** — reply "taxi 250 thb" to the bot
      (Splitsheet pattern).
- [ ] **Sticky manual rate** — an overridden rate persists for later
      expenses in that currency (Settle Up pattern).
- [ ] **Percentages/shares split modes**; per-member default weights
      (couples/families).
- [x] **Export** — formatted text summary posted to chat. Done — "Share
      summary" on the Balance screen posts to the linked group chat, or DMs
      the requester when no chat is linked.
- [ ] **Per-currency "unconverted" balance view** (Spliit #412 demand).
- [ ] **Dark theme** via `themeParams`; multiple parallel trips UI; receipt
      photo attachments; receipt OCR (last — even the big three do it
      badly).

### New backlog items from field-test friction

| From (friction-log timestamp/screen) | Item | Why deferred |
|---|---|---|
| | | |
| | | |

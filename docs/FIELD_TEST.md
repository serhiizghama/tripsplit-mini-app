# TripSplit — field-test protocol

Phase 9.3 (IMPLEMENTATION_PLAN.md, "MVP Launch & Field Test"). This is how
to run the **first real trip day** as a field test: a running friction log
you fill in as you go, so nothing gets lost to "I'll remember that later."

Do this only after **[LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)** is fully
checked off. When the day is done, feed whatever you logged into
**[FAST_FOLLOW.md](./FAST_FOLLOW.md)** to decide what becomes a hotfix now
vs. what waits for the post-MVP backlog.

---

## How to capture friction on the road

Pick whichever is actually least friction for **you**, on the day — the
goal is a log that gets filled in, not a "correct" tool:

- **Fastest:** voice-note yourself the moment something's annoying
  ("balance screen, had to tap settle three times") and transcribe the
  table below that evening.
- **Also fine:** a shared note (Telegram "Saved Messages", a notes app) —
  jot one line per incident with a rough time, copy into the table below
  later.
- **If you're already at a laptop:** just edit this file directly and fill
  the table in real time.

Don't overthink severity/exact wording in the moment — capture the raw
fact ("had to retype the amount, autofocus lost after switching currency")
and clean it up later. A missed friction point is worse than a messy one.

---

## What to watch for specifically

These are the things Phase 9 exists to catch — actively check for them,
don't just wait for them to be annoying enough to notice on their own:

- **Tap counts.** Is the "add expense" happy path still ≤3 interactions in
  practice (type amount, tap MainButton)? Any screen where you find
  yourself tapping more than expected to do something routine?
- **Default correctness.** Is the default payer (you) right? Default split
  (equal, all members) right for how you actually split things? Default
  currency (last-used) actually the one you want next, or are you
  re-picking it every time?
- **Missing currencies.** Any currency you needed that wasn't in the
  curated "top" list (THB/VND/LAK/UAH/USD/EUR/USDT) or the full picker at
  all? Note the exact code/name.
- **Translation overflow.** RU/UK text running longer than the English and
  clipping/wrapping badly, especially on smaller screens or long
  member/category names.
- **Rate accuracy vs. your card.** Compare the app's auto-filled rate
  against what your bank/card actually charged for the same purchase —
  note the delta. This is expected to differ some (mid-market rate vs.
  card spread — see IMPLEMENTATION_PLAN.md §12's risk table) but a big gap
  is worth knowing about, and is exactly what the editable-rate field is
  for — did you actually use it when the gap mattered?
- **Anything that made you ask "how do I…"** — the Phase 9 acceptance bar
  is a full day tracked **without** needing to ask that question. Every
  time you do, that's a friction-log entry.

---

## Friction log

Copy this table and fill it in as you go (or keep appending rows to this
file directly — either works).

| Timestamp | Screen | Friction | Severity | Proposed fix |
|---|---|---|---|---|
| _e.g. 14:32_ | _e.g. Add expense_ | _e.g. currency picker defaulted to USD instead of last-used THB after switching trips_ | _e.g. medium_ | _e.g. persist last-used currency per trip, not globally_ |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

**Severity guide** (kept deliberately simple — this is a 2-person MVP, not
a support queue):
- **blocker** — couldn't complete the task at all; had to work around it
  outside the app (mental math, a different app, asking the other person
  to do it instead).
- **high** — completed the task, but it was clearly wrong/confusing enough
  that it needs fixing before the next trip.
- **medium** — annoying, cost extra taps/time, but didn't block anything.
- **low** — a nice-to-have you noticed; not urgent.

---

## End of day

- [ ] Balances screen still makes sense after a full day of real use —
      spot-check the transfer suggestion against your own mental tally.
- [ ] Log at least one settlement for the day if any money actually
      changed hands.
- [ ] Transcribe/clean up the friction log above (or move it into
      `FAST_FOLLOW.md` directly if you're doing triage same-day).

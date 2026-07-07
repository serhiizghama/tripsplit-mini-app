# Device checklist — Phase 2 manual pass

This subagent has no phone access, so everything below is a **manual
step for the owner** on real Android + iPhone Telegram clients, per
IMPLEMENTATION_PLAN.md Phase 2.5 / §7 / §11. What *was* verified
automatically (build/typecheck/lint/tests + a headless boot smoke check)
is documented in the Phase 2 completion report, not here.

Do this once real BotFather `/newapp` + a tunnel (`scripts/dev-tunnel.sh`)
or a deployed build are pointed at from Telegram.

## Chrome / theme

- [ ] Header bar is white (`#FFFFFF`), not Telegram's default per-theme color
      — test with the Telegram app itself set to a **dark** theme; the Mini
      App must still look light (plan §8's "forced light chrome").
- [ ] Bottom bar (where present, e.g. Android gesture bar area) is white.
- [ ] Page background is `#F4F4F7`, cards are white `#FFFFFF` with 12 px
      rounded corners.

## Viewport / safe areas

- [ ] App opens expanded (not collapsed to a small sheet) — `viewport.expand()`
      took effect.
- [ ] iPhone notch/Dynamic Island and home-indicator areas don't clip content
      or the bottom tab bar (safe-area insets — see `AppShell.css`, tune the
      `padding-bottom` constant if the tab bar overlaps content).
- [ ] Rotating / resizing (iPad multitasking, Android split-screen) doesn't
      break layout — nothing should assume a fixed `100vh`.

## Scroll / swipe

- [ ] On iOS, dragging down from the top of a scrollable screen does **not**
      collapse/close the Mini App (`swipeBehavior.disableVertical()` should
      prevent the classic "scroll-collapse" bug).
- [ ] Normal vertical scrolling inside Feed/Balance/Settings still works.

## Navigation

- [ ] Tapping Feed / Balance / Settings in the bottom tab bar switches
      screens instantly, correct tab highlighted.
- [ ] Opening the app via a plain `t.me/<bot>/<app>` link (no `startapp`)
      lands on Feed (or the create-trip placeholder, since there are no
      trips yet in Phase 2).
- [ ] Opening the app via `t.me/<bot>/<app>?startapp=<code>` lands on the
      invite/join stub screen showing that exact code.
- [ ] Tapping "+ Add expense" opens the add-expense sheet (`Modal`); closing
      it (swipe down / tap outside) returns to Feed without a stuck state.

## Auth

- [ ] Settings screen shows your real Telegram first name (and `@username`
      if set) — proof the `Authorization: tma <initData>` round trip to
      `GET /api/me` works from a real device, not just dev fallback data.
- [ ] Force-quitting and reopening the Mini App still authenticates (fresh
      `initData` issued by Telegram on every open).

## Keyboard (forward-looking, full form lands Phase 4)

- [ ] Opening any text input doesn't leave a dead zone / broken scroll
      position once the keyboard dismisses.

## Known non-goals for Phase 2

- Real trip/expense data, avatars from `photo_url`, and the full
  add-expense form are Phase 3/4 — the stub screens here are intentionally
  empty-state only.
- Dark theme support beyond "forced light chrome" is a post-MVP backlog
  item (plan §13).

## Phase 7 addendum — i18n, branding, mobile polish

Everything below was verified automatically where possible (build, lint,
unit tests, an EN/RU/UK boot check in a real Chrome instance — see the
Phase 7 completion report) but still needs a real-device pass, same as the
rest of this file:

- [ ] **Language switcher** (Settings → Language): tapping EN/RU/UK
      updates every screen's text immediately (no reload needed), and the
      choice survives force-quitting and reopening the Mini App (proof
      `PATCH /api/me` persisted it and the per-request auth upsert no
      longer clobbers it — the bug this phase fixed).
- [ ] **Auto-detect on first launch**: a fresh Telegram account with a
      Russian or Ukrainian device language lands on the RU/UK UI without
      ever touching the language switcher.
- [ ] **No untranslated strings**: walk every screen (Feed, Balance,
      Settings, Create trip, Invite/Join, Add expense, Settle up) in all 3
      languages — look for any leftover English text, truncated/overlapping
      translated strings (RU/UK text runs longer than English), and correct
      plural forms on member/expense counts (1, 2, 5, 11+ members).
- [ ] **Dark-Telegram check**: with the Telegram app itself set to a dark
      theme, the Mini App still renders fully light (white cards, `#F4F4F7`
      background, white header/bottom bar) — plan §8's forced-light-chrome
      requirement, unchanged since Phase 2 but worth re-confirming here
      since Phase 7 added new UI (brand header, language switcher, toasts,
      skeletons) that should also render light everywhere.
- [ ] **Haptics**: a tap on "Add expense"/"Settle" success gives a success
      haptic; a validation error gives an error haptic (already wired since
      Phase 4/6 — Phase 7 didn't change this, just confirm it's still felt).
- [ ] **Keyboard dismiss**: after submitting the add-expense or settle
      form, the on-screen keyboard closes on its own (`hideKeyboard()`,
      Bot API 9.1+) rather than staying up over the now-dismissed sheet.
- [ ] **Tap targets**: the feed row's delete (🗑️/✅) button is comfortably
      tappable with a thumb, not just precisely with a stylus.
- [ ] **Branding**: bot avatar and Mini App photo (see `branding/`) look
      right once uploaded to BotFather — this file's own checklist doesn't
      cover the BotFather upload step itself (owner-only, see
      `branding/README.md`).

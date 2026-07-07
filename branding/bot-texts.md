# Bot copy — EN / RU / UK

Phase 7.2 deliverable: the `/start` description texts IMPLEMENTATION_PLAN.md
§8 asks for, in all 3 app locales. **This is copy only** — pasting it into
BotFather (`/setdescription`, `/setabouttext`, and wiring the actual `/start`
handler once a bot process exists — plan §3 names `grammY` for this, not yet
implemented in Phases 0–7) is the owner's manual step, per §7's BotFather
setup flow. Character counts below are BotFather's own limits.

---

## 1. Bot description (`/setdescription`, ≤ 512 chars)

Shown in the bot's chat before the user has pressed **Start** — this is the
"what does this bot do" pitch.

**EN**
> Split travel expenses with your group — no signup, just tap to join.
> Log any currency, see who owes whom, settle up. Free, unlimited, built
> for actual trips.

**RU**
> Делите расходы в путешествии со своей компанией — без регистрации,
> просто присоединяйтесь по ссылке. Любая валюта, видно, кто кому должен,
> расчёт в один тап. Бесплатно и без ограничений — для настоящих поездок.

**UK**
> Діліть подорожні витрати зі своєю компанією — без реєстрації, просто
> приєднуйтесь за посиланням. Будь-яка валюта, видно, хто кому винен,
> розрахунок в один дотик. Безкоштовно і без обмежень — для справжніх
> подорожей.

---

## 2. Bot about text (`/setabouttext`, ≤ 120 chars)

Shown on the bot's profile page (tap the bot's name/avatar).

**EN**
> Split travel expenses with your group. Any currency, no signup.

**RU**
> Делите расходы в путешествии с компанией. Любая валюта, без регистрации.

**UK**
> Діліть подорожні витрати з компанією. Будь-яка валюта, без реєстрації.

---

## 3. `/start` reply message

The message text a minimal `grammY` handler sends on `/start`, with a
Mini-App launch button below it (button label included). Keep this
separate from the description above — this is what's actually sent as a
chat message, not bot-profile metadata.

**EN**
> **TripSplit** — split travel expenses with your group.
>
> Tap below to open the app, create a trip (or join one from an invite
> link), and start logging shared expenses.

Button: `Open TripSplit`

**RU**
> **TripSplit** — делите расходы в путешествии со своей компанией.
>
> Нажмите ниже, чтобы открыть приложение, создать поездку (или
> присоединиться по ссылке-приглашению) и начать учёт общих расходов.

Button: `Открыть TripSplit`

**UK**
> **TripSplit** — діліть подорожні витрати з компанією.
>
> Натисніть нижче, щоб відкрити застосунок, створити подорож (або
> приєднатися за посиланням-запрошенням) і почати облік спільних витрат.

Button: `Відкрити TripSplit`

---

## Notes for whoever wires up the actual bot process

- The bot's own displayed language in Telegram's client chrome (BotFather
  fields above) is a single fixed string per field — Telegram does **not**
  localize bot descriptions per-user the way the Mini App itself is
  localized (Phase 7.1's `t()`/`me.user.lang`). Pick one locale for the
  BotFather fields (EN is the safe default for a public-facing bot
  description) — the RU/UK copy above is for when/if a localized bot
  description becomes relevant (e.g. `setMyDescription` per-language-code,
  which BotFather's API supports but the `/setdescription` chat command
  does not expose directly).
- The `/start` handler itself would pick EN/RU/UK from the *incoming
  message's* `from.language_code` (same `resolveLang()` rule already used
  server-side in `server/src/middleware/auth.ts`) — this file has all 3
  variants ready for that once the bot process exists.

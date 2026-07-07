/**
 * Boots the Telegram Mini Apps SDK — IMPLEMENTATION_PLAN.md §7 / §8, Phase 2.1.
 *
 * Installed package reality (checked against `node_modules/@tma.js/sdk-react`
 * and its `@tma.js/sdk` dependency — see the .d.ts files under `dist/dts`):
 *   - `@tma.js/sdk-react` re-exports everything from `@tma.js/sdk` and adds a
 *     handful of React hooks (`useSignal`, `useLaunchParams`, ...). There is
 *     no separate "SDKProvider" component to render in this version — you
 *     just call `init()` once, then mount/use the individual feature
 *     singletons (`viewport`, `swipeBehavior`, `miniApp`, ...) directly.
 *   - Every "checked" method on those singletons (the ones with a `.mount`,
 *     `.expand`, `.setHeaderColor`, etc.) exposes a non-throwing
 *     `.ifAvailable(...)` variant alongside the throwing plain call. We use
 *     `.ifAvailable()` everywhere below instead of calling the function
 *     directly, so a Telegram client that doesn't support a given method
 *     (older/newer Bot API, or no Telegram at all) degrades silently instead
 *     of throwing.
 *   - `init()` itself is a plain (throwing) function, not a checked one — it
 *     throws when there are no Telegram launch parameters at all, which is
 *     the normal case for `npm run dev` in a plain desktop browser. That's
 *     the one call we wrap in try/catch ourselves.
 *
 * We deliberately do NOT touch `themeParams` here — plan §8 says to ignore
 * `themeParams` for surfaces and force a fixed light chrome instead. Telegram
 * only injects `--tg-theme-*` CSS variables if we opt in via
 * `themeParams.bindCssVars()`; skipping that call means the app's own fixed
 * light palette (antd-mobile's `--adm-*` tokens, overridden in `index.css`)
 * is what renders, regardless of the user's Telegram theme.
 */
import { init, miniApp, swipeBehavior, viewport } from '@tma.js/sdk-react';

/** Force-light chrome regardless of the user's Telegram theme — plan §8. */
const HEADER_COLOR = '#FFFFFF';
const BACKGROUND_COLOR = '#F4F4F7';
const BOTTOM_BAR_COLOR = '#FFFFFF';

export interface TelegramBootResult {
  /** True once `init()` succeeded, i.e. real Telegram launch params were found. */
  isTma: boolean;
}

/**
 * Runs once at app startup (see `main.tsx`). Never throws — every effect is
 * independently guarded so a missing/changed API on any one feature can't
 * take down the others or crash boot.
 */
export function bootTelegramSdk(): TelegramBootResult {
  try {
    init();
  } catch (err) {
    console.warn(
      '[telegram] init() failed — probably not running inside Telegram (expected in plain-browser dev)',
      err,
    );
    return { isTma: false };
  }

  // Expand to the maximum available height and bind the stable viewport
  // dimensions as CSS vars (`--tg-viewport-stable-height`, safe-area insets,
  // ...). iOS gotcha (plan §7): layout must never depend on `100vh`.
  try {
    viewport.mount.ifAvailable();
    viewport.expand.ifAvailable();
    viewport.bindCssVars.ifAvailable();
  } catch (err) {
    console.warn('[telegram] viewport setup failed', err);
  }

  // iOS scroll-collapse fix (Bot API 7.7+) — plan §7.
  try {
    swipeBehavior.mount.ifAvailable();
    swipeBehavior.disableVertical.ifAvailable();
  } catch (err) {
    console.warn('[telegram] swipeBehavior setup failed', err);
  }

  // Forced-light chrome (plan §8) — the app must look Telegram-native in a
  // light style even when the user's own Telegram theme is dark.
  try {
    miniApp.mount.ifAvailable();
    miniApp.setHeaderColor.ifAvailable(HEADER_COLOR);
    miniApp.setBgColor.ifAvailable(BACKGROUND_COLOR);
    miniApp.setBottomBarColor.ifAvailable(BOTTOM_BAR_COLOR);
  } catch (err) {
    console.warn('[telegram] miniApp chrome setup failed', err);
  }

  return { isTma: true };
}

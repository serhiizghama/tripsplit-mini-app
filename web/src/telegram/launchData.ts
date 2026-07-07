/**
 * Raw `initData` + `start_param` access, with a dev-only fallback so
 * `npm run dev` works in a plain desktop browser — Phase 2.1 / 2.4 / 2.5.
 *
 * `retrieveRawInitData()` / `retrieveLaunchParams()` (from `@tma.js/sdk-react`,
 * re-exported from `@tma.js/sdk`) both throw `LaunchParamsRetrieveError` when
 * there are no Telegram launch parameters anywhere (no `tgWebApp*` query
 * string, hash, or sessionStorage entry) — that's the expected case outside
 * Telegram, not a bug, so every call here is wrapped in try/catch.
 */
import { retrieveLaunchParams, retrieveRawInitData } from '@tma.js/sdk-react';

/** The real, signed `initData` string Telegram embeds in the launch parameters. */
function getRealInitDataRaw(): string | undefined {
  try {
    return retrieveRawInitData();
  } catch {
    return undefined;
  }
}

/**
 * Dev-only fallback so local browser development doesn't just 401 on every
 * `/api/*` call. Configure via `VITE_DEV_INIT_DATA` in `web/.env.local` (see
 * `web/.env.example`) — empty by default, meaning dev-outside-Telegram simply
 * sees the real unauthenticated state (a "couldn't load your profile" empty
 * state, not a crash).
 *
 * Gated on `import.meta.env.DEV`, which Vite statically replaces with the
 * literal `false` in production builds — so both this branch and any value
 * of `VITE_DEV_INIT_DATA` are dead code in `web/dist`, even if someone sets
 * the var by mistake in a prod environment.
 */
function getDevInitDataFallback(): string | undefined {
  if (!import.meta.env.DEV) return undefined;
  return import.meta.env.VITE_DEV_INIT_DATA || undefined;
}

/** Raw initData to send as `Authorization: tma <raw>` — see `api/client.ts`. */
export function getInitDataRaw(): string | undefined {
  return getRealInitDataRaw() ?? getDevInitDataFallback();
}

/**
 * `start_param` from the launch (`?startapp=<code>` deep link) — plan §7.
 * Returns `undefined` outside Telegram or when no start param was passed.
 */
export function getStartParam(): string | undefined {
  // 1. Telegram-native start_param — set when the app is opened via a Mini App
  //    direct link (`t.me/<bot>/<app>?startapp=`) or the menu button.
  try {
    const launchParams = retrieveLaunchParams();
    const native = launchParams.tgWebAppStartParam ?? launchParams.tgWebAppData?.start_param;
    if (native) return native;
  } catch {
    // Not launched from Telegram launch params — fall through to the query.
  }

  // 2. Fallback: our own `?startapp=<code>` query param. This is how invites
  //    arrive when the app is opened via the bot's `/start` Web App button
  //    (no BotFather Mini App, so no native start_param) — the bot injects it
  //    onto the button URL. See server/src/bot.ts's handleStart.
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('startapp');
    if (fromQuery) return fromQuery;
  } catch {
    // window/URLSearchParams unavailable — nothing more to try.
  }

  return undefined;
}

/**
 * `startapp` payload is base64url, ≤64 chars (plan §7 / Appendix C). This is
 * a loose shape check to decide whether to route to the join-flow stub —
 * real validation happens server-side in Phase 3's `POST /api/trips/join`.
 */
const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export function isLikelyInviteCode(value: string | undefined): value is string {
  return typeof value === 'string' && INVITE_CODE_PATTERN.test(value);
}

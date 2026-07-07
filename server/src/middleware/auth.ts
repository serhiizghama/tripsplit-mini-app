/**
 * Telegram `initData` auth middleware — IMPLEMENTATION_PLAN.md §5 / §7.
 *
 * Every `/api/*` request (except `/api/health`) must carry
 * `Authorization: tma <initDataRaw>`. We validate the HMAC signature and
 * `auth_date` freshness with `@tma.js/init-data-node`'s `validate()`, then
 * parse the payload and upsert the `users` row from the embedded Telegram
 * user. No sessions, no cookies — every request re-proves identity via the
 * signature Telegram itself re-issues on every app open.
 *
 * Never log the raw header or `initDataRaw` — it's a signed credential.
 */
import { parse, validate } from '@tma.js/init-data-node';
import { eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { z } from 'zod';

import { db, schema } from '../db/index.js';
import { AppError } from '../lib/errors.js';

/** initData is valid for at most 1 hour, per IMPLEMENTATION_PLAN.md §7. */
const INIT_DATA_EXPIRES_IN_SECONDS = 3600;

const AUTH_HEADER_SCHEMA = z.string().regex(/^tma\s+(.+)$/);

export interface AuthUser {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  lang: string;
  createdAt: string;
  updatedAt: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

/** Maps Telegram's `language_code` to one of our 3 supported UI locales. */
export function resolveLang(languageCode: string | undefined): 'en' | 'ru' | 'uk' {
  if (languageCode === 'ru') return 'ru';
  if (languageCode === 'uk') return 'uk';
  return 'en';
}

function extractInitDataRaw(authHeader: string | undefined): string {
  const result = AUTH_HEADER_SCHEMA.safeParse(authHeader);
  if (!result.success) {
    throw new AppError(401, 'unauthorized', 'Missing or malformed Authorization header');
  }
  // Matched by the regex above: "tma " (1 keyword + whitespace) + the raw payload.
  return result.data.replace(/^tma\s+/, '');
}

/**
 * Upserts the `users` row from a parsed Telegram user and returns the
 * resulting row. Exported for reuse/testing independent of the HTTP layer.
 *
 * `lang` handling (Phase 7 fix — was previously re-derived from Telegram's
 * `language_code` on EVERY request, silently clobbering a user's own choice):
 * `resolveLang(tgUser.language_code)` is only ever used for the row's
 * *initial* value, on first-seen INSERT. The `onConflictDoUpdate` branch
 * deliberately omits `lang` from its `set` — Drizzle/SQLite's `ON CONFLICT DO
 * UPDATE SET` only touches the columns listed, so an existing row's `lang`
 * (whether it's still the Telegram-derived default or a value the user
 * picked via `PATCH /api/me`, see `updateMeSchema` in `src/index.ts`) is left
 * exactly as stored. `PATCH /api/me` is the only code path that changes
 * `lang` after the first insert.
 */
export function upsertUserFromTelegram(tgUser: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}): AuthUser {
  const now = new Date().toISOString();

  db.insert(schema.users)
    .values({
      id: tgUser.id,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name ?? null,
      username: tgUser.username ?? null,
      photoUrl: tgUser.photo_url ?? null,
      lang: resolveLang(tgUser.language_code), // first-seen default only
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        firstName: tgUser.first_name,
        lastName: tgUser.last_name ?? null,
        username: tgUser.username ?? null,
        photoUrl: tgUser.photo_url ?? null,
        // lang intentionally NOT set here — see doc comment above.
        updatedAt: now,
      },
    })
    .run();

  const row = db.select().from(schema.users).where(eq(schema.users.id, tgUser.id)).get();
  if (!row) {
    // Cannot happen: we just inserted/updated this exact row.
    throw new AppError(500, 'internal_error', 'Failed to upsert user');
  }
  return row;
}

/** Builds the `/api/*` auth middleware for a given bot token. */
export function createAuthMiddleware(botToken: string) {
  return async function authMiddleware(c: Context, next: Next) {
    // /api/health must stay public regardless of mount order — see src/index.ts.
    if (c.req.path === '/api/health') {
      await next();
      return;
    }

    const initDataRaw = extractInitDataRaw(c.req.header('Authorization'));

    try {
      validate(initDataRaw, botToken, { expiresIn: INIT_DATA_EXPIRES_IN_SECONDS });
    } catch {
      throw new AppError(401, 'unauthorized', 'Invalid or expired Telegram init data');
    }

    const initData = parse(initDataRaw);
    if (!initData.user) {
      throw new AppError(401, 'unauthorized', 'Telegram init data is missing the user field');
    }

    const user = upsertUserFromTelegram(initData.user);
    c.set('user', user);
    await next();
  };
}

/**
 * initData validation smoke tests (IMPLEMENTATION_PLAN.md §7, Phase 1.5).
 *
 * We sign fixtures ourselves with `@tma.js/init-data-node`'s `sign()` using a
 * dummy bot token (never a real one), then drive requests through the real
 * Hono app via `app.request(...)` — no network, no real Telegram server.
 */
import { sign } from '@tma.js/init-data-node';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

describe('Telegram initData auth', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('a validly signed initData fixture passes and upserts the user', async () => {
    current = await bootTestApp();
    const { app } = current;

    const initDataRaw = sign(
      { user: { id: 111222333, first_name: 'Anna', last_name: 'K', username: 'annak', language_code: 'ru' } },
      TEST_BOT_TOKEN,
      new Date(),
    );

    const res = await app.request('/api/me', {
      headers: { Authorization: `tma ${initDataRaw}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({
      id: 111222333,
      firstName: 'Anna',
      lastName: 'K',
      username: 'annak',
      lang: 'ru', // language_code 'ru' -> lang 'ru'
    });
    expect(body.trips).toEqual([]);
  });

  it('a forged initData fixture (signed with the wrong key) is rejected with 401', async () => {
    current = await bootTestApp();
    const { app } = current;

    const forgedInitDataRaw = sign(
      { user: { id: 999, first_name: 'Forger' } },
      'a-completely-different-signing-key',
      new Date(),
    );

    const res = await app.request('/api/me', {
      headers: { Authorization: `tma ${forgedInitDataRaw}` },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('unauthorized');
  });

  it('an expired initData fixture (auth_date older than 3600s) is rejected with 401', async () => {
    current = await bootTestApp();
    const { app } = current;

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const staleInitDataRaw = sign({ user: { id: 555, first_name: 'Stale' } }, TEST_BOT_TOKEN, twoHoursAgo);

    const res = await app.request('/api/me', {
      headers: { Authorization: `tma ${staleInitDataRaw}` },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('unauthorized');
  });

  it('a well-formed but unsigned/garbage Authorization header is rejected with 401', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/me', {
      headers: { Authorization: 'tma not-real-init-data' },
    });

    expect(res.status).toBe(401);
  });

  // Phase 7 i18n fix: the per-request upsert used to re-derive `lang` from
  // Telegram's `language_code` on EVERY request, silently overwriting a
  // user's own choice (made via `PATCH /api/me`) the next time Telegram
  // resent a *different* `language_code`. `upsertUserFromTelegram` must only
  // ever set `lang` on first-seen INSERT; every subsequent upsert (any
  // request after the first) must leave a stored `lang` exactly as-is.
  it('does not clobber a previously stored lang on a later request with a different language_code', async () => {
    current = await bootTestApp();
    const { app, db, schema } = current;

    const firstSeen = sign(
      { user: { id: 777, first_name: 'Uzer', language_code: 'ru' } },
      TEST_BOT_TOKEN,
      new Date(),
    );
    const insertRes = await app.request('/api/me', {
      headers: { Authorization: `tma ${firstSeen}` },
    });
    expect((await insertRes.json()).user.lang).toBe('ru'); // first-seen INSERT derives from language_code

    // Simulate a user-chosen override — exactly what `PATCH /api/me` does —
    // directly via the DB, independent of that endpoint's own tests.
    db.update(schema.users).set({ lang: 'uk' }).where(eq(schema.users.id, 777)).run();

    // A later request carries a *different* language_code (e.g. Telegram
    // re-detected the device locale); the stored override must survive.
    const laterRequest = sign(
      { user: { id: 777, first_name: 'Uzer', language_code: 'en' } },
      TEST_BOT_TOKEN,
      new Date(),
    );
    const updateRes = await app.request('/api/me', {
      headers: { Authorization: `tma ${laterRequest}` },
    });
    expect((await updateRes.json()).user.lang).toBe('uk'); // preserved, not reset to 'en'
  });
});

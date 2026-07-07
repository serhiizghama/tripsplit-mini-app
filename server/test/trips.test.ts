/**
 * Trip CRUD + invite/join tests — Phase 3.1/3.3. Same pattern as
 * `me.test.ts`/`auth.test.ts`: signed-fixture initData via
 * `@tma.js/init-data-node`'s `sign()`, driven through the real Hono app via
 * `app.request(...)` against an isolated temp-file SQLite DB per test.
 */
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it } from 'vitest';

import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

/** Signs a minimal initData fixture for a given Telegram user id. */
function authHeaderFor(userId: number, firstName = 'Test'): string {
  const initDataRaw = sign(
    { user: { id: userId, first_name: firstName } },
    TEST_BOT_TOKEN,
    new Date(),
  );
  return `tma ${initDataRaw}`;
}

describe('Trips API', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('POST /api/trips creates a trip, makes the creator a member, and returns an invite link', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/trips', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Thailand 2026', baseCurrency: 'THB' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.trip).toMatchObject({
      title: 'Thailand 2026',
      baseCurrency: 'THB',
      createdBy: 1,
    });
    expect(typeof body.trip.id).toBe('string');
    expect(typeof body.trip.inviteCode).toBe('string');
    // Bot deep-link form (t.me/<bot>?start=<code>) — works without a
    // BotFather-registered Mini App; the bot forwards the code into the app.
    expect(body.inviteLink).toContain(`?start=${body.trip.inviteCode}`);

    // /api/me should now list it, with the creator as its only member.
    const meRes = await app.request('/api/me', {
      headers: { Authorization: authHeaderFor(1) },
    });
    const me = await meRes.json();
    expect(me.trips).toEqual([
      expect.objectContaining({ id: body.trip.id, memberCount: 1 }),
    ]);
  });

  it('rejects an unknown base currency with 400', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/trips', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nope', baseCurrency: 'ZZZ' }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('GET /api/trips/:id returns the trip with members for a member', async () => {
    current = await bootTestApp();
    const { app } = current;

    const createRes = await app.request('/api/trips', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Trip A', baseCurrency: 'USD' }),
    });
    const { trip } = await createRes.json();

    const res = await app.request(`/api/trips/${trip.id}`, {
      headers: { Authorization: authHeaderFor(1) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Trip A');
    expect(body.members).toEqual([expect.objectContaining({ id: 1 })]);
    expect(body.expenses).toEqual([]);
  });

  it('GET /api/trips/:id for an unknown trip id returns 404 trip_not_found', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/trips/does-not-exist', {
      headers: { Authorization: authHeaderFor(1) },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('trip_not_found');
  });

  it('GET and PATCH /api/trips/:id return 403 forbidden for a non-member', async () => {
    current = await bootTestApp();
    const { app } = current;

    const createRes = await app.request('/api/trips', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Owner-only trip', baseCurrency: 'USD' }),
    });
    const { trip } = await createRes.json();

    const getRes = await app.request(`/api/trips/${trip.id}`, {
      headers: { Authorization: authHeaderFor(2) },
    });
    expect(getRes.status).toBe(403);
    expect((await getRes.json()).code).toBe('forbidden');

    const patchRes = await app.request(`/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(2), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    expect(patchRes.status).toBe(403);
    expect((await patchRes.json()).code).toBe('forbidden');
  });

  it('POST /api/trips/join adds a second user as a member (idempotent on repeat)', async () => {
    current = await bootTestApp();
    const { app } = current;

    const createRes = await app.request('/api/trips', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Shared trip', baseCurrency: 'EUR' }),
    });
    const { trip } = await createRes.json();

    const joinRes = await app.request('/api/trips/join', {
      method: 'POST',
      headers: {
        Authorization: authHeaderFor(2, 'Anna'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inviteCode: trip.inviteCode }),
    });
    expect(joinRes.status).toBe(200);
    const joined = await joinRes.json();
    expect(joined.members).toHaveLength(2);
    expect(joined.members.map((m: { id: number }) => m.id).sort()).toEqual([1, 2]);

    // The now-member (user 2) can GET it directly, and sees both members.
    const getRes = await app.request(`/api/trips/${trip.id}`, {
      headers: { Authorization: authHeaderFor(2) },
    });
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).members).toHaveLength(2);

    // Joining again (already a member) is idempotent — no duplicate, no error.
    const rejoinRes = await app.request('/api/trips/join', {
      method: 'POST',
      headers: {
        Authorization: authHeaderFor(2, 'Anna'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inviteCode: trip.inviteCode }),
    });
    expect(rejoinRes.status).toBe(200);
    expect((await rejoinRes.json()).members).toHaveLength(2);
  });

  it('POST /api/trips/join with an unknown invite code returns 404 trip_not_found', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/trips/join', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: 'this-code-does-not-exist' }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('trip_not_found');
  });

  it('PATCH /api/trips/:id renames the trip for a member', async () => {
    current = await bootTestApp();
    const { app } = current;

    const createRes = await app.request('/api/trips', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Old title', baseCurrency: 'USD' }),
    });
    const { trip } = await createRes.json();

    const res = await app.request(`/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New title' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe('New title');
  });

  it('PATCH base currency succeeds while the trip has no expenses, and is locked once one exists', async () => {
    current = await bootTestApp();
    const { app, db, schema } = current;

    const createRes = await app.request('/api/trips', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Currency trip', baseCurrency: 'USD' }),
    });
    const { trip } = await createRes.json();

    // No expenses yet — the change is allowed.
    const okRes = await app.request(`/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseCurrency: 'EUR' }),
    });
    expect(okRes.status).toBe(200);
    expect((await okRes.json()).baseCurrency).toBe('EUR');

    // Insert an expense row directly (the expenses API itself is Phase 4 —
    // this is the only way to exercise the guard ahead of that shipping).
    const now = new Date().toISOString();
    db.insert(schema.expenses)
      .values({
        id: 'exp1',
        tripId: trip.id,
        type: 'expense',
        payerId: 1,
        amountMinor: 1000,
        currency: 'EUR',
        rateToBase: 1,
        rateOverridden: 0,
        amountBaseMinor: 1000,
        splitMode: 'equal',
        spentOn: '2026-07-01',
        createdBy: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const lockedRes = await app.request(`/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseCurrency: 'THB' }),
    });
    expect(lockedRes.status).toBe(409);
    expect((await lockedRes.json()).code).toBe('base_currency_locked');

    // Renaming (no currency change) still works once expenses exist.
    const renameRes = await app.request(`/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Still renamable' }),
    });
    expect(renameRes.status).toBe(200);
    expect((await renameRes.json()).title).toBe('Still renamable');
  });
});

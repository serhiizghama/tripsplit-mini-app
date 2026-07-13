/**
 * Trip lifecycle tests — Trip Wrap plan (`docs/TRIP_WRAP_PLAN.md`) task W2:
 * `POST /:id/close`, `POST /:id/reopen`, `GET /:id/wrap`, and the
 * archived-mutation guard (`requireActiveTrip`, `lib/trips.ts`) on expense
 * create/update/delete + settlement create. Same `bootTestApp()` +
 * signed-fixture pattern as `export.test.ts`/`notify.test.ts`; telegram-side
 * assertions reuse `notify.test.ts`'s `vi.waitFor` polling since `/close`
 * fires the farewell card with `void` (fire-and-forget), same as every
 * `notify*` route call site.
 */
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

function authHeaderFor(
  userId: number,
  firstName = 'Test',
  languageCode?: string,
): string {
  const initDataRaw = sign(
    {
      user: {
        id: userId,
        first_name: firstName,
        ...(languageCode ? { language_code: languageCode } : {}),
      },
    },
    TEST_BOT_TOKEN,
    new Date(),
  );
  return `tma ${initDataRaw}`;
}

interface CreatedTrip {
  id: string;
  title: string;
  baseCurrency: string;
  inviteCode: string;
}

async function createTrip(
  app: TestApp['app'],
  ownerId: number,
  title: string,
  baseCurrency = 'USD',
): Promise<CreatedTrip> {
  const res = await app.request('/api/trips', {
    method: 'POST',
    headers: {
      Authorization: authHeaderFor(ownerId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, baseCurrency }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.trip as CreatedTrip;
}

async function joinTrip(
  app: TestApp['app'],
  userId: number,
  firstName: string,
  inviteCode: string,
): Promise<void> {
  const res = await app.request('/api/trips/join', {
    method: 'POST',
    headers: {
      Authorization: authHeaderFor(userId, firstName),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inviteCode }),
  });
  expect(res.status).toBe(200);
}

async function postExpense(
  app: TestApp['app'],
  tripId: string,
  userId: number,
  body: Record<string, unknown>,
) {
  return app.request(`/api/trips/${tripId}/expenses`, {
    method: 'POST',
    headers: {
      Authorization: authHeaderFor(userId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function postSettlement(
  app: TestApp['app'],
  tripId: string,
  userId: number,
  body: Record<string, unknown>,
) {
  return app.request(`/api/trips/${tripId}/settlements`, {
    method: 'POST',
    headers: {
      Authorization: authHeaderFor(userId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function closeTrip(
  app: TestApp['app'],
  tripId: string,
  userId: number,
  firstName = 'Test',
) {
  return app.request(`/api/trips/${tripId}/close`, {
    method: 'POST',
    headers: { Authorization: authHeaderFor(userId, firstName) },
  });
}

function reopenTrip(app: TestApp['app'], tripId: string, userId: number) {
  return app.request(`/api/trips/${tripId}/reopen`, {
    method: 'POST',
    headers: { Authorization: authHeaderFor(userId) },
  });
}

function getWrap(app: TestApp['app'], tripId: string, userId: number) {
  return app.request(`/api/trips/${tripId}/wrap`, {
    headers: { Authorization: authHeaderFor(userId) },
  });
}

interface SentCall {
  chatId: number;
  text: string;
}

/** Stubs `fetch` to always answer Telegram calls with `{ ok: true }` and records every `sendMessage` call. */
function stubTelegramFetch(): SentCall[] {
  const calls: SentCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.push({ chatId: body.chat_id, text: body.text });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }),
  );
  return calls;
}

/** Stubs `fetch` to always fail the Telegram call (simulates an outage/kicked bot). */
function stubFailingTelegramFetch(): SentCall[] {
  const calls: SentCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.push({ chatId: body.chat_id, text: body.text });
      return new Response(JSON.stringify({ ok: false, error_code: 500 }), {
        status: 500,
      });
    }),
  );
  return calls;
}

describe('POST /api/trips/:id/close', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('closes an active trip: 200 with the wrap payload, archivedAt set in the trip detail', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    stubTelegramFetch();

    const res = await closeTrip(app, trip.id, 1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tripId).toBe(trip.id);
    expect(body.title).toBe('Bali');
    expect(body.archivedAt).toEqual(expect.any(String));

    const detailRes = await app.request(`/api/trips/${trip.id}`, {
      headers: { Authorization: authHeaderFor(1) },
    });
    expect((await detailRes.json()).archivedAt).toEqual(expect.any(String));
  });

  it('closing an already-closed trip returns 409 trip_archived', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    stubTelegramFetch();

    expect((await closeTrip(app, trip.id, 1)).status).toBe(200);
    const second = await closeTrip(app, trip.id, 1);
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe('trip_archived');
  });

  it('with a linked chat: fires the farewell card containing the trip title', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    const calls = stubTelegramFetch();
    const res = await closeTrip(app, trip.id, 1);
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].chatId).toBe(-100);
    expect(calls[0].text).toContain('Bali');
    expect(calls[0].text).toContain('finished');
  });

  it('without a linked chat: no telegram call, still 200', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    const calls = stubTelegramFetch();

    const res = await closeTrip(app, trip.id, 1);
    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  it('a telegram outage never fails the close — still returns 200', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    stubFailingTelegramFetch();
    const res = await closeTrip(app, trip.id, 1);
    expect(res.status).toBe(200);
  });

  it('non-member gets 403 forbidden', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');

    const res = await closeTrip(app, trip.id, 2);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });
});

describe('POST /api/trips/:id/reopen', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('reopens a closed trip: archivedAt clears back to null', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    stubTelegramFetch();
    await closeTrip(app, trip.id, 1);

    const res = await reopenTrip(app, trip.id, 1);
    expect(res.status).toBe(200);
    expect((await res.json()).archivedAt).toBeNull();

    const detailRes = await app.request(`/api/trips/${trip.id}`, {
      headers: { Authorization: authHeaderFor(1) },
    });
    expect((await detailRes.json()).archivedAt).toBeNull();
  });

  it('reopening an active trip returns 409 trip_not_archived', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');

    const res = await reopenTrip(app, trip.id, 1);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('trip_not_archived');
  });

  it('non-member gets 403 forbidden', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    stubTelegramFetch();
    await closeTrip(app, trip.id, 1);

    const res = await reopenTrip(app, trip.id, 2);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });
});

describe('GET /api/trips/:id/wrap', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('active trip: 200 with correct totals (available as a live preview, no close required)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    await postExpense(app, trip.id, 1, {
      amountMinor: 5000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      shares: [{ userId: 1 }],
    });

    const res = await getWrap(app, trip.id, 1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archivedAt).toBeNull();
    expect(body.totalBaseMinor).toBe(5000);
    expect(body.expenseCount).toBe(1);
  });

  it('archived trip: still 200 with the same totals', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    await postExpense(app, trip.id, 1, {
      amountMinor: 5000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      shares: [{ userId: 1 }],
    });
    stubTelegramFetch();
    await closeTrip(app, trip.id, 1);

    const res = await getWrap(app, trip.id, 1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archivedAt).toEqual(expect.any(String));
    expect(body.totalBaseMinor).toBe(5000);
  });

  it('non-member gets 403 forbidden', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');

    const res = await getWrap(app, trip.id, 2);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });
});

describe('archived-trip mutation guard', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('expense create/update/delete + settlement create all 409 trip_archived on a closed trip; work again after reopen', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    const createdRes = await postExpense(app, trip.id, 1, {
      amountMinor: 1000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      shares: [{ userId: 1 }],
      description: 'Snacks',
    });
    expect(createdRes.status).toBe(201);
    const expense = await createdRes.json();

    stubTelegramFetch();
    expect((await closeTrip(app, trip.id, 1)).status).toBe(200);

    const blockedCreate = await postExpense(app, trip.id, 1, {
      amountMinor: 500,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      shares: [{ userId: 1 }],
    });
    expect(blockedCreate.status).toBe(409);
    expect((await blockedCreate.json()).code).toBe('trip_archived');

    const blockedUpdate = await app.request(`/api/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Edited' }),
    });
    expect(blockedUpdate.status).toBe(409);
    expect((await blockedUpdate.json()).code).toBe('trip_archived');

    const blockedDelete = await app.request(`/api/expenses/${expense.id}`, {
      method: 'DELETE',
      headers: { Authorization: authHeaderFor(1) },
    });
    expect(blockedDelete.status).toBe(409);
    expect((await blockedDelete.json()).code).toBe('trip_archived');

    const blockedSettlement = await postSettlement(app, trip.id, 1, {
      payerId: 1,
      receiverId: 2,
      amountMinor: 200,
      currency: 'USD',
    });
    expect(blockedSettlement.status).toBe(409);
    expect((await blockedSettlement.json()).code).toBe('trip_archived');

    expect((await reopenTrip(app, trip.id, 1)).status).toBe(200);

    const reopenedCreate = await postExpense(app, trip.id, 1, {
      amountMinor: 500,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      shares: [{ userId: 1 }],
    });
    expect(reopenedCreate.status).toBe(201);

    const reopenedUpdate = await app.request(`/api/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Edited' }),
    });
    expect(reopenedUpdate.status).toBe(200);

    const reopenedSettlement = await postSettlement(app, trip.id, 1, {
      payerId: 1,
      receiverId: 2,
      amountMinor: 200,
      currency: 'USD',
    });
    expect(reopenedSettlement.status).toBe(201);

    const reopenedDelete = await app.request(`/api/expenses/${expense.id}`, {
      method: 'DELETE',
      headers: { Authorization: authHeaderFor(1) },
    });
    expect(reopenedDelete.status).toBe(204);
  });

  it('renaming an archived trip (PATCH /:id) is still allowed', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    stubTelegramFetch();
    await closeTrip(app, trip.id, 1);

    const res = await app.request(`/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bali (archived)' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe('Bali (archived)');
  });
});

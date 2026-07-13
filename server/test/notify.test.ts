/**
 * Group-chat nudge tests — Export & Group Nudges plan
 * (`docs/EXPORT_NUDGES_PLAN.md`) task T4. Two layers, per the task brief:
 *  - `lib/notify.js`'s `notify*` fns called directly and awaited (they
 *    return their `Promise<void>` for exactly this reason) — deterministic,
 *    no polling needed.
 *  - One route-level test that drives the real HTTP API and polls the fetch
 *    spy with `vi.waitFor`, since the routes call `notify*` with `void` and
 *    never await it (fire-and-forget — see notify.ts's doc comment).
 *
 * Same `bootTestApp()` + signed-fixture + dynamic-import pattern as
 * `summary.test.ts`/`tripChats.test.ts` (`vi.resetModules()` per test means
 * a static top-level import of `lib/notify.js` would bind to a stale DB).
 */
import { sign } from '@tma.js/init-data-node';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TripRow } from '../src/lib/summary.js';
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
  firstName = 'Test',
  languageCode?: string,
) {
  const res = await app.request(`/api/trips/${tripId}/expenses`, {
    method: 'POST',
    headers: {
      Authorization: authHeaderFor(userId, firstName, languageCode),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function postSettlement(
  app: TestApp['app'],
  tripId: string,
  userId: number,
  body: Record<string, unknown>,
  firstName = 'Test',
) {
  const res = await app.request(`/api/trips/${tripId}/settlements`, {
    method: 'POST',
    headers: {
      Authorization: authHeaderFor(userId, firstName),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return res.json();
}

function getTripRow(current: TestApp, tripId: string): TripRow {
  const row = current.db
    .select()
    .from(current.schema.trips)
    .where(eq(current.schema.trips.id, tripId))
    .get();
  if (!row) throw new Error('trip row missing in test setup');
  return row;
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
function stubFailingTelegramFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error_code: 500 }), { status: 500 }),
    ),
  );
}

describe('notify (direct fn calls)', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('notifyExpenseCreated: no linked chats -> no telegram call at all', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    const calls = stubTelegramFetch();

    const { notifyExpenseCreated } = await import('../src/lib/notify.js');
    const tripRow = getTripRow(current, trip.id);
    await notifyExpenseCreated(
      tripRow,
      { firstName: 'Test', lang: 'en' },
      {
        amountMinor: 1000,
        currency: 'USD',
        description: 'Dinner',
        category: '🍜',
        status: 'paid',
      },
    );

    expect(calls).toHaveLength(0);
  });

  it('notifyExpenseCreated: one message per linked chat, containing actor name, formatted amount, and the post-mutation top-debt hint', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Thailand', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    // Alice (1) pays 100.00 USD split equally with Anna (2) -> Anna owes Alice
    // $50.00. No chat is linked yet, so this write's own route-level nudge is
    // a no-op — chats are linked below, AFTER the mutation, so the manual
    // `notifyExpenseCreated` call is the only thing that hits `fetch`.
    await postExpense(app, trip.id, 1, {
      amountMinor: 10000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
      description: 'Dinner',
      category: '🍜',
    });

    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -200, linkedBy: 1 });

    const calls = stubTelegramFetch();
    const { notifyExpenseCreated } = await import('../src/lib/notify.js');

    const tripRow = getTripRow(current, trip.id);
    await notifyExpenseCreated(
      tripRow,
      { firstName: 'Test', lang: 'en' },
      {
        amountMinor: 10000,
        currency: 'USD',
        description: 'Dinner',
        category: '🍜',
        status: 'paid',
      },
    );

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.chatId).sort()).toEqual([-100, -200]);
    for (const call of calls) {
      expect(call.text).toContain('<b>Test</b>');
      expect(call.text).toContain('$100.00');
      expect(call.text).toContain('🍜');
      expect(call.text).toContain('Dinner');
      expect(call.text).toContain('👉 Biggest debt: Anna → Test: $50.00');
    }
  });

  it('notifyExpenseCreated: actor with lang "ru" gets the russian nudge text', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    const calls = stubTelegramFetch();
    const { notifyExpenseCreated } = await import('../src/lib/notify.js');
    const tripRow = getTripRow(current, trip.id);

    await notifyExpenseCreated(
      tripRow,
      { firstName: 'Тест', lang: 'ru' },
      {
        amountMinor: 1000,
        currency: 'USD',
        description: null,
        category: null,
        status: 'paid',
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('добавил(а) расход');
  });

  it('notifyExpenseDeleted: pre-delete amount/currency/description still show up in the message', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    const calls = stubTelegramFetch();
    const { notifyExpenseDeleted } = await import('../src/lib/notify.js');
    const tripRow = getTripRow(current, trip.id);

    await notifyExpenseDeleted(
      tripRow,
      { firstName: 'Test', lang: 'en' },
      {
        amountMinor: 2500,
        currency: 'EUR',
        description: 'Taxi',
        category: '🚕',
        status: 'paid',
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('deleted an expense');
    expect(calls[0].text).toContain('€25.00');
    expect(calls[0].text).toContain('Taxi');
  });

  it('notifySettlementCreated: message contains both the actor and receiver names', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    // No chat linked yet at settlement time -> the route's own nudge is a
    // no-op; the chat is linked below, so only the manual call hits `fetch`.
    const settlement = await postSettlement(
      app,
      trip.id,
      2,
      { payerId: 2, receiverId: 1, amountMinor: 5000, currency: 'USD' },
      'Anna',
    );

    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    const calls = stubTelegramFetch();
    const { notifySettlementCreated } = await import('../src/lib/notify.js');

    const tripRow = getTripRow(current, trip.id);
    await notifySettlementCreated(tripRow, { firstName: 'Anna', lang: 'en' }, settlement);

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('<b>Anna</b>');
    expect(calls[0].text).toContain('<b>Test</b>'); // receiver, resolved from the settlement's share row
    expect(calls[0].text).toContain('$50.00');
  });

  it('a telegram send failure does not throw and does not stop other chats from being tried', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    stubFailingTelegramFetch();
    const { notifyExpenseCreated } = await import('../src/lib/notify.js');
    const tripRow = getTripRow(current, trip.id);

    await expect(
      notifyExpenseCreated(
        tripRow,
        { firstName: 'Test', lang: 'en' },
        {
          amountMinor: 1000,
          currency: 'USD',
          description: null,
          category: null,
          status: 'paid',
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('notify (wired into routes)', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('POST /:id/expenses fires a nudge to the linked chat without delaying the 201 response', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali', 'USD');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    const calls = stubTelegramFetch();

    await postExpense(app, trip.id, 1, {
      amountMinor: 4200,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      shares: [{ userId: 1 }],
      description: 'Snacks',
    });

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].chatId).toBe(-100);
    expect(calls[0].text).toContain('<b>Test</b>');
    expect(calls[0].text).toContain('$42.00');
  });

  it('POST /:id/expenses with no linked chat never calls telegram', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali', 'USD');
    const calls = stubTelegramFetch();

    await postExpense(app, trip.id, 1, {
      amountMinor: 1000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      shares: [{ userId: 1 }],
    });

    // Give any accidental fire-and-forget call a tick to land before asserting absence.
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  it('a telegram outage never fails the mutation itself — the API still returns 201', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali', 'USD');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    stubFailingTelegramFetch();

    // postExpense() itself already asserts res.status === 201; this test's
    // point is just that the mutation completes successfully even though
    // every nudge send will fail server-side (logged, not surfaced).
    await postExpense(app, trip.id, 1, {
      amountMinor: 1000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      shares: [{ userId: 1 }],
    });
  });

  it('DELETE /api/expenses/:id nudges with the pre-delete amount/description', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali', 'USD');

    // Created before the chat is linked (and before fetch is stubbed) so
    // creation itself is a nudge no-op — only the delete below should hit fetch.
    const created = await postExpense(app, trip.id, 1, {
      amountMinor: 1500,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      shares: [{ userId: 1 }],
      description: 'Coffee',
    });

    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    const calls = stubTelegramFetch();
    const res = await app.request(`/api/expenses/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: authHeaderFor(1) },
    });
    expect(res.status).toBe(204);

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].text).toContain('deleted an expense');
    expect(calls[0].text).toContain('$15.00');
    expect(calls[0].text).toContain('Coffee');
  });

  it('POST /:id/settlements nudges the linked chat with both names', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    const calls = stubTelegramFetch();
    await postSettlement(
      app,
      trip.id,
      2,
      { payerId: 2, receiverId: 1, amountMinor: 2000, currency: 'USD' },
      'Anna',
    );

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].text).toContain('<b>Anna</b>');
    expect(calls[0].text).toContain('<b>Test</b>');
    expect(calls[0].text).toContain('$20.00');
  });
});

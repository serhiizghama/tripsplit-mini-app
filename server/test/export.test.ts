/**
 * `POST /api/trips/:id/export` + trip detail `linkedChats` tests — Export &
 * Group Nudges plan (`docs/EXPORT_NUDGES_PLAN.md`) task T5. Same
 * `bootTestApp()` + signed-fixture + `stubTelegramFetch` pattern as
 * `notify.test.ts`; unlike nudges this route awaits the send, so no
 * `vi.waitFor` polling is needed — the response itself reflects the outcome.
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

async function exportTrip(
  app: TestApp['app'],
  tripId: string,
  userId: number,
  firstName = 'Test',
  languageCode?: string,
) {
  return app.request(`/api/trips/${tripId}/export`, {
    method: 'POST',
    headers: { Authorization: authHeaderFor(userId, firstName, languageCode) },
  });
}

async function shareWrap(
  app: TestApp['app'],
  tripId: string,
  userId: number,
  firstName = 'Test',
  languageCode?: string,
) {
  return app.request(`/api/trips/${tripId}/wrap/share`, {
    method: 'POST',
    headers: { Authorization: authHeaderFor(userId, firstName, languageCode) },
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

/** Fails sends to any chat id in `failChatIds`, succeeds otherwise. */
function stubPartialTelegramFetch(failChatIds: Set<number>): SentCall[] {
  const calls: SentCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.push({ chatId: body.chat_id, text: body.text });
      if (failChatIds.has(body.chat_id)) {
        return new Response(JSON.stringify({ ok: false, error_code: 500 }), {
          status: 500,
        });
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }),
  );
  return calls;
}

describe('POST /api/trips/:id/export', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('with a linked chat: posts to the group chat and responds delivered: group', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    const calls = stubTelegramFetch();
    const res = await exportTrip(app, trip.id, 1);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delivered: 'group' });
    expect(calls).toHaveLength(1);
    expect(calls[0].chatId).toBe(-100);
    expect(calls[0].text).toContain('Bali');
  });

  it('with multiple linked chats: sends to every one of them', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -200, linkedBy: 1 });

    const calls = stubTelegramFetch();
    const res = await exportTrip(app, trip.id, 1);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delivered: 'group' });
    expect(calls.map((c) => c.chatId).sort()).toEqual([-100, -200]);
  });

  it('without a linked chat: DMs the requesting user and responds delivered: dm', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');

    const calls = stubTelegramFetch();
    const res = await exportTrip(app, trip.id, 1);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delivered: 'dm' });
    expect(calls).toHaveLength(1);
    expect(calls[0].chatId).toBe(1); // DM = the requesting user's own chat id
  });

  it('when every linked-chat send fails, falls back to a DM', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    const calls = stubPartialTelegramFetch(new Set([-100]));
    const res = await exportTrip(app, trip.id, 1);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delivered: 'dm' });
    expect(calls.map((c) => c.chatId)).toEqual([-100, 1]);
  });

  it('when the DM also fails, responds with export_failed', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');

    stubFailingTelegramFetch();
    const res = await exportTrip(app, trip.id, 1);

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'export_failed' });
  });

  it('non-member gets 403 forbidden, and no telegram call is made', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');

    const calls = stubTelegramFetch();
    const res = await exportTrip(app, trip.id, 2);

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
    expect(calls).toHaveLength(0);
  });

  it('unknown trip id gets 404 trip_not_found', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await exportTrip(app, 'does-not-exist', 1);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('trip_not_found');
  });

  it('sends the localized summary — trip title shows up in the requester’s language', async () => {
    current = await bootTestApp();
    const { app } = current;
    // `lang` is only ever set from `language_code` on a user's first-seen
    // request (see auth.ts's `upsertUserFromTelegram` doc comment), so the
    // 'ru' code must ride along on the very first request for this user.
    const createRes = await app.request('/api/trips', {
      method: 'POST',
      headers: {
        Authorization: authHeaderFor(1, 'Test', 'ru'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Отпуск', baseCurrency: 'USD' }),
    });
    const { trip } = await createRes.json();

    const calls = stubTelegramFetch();
    const res = await exportTrip(app, trip.id, 1, 'Test', 'ru');

    expect(res.status).toBe(200);
    expect(calls[0].text).toContain('Отпуск');
    expect(calls[0].text).toContain('итоги'); // ru summaryHeader, see botMessages.ts
  });
});

describe('POST /api/trips/:id/wrap/share', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('with a linked chat: posts the farewell card to the group chat and responds delivered: group', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, linkedBy: 1 });

    const calls = stubTelegramFetch();
    const res = await shareWrap(app, trip.id, 1);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delivered: 'group' });
    expect(calls).toHaveLength(1);
    expect(calls[0].chatId).toBe(-100);
    expect(calls[0].text).toContain('Bali');
  });

  it('without a linked chat: DMs the requesting user and responds delivered: dm', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');

    const calls = stubTelegramFetch();
    const res = await shareWrap(app, trip.id, 1);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delivered: 'dm' });
    expect(calls).toHaveLength(1);
    expect(calls[0].chatId).toBe(1); // DM = the requesting user's own chat id
  });

  it('when every send fails, responds with export_failed', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');

    stubFailingTelegramFetch();
    const res = await shareWrap(app, trip.id, 1);

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'export_failed' });
  });
});

describe('GET /api/trips/:id linkedChats', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('is empty before any chat is linked', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');

    const res = await app.request(`/api/trips/${trip.id}`, {
      headers: { Authorization: authHeaderFor(1) },
    });
    expect((await res.json()).linkedChats).toEqual([]);
  });

  it('lists a linked chat’s id and title after /link', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({
      inviteCode: trip.inviteCode,
      chatId: -100,
      chatTitle: 'Bali crew',
      linkedBy: 1,
    });

    const res = await app.request(`/api/trips/${trip.id}`, {
      headers: { Authorization: authHeaderFor(1) },
    });
    expect((await res.json()).linkedChats).toEqual([
      { chatId: -100, title: 'Bali crew' },
    ]);
  });
});

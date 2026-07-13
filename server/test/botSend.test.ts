/**
 * `sendBotMessage` tests — Export & Group Nudges plan
 * (`docs/EXPORT_NUDGES_PLAN.md`) task T3. Same `global.fetch` mocking pattern
 * as `rates.test.ts` (`vi.stubGlobal('fetch', ...)`, `vi.unstubAllGlobals()`
 * in `afterEach`) — no real network.
 */
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

function authHeaderFor(userId: number, firstName = 'Test'): string {
  const initDataRaw = sign(
    { user: { id: userId, first_name: firstName } },
    TEST_BOT_TOKEN,
    new Date(),
  );
  return `tma ${initDataRaw}`;
}

async function createTrip(app: TestApp['app'], ownerId: number, title: string): Promise<{ inviteCode: string }> {
  const res = await app.request('/api/trips', {
    method: 'POST',
    headers: { Authorization: authHeaderFor(ownerId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, baseCurrency: 'USD' }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.trip as { inviteCode: string };
}

describe('sendBotMessage', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('posts sendMessage with HTML parse_mode and disabled link previews, returns true on success', async () => {
    current = await bootTestApp();

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(`https://api.telegram.org/bot${TEST_BOT_TOKEN}/sendMessage`);
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        chat_id: -100,
        text: '<b>hi</b>',
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { sendBotMessage } = await import('../src/lib/botSend.js');
    await expect(sendBotMessage(TEST_BOT_TOKEN, -100, '<b>hi</b>')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('auto-unlinks the chat and returns false on a 403 (bot kicked)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip');
    const { linkTripChat, getTripsForChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -200, linkedBy: 1 });
    expect(getTripsForChat(-200)).toHaveLength(1);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error_code: 403,
              description: 'Forbidden: bot was kicked from the group chat',
            }),
            { status: 403 },
          ),
      ),
    );

    const { sendBotMessage } = await import('../src/lib/botSend.js');
    await expect(sendBotMessage(TEST_BOT_TOKEN, -200, 'hi')).resolves.toBe(false);
    expect(getTripsForChat(-200)).toHaveLength(0);
  });

  it('auto-unlinks the chat and returns false on a 400 "chat not found"', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip');
    const { linkTripChat, getTripsForChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -300, linkedBy: 1 });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }),
            { status: 400 },
          ),
      ),
    );

    const { sendBotMessage } = await import('../src/lib/botSend.js');
    await expect(sendBotMessage(TEST_BOT_TOKEN, -300, 'hi')).resolves.toBe(false);
    expect(getTripsForChat(-300)).toHaveLength(0);
  });

  it('returns false and keeps the binding on a transient 500', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip');
    const { linkTripChat, getTripsForChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -400, linkedBy: 1 });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: false, error_code: 500, description: 'Internal Server Error' }),
            { status: 500 },
          ),
      ),
    );

    const { sendBotMessage } = await import('../src/lib/botSend.js');
    await expect(sendBotMessage(TEST_BOT_TOKEN, -400, 'hi')).resolves.toBe(false);
    expect(getTripsForChat(-400)).toHaveLength(1);
  });

  it('never throws and returns false when fetch itself rejects', async () => {
    current = await bootTestApp();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const { sendBotMessage } = await import('../src/lib/botSend.js');
    await expect(sendBotMessage(TEST_BOT_TOKEN, -1, 'hi')).resolves.toBe(false);
  });
});

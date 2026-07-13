/**
 * `handleUpdate` command-parsing tests — Export & Group Nudges plan
 * (`docs/EXPORT_NUDGES_PLAN.md`) task T3. Drives `handleUpdate` directly
 * (never the long-polling loop) with hand-built update objects, mocking
 * `global.fetch` the same way `botSend.test.ts`/`rates.test.ts` do so no real
 * Telegram call happens; assertions read back what `sendBotMessage` posted.
 */
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { botMessages } from '../src/lib/botMessages.js';
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

async function createTrip(
  app: TestApp['app'],
  ownerId: number,
  title: string,
): Promise<{ inviteCode: string }> {
  const res = await app.request('/api/trips', {
    method: 'POST',
    headers: {
      Authorization: authHeaderFor(ownerId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, baseCurrency: 'USD' }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.trip as { inviteCode: string };
}

/** Registers a `users` row without joining a trip — used to give a sender a stored `lang`. */
async function ensureUser(
  app: TestApp['app'],
  userId: number,
  firstName: string,
  languageCode: string,
): Promise<void> {
  const res = await app.request('/api/me', {
    headers: { Authorization: authHeaderFor(userId, firstName, languageCode) },
  });
  expect(res.status).toBe(200);
}

interface SentCall {
  url: string;
  body: { chat_id: number; text: string; parse_mode?: string };
}

/** Stubs `fetch` to always answer Telegram calls with `{ ok: true }` and records every call. */
function stubTelegramFetch(): SentCall[] {
  const calls: SentCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }),
  );
  return calls;
}

function makeUpdate(opts: {
  chatId: number;
  chatType?: string;
  chatTitle?: string;
  fromId?: number;
  languageCode?: string;
  text: string;
}) {
  return {
    update_id: 1,
    message: {
      chat: { id: opts.chatId, type: opts.chatType ?? 'group', title: opts.chatTitle },
      from:
        opts.fromId === undefined
          ? undefined
          : { id: opts.fromId, language_code: opts.languageCode },
      text: opts.text,
    },
  };
}

describe('handleUpdate', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('/link@BotName <code> links the chat and replies with linkSuccess', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali Trip');
    const calls = stubTelegramFetch();

    const { handleUpdate } = await import('../src/bot.js');
    await handleUpdate(
      TEST_BOT_TOKEN,
      makeUpdate({
        chatId: -500,
        chatTitle: 'Bali Group',
        fromId: 1,
        text: `/link@TripSplitBot ${trip.inviteCode}`,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].body.chat_id).toBe(-500);
    expect(calls[0].body.text).toBe(botMessages.en.linkSuccess('Bali Trip'));

    const { getTripsForChat } = await import('../src/lib/tripChats.js');
    const trips = getTripsForChat(-500);
    expect(trips).toHaveLength(1);
    expect(trips[0].title).toBe('Bali Trip');
  });

  it('/link with an unknown code replies linkUnknownCode and links nothing', async () => {
    current = await bootTestApp();
    const { app } = current;
    await createTrip(app, 1, 'Bali Trip');
    const calls = stubTelegramFetch();

    const { handleUpdate } = await import('../src/bot.js');
    await handleUpdate(
      TEST_BOT_TOKEN,
      makeUpdate({ chatId: -501, fromId: 1, text: '/link nope-not-a-code' }),
    );

    expect(calls[0].body.text).toBe(botMessages.en.linkUnknownCode());
    const { getTripsForChat } = await import('../src/lib/tripChats.js');
    expect(getTripsForChat(-501)).toHaveLength(0);
  });

  it('/summary posts a summary containing the trip title for every trip linked to the chat', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Thailand 2026');

    // Link first via a real /link command so the flow is end-to-end.
    const linkCalls = stubTelegramFetch();
    const { handleUpdate } = await import('../src/bot.js');
    await handleUpdate(
      TEST_BOT_TOKEN,
      makeUpdate({ chatId: -600, fromId: 1, text: `/link ${trip.inviteCode}` }),
    );
    expect(linkCalls).toHaveLength(1);

    const summaryCalls = stubTelegramFetch();
    await handleUpdate(
      TEST_BOT_TOKEN,
      makeUpdate({ chatId: -600, fromId: 1, text: '/summary' }),
    );

    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0].body.chat_id).toBe(-600);
    expect(summaryCalls[0].body.text).toContain('Thailand 2026');
    expect(summaryCalls[0].body.text).toContain('📊 <b>Thailand 2026</b> — summary');
  });

  it('/summary with nothing linked replies unlinkNothingLinked', async () => {
    current = await bootTestApp();
    const calls = stubTelegramFetch();

    const { handleUpdate } = await import('../src/bot.js');
    await handleUpdate(
      TEST_BOT_TOKEN,
      makeUpdate({ chatId: -601, fromId: 1, text: '/summary' }),
    );

    expect(calls[0].body.text).toBe(botMessages.en.unlinkNothingLinked());
  });

  it("uses the sender's stored lang for the reply: a ru sender gets the Russian usage hint", async () => {
    current = await bootTestApp();
    const { app } = current;
    await ensureUser(app, 7, 'Ivan', 'ru');
    const calls = stubTelegramFetch();

    const { handleUpdate } = await import('../src/bot.js');
    await handleUpdate(
      TEST_BOT_TOKEN,
      makeUpdate({ chatId: -700, fromId: 7, text: '/link' }),
    );

    expect(calls[0].body.text).toBe(botMessages.ru.linkUsageHint());
  });

  it('/unlink removes the binding and replies unlinkSuccess', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip');
    const { linkTripChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -800, linkedBy: 1 });

    const calls = stubTelegramFetch();
    const { handleUpdate } = await import('../src/bot.js');
    await handleUpdate(
      TEST_BOT_TOKEN,
      makeUpdate({ chatId: -800, fromId: 1, text: '/unlink' }),
    );

    expect(calls[0].body.text).toBe(botMessages.en.unlinkSuccess('Trip'));
    const { getTripsForChat } = await import('../src/lib/tripChats.js');
    expect(getTripsForChat(-800)).toHaveLength(0);
  });

  it('ignores non-command text and unknown commands without calling Telegram', async () => {
    current = await bootTestApp();
    const calls = stubTelegramFetch();

    const { handleUpdate } = await import('../src/bot.js');
    await handleUpdate(
      TEST_BOT_TOKEN,
      makeUpdate({ chatId: -900, fromId: 1, text: 'hello there' }),
    );
    await handleUpdate(
      TEST_BOT_TOKEN,
      makeUpdate({ chatId: -900, fromId: 1, text: '/notacommand' }),
    );

    expect(calls).toHaveLength(0);
  });
});

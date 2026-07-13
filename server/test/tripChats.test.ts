/**
 * `trip_chats` service tests — Export & Group Nudges plan
 * (`docs/EXPORT_NUDGES_PLAN.md`) task T3. Same `bootTestApp()` + signed-
 * fixture pattern as `summary.test.ts`; `lib/tripChats.js` is imported
 * dynamically INSIDE each test, after `bootTestApp()`, for the same reason
 * `summary.test.ts` does — `bootTestApp()` calls `vi.resetModules()` per
 * test, so a static top-level import would bind to a stale DB module graph.
 */
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it } from 'vitest';

import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

function authHeaderFor(userId: number, firstName = 'Test'): string {
  const initDataRaw = sign(
    { user: { id: userId, first_name: firstName } },
    TEST_BOT_TOKEN,
    new Date(),
  );
  return `tma ${initDataRaw}`;
}

interface CreatedTrip {
  id: string;
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

/** Registers a `users` row for `userId` without joining any trip (linkedBy only needs the FK to exist). */
async function ensureUser(app: TestApp['app'], userId: number, firstName = 'User'): Promise<void> {
  const res = await app.request('/api/me', { headers: { Authorization: authHeaderFor(userId, firstName) } });
  expect(res.status).toBe(200);
}

describe('tripChats service', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('linkTripChat: valid code binds the chat and getLinkedChats/getTripsForChat see it', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');

    const { linkTripChat, getLinkedChats, getTripsForChat } = await import('../src/lib/tripChats.js');

    const result = linkTripChat({
      inviteCode: trip.inviteCode,
      chatId: -100,
      chatTitle: 'Bali Group',
      linkedBy: 1,
    });
    expect(result?.trip.id).toBe(trip.id);

    const linked = getLinkedChats(trip.id);
    expect(linked).toHaveLength(1);
    expect(linked[0].chatId).toBe(-100);
    expect(linked[0].chatTitle).toBe('Bali Group');
    expect(linked[0].linkedBy).toBe(1);

    const trips = getTripsForChat(-100);
    expect(trips).toHaveLength(1);
    expect(trips[0].id).toBe(trip.id);
  });

  it('linkTripChat: unknown invite code returns undefined and creates no binding', async () => {
    current = await bootTestApp();
    const { app } = current;
    await createTrip(app, 1, 'Bali');

    const { linkTripChat, getTripsForChat } = await import('../src/lib/tripChats.js');
    expect(linkTripChat({ inviteCode: 'does-not-exist', chatId: -1, linkedBy: 1 })).toBeUndefined();
    expect(getTripsForChat(-1)).toHaveLength(0);
  });

  it('linkTripChat: re-linking the same (trip, chat) upserts chatTitle/linkedBy instead of duplicating', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Bali');
    await ensureUser(app, 2, 'Anna');

    const { linkTripChat, getLinkedChats } = await import('../src/lib/tripChats.js');

    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, chatTitle: 'Old Title', linkedBy: 1 });
    linkTripChat({ inviteCode: trip.inviteCode, chatId: -100, chatTitle: 'New Title', linkedBy: 2 });

    const linked = getLinkedChats(trip.id);
    expect(linked).toHaveLength(1); // upsert, not a second row
    expect(linked[0].chatTitle).toBe('New Title');
    expect(linked[0].linkedBy).toBe(2);
  });

  it('unlinkChat: removes every binding for a chat and returns the unlinked trip titles', async () => {
    current = await bootTestApp();
    const { app } = current;
    const tripA = await createTrip(app, 1, 'Trip A');
    const tripB = await createTrip(app, 1, 'Trip B');

    const { linkTripChat, unlinkChat, getTripsForChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: tripA.inviteCode, chatId: -100, linkedBy: 1 });
    linkTripChat({ inviteCode: tripB.inviteCode, chatId: -100, linkedBy: 1 });
    expect(getTripsForChat(-100)).toHaveLength(2);

    const { tripTitles } = unlinkChat(-100);
    expect([...tripTitles].sort()).toEqual(['Trip A', 'Trip B']);
    expect(getTripsForChat(-100)).toHaveLength(0);
  });

  it('unlinkChat: a chat with no bindings returns an empty list', async () => {
    current = await bootTestApp();
    const { unlinkChat } = await import('../src/lib/tripChats.js');
    expect(unlinkChat(-999).tripTitles).toEqual([]);
  });

  it('removeChatBinding: removes only the given (trip, chat) pair, leaving other trips linked to the same chat', async () => {
    current = await bootTestApp();
    const { app } = current;
    const tripA = await createTrip(app, 1, 'Trip A');
    const tripB = await createTrip(app, 1, 'Trip B');

    const { linkTripChat, removeChatBinding, getTripsForChat } = await import('../src/lib/tripChats.js');
    linkTripChat({ inviteCode: tripA.inviteCode, chatId: -100, linkedBy: 1 });
    linkTripChat({ inviteCode: tripB.inviteCode, chatId: -100, linkedBy: 1 });

    removeChatBinding(tripA.id, -100);

    const trips = getTripsForChat(-100);
    expect(trips).toHaveLength(1);
    expect(trips[0].id).toBe(tripB.id);
  });

  it('getTripsForChat: a chat with no bindings returns an empty array', async () => {
    current = await bootTestApp();
    const { getTripsForChat } = await import('../src/lib/tripChats.js');
    expect(getTripsForChat(-1)).toEqual([]);
  });
});

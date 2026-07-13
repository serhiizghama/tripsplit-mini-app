/**
 * Bot-message i18n + trip summary formatter tests — Export & Group Nudges
 * plan (`docs/EXPORT_NUDGES_PLAN.md`) task T2. Same `bootTestApp()` + signed-
 * fixture pattern as `balances.test.ts`; `buildTripSummaryMessage`/
 * `buildTopDebtHint` are exercised against a trip built through the real
 * HTTP API (not hand-built rows) so the test also proves the DB-reading glue
 * (`getTripMembers`/`getTripBalances`/`getTripInsights`) wires up correctly.
 *
 * `summary.js` is imported dynamically INSIDE each test, after
 * `bootTestApp()` — same reason `balances.test.ts` dynamically imports
 * `lib/balances.js`: `bootTestApp()` calls `vi.resetModules()` per test, so
 * a static top-level import would bind `summary.ts`'s own `db`/`schema`
 * imports to whichever module graph happened to load first, not the fresh
 * per-test DB `bootTestApp()` just set up.
 */
import { eq } from 'drizzle-orm';
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it } from 'vitest';

import { escapeHtml, resolveBotLocale } from '../src/lib/botMessages.js';
import type { TripRow } from '../src/lib/summary.js';
import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

/** `Intl.NumberFormat('ru'|'uk', ...)` separates the amount from the trailing `$` with a NBSP, not a plain space. */
const NBSP = ' ';

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
  baseCurrency: string;
  inviteCode: string;
}

async function createTrip(
  app: TestApp['app'],
  ownerId: number,
  title: string,
  baseCurrency: string,
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

// `firstName` matters here (unlike balances.test.ts): `upsertUserFromTelegram`
// (auth.ts) refreshes a user's stored `firstName` from EVERY authenticated
// request, so a call signed with the default 'Test' would silently rename a
// member who joined under a different name — callers must pass the same
// `firstName` used at join time for every subsequent request by that user.
async function postExpense(
  app: TestApp['app'],
  tripId: string,
  userId: number,
  body: Record<string, unknown>,
  firstName = 'Test',
) {
  const res = await app.request(`/api/trips/${tripId}/expenses`, {
    method: 'POST',
    headers: {
      Authorization: authHeaderFor(userId, firstName),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return res;
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
  return res;
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

describe('escapeHtml', () => {
  it('escapes &, <, > but leaves other characters untouched', () => {
    expect(escapeHtml('<b>evil</b> & "quoted" \'stuff\'')).toBe(
      '&lt;b&gt;evil&lt;/b&gt; &amp; "quoted" \'stuff\'',
    );
  });
});

describe('resolveBotLocale', () => {
  it('prefix-matches ru/uk and defaults to en for anything else, including undefined', () => {
    expect(resolveBotLocale('ru')).toBe('ru');
    expect(resolveBotLocale('ru-RU')).toBe('ru');
    expect(resolveBotLocale('RU')).toBe('ru');
    expect(resolveBotLocale('uk')).toBe('uk');
    expect(resolveBotLocale('uk-UA')).toBe('uk');
    expect(resolveBotLocale('en')).toBe('en');
    expect(resolveBotLocale('fr')).toBe('en');
    expect(resolveBotLocale(undefined)).toBe('en');
    expect(resolveBotLocale('')).toBe('en');
  });
});

describe('buildTripSummaryMessage / buildTopDebtHint', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('all-settled trip: no expenses at all -> allSettled empty state, zero total, no member lines with debt', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Solo Trip', 'USD');
    const tripRow = getTripRow(current, trip.id);
    const { buildTripSummaryMessage, buildTopDebtHint } =
      await import('../src/lib/summary.js');

    const message = buildTripSummaryMessage(tripRow, 'en');
    expect(message).toContain('Total spent: <b>$0.00</b>');
    expect(message).toContain("✅ Everyone's settled up — no transfers needed.");
    expect(message).not.toContain('Suggested transfers:');

    expect(buildTopDebtHint(tripRow, 'en')).toBeUndefined();
  });

  it('unsettled trip: totals, per-currency, per-member net, and suggested transfers all show up (en)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Thailand 2026', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    // Alice (1) pays 100.00 USD split equally -> Anna (2) owes Alice 50.00 USD.
    await postExpense(app, trip.id, 1, {
      amountMinor: 10000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
      description: 'Dinner',
      category: '🍜',
    });

    const tripRow = getTripRow(current, trip.id);
    const { buildTripSummaryMessage, buildTopDebtHint } =
      await import('../src/lib/summary.js');
    const message = buildTripSummaryMessage(tripRow, 'en');

    expect(message).toContain('📊 <b>Thailand 2026</b> — summary');
    expect(message).toContain('Total spent: <b>$100.00</b>');
    expect(message).toContain('Spend by currency:');
    expect(message).toContain('• $100.00');
    expect(message).toContain('Balances:');
    expect(message).toContain('• Test is owed $50.00'); // user 1's authHeaderFor default firstName is 'Test'
    expect(message).toContain('• Anna owes $50.00');
    expect(message).toContain('Suggested transfers:');
    expect(message).toContain('• Anna → Test: $50.00');

    const hint = buildTopDebtHint(tripRow, 'en');
    expect(hint).toBe('👉 Biggest debt: Anna → Test: $50.00');
  });

  it('fully settled after an exact settlement: per-member lines flip to settled, transfers empty', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    await postExpense(app, trip.id, 1, {
      amountMinor: 1000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
    });
    await postSettlement(
      app,
      trip.id,
      2,
      { payerId: 2, receiverId: 1, amountMinor: 500, currency: 'USD' },
      'Anna',
    );

    const tripRow = getTripRow(current, trip.id);
    const { buildTripSummaryMessage, buildTopDebtHint } =
      await import('../src/lib/summary.js');
    const message = buildTripSummaryMessage(tripRow, 'en');

    expect(message).toContain('• Test — settled up');
    expect(message).toContain('• Anna — settled up');
    expect(message).toContain("✅ Everyone's settled up — no transfers needed.");
    expect(buildTopDebtHint(tripRow, 'en')).toBeUndefined();
  });

  it('ru locale: gendered-bracket verbs and header copy render correctly', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Поездка', 'USD');
    await joinTrip(app, 2, 'Аня', trip.inviteCode);

    await postExpense(app, trip.id, 1, {
      amountMinor: 10000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
    });

    const tripRow = getTripRow(current, trip.id);
    const { buildTripSummaryMessage, buildTopDebtHint } =
      await import('../src/lib/summary.js');
    const message = buildTripSummaryMessage(tripRow, 'ru');

    expect(message).toContain('📊 «<b>Поездка</b>» — итоги');
    expect(message).toContain('Всего потрачено: <b>100,00 $</b>');
    expect(message).toContain('• Test получит');
    expect(message).toContain('• Аня должен(на)');
    expect(message).toContain('Кто кому переводит:');

    const hint = buildTopDebtHint(tripRow, 'ru');
    expect(hint).toContain('👉 Самый большой долг: Аня → Test');
  });

  it('uk locale: gendered-bracket verbs and header copy render correctly', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Подорож', 'USD');
    await joinTrip(app, 2, 'Аня', trip.inviteCode);

    await postExpense(app, trip.id, 1, {
      amountMinor: 10000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
    });

    const tripRow = getTripRow(current, trip.id);
    const { buildTripSummaryMessage, buildTopDebtHint } =
      await import('../src/lib/summary.js');
    const message = buildTripSummaryMessage(tripRow, 'uk');

    expect(message).toContain('📊 «<b>Подорож</b>» — підсумки');
    expect(message).toContain(`Всього витрачено: <b>100,00${NBSP}$</b>`);
    expect(message).toContain('• Test отримає');
    expect(message).toContain('• Аня винен(на)');
    expect(message).toContain('Хто кому переказує:');

    const hint = buildTopDebtHint(tripRow, 'uk');
    expect(hint).toContain('👉 Найбільший борг: Аня → Test');
  });

  it('escapes a malicious trip title and expense description/category so raw HTML never reaches parse_mode', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, '<b>Evil</b> & Co', 'USD');

    await postExpense(app, trip.id, 1, {
      amountMinor: 1000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
      description: '<script>alert(1)</script>',
      category: '<i>x</i>', // 8 chars — max allowed by the expense schema's category field
    });

    const tripRow = getTripRow(current, trip.id);
    const { buildTripSummaryMessage } = await import('../src/lib/summary.js');
    const message = buildTripSummaryMessage(tripRow, 'en');

    expect(message).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co');
    expect(message).not.toContain('<b>Evil</b>');
    // Summary itself doesn't render expense descriptions (nudges do — botMessages.test
    // covers that path); this just guards the title never leaks raw markup.
  });
});

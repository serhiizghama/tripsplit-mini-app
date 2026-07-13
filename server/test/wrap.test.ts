/**
 * Trip Wrap tests — mirrors `insights.test.ts`'s structure. Priority is the
 * pure `computeTripWrap` function (hand-built row fixtures, no DB, full
 * control over award/tie-break edge cases), plus a couple of `getTripWrap`
 * (DB assembler) tests built through the real HTTP API (`bootTestApp()`,
 * same pattern as `summary.test.ts`'s `getTripRow` helper) to prove the
 * DB-reading glue — real split/rate math, deleted+planned exclusion,
 * settlement wiring — lines up with the pure function.
 */
import { eq } from 'drizzle-orm';
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it } from 'vitest';

import {
  computeTripWrap,
  type WrapSettlementSourceRow,
  type WrapSourceRow,
} from '../src/lib/wrap.js';
import type { TripRow } from '../src/lib/summary.js';
import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

function authHeaderFor(userId: number, firstName = 'Test'): string {
  const initDataRaw = sign(
    { user: { id: userId, first_name: firstName } },
    TEST_BOT_TOKEN,
    new Date(),
  );
  return `tma ${initDataRaw}`;
}

function row(overrides: Partial<WrapSourceRow>): WrapSourceRow {
  return {
    payerId: 1,
    amountMinor: 1000,
    amountBaseMinor: 1000,
    currency: 'USD',
    category: null,
    description: null,
    spentOn: '2026-01-01',
    createdBy: 1,
    shares: [],
    ...overrides,
  };
}

const noTransfers: never[] = [];
const trip = { id: 'trip1', title: 'Trip', baseCurrency: 'USD', archivedAt: null };

describe('computeTripWrap (pure)', () => {
  it('empty trip: zeroed headline, zero-row members, no awards, settled', () => {
    const result = computeTripWrap([], [], [1, 2], noTransfers, trip);
    expect(result).toEqual({
      tripId: 'trip1',
      title: 'Trip',
      baseCurrency: 'USD',
      archivedAt: null,
      totalBaseMinor: 0,
      expenseCount: 0,
      dayCount: 0,
      avgPerDayBaseMinor: 0,
      firstSpentOn: null,
      lastSpentOn: null,
      currenciesUsed: 0,
      members: [
        { userId: 1, paidBaseMinor: 0, shareBaseMinor: 0, expensesPaidCount: 0 },
        { userId: 2, paidBaseMinor: 0, shareBaseMinor: 0, expensesPaidCount: 0 },
      ],
      awards: [],
      settled: true,
      outstandingTransfers: [],
    });
  });

  it('headline: totals, dayCount, avg rounding, first/lastSpentOn, currenciesUsed', () => {
    const rows: WrapSourceRow[] = [
      row({ amountBaseMinor: 1000, currency: 'USD', spentOn: '2026-01-01' }),
      row({ amountBaseMinor: 500, currency: 'THB', spentOn: '2026-01-03' }),
      row({ amountBaseMinor: 500, currency: 'USD', spentOn: '2026-01-02' }),
    ];
    const result = computeTripWrap(rows, [], [1], noTransfers, trip);

    expect(result.totalBaseMinor).toBe(2000);
    expect(result.expenseCount).toBe(3);
    expect(result.dayCount).toBe(3);
    // 2000 / 3 = 666.67 -> rounds to 667.
    expect(result.avgPerDayBaseMinor).toBe(667);
    expect(result.firstSpentOn).toBe('2026-01-01');
    expect(result.lastSpentOn).toBe('2026-01-03');
    expect(result.currenciesUsed).toBe(2);
  });

  it('members: paid/share/count per member, zero-activity members included, sorted paidBaseMinor DESC then userId ASC', () => {
    const rows: WrapSourceRow[] = [
      row({
        payerId: 2,
        amountBaseMinor: 900,
        shares: [
          { userId: 1, shareMinor: 300 },
          { userId: 2, shareMinor: 300 },
          { userId: 3, shareMinor: 300 },
        ],
      }),
      row({
        payerId: 1,
        amountBaseMinor: 300,
        shares: [{ userId: 1, shareMinor: 300 }],
      }),
    ];
    // Member 3 never pays; member 4 doesn't even appear.
    const result = computeTripWrap(rows, [], [1, 2, 3], noTransfers, trip);

    expect(result.members).toEqual([
      { userId: 2, paidBaseMinor: 900, shareBaseMinor: 300, expensesPaidCount: 1 },
      { userId: 1, paidBaseMinor: 300, shareBaseMinor: 600, expensesPaidCount: 1 },
      { userId: 3, paidBaseMinor: 0, shareBaseMinor: 300, expensesPaidCount: 0 },
    ]);
  });

  it('members: shareBaseMinor reuses allocateProportional exactly (unequal weights, largest-remainder rounding)', () => {
    // Same 999-total/[70,30]-weight case as balances.test.ts's
    // allocateProportional unit test -> [699, 300].
    const rows: WrapSourceRow[] = [
      row({
        payerId: 1,
        amountBaseMinor: 999,
        shares: [
          { userId: 1, shareMinor: 70 },
          { userId: 2, shareMinor: 30 },
        ],
      }),
    ];
    const result = computeTripWrap(rows, [], [1, 2], noTransfers, trip);
    const byUser = new Map(result.members.map((m) => [m.userId, m.shareBaseMinor]));
    expect(byUser.get(1)).toBe(699);
    expect(byUser.get(2)).toBe(300);
  });

  it('sponsor: biggest paid total, omitted when every member paid zero, ties broken by userId ascending', () => {
    const zero = computeTripWrap([], [], [1, 2], noTransfers, trip);
    expect(zero.awards.find((a) => a.kind === 'sponsor')).toBeUndefined();

    const tied: WrapSourceRow[] = [
      row({ payerId: 2, amountBaseMinor: 500 }),
      row({ payerId: 1, amountBaseMinor: 500 }),
    ];
    const result = computeTripWrap(tied, [], [1, 2], noTransfers, trip);
    expect(result.awards[0]).toEqual({
      kind: 'sponsor',
      userId: 1,
      amountBaseMinor: 500,
    });
  });

  it('bookkeeper: most expenses logged (createdBy), independent of who paid, ties broken by userId ascending', () => {
    const rows: WrapSourceRow[] = [
      row({ payerId: 2, createdBy: 1, amountBaseMinor: 100 }),
      row({ payerId: 2, createdBy: 1, amountBaseMinor: 100 }),
      row({ payerId: 1, createdBy: 2, amountBaseMinor: 100 }),
    ];
    const result = computeTripWrap(rows, [], [1, 2], noTransfers, trip);
    expect(result.awards.find((a) => a.kind === 'bookkeeper')).toEqual({
      kind: 'bookkeeper',
      userId: 1,
      count: 2,
    });
  });

  it('biggestExpense: max amountBaseMinor row, ties broken by lower payerId, description falls back to category', () => {
    const rows: WrapSourceRow[] = [
      row({ payerId: 2, amountBaseMinor: 500, description: null, category: '🍜' }),
      row({ payerId: 1, amountBaseMinor: 500, description: null, category: '🍺' }),
      row({ payerId: 3, amountBaseMinor: 100, description: 'Snack', category: null }),
    ];
    const result = computeTripWrap(rows, [], [1, 2, 3], noTransfers, trip);
    expect(result.awards.find((a) => a.kind === 'biggestExpense')).toEqual({
      kind: 'biggestExpense',
      userId: 1,
      amountBaseMinor: 500,
      description: '🍺',
    });
  });

  it('busiestDay: date with most rows, omitted below 2, ties broken by earliest date', () => {
    const single: WrapSourceRow[] = [
      row({ spentOn: '2026-01-01' }),
      row({ spentOn: '2026-01-02' }),
    ];
    expect(
      computeTripWrap(single, [], [1], noTransfers, trip).awards.find(
        (a) => a.kind === 'busiestDay',
      ),
    ).toBeUndefined();

    const tied: WrapSourceRow[] = [
      row({ spentOn: '2026-01-02' }),
      row({ spentOn: '2026-01-02' }),
      row({ spentOn: '2026-01-01' }),
      row({ spentOn: '2026-01-01' }),
    ];
    const result = computeTripWrap(tied, [], [1], noTransfers, trip);
    expect(result.awards.find((a) => a.kind === 'busiestDay')).toEqual({
      kind: 'busiestDay',
      date: '2026-01-01',
      count: 2,
    });
  });

  it('priciestDay: omitted for a single-day trip, otherwise the date with the largest total', () => {
    const singleDay: WrapSourceRow[] = [
      row({ spentOn: '2026-01-01', amountBaseMinor: 100 }),
    ];
    expect(
      computeTripWrap(singleDay, [], [1], noTransfers, trip).awards.find(
        (a) => a.kind === 'priciestDay',
      ),
    ).toBeUndefined();

    const multiDay: WrapSourceRow[] = [
      row({ spentOn: '2026-01-01', amountBaseMinor: 100 }),
      row({ spentOn: '2026-01-02', amountBaseMinor: 900 }),
    ];
    const result = computeTripWrap(multiDay, [], [1], noTransfers, trip);
    expect(result.awards.find((a) => a.kind === 'priciestDay')).toEqual({
      kind: 'priciestDay',
      date: '2026-01-02',
      amountBaseMinor: 900,
    });
  });

  it('currencyCollector: member who paid in the most distinct currencies, omitted below 2, ties broken by userId ascending', () => {
    const single: WrapSourceRow[] = [
      row({ payerId: 1, currency: 'USD' }),
      row({ payerId: 1, currency: 'USD' }),
    ];
    expect(
      computeTripWrap(single, [], [1], noTransfers, trip).awards.find(
        (a) => a.kind === 'currencyCollector',
      ),
    ).toBeUndefined();

    const rows: WrapSourceRow[] = [
      row({ payerId: 2, currency: 'USD' }),
      row({ payerId: 2, currency: 'THB' }),
      row({ payerId: 1, currency: 'USD' }),
      row({ payerId: 1, currency: 'EUR' }),
    ];
    const result = computeTripWrap(rows, [], [1, 2], noTransfers, trip);
    expect(result.awards.find((a) => a.kind === 'currencyCollector')).toEqual({
      kind: 'currencyCollector',
      userId: 1,
      count: 2,
    });
  });

  it('categoryChampion: top 3 categories by total (4th excluded), each paired with its top-paying member, ties broken by userId ascending', () => {
    const rows: WrapSourceRow[] = [
      row({ payerId: 1, category: '🍜', amountBaseMinor: 400 }),
      row({ payerId: 2, category: '🍜', amountBaseMinor: 400 }), // ties payer1 in 🍜 -> userId 1 wins
      row({ payerId: 1, category: '🍺', amountBaseMinor: 300 }),
      row({ payerId: 1, category: '🏨', amountBaseMinor: 200 }),
      row({ payerId: 1, category: '🚕', amountBaseMinor: 100 }), // 4th category, excluded (top 3 only)
      row({ payerId: 1, category: null, amountBaseMinor: 1000 }), // uncategorized, never a champion
    ];
    const result = computeTripWrap(rows, [], [1, 2], noTransfers, trip);
    const champions = result.awards.filter((a) => a.kind === 'categoryChampion');
    expect(champions).toEqual([
      { kind: 'categoryChampion', userId: 1, amountBaseMinor: 400, category: '🍜' },
      { kind: 'categoryChampion', userId: 1, amountBaseMinor: 300, category: '🍺' },
      { kind: 'categoryChampion', userId: 1, amountBaseMinor: 200, category: '🏨' },
    ]);
  });

  it('settlements: count + total volume, omitted when there are none', () => {
    expect(
      computeTripWrap([], [], [1], noTransfers, trip).awards.find(
        (a) => a.kind === 'settlements',
      ),
    ).toBeUndefined();

    const settlementRows: WrapSettlementSourceRow[] = [
      { amountBaseMinor: 500 },
      { amountBaseMinor: 300 },
    ];
    const result = computeTripWrap([], settlementRows, [1], noTransfers, trip);
    expect(result.awards).toEqual([
      { kind: 'settlements', count: 2, amountBaseMinor: 800 },
    ]);
  });

  it('settled/outstandingTransfers mirror the passed-in transfer list', () => {
    const transfers = [{ fromUserId: 2, toUserId: 1, amountBaseMinor: 500 }];
    const result = computeTripWrap([], [], [1, 2], transfers, trip);
    expect(result.settled).toBe(false);
    expect(result.outstandingTransfers).toEqual(transfers);
  });

  it('award order is deterministic: sponsor, bookkeeper, biggestExpense, busiestDay, priciestDay, currencyCollector, categoryChampions, settlements', () => {
    const rows: WrapSourceRow[] = [
      row({
        payerId: 1,
        createdBy: 1,
        amountBaseMinor: 500,
        currency: 'USD',
        category: '🍜',
        spentOn: '2026-01-01',
      }),
      row({
        payerId: 1,
        createdBy: 1,
        amountBaseMinor: 300,
        currency: 'THB',
        category: '🍺',
        spentOn: '2026-01-01',
      }),
      row({
        payerId: 1,
        createdBy: 1,
        amountBaseMinor: 200,
        currency: 'EUR',
        category: '🏨',
        spentOn: '2026-01-02',
      }),
    ];
    const settlementRows: WrapSettlementSourceRow[] = [{ amountBaseMinor: 100 }];
    const result = computeTripWrap(rows, settlementRows, [1], noTransfers, trip);
    expect(result.awards.map((a) => a.kind)).toEqual([
      'sponsor',
      'bookkeeper',
      'biggestExpense',
      'busiestDay',
      'priciestDay',
      'currencyCollector',
      'categoryChampion',
      'categoryChampion',
      'categoryChampion',
      'settlements',
    ]);
  });
});

describe('getTripWrap (DB assembler)', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

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
    return (await res.json()).trip as CreatedTrip;
  }

  async function joinTrip(
    app: TestApp['app'],
    userId: number,
    firstName: string,
    inviteCode: string,
  ) {
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

  function getTripRow(t: TestApp, tripId: string): TripRow {
    const r = t.db
      .select()
      .from(t.schema.trips)
      .where(eq(t.schema.trips.id, tripId))
      .get();
    if (!r) throw new Error('trip row missing in test setup');
    return r;
  }

  it('empty trip: zeroed headline, empty awards, settled', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip1 = await createTrip(app, 1, 'Solo Trip', 'USD');
    const tripRow = getTripRow(current, trip1.id);
    const { getTripWrap } = await import('../src/lib/wrap.js');

    const wrap = getTripWrap(tripRow);
    expect(wrap.tripId).toBe(trip1.id);
    expect(wrap.title).toBe('Solo Trip');
    expect(wrap.totalBaseMinor).toBe(0);
    expect(wrap.expenseCount).toBe(0);
    expect(wrap.awards).toEqual([]);
    expect(wrap.settled).toBe(true);
    expect(wrap.members).toEqual([
      { userId: 1, paidBaseMinor: 0, shareBaseMinor: 0, expensesPaidCount: 0 },
    ]);
  });

  it('multi-member/day/currency/category trip + a settlement: headline, members, awards, settle state; deleted + planned rows excluded', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip1 = await createTrip(app, 1, 'Group Trip', 'USD'); // 1 = Alice
    await joinTrip(app, 2, 'Bob', trip1.inviteCode);
    await joinTrip(app, 3, 'Cy', trip1.inviteCode);

    // Day 1: two expenses (busiestDay candidate).
    const e1 = await postExpense(app, trip1.id, 1, {
      amountMinor: 900,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
      category: '🍜',
      spentOn: '2026-01-01',
    });
    expect(e1.status).toBe(201);

    await postExpense(app, trip1.id, 2, {
      amountMinor: 1800,
      currency: 'USD',
      payerId: 2,
      splitMode: 'equal',
      category: '🍺',
      spentOn: '2026-01-01',
    });

    // Day 2: single, largest expense (also biggestExpense + priciestDay).
    await postExpense(app, trip1.id, 1, {
      amountMinor: 5100,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      beneficiaryId: 1,
      category: '🏨',
      description: 'Fancy hotel',
      spentOn: '2026-01-02',
    });

    // Day 3: Cy pays in THB (explicit rate, no live rate lookup needed);
    // Alice logs it on Cy's behalf (bookkeeper counts createdBy, not payer).
    await postExpense(app, trip1.id, 1, {
      amountMinor: 150000,
      currency: 'THB',
      payerId: 3,
      splitMode: 'equal',
      category: '🍜',
      spentOn: '2026-01-03',
      rateToBase: 0.02,
      rateOverridden: true,
    });

    // A deleted expense — must not affect any totals.
    const deleted = await postExpense(app, trip1.id, 2, {
      amountMinor: 999,
      currency: 'USD',
      payerId: 2,
      splitMode: 'solo',
      beneficiaryId: 2,
      category: '🚕',
      spentOn: '2026-01-01',
    });
    const deletedId = (await deleted.json()).id as string;
    const delRes = await app.request(`/api/expenses/${deletedId}`, {
      method: 'DELETE',
      headers: { Authorization: authHeaderFor(1) },
    });
    expect(delRes.status).toBe(204);

    // A planned expense (no payer) — must not affect any totals.
    const planned = await postExpense(app, trip1.id, 1, {
      amountMinor: 100000,
      currency: 'USD',
      splitMode: 'equal',
      category: '🍜',
      spentOn: '2026-01-03',
    });
    expect(planned.status).toBe(201);

    // Bob settles part of what he owes back to Alice.
    const settleRes = await postSettlement(app, trip1.id, 2, {
      payerId: 2,
      receiverId: 1,
      amountMinor: 1000,
      currency: 'USD',
      spentOn: '2026-01-03',
    });
    expect(settleRes.status).toBe(201);

    const tripRow = getTripRow(current, trip1.id);
    const { getTripWrap } = await import('../src/lib/wrap.js');
    const wrap = getTripWrap(tripRow);

    // Headline — deleted/planned rows excluded (4 real expenses only).
    expect(wrap.totalBaseMinor).toBe(10800);
    expect(wrap.expenseCount).toBe(4);
    expect(wrap.dayCount).toBe(3);
    expect(wrap.avgPerDayBaseMinor).toBe(3600);
    expect(wrap.firstSpentOn).toBe('2026-01-01');
    expect(wrap.lastSpentOn).toBe('2026-01-03');
    expect(wrap.currenciesUsed).toBe(2); // USD, THB

    expect(wrap.members).toEqual([
      { userId: 1, paidBaseMinor: 6000, shareBaseMinor: 7000, expensesPaidCount: 2 },
      { userId: 3, paidBaseMinor: 3000, shareBaseMinor: 1900, expensesPaidCount: 1 },
      { userId: 2, paidBaseMinor: 1800, shareBaseMinor: 1900, expensesPaidCount: 1 },
    ]);

    expect(wrap.awards).toEqual([
      { kind: 'sponsor', userId: 1, amountBaseMinor: 6000 },
      { kind: 'bookkeeper', userId: 1, count: 3 },
      {
        kind: 'biggestExpense',
        userId: 1,
        amountBaseMinor: 5100,
        description: 'Fancy hotel',
      },
      { kind: 'busiestDay', date: '2026-01-01', count: 2 },
      { kind: 'priciestDay', date: '2026-01-02', amountBaseMinor: 5100 },
      // currencyCollector omitted: every payer only ever paid in one currency.
      { kind: 'categoryChampion', userId: 1, amountBaseMinor: 5100, category: '🏨' },
      { kind: 'categoryChampion', userId: 3, amountBaseMinor: 3000, category: '🍜' },
      { kind: 'categoryChampion', userId: 2, amountBaseMinor: 1800, category: '🍺' },
      { kind: 'settlements', count: 1, amountBaseMinor: 1000 },
    ]);

    // Settle state comes straight from getTripBalances -> reflects the
    // settlement above (Bob's partial paydown), not the raw expense split.
    expect(wrap.settled).toBe(false);
    expect(wrap.outstandingTransfers).toEqual([
      { fromUserId: 1, toUserId: 3, amountBaseMinor: 1100 },
      { fromUserId: 1, toUserId: 2, amountBaseMinor: 900 },
    ]);
  });
});

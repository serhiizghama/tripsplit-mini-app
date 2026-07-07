/**
 * Trip insights tests — mirrors `balances.test.ts`'s structure. Priority is
 * the pure `computeInsights` function (hand-built row fixtures, no DB), plus
 * a couple of thin HTTP tests for route wiring + membership authz, following
 * the same `bootTestApp()` pattern as the balances API tests.
 */
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it } from 'vitest';

import { computeInsights, type InsightsSourceRow } from '../src/lib/insights.js';
import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

function authHeaderFor(userId: number, firstName = 'Test'): string {
  const initDataRaw = sign(
    { user: { id: userId, first_name: firstName } },
    TEST_BOT_TOKEN,
    new Date(),
  );
  return `tma ${initDataRaw}`;
}

function row(overrides: Partial<InsightsSourceRow>): InsightsSourceRow {
  return {
    payerId: 1,
    amountMinor: 1000,
    amountBaseMinor: 1000,
    currency: 'USD',
    category: null,
    description: null,
    spentOn: '2026-01-01',
    ...overrides,
  };
}

describe('computeInsights (pure)', () => {
  it('empty trip: zeroed totals, null largest, empty breakdowns, all-zero members', () => {
    const result = computeInsights([], [1, 2], 'USD');
    expect(result).toEqual({
      baseCurrency: 'USD',
      totalBaseMinor: 0,
      expenseCount: 0,
      dayCount: 0,
      avgPerDayBaseMinor: 0,
      largest: null,
      byCategory: [],
      byDay: [],
      byMember: [
        { userId: 1, paidBaseMinor: 0 },
        { userId: 2, paidBaseMinor: 0 },
      ],
    });
  });

  it('totals, expenseCount, distinct dayCount, and avg rounding', () => {
    const rows: InsightsSourceRow[] = [
      row({ payerId: 1, amountBaseMinor: 1000, spentOn: '2026-01-01' }),
      row({ payerId: 2, amountBaseMinor: 2000, spentOn: '2026-01-01' }),
      row({ payerId: 1, amountBaseMinor: 1000, spentOn: '2026-01-02' }),
    ];
    const result = computeInsights(rows, [1, 2], 'USD');

    expect(result.totalBaseMinor).toBe(4000);
    expect(result.expenseCount).toBe(3);
    expect(result.dayCount).toBe(2); // 2026-01-01 and 2026-01-02, deduped
    // 4000 / 2 = 2000 exactly.
    expect(result.avgPerDayBaseMinor).toBe(2000);
  });

  it('avgPerDayBaseMinor rounds to the nearest integer (not truncated)', () => {
    // 1000 total over 3 distinct days -> 333.33... rounds to 333.
    const rows: InsightsSourceRow[] = [
      row({ amountBaseMinor: 1000, spentOn: '2026-01-01' }),
      row({ amountBaseMinor: 0, spentOn: '2026-01-02' }),
      row({ amountBaseMinor: 0, spentOn: '2026-01-03' }),
    ];
    const result = computeInsights(rows, [1], 'USD');
    expect(result.dayCount).toBe(3);
    expect(result.avgPerDayBaseMinor).toBe(333);
  });

  it('byCategory: grouped and summed, sorted by total DESC, null-category group included and sorted last on ties', () => {
    const rows: InsightsSourceRow[] = [
      row({ category: 'food', amountBaseMinor: 500 }),
      row({ category: 'food', amountBaseMinor: 500 }),
      row({ category: 'transport', amountBaseMinor: 2000 }),
      row({ category: null, amountBaseMinor: 1000 }),
    ];
    const result = computeInsights(rows, [1], 'USD');

    expect(result.byCategory).toEqual([
      { category: 'transport', totalBaseMinor: 2000 },
      { category: 'food', totalBaseMinor: 1000 },
      { category: null, totalBaseMinor: 1000 },
    ]);
  });

  it('byCategory: ties broken by category string ascending, null last', () => {
    const rows: InsightsSourceRow[] = [
      row({ category: 'zoo', amountBaseMinor: 100 }),
      row({ category: null, amountBaseMinor: 100 }),
      row({ category: 'art', amountBaseMinor: 100 }),
    ];
    const result = computeInsights(rows, [1], 'USD');

    expect(result.byCategory.map((c) => c.category)).toEqual(['art', 'zoo', null]);
  });

  it('byDay: grouped and summed, sorted by date ASC', () => {
    const rows: InsightsSourceRow[] = [
      row({ spentOn: '2026-01-03', amountBaseMinor: 100 }),
      row({ spentOn: '2026-01-01', amountBaseMinor: 200 }),
      row({ spentOn: '2026-01-01', amountBaseMinor: 50 }),
    ];
    const result = computeInsights(rows, [1], 'USD');

    expect(result.byDay).toEqual([
      { date: '2026-01-01', totalBaseMinor: 250 },
      { date: '2026-01-03', totalBaseMinor: 100 },
    ]);
  });

  it('byMember: includes every trip member (zero-paid included), sorted by paidBaseMinor DESC then userId ASC', () => {
    const rows: InsightsSourceRow[] = [
      row({ payerId: 2, amountBaseMinor: 300 }),
      row({ payerId: 1, amountBaseMinor: 700 }),
      row({ payerId: 2, amountBaseMinor: 100 }),
    ];
    // Member 3 never pays anything; member 4 doesn't even exist in rows.
    const result = computeInsights(rows, [1, 2, 3], 'USD');

    expect(result.byMember).toEqual([
      { userId: 1, paidBaseMinor: 700 },
      { userId: 2, paidBaseMinor: 400 },
      { userId: 3, paidBaseMinor: 0 },
    ]);
  });

  it('byMember: ties broken by userId ascending', () => {
    const rows: InsightsSourceRow[] = [
      row({ payerId: 2, amountBaseMinor: 100 }),
      row({ payerId: 1, amountBaseMinor: 100 }),
    ];
    const result = computeInsights(rows, [1, 2], 'USD');
    expect(result.byMember.map((m) => m.userId)).toEqual([1, 2]);
  });

  it('largest: picks the max amountBaseMinor row, mapped to LargestExpense', () => {
    const rows: InsightsSourceRow[] = [
      row({ amountBaseMinor: 100, amountMinor: 100, currency: 'USD', category: 'food', description: 'Lunch' }),
      row({ amountBaseMinor: 900, amountMinor: 30000, currency: 'THB', category: 'transport', description: 'Taxi' }),
      row({ amountBaseMinor: 500, amountMinor: 500, currency: 'USD', category: null, description: null }),
    ];
    const result = computeInsights(rows, [1], 'USD');

    expect(result.largest).toEqual({
      amountBaseMinor: 900,
      amountMinor: 30000,
      currency: 'THB',
      category: 'transport',
      description: 'Taxi',
    });
  });

  it('largest: ties keep the first max encountered (deterministic)', () => {
    const rows: InsightsSourceRow[] = [
      row({ amountBaseMinor: 500, description: 'first' }),
      row({ amountBaseMinor: 500, description: 'second' }),
    ];
    const result = computeInsights(rows, [1], 'USD');
    expect(result.largest?.description).toBe('first');
  });
});

describe('Insights API', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('GET /:id/insights returns computed totals for a membership-checked trip', async () => {
    current = await bootTestApp();
    const { app } = current;

    const createRes = await app.request('/api/trips', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Trip', baseCurrency: 'USD' }),
    });
    expect(createRes.status).toBe(201);
    const trip = (await createRes.json()).trip as { id: string; inviteCode: string };

    const expenseRes = await app.request(`/api/trips/${trip.id}/expenses`, {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountMinor: 1000,
        currency: 'USD',
        payerId: 1,
        splitMode: 'equal',
        category: 'food',
      }),
    });
    expect(expenseRes.status).toBe(201);

    const res = await app.request(`/api/trips/${trip.id}/insights`, {
      headers: { Authorization: authHeaderFor(1) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.baseCurrency).toBe('USD');
    expect(body.totalBaseMinor).toBe(1000);
    expect(body.expenseCount).toBe(1);
    expect(body.dayCount).toBe(1);
    expect(body.avgPerDayBaseMinor).toBe(1000);
    expect(body.largest).toMatchObject({ amountBaseMinor: 1000, category: 'food' });
    expect(body.byCategory).toEqual([{ category: 'food', totalBaseMinor: 1000 }]);
    expect(body.byMember).toEqual([{ userId: 1, paidBaseMinor: 1000 }]);
  });

  it('a non-member cannot GET insights (403)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const createRes = await app.request('/api/trips', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Trip', baseCurrency: 'USD' }),
    });
    const trip = (await createRes.json()).trip as { id: string };

    const res = await app.request(`/api/trips/${trip.id}/insights`, {
      headers: { Authorization: authHeaderFor(2) },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });
});

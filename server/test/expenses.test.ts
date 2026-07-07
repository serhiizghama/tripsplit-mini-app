/**
 * Expenses API tests — Phase 4.5. Same signed-fixture + temp-DB pattern as
 * `trips.test.ts`: everything drives the real Hono app via `app.request(...)`
 * against an isolated SQLite DB per test.
 *
 * Covers the invariants IMPLEMENTATION_PLAN.md's Phase 4 brief calls for:
 * largest-remainder equal-split rounding (incl. an exponent-0 currency and a
 * non-even division), solo/custom split modes, the `amount_base_minor`
 * conversion formula, membership authz on every route, edit preserving
 * split intent, and soft delete.
 */
import { sign } from '@tma.js/init-data-node';
import { and, eq } from 'drizzle-orm';
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

async function postExpense(
  app: TestApp['app'],
  tripId: string,
  userId: number,
  body: Record<string, unknown>,
) {
  return app.request(`/api/trips/${tripId}/expenses`, {
    method: 'POST',
    headers: { Authorization: authHeaderFor(userId), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getTrip(app: TestApp['app'], tripId: string, userId: number) {
  return app.request(`/api/trips/${tripId}`, {
    headers: { Authorization: authHeaderFor(userId) },
  });
}

describe('resolveRate (pure rate-resolution boundary — Fix #1: no more silent rate=1)', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('same currency as base -> rate 1, not overridden, regardless of other inputs', async () => {
    current = await bootTestApp();
    const { resolveRate } = await import('../src/lib/expenses.js');
    expect(resolveRate('EUR', 'EUR', 999, true, '2026-01-01')).toEqual({
      rateToBase: 1,
      rateOverridden: false,
    });
  });

  it('an explicit rateToBaseInput is used as-is, rateOverridden reflecting the caller flag', async () => {
    current = await bootTestApp();
    const { resolveRate } = await import('../src/lib/expenses.js');
    expect(resolveRate('THB', 'EUR', 0.03, true, '2026-01-01')).toEqual({
      rateToBase: 0.03,
      rateOverridden: true,
    });
    expect(resolveRate('THB', 'EUR', 0.03, undefined, '2026-01-01')).toEqual({
      rateToBase: 0.03,
      rateOverridden: false,
    });
  });

  it('cross-currency with a cached cross-rate uses it, and is not overridden', async () => {
    current = await bootTestApp();
    const { db, schema } = current;
    const RATE_DATE = '2026-01-15';
    db.insert(schema.rates)
      .values([
        { date: RATE_DATE, base: 'USD', currency: 'THB', rate: 33, source: 'open-er-api' },
        { date: RATE_DATE, base: 'USD', currency: 'EUR', rate: 0.9, source: 'open-er-api' },
      ])
      .run();

    const { resolveRate } = await import('../src/lib/expenses.js');
    const result = resolveRate('THB', 'EUR', undefined, undefined, RATE_DATE);
    expect(result.rateToBase).toBe(0.9 / 33);
    expect(result.rateOverridden).toBe(false);
  });

  it('cross-currency with NO cached rate and no override throws a 422 rate_unavailable AppError', async () => {
    current = await bootTestApp();
    const { resolveRate } = await import('../src/lib/expenses.js');
    const { AppError } = await import('../src/lib/errors.js');

    expect(() => resolveRate('THB', 'EUR', undefined, undefined, '2026-01-15')).toThrow(AppError);
    try {
      resolveRate('THB', 'EUR', undefined, undefined, '2026-01-15');
      throw new Error('expected resolveRate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as InstanceType<typeof AppError>).status).toBe(422);
      expect((err as InstanceType<typeof AppError>).code).toBe('rate_unavailable');
    }
  });
});

describe('Expenses API', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('equal split across 2 members divides evenly when it can', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    const res = await postExpense(app, trip.id, 1, {
      amountMinor: 10000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
    });
    expect(res.status).toBe(201);
    const expense = await res.json();
    expect(expense.shares).toHaveLength(2);
    const sum = expense.shares.reduce(
      (acc: number, s: { shareMinor: number }) => acc + s.shareMinor,
      0,
    );
    expect(sum).toBe(10000);
    expect(
      expense.shares.map((s: { shareMinor: number }) => s.shareMinor).sort(),
    ).toEqual([5000, 5000]);
  });

  it('equal split across 2 members with a non-even amount uses largest-remainder rounding (VND, exponent 0)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'VND');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    const res = await postExpense(app, trip.id, 1, {
      amountMinor: 101,
      currency: 'VND',
      payerId: 1,
      splitMode: 'equal',
    });
    expect(res.status).toBe(201);
    const expense = await res.json();
    const sum = expense.shares.reduce(
      (acc: number, s: { shareMinor: number }) => acc + s.shareMinor,
      0,
    );
    expect(sum).toBe(101);
    // Stable tie-break order is ascending user id — user 1 (lower id) gets the extra minor unit.
    expect(expense.shares).toEqual(
      expect.arrayContaining([
        { expenseId: expense.id, userId: 1, shareMinor: 51 },
        { expenseId: expense.id, userId: 2, shareMinor: 50 },
      ]),
    );
  });

  it('equal split across 3 members: 100 -> 34/33/33 (plan’s worked example)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);
    await joinTrip(app, 3, 'Bo', trip.inviteCode);

    const res = await postExpense(app, trip.id, 1, {
      amountMinor: 100,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
    });
    expect(res.status).toBe(201);
    const expense = await res.json();
    const sum = expense.shares.reduce(
      (acc: number, s: { shareMinor: number }) => acc + s.shareMinor,
      0,
    );
    expect(sum).toBe(100);
    const byUser = new Map(
      expense.shares.map((s: { userId: number; shareMinor: number }) => [
        s.userId,
        s.shareMinor,
      ]),
    );
    expect(byUser.get(1)).toBe(34);
    expect(byUser.get(2)).toBe(33);
    expect(byUser.get(3)).toBe(33);
  });

  it('solo split assigns the full amount to exactly one member', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    const res = await postExpense(app, trip.id, 1, {
      amountMinor: 4200,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      beneficiaryId: 2,
    });
    expect(res.status).toBe(201);
    const expense = await res.json();
    expect(expense.shares).toEqual([
      { expenseId: expense.id, userId: 2, shareMinor: 4200 },
    ]);
  });

  it('solo split rejects a beneficiary who is not a trip member', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');

    const res = await postExpense(app, trip.id, 1, {
      amountMinor: 100,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      beneficiaryId: 999,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('custom split validates membership and the sum, and rejects a non-summing split with 400', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    const ok = await postExpense(app, trip.id, 1, {
      amountMinor: 1000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'custom',
      shares: [
        { userId: 1, shareMinor: 700 },
        { userId: 2, shareMinor: 300 },
      ],
    });
    expect(ok.status).toBe(201);
    const okExpense = await ok.json();
    const sum = okExpense.shares.reduce(
      (acc: number, s: { shareMinor: number }) => acc + s.shareMinor,
      0,
    );
    expect(sum).toBe(1000);

    const badSum = await postExpense(app, trip.id, 1, {
      amountMinor: 1000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'custom',
      shares: [
        { userId: 1, shareMinor: 700 },
        { userId: 2, shareMinor: 250 },
      ],
    });
    expect(badSum.status).toBe(400);
    expect((await badSum.json()).code).toBe('invalid_request');

    const nonMember = await postExpense(app, trip.id, 1, {
      amountMinor: 1000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'custom',
      shares: [
        { userId: 1, shareMinor: 500 },
        { userId: 999, shareMinor: 500 },
      ],
    });
    expect(nonMember.status).toBe(400);
    expect((await nonMember.json()).code).toBe('invalid_request');
  });

  it('computes amount_base_minor with the documented cross-exponent formula (VND-0 -> EUR-2)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'EUR');

    // 100,000 VND (exponent 0) at rate 0.000038 to EUR (exponent 2):
    // round(100000 * 10^(2-0) * 0.000038) = round(100000 * 100 * 0.000038) = round(380) = 380 -> 3.80 EUR.
    const res = await postExpense(app, trip.id, 1, {
      amountMinor: 100000,
      currency: 'VND',
      payerId: 1,
      splitMode: 'solo',
      beneficiaryId: 1,
      rateToBase: 0.000038,
    });
    expect(res.status).toBe(201);
    const expense = await res.json();
    expect(expense.rateToBase).toBe(0.000038);
    expect(expense.rateOverridden).toBe(false);
    expect(expense.amountBaseMinor).toBe(380);
  });

  it('rate boundary: same-currency-as-base forces rate=1/not-overridden regardless of client input', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'EUR');

    const res = await postExpense(app, trip.id, 1, {
      amountMinor: 4100,
      currency: 'EUR',
      payerId: 1,
      splitMode: 'solo',
      beneficiaryId: 1,
      rateToBase: 999,
      rateOverridden: true,
    });
    expect(res.status).toBe(201);
    const expense = await res.json();
    expect(expense.rateToBase).toBe(1);
    expect(expense.rateOverridden).toBe(false);
    expect(expense.amountBaseMinor).toBe(4100);
  });

  it('rate boundary: non-base currency with no rate supplied and no cached cross-rate rejects with 422 rate_unavailable (no more silent rate=1 fallback)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'EUR');

    const res = await postExpense(app, trip.id, 1, {
      amountMinor: 4100,
      currency: 'THB',
      payerId: 1,
      splitMode: 'solo',
      beneficiaryId: 1,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('rate_unavailable');
  });

  it('rejects a payer who is not a trip member with 400', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');

    const res = await postExpense(app, trip.id, 1, {
      amountMinor: 100,
      currency: 'USD',
      payerId: 999,
      splitMode: 'solo',
      beneficiaryId: 1,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('a non-member cannot POST an expense (403)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');

    const res = await postExpense(app, trip.id, 2, {
      amountMinor: 100,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });

  it('a non-member cannot PATCH or DELETE an expense (403)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');

    const createRes = await postExpense(app, trip.id, 1, {
      amountMinor: 100,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
    });
    const expense = await createRes.json();

    const patchRes = await app.request(`/api/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(2), 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Hijacked' }),
    });
    expect(patchRes.status).toBe(403);
    expect((await patchRes.json()).code).toBe('forbidden');

    const deleteRes = await app.request(`/api/expenses/${expense.id}`, {
      method: 'DELETE',
      headers: { Authorization: authHeaderFor(2) },
    });
    expect(deleteRes.status).toBe(403);
    expect((await deleteRes.json()).code).toBe('forbidden');
  });

  it('editing preserves the stored custom split intent when only touching another field', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    const createRes = await postExpense(app, trip.id, 1, {
      amountMinor: 1000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'custom',
      shares: [
        { userId: 1, shareMinor: 600 },
        { userId: 2, shareMinor: 400 },
      ],
      description: 'Groceries',
    });
    const created = await createRes.json();

    const patchRes = await app.request(`/api/expenses/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Groceries + snacks' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.description).toBe('Groceries + snacks');
    expect(patched.splitMode).toBe('custom');
    const patchedByUser = new Map(
      patched.shares.map((s: { userId: number; shareMinor: number }) => [
        s.userId,
        s.shareMinor,
      ]),
    );
    expect(patchedByUser.get(1)).toBe(600);
    expect(patchedByUser.get(2)).toBe(400);

    // Confirm it round-trips through GET too (reconstructing the intent for the edit sheet).
    const getRes = await getTrip(app, trip.id, 1);
    const tripDetail = await getRes.json();
    const fetched = tripDetail.expenses.find((e: { id: string }) => e.id === created.id);
    expect(fetched.splitMode).toBe('custom');
    const fetchedByUser = new Map(
      fetched.shares.map((s: { userId: number; shareMinor: number }) => [
        s.userId,
        s.shareMinor,
      ]),
    );
    expect(fetchedByUser.get(1)).toBe(600);
    expect(fetchedByUser.get(2)).toBe(400);
  });

  it('editing recomputes shares when the amount changes for an equal-split expense', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);
    await joinTrip(app, 3, 'Bo', trip.inviteCode);

    const createRes = await postExpense(app, trip.id, 1, {
      amountMinor: 300,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
    });
    const created = await createRes.json();

    const patchRes = await app.request(`/api/expenses/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountMinor: 100 }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    const sum = patched.shares.reduce(
      (acc: number, s: { shareMinor: number }) => acc + s.shareMinor,
      0,
    );
    expect(sum).toBe(100);
    const byUser = new Map(
      patched.shares.map((s: { userId: number; shareMinor: number }) => [
        s.userId,
        s.shareMinor,
      ]),
    );
    expect(byUser.get(1)).toBe(34);
    expect(byUser.get(2)).toBe(33);
    expect(byUser.get(3)).toBe(33);
  });

  it('editing spentOn on a cross-currency auto-rate expense re-resolves the rate for the new date (Fix #2)', async () => {
    current = await bootTestApp();
    const { app, db, schema } = current;
    const trip = await createTrip(app, 1, 'Trip', 'EUR');

    const DATE_1 = '2026-01-10';
    const DATE_2 = '2026-02-10';
    db.insert(schema.rates)
      .values([
        { date: DATE_1, base: 'USD', currency: 'THB', rate: 33, source: 'open-er-api' },
        { date: DATE_1, base: 'USD', currency: 'EUR', rate: 0.9, source: 'open-er-api' },
        // A DIFFERENT THB rate on the new date -> the re-resolved cross-rate must differ.
        { date: DATE_2, base: 'USD', currency: 'THB', rate: 30, source: 'open-er-api' },
      ])
      .run();

    const created = await (
      await postExpense(app, trip.id, 1, {
        amountMinor: 100000,
        currency: 'THB',
        payerId: 1,
        splitMode: 'solo',
        beneficiaryId: 1,
        spentOn: DATE_1,
      })
    ).json();
    expect(created.rateOverridden).toBe(false);
    expect(created.rateToBase).toBe(0.9 / 33);
    expect(created.amountBaseMinor).toBe(2727); // round(100000 * 0.9/33)

    const patchRes = await app.request(`/api/expenses/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ spentOn: DATE_2 }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.spentOn).toBe(DATE_2);
    expect(patched.rateOverridden).toBe(false);
    // EUR's nearest-earlier-cached rate is still 0.9 (from DATE_1); THB's is
    // the new 30 -> the re-resolved cross-rate is 0.9/30, NOT the stale 0.9/33.
    expect(patched.rateToBase).toBe(0.9 / 30);
    expect(patched.amountBaseMinor).toBe(3000); // round(100000 * 0.9/30)
  });

  it('an overridden (manual) rate is preserved across a spentOn change, even with no cached rate for the new date (Fix #2)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'EUR');

    const created = await (
      await postExpense(app, trip.id, 1, {
        amountMinor: 100000,
        currency: 'THB',
        payerId: 1,
        splitMode: 'solo',
        beneficiaryId: 1,
        spentOn: '2026-01-10',
        rateToBase: 0.05,
        rateOverridden: true,
      })
    ).json();
    expect(created.rateOverridden).toBe(true);
    expect(created.rateToBase).toBe(0.05);
    expect(created.amountBaseMinor).toBe(5000);

    // No rate is cached for this new date at all — if the override weren't
    // preserved, this PATCH would now throw 422 rate_unavailable (Fix #1).
    const patchRes = await app.request(`/api/expenses/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ spentOn: '2026-03-01' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.spentOn).toBe('2026-03-01');
    expect(patched.rateOverridden).toBe(true);
    expect(patched.rateToBase).toBe(0.05);
    expect(patched.amountBaseMinor).toBe(5000);
  });

  it('editing an unrelated field with spentOn/currency both unchanged still reuses the stored rate, not a fresh lookup (regression guard)', async () => {
    current = await bootTestApp();
    const { app, db, schema } = current;
    const trip = await createTrip(app, 1, 'Trip', 'EUR');

    const RATE_DATE = '2026-01-10';
    db.insert(schema.rates)
      .values([
        { date: RATE_DATE, base: 'USD', currency: 'THB', rate: 33, source: 'open-er-api' },
        { date: RATE_DATE, base: 'USD', currency: 'EUR', rate: 0.9, source: 'open-er-api' },
      ])
      .run();

    const created = await (
      await postExpense(app, trip.id, 1, {
        amountMinor: 100000,
        currency: 'THB',
        payerId: 1,
        splitMode: 'solo',
        beneficiaryId: 1,
        spentOn: RATE_DATE,
      })
    ).json();
    expect(created.rateToBase).toBe(0.9 / 33);
    expect(created.amountBaseMinor).toBe(2727);

    // Perturb the cached rate for that same date AFTER creation — if
    // `updateExpense` wrongly re-resolved on every edit, this PATCH would pick
    // up the new (wrong) rate even though neither currency nor spentOn changed.
    db.update(schema.rates)
      .set({ rate: 20 })
      .where(and(eq(schema.rates.date, RATE_DATE), eq(schema.rates.currency, 'THB')))
      .run();

    const patchRes = await app.request(`/api/expenses/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'unrelated edit' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.description).toBe('unrelated edit');
    expect(patched.rateToBase).toBe(0.9 / 33); // unchanged, reused from storage
    expect(patched.amountBaseMinor).toBe(2727);
  });

  it('soft delete removes the expense from GET /api/trips/:id and re-unlocks the base currency', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');

    const createRes = await postExpense(app, trip.id, 1, {
      amountMinor: 100,
      currency: 'USD',
      payerId: 1,
      splitMode: 'solo',
      beneficiaryId: 1,
    });
    const created = await createRes.json();

    // With a live expense, the base currency is locked (Phase 3 guard).
    const lockedRes = await app.request(`/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseCurrency: 'THB' }),
    });
    expect(lockedRes.status).toBe(409);

    const beforeDelete = await getTrip(app, trip.id, 1);
    expect((await beforeDelete.json()).expenses).toHaveLength(1);

    const deleteRes = await app.request(`/api/expenses/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: authHeaderFor(1) },
    });
    expect(deleteRes.status).toBe(204);

    const afterDelete = await getTrip(app, trip.id, 1);
    expect((await afterDelete.json()).expenses).toEqual([]);

    // The only expense is gone (soft-deleted) — base currency unlocks again.
    const unlockedRes = await app.request(`/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseCurrency: 'THB' }),
    });
    expect(unlockedRes.status).toBe(200);
    expect((await unlockedRes.json()).baseCurrency).toBe('THB');
  });

  it('paginates GET /api/trips/:id expenses with expensesLimit/expensesBefore', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');

    // Three expenses on distinct dates so `spentOn desc` ordering is deterministic.
    for (const spentOn of ['2026-01-01', '2026-01-02', '2026-01-03']) {
      const res = await postExpense(app, trip.id, 1, {
        amountMinor: 100,
        currency: 'USD',
        payerId: 1,
        splitMode: 'solo',
        beneficiaryId: 1,
        spentOn,
      });
      expect(res.status).toBe(201);
    }

    const firstPageRes = await app.request(`/api/trips/${trip.id}?expensesLimit=2`, {
      headers: { Authorization: authHeaderFor(1) },
    });
    const firstPage = await firstPageRes.json();
    expect(firstPage.expenses).toHaveLength(2);
    expect(firstPage.expenses.map((e: { spentOn: string }) => e.spentOn)).toEqual([
      '2026-01-03',
      '2026-01-02',
    ]);
    expect(firstPage.expensesNextCursor).toEqual(expect.any(String));

    const secondPageRes = await app.request(
      `/api/trips/${trip.id}?expensesLimit=2&expensesBefore=${firstPage.expensesNextCursor}`,
      { headers: { Authorization: authHeaderFor(1) } },
    );
    const secondPage = await secondPageRes.json();
    expect(secondPage.expenses).toHaveLength(1);
    expect(secondPage.expenses[0].spentOn).toBe('2026-01-01');
    expect(secondPage.expensesNextCursor).toBeNull();
  });

  it('creates a planned expense with no payer (status=planned, payerId=null), lists it, keeps balances zero', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Bob', trip.inviteCode);

    // Omitting payerId → a planned (budgeted, not-yet-paid) expense.
    const res = await postExpense(app, trip.id, 1, {
      amountMinor: 5000,
      currency: 'USD',
      splitMode: 'equal',
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.status).toBe('planned');
    expect(created.payerId).toBeNull();
    // Split intent is still computed (equal across both members).
    expect(created.shares).toHaveLength(2);

    // It appears in the trip feed…
    const tripBody = await (await getTrip(app, trip.id, 1)).json();
    expect(tripBody.expenses).toHaveLength(1);
    expect(tripBody.expenses[0].status).toBe('planned');

    // …but is excluded from balances (nobody paid yet).
    const bal = await (
      await app.request(`/api/trips/${trip.id}/balances`, {
        headers: { Authorization: authHeaderFor(1) },
      })
    ).json();
    for (const b of bal.balances) {
      expect(b.paidBaseMinor).toBe(0);
      expect(b.owedBaseMinor).toBe(0);
      expect(b.netBaseMinor).toBe(0);
    }
    expect(bal.transfers).toEqual([]);
  });

  it('marks a planned expense paid by assigning a payer via PATCH (then it counts in balances)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Bob', trip.inviteCode);

    const planned = await (
      await postExpense(app, trip.id, 1, {
        amountMinor: 5000,
        currency: 'USD',
        splitMode: 'equal',
      })
    ).json();
    expect(planned.status).toBe('planned');

    // Assigning a payer is the planned → paid transition.
    const patchRes = await app.request(`/api/expenses/${planned.id}`, {
      method: 'PATCH',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ payerId: 1 }),
    });
    expect(patchRes.status).toBe(200);
    const paid = await patchRes.json();
    expect(paid.status).toBe('paid');
    expect(paid.payerId).toBe(1);

    // Now it counts: payer 1 is up by the other member's $25 half; Σ net == 0.
    const bal = await (
      await app.request(`/api/trips/${trip.id}/balances`, {
        headers: { Authorization: authHeaderFor(1) },
      })
    ).json();
    const sumNet = bal.balances.reduce(
      (s: number, b: { netBaseMinor: number }) => s + b.netBaseMinor,
      0,
    );
    expect(sumNet).toBe(0);
    const payer = bal.balances.find((b: { userId: number }) => b.userId === 1);
    expect(payer.paidBaseMinor).toBe(5000);
    expect(payer.netBaseMinor).toBe(2500);
  });
});

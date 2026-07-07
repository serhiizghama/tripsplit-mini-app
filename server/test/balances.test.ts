/**
 * Balances & Settlements tests — Phase 6.5 (IMPLEMENTATION_PLAN.md §4/§5,
 * "Balances & Settlements"). Same signed-fixture + temp-DB pattern as the
 * other API test files (`bootTestApp()`, `helpers.ts`).
 *
 * Covers the plan's Phase 6 Definition of Done exactly:
 *  - `Σ net == 0` for a mixed scenario (equal + custom + solo splits, 4
 *    members, one with zero activity).
 *  - A hand-computed scenario (mixed currencies + a partial settlement)
 *    matching the service's output exactly (balances + transfer list,
 *    before AND after the settlement).
 *  - Full settlement of an exact debt zeroes both parties' nets.
 *  - Cross-currency settlement (THB settling a EUR-base debt via the real
 *    cached cross-rate, not a client override) reduces the right net by
 *    exactly the converted amount.
 *  - 3+ member transfer minimization: `transfers.length <= members - 1`,
 *    and applying every suggested transfer zeroes out every member.
 *  - Membership authz on `GET .../balances` and `POST .../settlements`
 *    (non-member -> 403).
 *
 * Plus a couple of direct unit tests on the pure `allocateProportional`/
 * `computeTransfers` primitives (lib/balances.ts) for edge cases that are
 * awkward to provoke through the full HTTP stack.
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
    headers: { Authorization: authHeaderFor(ownerId), 'Content-Type': 'application/json' },
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
    headers: { Authorization: authHeaderFor(userId, firstName), 'Content-Type': 'application/json' },
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

async function postSettlement(
  app: TestApp['app'],
  tripId: string,
  userId: number,
  body: Record<string, unknown>,
) {
  return app.request(`/api/trips/${tripId}/settlements`, {
    method: 'POST',
    headers: { Authorization: authHeaderFor(userId), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getBalances(app: TestApp['app'], tripId: string, userId: number) {
  return app.request(`/api/trips/${tripId}/balances`, {
    headers: { Authorization: authHeaderFor(userId) },
  });
}

function sumNets(balances: { netBaseMinor: number }[]): number {
  return balances.reduce((sum, b) => sum + b.netBaseMinor, 0);
}

function byUser(balances: { userId: number }[]) {
  return new Map(balances.map((b) => [b.userId, b]));
}

describe('Balance math (pure functions)', () => {
  it('allocateProportional: unequal weights sum exactly to the total, largest-remainder tie-broken by index', async () => {
    const { allocateProportional } = await import('../src/lib/balances.js');

    // 10 split across three equal weights (1,1,1): floor(10/3)=3 each,
    // remainder 1 goes to index 0 (all three tie on remainder).
    expect(allocateProportional(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateProportional(10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10);

    // Unequal weights (70/30 split of 999): floor(699.3)=699, floor(299.7)=299
    // (sum 998, short by 1); the leftover unit goes to whichever entry has
    // the larger fractional remainder — index 1 (.70 vs index 0's .30).
    const result = allocateProportional(999, [70, 30]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(999);
    expect(result).toEqual([699, 300]);
  });

  it('computeTransfers: no non-zero balances -> no transfers', async () => {
    const { computeTransfers } = await import('../src/lib/balances.js');
    expect(
      computeTransfers([
        { userId: 1, paidBaseMinor: 100, owedBaseMinor: 100, netBaseMinor: 0 },
        { userId: 2, paidBaseMinor: 50, owedBaseMinor: 50, netBaseMinor: 0 },
      ]),
    ).toEqual([]);
  });

  it('computeTransfers: single creditor/debtor pair produces exactly one transfer', async () => {
    const { computeTransfers } = await import('../src/lib/balances.js');
    expect(
      computeTransfers([
        { userId: 1, paidBaseMinor: 0, owedBaseMinor: 0, netBaseMinor: 500 },
        { userId: 2, paidBaseMinor: 0, owedBaseMinor: 0, netBaseMinor: -500 },
      ]),
    ).toEqual([{ fromUserId: 2, toUserId: 1, amountBaseMinor: 500 }]);
  });
});

describe('Balances API', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('Σ net == 0 for a mixed scenario (equal + custom + solo, 4 members incl. one with zero activity)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);
    await joinTrip(app, 3, 'Bo', trip.inviteCode);

    // Equal split among the 3 members present so far.
    expect(
      (
        await postExpense(app, trip.id, 1, {
          amountMinor: 10000,
          currency: 'USD',
          payerId: 1,
          splitMode: 'equal',
        })
      ).status,
    ).toBe(201);

    // Cy joins AFTER the equal-split expense (so it was computed over just
    // the 3 members present at the time) and is never a payer or referenced
    // share in the custom/solo expenses below either — genuinely zero
    // activity, not just "not owed".
    await joinTrip(app, 4, 'Cy', trip.inviteCode);

    // Custom split between 2 and 3.
    expect(
      (
        await postExpense(app, trip.id, 2, {
          amountMinor: 5000,
          currency: 'USD',
          payerId: 2,
          splitMode: 'custom',
          shares: [
            { userId: 2, shareMinor: 2000 },
            { userId: 3, shareMinor: 3000 },
          ],
        })
      ).status,
    ).toBe(201);

    // Solo expense: 3 pays, entirely for 1.
    expect(
      (
        await postExpense(app, trip.id, 3, {
          amountMinor: 2500,
          currency: 'USD',
          payerId: 3,
          splitMode: 'solo',
          beneficiaryId: 1,
        })
      ).status,
    ).toBe(201);

    const res = await getBalances(app, trip.id, 1);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.baseCurrency).toBe('USD');
    expect(body.balances).toHaveLength(4);
    expect(sumNets(body.balances)).toBe(0);

    // Member 4 never appears in a payer/share row -> net 0, but still listed.
    const map = byUser(body.balances);
    expect(map.get(4)).toMatchObject({ paidBaseMinor: 0, owedBaseMinor: 0, netBaseMinor: 0 });

    // Applying every suggested transfer should zero out every member.
    const simulated = new Map(body.balances.map((b: { userId: number; netBaseMinor: number }) => [b.userId, b.netBaseMinor]));
    for (const t of body.transfers as { fromUserId: number; toUserId: number; amountBaseMinor: number }[]) {
      simulated.set(t.fromUserId, (simulated.get(t.fromUserId) ?? 0) + t.amountBaseMinor);
      simulated.set(t.toUserId, (simulated.get(t.toUserId) ?? 0) - t.amountBaseMinor);
    }
    for (const net of simulated.values()) {
      expect(net).toBe(0);
    }
  });

  it('hand-computed scenario: mixed currencies + a partial settlement match the service output exactly', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'EUR'); // 1 = Alice
    await joinTrip(app, 2, 'Bob', trip.inviteCode);

    // Expense 1: Alice pays 100.00 EUR, split equally -> 50/50.
    // paid(1)=10000; owed(1)=5000, owed(2)=5000.
    expect(
      (
        await postExpense(app, trip.id, 1, {
          amountMinor: 10000,
          currency: 'EUR',
          payerId: 1,
          splitMode: 'equal',
        })
      ).status,
    ).toBe(201);

    // Expense 2: Bob pays 3,000.00 THB, solo entirely for Alice, explicit
    // rate 0.025 (hand-computable): amountBaseMinor = round(300000*0.025) = 7500.
    // paid(2)+=7500; owed(1)+=7500.
    expect(
      (
        await postExpense(app, trip.id, 2, {
          amountMinor: 300000,
          currency: 'THB',
          payerId: 2,
          splitMode: 'solo',
          beneficiaryId: 1,
          rateToBase: 0.025,
        })
      ).status,
    ).toBe(201);

    // Net so far: Alice = paid 10000 - owed 12500 = -2500 (owes 25.00 EUR).
    // Bob = paid 7500 - owed 5000 = +2500 (is owed 25.00 EUR).
    const before = await (await getBalances(app, trip.id, 1)).json();
    expect(sumNets(before.balances)).toBe(0);
    const beforeByUser = byUser(before.balances);
    expect(beforeByUser.get(1)).toMatchObject({
      paidBaseMinor: 10000,
      owedBaseMinor: 12500,
      netBaseMinor: -2500,
    });
    expect(beforeByUser.get(2)).toMatchObject({
      paidBaseMinor: 7500,
      owedBaseMinor: 5000,
      netBaseMinor: 2500,
    });
    expect(before.transfers).toEqual([{ fromUserId: 1, toUserId: 2, amountBaseMinor: 2500 }]);
    expect(before.perCurrency).toEqual([
      { currency: 'EUR', totalMinor: 10000 },
      { currency: 'THB', totalMinor: 300000 },
    ]);

    // Partial settlement: Alice pays Bob back 10.00 USD (a THIRD currency),
    // explicit rate 0.9 -> amountBaseMinor = round(1000*0.9) = 900.
    const settleRes = await postSettlement(app, trip.id, 1, {
      payerId: 1,
      receiverId: 2,
      amountMinor: 1000,
      currency: 'USD',
      rateToBase: 0.9,
      rateOverridden: true,
    });
    expect(settleRes.status).toBe(201);
    const settlement = await settleRes.json();
    expect(settlement.type).toBe('settlement');
    expect(settlement.payerId).toBe(1);
    expect(settlement.amountBaseMinor).toBe(900);
    expect(settlement.shares).toEqual([{ expenseId: settlement.id, userId: 2, shareMinor: 1000 }]);

    // After: Alice = paid 10900 - owed 12500 = -1600. Bob = paid 7500 - owed 5900 = +1600.
    // Reduction is exactly the converted settlement amount (900) on both sides.
    const after = await (await getBalances(app, trip.id, 1)).json();
    expect(sumNets(after.balances)).toBe(0);
    const afterByUser = byUser(after.balances);
    expect(afterByUser.get(1)).toMatchObject({
      paidBaseMinor: 10900,
      owedBaseMinor: 12500,
      netBaseMinor: -1600,
    });
    expect(afterByUser.get(2)).toMatchObject({
      paidBaseMinor: 7500,
      owedBaseMinor: 5900,
      netBaseMinor: 1600,
    });
    expect(after.transfers).toEqual([{ fromUserId: 1, toUserId: 2, amountBaseMinor: 1600 }]);
    // perCurrency is expense-only and unaffected by the (USD) settlement.
    expect(after.perCurrency).toEqual([
      { currency: 'EUR', totalMinor: 10000 },
      { currency: 'THB', totalMinor: 300000 },
    ]);
  });

  it('full settlement of an exact debt zeroes both parties net (and the transfer list empties)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'Anna', trip.inviteCode);

    // Equal split of 1000 -> 500/500. User 1 paid, so user 2 owes user 1 500.
    await postExpense(app, trip.id, 1, {
      amountMinor: 1000,
      currency: 'USD',
      payerId: 1,
      splitMode: 'equal',
    });

    const before = await (await getBalances(app, trip.id, 1)).json();
    expect(byUser(before.balances).get(2)?.netBaseMinor).toBe(-500);
    expect(before.transfers).toEqual([{ fromUserId: 2, toUserId: 1, amountBaseMinor: 500 }]);

    // User 2 settles the exact 500 owed, same currency as base (rate 1).
    const settleRes = await postSettlement(app, trip.id, 2, {
      payerId: 2,
      receiverId: 1,
      amountMinor: 500,
      currency: 'USD',
    });
    expect(settleRes.status).toBe(201);

    const after = await (await getBalances(app, trip.id, 1)).json();
    const afterByUser = byUser(after.balances);
    expect(afterByUser.get(1)?.netBaseMinor).toBe(0);
    expect(afterByUser.get(2)?.netBaseMinor).toBe(0);
    expect(sumNets(after.balances)).toBe(0);
    expect(after.transfers).toEqual([]);
  });

  it('cross-currency settlement: THB settling a EUR-base debt (real cached cross-rate) reduces the right net by exactly the converted amount', async () => {
    current = await bootTestApp();
    const { db, schema } = current;
    const RATE_DATE = '2026-01-15';
    const USD_THB = 33;
    const USD_EUR = 0.9;
    db.insert(schema.rates)
      .values([
        { date: RATE_DATE, base: 'USD', currency: 'THB', rate: USD_THB, source: 'open-er-api' },
        { date: RATE_DATE, base: 'USD', currency: 'EUR', rate: USD_EUR, source: 'open-er-api' },
      ])
      .run();

    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'EUR'); // 1 = Alice
    await joinTrip(app, 2, 'Bob', trip.inviteCode);

    // Alice pays 200.00 EUR, split equally -> Bob owes Alice 100.00 EUR (10000 minor).
    await postExpense(app, trip.id, 1, {
      amountMinor: 20000,
      currency: 'EUR',
      payerId: 1,
      splitMode: 'equal',
      spentOn: RATE_DATE,
    });

    const before = await (await getBalances(app, trip.id, 1)).json();
    expect(byUser(before.balances).get(1)?.netBaseMinor).toBe(10000);
    expect(byUser(before.balances).get(2)?.netBaseMinor).toBe(-10000);

    // Bob settles 1,000.00 THB back to Alice, with NO client rate — exercises
    // the real auto cross-rate lookup (resolveRate -> getCrossRateLocal),
    // exactly like rates.test.ts's confirmed 100000 THB -> 2727 EUR-cents
    // conversion at this same (rate, date) pair.
    const settleRes = await postSettlement(app, trip.id, 2, {
      payerId: 2,
      receiverId: 1,
      amountMinor: 100000,
      currency: 'THB',
      spentOn: RATE_DATE,
    });
    expect(settleRes.status).toBe(201);
    const settlement = await settleRes.json();
    expect(settlement.rateOverridden).toBe(false);
    expect(settlement.amountBaseMinor).toBe(2727);

    const after = await (await getBalances(app, trip.id, 1)).json();
    const afterByUser = byUser(after.balances);
    // Alice's net dropped from 10000 to exactly 10000 - 2727 = 7273; Bob's
    // rose from -10000 to exactly -10000 + 2727 = -7273.
    expect(afterByUser.get(1)?.netBaseMinor).toBe(7273);
    expect(afterByUser.get(2)?.netBaseMinor).toBe(-7273);
    expect(sumNets(after.balances)).toBe(0);
  });

  it('3+ member transfer minimization: <= n-1 transfers, and applying them zeroes every member out', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');
    await joinTrip(app, 2, 'B', trip.inviteCode);
    await joinTrip(app, 3, 'C', trip.inviteCode);
    await joinTrip(app, 4, 'D', trip.inviteCode);

    // Engineered nets: 1:+300, 2:+100, 3:-150, 4:-250 (sums to 0).
    // Expense A: user 1 pays 300, custom split (1:0, 2:0, 3:150, 4:150).
    await postExpense(app, trip.id, 1, {
      amountMinor: 300,
      currency: 'USD',
      payerId: 1,
      splitMode: 'custom',
      shares: [
        { userId: 1, shareMinor: 0 },
        { userId: 2, shareMinor: 0 },
        { userId: 3, shareMinor: 150 },
        { userId: 4, shareMinor: 150 },
      ],
    });
    // Expense B: user 2 pays 100, solo entirely for user 4.
    await postExpense(app, trip.id, 2, {
      amountMinor: 100,
      currency: 'USD',
      payerId: 2,
      splitMode: 'solo',
      beneficiaryId: 4,
    });

    const res = await getBalances(app, trip.id, 1);
    const body = await res.json();
    const map = byUser(body.balances);
    expect(map.get(1)?.netBaseMinor).toBe(300);
    expect(map.get(2)?.netBaseMinor).toBe(100);
    expect(map.get(3)?.netBaseMinor).toBe(-150);
    expect(map.get(4)?.netBaseMinor).toBe(-250);

    expect(body.transfers.length).toBeLessThanOrEqual(3); // n - 1 for n=4

    const simulated = new Map(
      body.balances.map((b: { userId: number; netBaseMinor: number }) => [b.userId, b.netBaseMinor]),
    );
    for (const t of body.transfers as { fromUserId: number; toUserId: number; amountBaseMinor: number }[]) {
      simulated.set(t.fromUserId, (simulated.get(t.fromUserId) ?? 0) + t.amountBaseMinor);
      simulated.set(t.toUserId, (simulated.get(t.toUserId) ?? 0) - t.amountBaseMinor);
    }
    for (const net of simulated.values()) {
      expect(net).toBe(0);
    }
  });

  it('a non-member cannot GET balances (403)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');

    const res = await getBalances(app, trip.id, 2);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });

  it('a non-member cannot POST a settlement (403)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');

    const res = await postSettlement(app, trip.id, 2, {
      payerId: 1,
      receiverId: 2,
      amountMinor: 100,
      currency: 'USD',
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });

  it('rejects a settlement whose payer or receiver is not a trip member (400)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');

    const badReceiver = await postSettlement(app, trip.id, 1, {
      payerId: 1,
      receiverId: 999,
      amountMinor: 100,
      currency: 'USD',
    });
    expect(badReceiver.status).toBe(400);
    expect((await badReceiver.json()).code).toBe('invalid_request');
  });

  it('rejects a settlement where payer and receiver are the same member (400)', async () => {
    current = await bootTestApp();
    const { app } = current;
    const trip = await createTrip(app, 1, 'Trip', 'USD');

    const res = await postSettlement(app, trip.id, 1, {
      payerId: 1,
      receiverId: 1,
      amountMinor: 100,
      currency: 'USD',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('settlements appear in the trip feed distinguishable by type', async () => {
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
    await postSettlement(app, trip.id, 2, {
      payerId: 2,
      receiverId: 1,
      amountMinor: 500,
      currency: 'USD',
    });

    const tripRes = await app.request(`/api/trips/${trip.id}`, {
      headers: { Authorization: authHeaderFor(1) },
    });
    const tripBody = await tripRes.json();
    const types = tripBody.expenses.map((e: { type: string }) => e.type).sort();
    expect(types).toEqual(['expense', 'settlement']);
  });
});

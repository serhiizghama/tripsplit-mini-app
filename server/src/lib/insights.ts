/**
 * Trip insights (statistics) service — `GET /api/trips/:id/insights`. Mirrors
 * `lib/balances.ts`'s structure exactly: pure compute functions over plain
 * row objects, plus one DB-reading assembler that wires them together for
 * the route handler.
 *
 * Scope (same intent as `balances.ts`): only non-deleted, `status: 'paid'`,
 * `type: 'expense'` rows count. Settlements are transfers between members,
 * not new trip spend (same reasoning as `computeCurrencyTotals`'s
 * expense-only scope); `'planned'` rows have no payer yet and aren't real
 * spend (same reasoning as `getTripBalances`'s `status: 'paid'` filter).
 *
 * All amounts here are trip **base-currency minor units** — this is a
 * statistics view, not a source of new money math, so unlike `balances.ts`
 * there's no need for `allocateProportional`-style exact-sum tricks; each
 * row's own stored `amountBaseMinor` is just summed/grouped directly.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { CategoryTotal, DailyTotal, InsightsResponse, LargestExpense, MemberSpend } from '@tripsplit/shared';

import { db, schema } from '../db/index.js';
import { getTripMembers } from './members.js';

// ---------------------------------------------------------------------------
// Pure compute
// ---------------------------------------------------------------------------

export interface InsightsSourceRow {
  payerId: number | null;
  amountMinor: number;
  amountBaseMinor: number;
  currency: string;
  category: string | null;
  description: string | null;
  spentOn: string;
}

/**
 * Computes `InsightsResponse` from a trip's paid expense rows — PURE, no DB
 * (see module doc comment for the exact row scope). `memberIds` is the full
 * current trip membership, passed explicitly (rather than derived from
 * `rows`) so a member with zero spend still gets a `{ paidBaseMinor: 0 }`
 * line in `byMember` — same reasoning as `computeMemberBalances`.
 */
export function computeInsights(
  rows: InsightsSourceRow[],
  memberIds: number[],
  baseCurrency: string,
): InsightsResponse {
  const totalBaseMinor = rows.reduce((sum, r) => sum + r.amountBaseMinor, 0);
  const expenseCount = rows.length;

  const distinctDays = new Set(rows.map((r) => r.spentOn));
  const dayCount = distinctDays.size;
  const avgPerDayBaseMinor = dayCount > 0 ? Math.round(totalBaseMinor / dayCount) : 0;

  // byCategory: group by category (null is its own group), sort by total
  // DESC, tie-broken by category string ASC with null last (deterministic).
  const categoryTotals = new Map<string | null, number>();
  for (const row of rows) {
    categoryTotals.set(row.category, (categoryTotals.get(row.category) ?? 0) + row.amountBaseMinor);
  }
  const byCategory: CategoryTotal[] = [...categoryTotals.entries()]
    .map(([category, total]) => ({ category, totalBaseMinor: total }))
    .sort((a, b) => {
      if (b.totalBaseMinor !== a.totalBaseMinor) return b.totalBaseMinor - a.totalBaseMinor;
      if (a.category === null) return b.category === null ? 0 : 1;
      if (b.category === null) return -1;
      return a.category.localeCompare(b.category);
    });

  // byDay: group by spentOn, sort by date ASC.
  const dayTotals = new Map<string, number>();
  for (const row of rows) {
    dayTotals.set(row.spentOn, (dayTotals.get(row.spentOn) ?? 0) + row.amountBaseMinor);
  }
  const byDay: DailyTotal[] = [...dayTotals.entries()]
    .map(([date, total]) => ({ date, totalBaseMinor: total }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // byMember: start every current member at 0, add each row's paid amount,
  // sort by paidBaseMinor DESC then userId ASC.
  const paid = new Map<number, number>(memberIds.map((id) => [id, 0]));
  for (const row of rows) {
    if (row.payerId === null) continue; // defensive — paid rows always have a payer
    paid.set(row.payerId, (paid.get(row.payerId) ?? 0) + row.amountBaseMinor);
  }
  const byMember: MemberSpend[] = memberIds
    .map((userId) => ({ userId, paidBaseMinor: paid.get(userId) ?? 0 }))
    .sort((a, b) => b.paidBaseMinor - a.paidBaseMinor || a.userId - b.userId);

  // largest: max amountBaseMinor, first-encountered wins ties.
  let largest: LargestExpense | null = null;
  for (const row of rows) {
    if (largest === null || row.amountBaseMinor > largest.amountBaseMinor) {
      largest = {
        amountBaseMinor: row.amountBaseMinor,
        amountMinor: row.amountMinor,
        currency: row.currency,
        category: row.category,
        description: row.description,
      };
    }
  }

  return {
    baseCurrency,
    totalBaseMinor,
    expenseCount,
    dayCount,
    avgPerDayBaseMinor,
    largest,
    byCategory,
    byDay,
    byMember,
  };
}

// ---------------------------------------------------------------------------
// DB-reading assembly — the only function here that touches `db`
// ---------------------------------------------------------------------------

/**
 * `GET /api/trips/:id/insights` — loads the trip's non-deleted, paid,
 * expense-type rows and wires them through `computeInsights`. `baseCurrency`
 * is passed in (the caller already has the trip row via `requireMembership`),
 * same as `getTripBalances`.
 */
export function getTripInsights(tripId: string, baseCurrency: string): InsightsResponse {
  const memberIds = getTripMembers(tripId).map((m) => m.id);

  const rows = db
    .select({
      payerId: schema.expenses.payerId,
      amountMinor: schema.expenses.amountMinor,
      amountBaseMinor: schema.expenses.amountBaseMinor,
      currency: schema.expenses.currency,
      category: schema.expenses.category,
      description: schema.expenses.description,
      spentOn: schema.expenses.spentOn,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.tripId, tripId),
        isNull(schema.expenses.deletedAt),
        eq(schema.expenses.status, 'paid'),
        eq(schema.expenses.type, 'expense'),
      ),
    )
    .orderBy(schema.expenses.spentOn, schema.expenses.createdAt, schema.expenses.id)
    .all();

  return computeInsights(
    rows.map((r) => ({
      payerId: r.payerId,
      amountMinor: r.amountMinor,
      amountBaseMinor: r.amountBaseMinor,
      currency: r.currency,
      category: r.category,
      description: r.description,
      spentOn: r.spentOn,
    })),
    memberIds,
    baseCurrency,
  );
}

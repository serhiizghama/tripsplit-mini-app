/**
 * Trip Wrap engine — `GET /api/trips/:id/wrap` (`docs/TRIP_WRAP_PLAN.md`
 * task W1). Same structure as `lib/insights.ts`: pure compute over plain row
 * objects, plus one DB-reading assembler that wires it together.
 *
 * Scope mirrors `insights.ts` exactly for headline/member numbers: only
 * non-deleted, `status: 'paid'`, `type: 'expense'` rows count as spend.
 * `type: 'settlement'` rows are queried separately and ONLY feed the
 * `settlements` award (count + volume) — never counted as spend, same
 * reasoning as `computeCurrencyTotals` (lib/balances.ts).
 *
 * `shareBaseMinor` (per-member fair-share total) reuses `allocateProportional`
 * (lib/balances.ts) EXACTLY the way `computeMemberBalances` does for
 * `owedBaseMinor` — same largest-remainder exactness argument, just scoped
 * to expense rows only (no settlements) since a "fair share" of the trip's
 * spend shouldn't move when money is shuffled between members afterwards.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type {
  TransferSuggestion,
  TripWrapResponse,
  WrapAward,
  WrapMemberRow,
} from '@tripsplit/shared';

import { db, schema } from '../db/index.js';
import { allocateProportional, getTripBalances } from './balances.js';
import { getTripMembers } from './members.js';
import type { TripRow } from './summary.js';

// ---------------------------------------------------------------------------
// Pure compute
// ---------------------------------------------------------------------------

export interface WrapSourceRow {
  payerId: number | null;
  amountMinor: number;
  amountBaseMinor: number;
  currency: string;
  category: string | null;
  description: string | null;
  spentOn: string;
  createdBy: number;
  shares: { userId: number; shareMinor: number }[];
}

export interface WrapSettlementSourceRow {
  amountBaseMinor: number;
}

/**
 * Computes `TripWrapResponse` from a trip's paid expense rows (+shares),
 * its settlement rows, current membership, and its already-computed transfer
 * list — PURE, no DB (see module doc comment for row scope). `memberIds` and
 * `transfers` are passed in rather than derived here for the same reason
 * `computeInsights`/`computeMemberBalances` take `memberIds` explicitly: a
 * member with zero activity still gets a `{ paidBaseMinor: 0 }` line, and
 * `transfers` is the single source of truth for settle-state (no reason to
 * duplicate `computeTransfers`' greedy algorithm here).
 */
export function computeTripWrap(
  rows: WrapSourceRow[],
  settlementRows: WrapSettlementSourceRow[],
  memberIds: number[],
  transfers: TransferSuggestion[],
  trip: { id: string; title: string; baseCurrency: string; archivedAt: string | null },
): TripWrapResponse {
  const totalBaseMinor = rows.reduce((sum, r) => sum + r.amountBaseMinor, 0);
  const expenseCount = rows.length;

  const distinctDays = new Set(rows.map((r) => r.spentOn));
  const dayCount = distinctDays.size;
  const avgPerDayBaseMinor = dayCount > 0 ? Math.round(totalBaseMinor / dayCount) : 0;

  // spentOn is YYYY-MM-DD text, so plain string comparison sorts chronologically.
  let firstSpentOn: string | null = null;
  let lastSpentOn: string | null = null;
  for (const row of rows) {
    if (firstSpentOn === null || row.spentOn < firstSpentOn) firstSpentOn = row.spentOn;
    if (lastSpentOn === null || row.spentOn > lastSpentOn) lastSpentOn = row.spentOn;
  }

  const currenciesUsed = new Set(rows.map((r) => r.currency)).size;

  // members: paid total + fair-share total (allocateProportional, expense-only)
  // + paid count, every current member included (zero activity -> zero row).
  const paid = new Map<number, number>(memberIds.map((id) => [id, 0]));
  const paidCount = new Map<number, number>(memberIds.map((id) => [id, 0]));
  const owed = new Map<number, number>(memberIds.map((id) => [id, 0]));
  for (const row of rows) {
    if (row.payerId === null) continue; // defensive — paid rows always have a payer
    paid.set(row.payerId, (paid.get(row.payerId) ?? 0) + row.amountBaseMinor);
    paidCount.set(row.payerId, (paidCount.get(row.payerId) ?? 0) + 1);

    const weights = row.shares.map((s) => s.shareMinor);
    const allocations = allocateProportional(row.amountBaseMinor, weights);
    row.shares.forEach((share, i) => {
      owed.set(share.userId, (owed.get(share.userId) ?? 0) + (allocations[i] ?? 0));
    });
  }
  const members: WrapMemberRow[] = memberIds
    .map((userId) => ({
      userId,
      paidBaseMinor: paid.get(userId) ?? 0,
      shareBaseMinor: owed.get(userId) ?? 0,
      expensesPaidCount: paidCount.get(userId) ?? 0,
    }))
    .sort((a, b) => b.paidBaseMinor - a.paidBaseMinor || a.userId - b.userId);

  const awards: WrapAward[] = [];

  // sponsor: biggest paid total. `members` is already sorted paidBaseMinor
  // DESC then userId ASC, so its head is exactly the tie-break rule wants.
  const topPayer = members[0];
  if (topPayer && topPayer.paidBaseMinor > 0) {
    awards.push({
      kind: 'sponsor',
      userId: topPayer.userId,
      amountBaseMinor: topPayer.paidBaseMinor,
    });
  }

  // bookkeeper: most expenses logged (createdBy), regardless of who paid.
  const loggedCounts = new Map<number, number>();
  for (const row of rows) {
    loggedCounts.set(row.createdBy, (loggedCounts.get(row.createdBy) ?? 0) + 1);
  }
  const bookkeeper = memberIds
    .map((userId) => ({ userId, count: loggedCounts.get(userId) ?? 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.userId - b.userId)[0];
  if (bookkeeper) {
    awards.push({
      kind: 'bookkeeper',
      userId: bookkeeper.userId,
      count: bookkeeper.count,
    });
  }

  // biggestExpense: single largest amountBaseMinor row, tie-broken by lower
  // payerId. Description falls back to the category glyph when there's none.
  let biggest: {
    amount: number;
    payerId: number;
    description: string | null;
    category: string | null;
  } | null = null;
  for (const row of rows) {
    if (row.payerId === null) continue;
    if (
      biggest === null ||
      row.amountBaseMinor > biggest.amount ||
      (row.amountBaseMinor === biggest.amount && row.payerId < biggest.payerId)
    ) {
      biggest = {
        amount: row.amountBaseMinor,
        payerId: row.payerId,
        description: row.description,
        category: row.category,
      };
    }
  }
  if (biggest) {
    awards.push({
      kind: 'biggestExpense',
      userId: biggest.payerId,
      amountBaseMinor: biggest.amount,
      description: biggest.description ?? biggest.category,
    });
  }

  // busiestDay: date with most expense rows, needs >= 2 to be meaningful.
  // Tie-broken by earliest date (there's no member to break ties by).
  const dayCounts = new Map<string, number>();
  for (const row of rows) {
    dayCounts.set(row.spentOn, (dayCounts.get(row.spentOn) ?? 0) + 1);
  }
  const busiestDay = [...dayCounts.entries()]
    .map(([date, count]) => ({ date, count }))
    .filter((d) => d.count >= 2)
    .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))[0];
  if (busiestDay) {
    awards.push({ kind: 'busiestDay', date: busiestDay.date, count: busiestDay.count });
  }

  // priciestDay: date with largest total — only meaningful once the trip
  // spans 2+ distinct days (with one day it's trivially the whole trip).
  if (dayCount >= 2) {
    const dayTotals = new Map<string, number>();
    for (const row of rows) {
      dayTotals.set(row.spentOn, (dayTotals.get(row.spentOn) ?? 0) + row.amountBaseMinor);
    }
    const priciestDay = [...dayTotals.entries()]
      .map(([date, amountBaseMinor]) => ({ date, amountBaseMinor }))
      .sort(
        (a, b) => b.amountBaseMinor - a.amountBaseMinor || a.date.localeCompare(b.date),
      )[0];
    if (priciestDay) {
      awards.push({
        kind: 'priciestDay',
        date: priciestDay.date,
        amountBaseMinor: priciestDay.amountBaseMinor,
      });
    }
  }

  // currencyCollector: member who PAID in the most distinct currencies,
  // needs >= 2 distinct currencies to be a meaningful "collector".
  const currenciesByPayer = new Map<number, Set<string>>();
  for (const row of rows) {
    if (row.payerId === null) continue;
    const set = currenciesByPayer.get(row.payerId) ?? new Set<string>();
    set.add(row.currency);
    currenciesByPayer.set(row.payerId, set);
  }
  const currencyCollector = memberIds
    .map((userId) => ({ userId, count: currenciesByPayer.get(userId)?.size ?? 0 }))
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count || a.userId - b.userId)[0];
  if (currencyCollector) {
    awards.push({
      kind: 'currencyCollector',
      userId: currencyCollector.userId,
      count: currencyCollector.count,
    });
  }

  // categoryChampion: top 3 non-null categories by total, each paired with
  // whichever member paid the most within that category.
  const categoryTotals = new Map<string, number>();
  for (const row of rows) {
    if (row.category === null) continue;
    categoryTotals.set(
      row.category,
      (categoryTotals.get(row.category) ?? 0) + row.amountBaseMinor,
    );
  }
  const topCategories = [...categoryTotals.entries()]
    .map(([category, totalBaseMinor]) => ({ category, totalBaseMinor }))
    .sort(
      (a, b) =>
        b.totalBaseMinor - a.totalBaseMinor || a.category.localeCompare(b.category),
    )
    .slice(0, 3);

  for (const { category } of topCategories) {
    const perMember = new Map<number, number>();
    for (const row of rows) {
      if (row.category !== category || row.payerId === null) continue;
      perMember.set(row.payerId, (perMember.get(row.payerId) ?? 0) + row.amountBaseMinor);
    }
    const champion = [...perMember.entries()]
      .map(([userId, amountBaseMinor]) => ({ userId, amountBaseMinor }))
      .sort((a, b) => b.amountBaseMinor - a.amountBaseMinor || a.userId - b.userId)[0];
    if (champion) {
      awards.push({
        kind: 'categoryChampion',
        userId: champion.userId,
        amountBaseMinor: champion.amountBaseMinor,
        category,
      });
    }
  }

  // settlements: count + total volume, whenever at least one was recorded.
  if (settlementRows.length > 0) {
    const volume = settlementRows.reduce((sum, r) => sum + r.amountBaseMinor, 0);
    awards.push({
      kind: 'settlements',
      count: settlementRows.length,
      amountBaseMinor: volume,
    });
  }

  return {
    tripId: trip.id,
    title: trip.title,
    baseCurrency: trip.baseCurrency,
    archivedAt: trip.archivedAt,
    totalBaseMinor,
    expenseCount,
    dayCount,
    avgPerDayBaseMinor,
    firstSpentOn,
    lastSpentOn,
    currenciesUsed,
    members,
    awards,
    settled: transfers.length === 0,
    outstandingTransfers: transfers,
  };
}

// ---------------------------------------------------------------------------
// DB-reading assembly — the only function here that touches `db`
// ---------------------------------------------------------------------------

/**
 * `GET /api/trips/:id/wrap` — loads the trip's paid expense rows (+shares),
 * its settlement rows, current membership, and its transfer list (via
 * `getTripBalances`, so settle-state math lives in exactly one place), and
 * wires them through `computeTripWrap`. Takes the full `TripRow` (unlike
 * `getTripInsights`/`getTripBalances`, which only need `baseCurrency`)
 * because the wrap response also echoes `title`/`archivedAt`.
 */
export function getTripWrap(trip: TripRow): TripWrapResponse {
  const memberIds = getTripMembers(trip.id).map((m) => m.id);

  const expenseRows = db
    .select()
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.tripId, trip.id),
        isNull(schema.expenses.deletedAt),
        eq(schema.expenses.status, 'paid'),
        eq(schema.expenses.type, 'expense'),
      ),
    )
    .orderBy(schema.expenses.spentOn, schema.expenses.createdAt, schema.expenses.id)
    .all();

  const shareRows =
    expenseRows.length === 0
      ? []
      : db
          .select()
          .from(schema.expenseShares)
          .where(
            inArray(
              schema.expenseShares.expenseId,
              expenseRows.map((r) => r.id),
            ),
          )
          .all();

  const sharesByExpense = new Map<string, { userId: number; shareMinor: number }[]>();
  for (const share of shareRows) {
    const list = sharesByExpense.get(share.expenseId) ?? [];
    list.push({ userId: share.userId, shareMinor: share.shareMinor });
    sharesByExpense.set(share.expenseId, list);
  }

  const rows: WrapSourceRow[] = expenseRows.map((r) => ({
    payerId: r.payerId,
    amountMinor: r.amountMinor,
    amountBaseMinor: r.amountBaseMinor,
    currency: r.currency,
    category: r.category,
    description: r.description,
    spentOn: r.spentOn,
    createdBy: r.createdBy,
    shares: sharesByExpense.get(r.id) ?? [],
  }));

  const settlementRows = db
    .select({ amountBaseMinor: schema.expenses.amountBaseMinor })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.tripId, trip.id),
        isNull(schema.expenses.deletedAt),
        eq(schema.expenses.type, 'settlement'),
      ),
    )
    .all();

  const { transfers } = getTripBalances(trip.id, trip.baseCurrency);

  return computeTripWrap(rows, settlementRows, memberIds, transfers, {
    id: trip.id,
    title: trip.title,
    baseCurrency: trip.baseCurrency,
    archivedAt: trip.archivedAt,
  });
}

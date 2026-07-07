/**
 * Balance + settlement-suggestion service — Phase 6 (IMPLEMENTATION_PLAN.md
 * §4 "Balance definition" + §5's `GET /api/trips/:id/balances`).
 *
 * **Balance definition** (plan §4, spelled out exactly): for each member,
 *
 *     net = Σ(paid, base) − Σ(owed shares, base)
 *
 * over ALL non-deleted rows, BOTH `type: 'expense'` and `type: 'settlement'`
 * rows. `net > 0` -> the member is owed money (creditor); `net < 0` -> the
 * member owes money (debtor). Invariant: `Σ net == 0` across every member,
 * exactly, in base minor units — always, not just approximately.
 *
 * **Why `allocateProportional` exists (the exactness trick):** each
 * expense/settlement stores one authoritative `amountBaseMinor` (computed
 * once at write time by `computeAmountBaseMinor`, Phase 5) and its
 * `expense_shares` rows in the ORIGINAL currency's minor units
 * (`share_minor`, summing exactly to `amount_minor` — Phase 4's invariant).
 * There is no per-share `amount_base_minor` column, so this file has to
 * *derive* each share's base-currency value from the expense's single
 * stored total. Naively rounding each share independently
 * (`round(amountBaseMinor * shareMinor / amountMinor)`) would NOT
 * necessarily sum back to `amountBaseMinor` (rounding drift), which would
 * silently break the `Σ net == 0` invariant. `allocateProportional` instead
 * applies the exact same largest-remainder technique `splitEqual`
 * (lib/expenses.ts, Phase 4) uses for equal splits — but weighted by each
 * share's proportion of the original amount rather than uniform — so the
 * per-share base allocations always sum to precisely `amountBaseMinor`.
 *
 * Settlement modeling (plan §4): a settlement "D pays C amount X" is a row
 * with `type: 'settlement'`, `payer_id = D`, and exactly one share row
 * (`user_id = C`, `share_minor` = the full `amount_minor`) — structurally
 * identical to a `'solo'`-split expense, so `allocateProportional` handles
 * it for free (single weight == weight sum -> the whole `amountBaseMinor`
 * goes to that one share, no rounding to distribute).
 *
 * **Pure vs. DB-reading split:** `computeMemberBalances` / `computeTransfers`
 * / `computeCurrencyTotals` are pure functions over plain row objects
 * (exactly what the plan's "assert-friendly" brief calls for — tests hand
 * them a hand-built scenario, no DB involved). `getTripBalances` is the only
 * function here that touches `db` — it loads a trip's rows and shares and
 * wires the three pure functions together for the route handler.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { BalancesResponse, CurrencyTotal, MemberBalance, TransferSuggestion } from '@tripsplit/shared';

import { db, schema } from '../db/index.js';
import { getTripMembers } from './members.js';

// ---------------------------------------------------------------------------
// Proportional largest-remainder allocation
// ---------------------------------------------------------------------------

/**
 * Splits integer `total` across `weights` (non-negative integers, typically
 * each share's original-currency `shareMinor`) proportionally, returning
 * integers that sum EXACTLY to `total` — the weighted analogue of
 * `splitEqual` (lib/expenses.ts). Each entry gets `floor(total * weight /
 * weightSum)`, then the leftover remainder (`total` minus the sum of those
 * floors) is handed out one minor unit at a time to the entries with the
 * largest fractional remainder, breaking ties by ascending index (callers
 * pass weights in a stable, deterministic order — ascending user id — so
 * this is fully deterministic).
 *
 * `weightSum === 0` (no real-world caller hits this — every expense/
 * settlement's shares sum to a positive `amountMinor` — but kept safe
 * anyway) hands the whole `total` to the first entry rather than dividing
 * by zero, so the sum-exact invariant still holds trivially.
 */
export function allocateProportional(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum === 0) {
    return weights.map((_, i) => (i === 0 ? total : 0));
  }

  const floors = weights.map((w) => Math.floor((total * w) / weightSum));
  const flooredSum = floors.reduce((sum, f) => sum + f, 0);
  const remainder = total - flooredSum;

  const remainders = weights
    .map((w, i) => ({ i, frac: (total * w) % weightSum }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floors];
  for (let k = 0; k < remainder; k++) {
    const entry = remainders[k];
    if (entry === undefined) continue;
    const current = result[entry.i] ?? 0;
    result[entry.i] = current + 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Per-member net balance
// ---------------------------------------------------------------------------

export interface BalanceSourceRow {
  payerId: number;
  /** ORIGINAL currency minor units — used only as the proportional-allocation weight basis. */
  amountMinor: number;
  /** Converted, stored base-currency minor units — the authoritative total this row's shares must sum to. */
  amountBaseMinor: number;
  shares: { userId: number; shareMinor: number }[];
}

/**
 * Computes `{ paidBaseMinor, owedBaseMinor, netBaseMinor }` per member from
 * a trip's non-deleted expense+settlement rows (see the module doc comment
 * for the exactness argument). `memberIds` is the full current trip
 * membership — passed explicitly (rather than derived from `rows`) so a
 * member with zero activity still gets a `{ net: 0 }` line, and so test
 * scenarios can hand-build a fixed, known member set.
 */
export function computeMemberBalances(
  rows: BalanceSourceRow[],
  memberIds: number[],
): MemberBalance[] {
  const paid = new Map<number, number>(memberIds.map((id) => [id, 0]));
  const owed = new Map<number, number>(memberIds.map((id) => [id, 0]));

  for (const row of rows) {
    paid.set(row.payerId, (paid.get(row.payerId) ?? 0) + row.amountBaseMinor);

    const weights = row.shares.map((s) => s.shareMinor);
    const allocations = allocateProportional(row.amountBaseMinor, weights);
    row.shares.forEach((share, i) => {
      owed.set(share.userId, (owed.get(share.userId) ?? 0) + (allocations[i] ?? 0));
    });
  }

  return memberIds.map((userId) => {
    const paidBaseMinor = paid.get(userId) ?? 0;
    const owedBaseMinor = owed.get(userId) ?? 0;
    return {
      userId,
      paidBaseMinor,
      owedBaseMinor,
      netBaseMinor: paidBaseMinor - owedBaseMinor,
    };
  });
}

// ---------------------------------------------------------------------------
// Greedy min-cash-flow transfer suggestions
// ---------------------------------------------------------------------------

/**
 * Minimal transfer list (plan §4's "Transfer suggestions: greedy min-cash-
 * flow"): split members into creditors (`net > 0`) and debtors (`net < 0`);
 * repeatedly settle the current max creditor against the current max
 * debtor for `min(creditor.net, -debtor.net)`, emit that transfer, and drop
 * whichever side(s) hit zero. Produces at most `n - 1` transfers for `n`
 * members with a non-zero net (standard result for this algorithm — every
 * transfer fully zeroes out at least one side).
 *
 * Deterministic tie-break: both queues are re-sorted by net descending (by
 * *owed* amount descending for debtors) on every iteration, ties broken by
 * ascending `userId` — so the same input balances always produce the exact
 * same transfer list, which is what makes this assertable in tests.
 */
export function computeTransfers(balances: MemberBalance[]): TransferSuggestion[] {
  interface Entry {
    userId: number;
    amount: number; // creditor: net owed to them; debtor: net they owe (positive)
  }

  const creditors: Entry[] = [];
  const debtors: Entry[] = [];
  for (const b of balances) {
    if (b.netBaseMinor > 0) creditors.push({ userId: b.userId, amount: b.netBaseMinor });
    else if (b.netBaseMinor < 0) debtors.push({ userId: b.userId, amount: -b.netBaseMinor });
  }

  const byNetDesc = (a: Entry, b: Entry) => b.amount - a.amount || a.userId - b.userId;

  const transfers: TransferSuggestion[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byNetDesc);
    debtors.sort(byNetDesc);

    const creditor = creditors[0]!;
    const debtor = debtors[0]!;
    const amount = Math.min(creditor.amount, debtor.amount);

    if (amount > 0) {
      transfers.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountBaseMinor: amount,
      });
    }

    creditor.amount -= amount;
    debtor.amount -= amount;

    if (creditor.amount === 0) creditors.shift();
    if (debtor.amount === 0) debtors.shift();
  }

  return transfers;
}

// ---------------------------------------------------------------------------
// Per-currency spend breakdown
// ---------------------------------------------------------------------------

export interface CurrencySourceRow {
  type: string;
  currency: string;
  amountMinor: number;
}

/**
 * Total original spend per currency — **`type: 'expense'` rows only**
 * (settlements are transfers between members, not new trip spend; see
 * `CurrencyTotal`'s doc comment in `@tripsplit/shared`). Sums each
 * currency's own ORIGINAL `amountMinor` (not the base-converted amount) —
 * this is "how much did we actually spend in THB", which is the useful
 * travel stat, not a base-currency-converted double-count of the same money
 * `balances` already accounts for. Sorted by currency code for a stable
 * display order.
 */
export function computeCurrencyTotals(rows: CurrencySourceRow[]): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== 'expense') continue;
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amountMinor);
  }
  return [...totals.entries()]
    .map(([currency, totalMinor]) => ({ currency, totalMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

// ---------------------------------------------------------------------------
// DB-reading assembly — the only function here that touches `db`
// ---------------------------------------------------------------------------

/**
 * `GET /api/trips/:id/balances` (plan §5) — loads the trip's non-deleted
 * expense+settlement rows and their shares, and wires the three pure
 * functions above together. `baseCurrency` is passed in (the caller already
 * has the trip row via `requireMembership`) rather than re-fetched here, so
 * this module never needs to import `lib/trips.ts` (which itself imports
 * `lib/expenses.ts` — passing `baseCurrency` in avoids any risk of a
 * circular import as this file's own callers grow).
 */
export function getTripBalances(tripId: string, baseCurrency: string): BalancesResponse {
  const memberIds = getTripMembers(tripId).map((m) => m.id);

  // Only 'paid' rows count toward balances. 'planned' expenses (budgeted but
  // not yet paid — no payer assigned) are excluded from net balances, transfer
  // suggestions, AND the per-currency spend breakdown (they're not spent yet),
  // since all three derive from `expenseRows`. Settlements are always 'paid'.
  const expenseRows = db
    .select()
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.tripId, tripId),
        isNull(schema.expenses.deletedAt),
        eq(schema.expenses.status, 'paid'),
      ),
    )
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

  const balanceRows: BalanceSourceRow[] = expenseRows.map((r) => ({
    // Non-null here: `expenseRows` is filtered to status='paid' above, and the
    // DB CHECK guarantees a paid row always has a payer.
    payerId: r.payerId as number,
    amountMinor: r.amountMinor,
    amountBaseMinor: r.amountBaseMinor,
    shares: sharesByExpense.get(r.id) ?? [],
  }));

  const balances = computeMemberBalances(balanceRows, memberIds);
  const transfers = computeTransfers(balances);
  const perCurrency = computeCurrencyTotals(
    expenseRows.map((r) => ({
      type: r.type,
      currency: r.currency,
      amountMinor: r.amountMinor,
    })),
  );

  return { balances, transfers, perCurrency, baseCurrency };
}

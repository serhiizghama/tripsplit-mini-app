/**
 * Expense money-math + service helpers — Phase 4 (IMPLEMENTATION_PLAN.md
 * §3/§4/§5, "Expenses Core"). Used by `routes/trips.ts`'s
 * `POST /:id/expenses` (nested under a trip) and `routes/expenses.ts`'s
 * `PATCH`/`DELETE /api/expenses/:id` (top-level — an expense id alone
 * doesn't nest under a trip path).
 *
 * Money rules (plan §3 + this phase's brief):
 *  - All amounts are integer minor units — never floats.
 *  - `expense_shares.share_minor` are in the ORIGINAL currency's minor
 *    units; the invariant `SUM(share_minor) === amount_minor` must hold for
 *    every split mode (`splitEqual`'s largest-remainder rounding, `solo`'s
 *    single full-amount share, `custom`'s client-validated split).
 *  - `amount_base_minor` is computed once at write time and stored — see
 *    `computeAmountBaseMinor` — never recomputed on read.
 *  - Split *intent* (mode + custom weights, or the solo beneficiary) is the
 *    `expense_shares` rows themselves plus `split_mode` — there is no
 *    separate "intent" column. Reconstructing the add-expense form on edit
 *    is just: re-read `splitMode` + `shares` from a `GET`/the create/update
 *    response (see `toExpenseWithShares`).
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { computeAmountBaseMinor } from '@tripsplit/shared';
import type {
  Expense,
  ExpenseShare,
  ExpenseStatus,
  ExpenseType,
  SplitMode,
} from '@tripsplit/shared';
import { nanoid } from 'nanoid';

import { db, schema } from '../db/index.js';
import { AppError } from './errors.js';
import { getTripMembers } from './members.js';
import { getCrossRateLocal } from './rates.js';

const EXPENSE_ID_LENGTH = 12;

export type ExpenseRow = typeof schema.expenses.$inferSelect;
export type ExpenseShareRow = typeof schema.expenseShares.$inferSelect;

export interface ExpenseWithShares extends Expense {
  shares: ExpenseShare[];
}

export interface ShareInput {
  userId: number;
  shareMinor?: number;
}

// ---------------------------------------------------------------------------
// Money math
// ---------------------------------------------------------------------------

/**
 * Largest-remainder equal split: `floor(amount / n)` for every member, then
 * +1 minor unit to the first `amount % n` members in the caller's array
 * order — so the caller must pass a stable, deterministic order (see
 * `computeShares`, which sorts member ids ascending). Exact for every
 * exponent, including exponent-0 currencies (VND/LAK) since it never
 * divides by anything but an integer `n`.
 *
 * Example: `splitEqual(100, 3) === [34, 33, 33]`.
 */
export function splitEqual(amountMinor: number, n: number): number[] {
  if (n <= 0) {
    throw new AppError(
      400,
      'invalid_request',
      'Cannot split an expense with zero trip members',
    );
  }
  const base = Math.floor(amountMinor / n);
  const remainder = amountMinor - base * n; // 0 <= remainder < n
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

// `computeAmountBaseMinor` itself now lives in `@tripsplit/shared` (Phase 5)
// so the server's authoritative write-time conversion and the add-expense
// form's live preview (`web/src/lib/money.ts`) are always the exact same
// formula — re-exported here since every call site in this file (and this
// file's own tests) already imports it from `lib/expenses.ts`.
export { computeAmountBaseMinor };

export interface ResolvedRate {
  rateToBase: number;
  rateOverridden: boolean;
}

/**
 * Rate boundary with Phase 5 (currency engine):
 *  - Same currency as the trip base → the rate is definitionally `1` and
 *    never "overridden"; any client-supplied `rateToBase`/`rateOverridden`
 *    is ignored in this case (it wouldn't mean anything).
 *  - Different currency, client supplied `rateToBase` → treat it as the
 *    manual/prefilled rate; `rateOverridden` reflects the client's own flag
 *    (defaults to `false` if the client didn't say).
 *  - Different currency, no rate supplied → **Phase 5's auto-rate lookup**:
 *    `getCrossRateLocal(spentOn, currency, baseCurrency)` (lib/rates.ts) — a
 *    pure local SQLite read (exact-date cache hit, or the nearest earlier
 *    cached date), the exact same cache `GET /api/rates` serves from. This
 *    is deliberately synchronous/local rather than an on-demand external
 *    fetch: `better-sqlite3` is sync, so expense creation never blocks on a
 *    rate-API round trip. If truly nothing is cached yet for either
 *    currency (fresh deploy, cron hasn't run), there is no safe numeric
 *    default to fall back to — silently storing e.g. rate `1` for a VND->EUR
 *    expense would write a wildly wrong `amount_base_minor` — so this throws
 *    a `422 rate_unavailable` `AppError` instead, asking the caller to supply
 *    a manual rate.
 */
export function resolveRate(
  currency: string,
  baseCurrency: string,
  rateToBaseInput: number | undefined,
  rateOverriddenInput: boolean | undefined,
  spentOn: string,
): ResolvedRate {
  if (currency === baseCurrency) {
    return { rateToBase: 1, rateOverridden: false };
  }
  if (rateToBaseInput !== undefined) {
    return { rateToBase: rateToBaseInput, rateOverridden: rateOverriddenInput === true };
  }
  const cached = getCrossRateLocal(spentOn, currency, baseCurrency);
  if (!cached) {
    throw new AppError(
      422,
      'rate_unavailable',
      `No exchange rate available for ${currency}→${baseCurrency} on ${spentOn}. Enter the rate manually.`,
    );
  }
  return { rateToBase: cached.rate, rateOverridden: false };
}

// ---------------------------------------------------------------------------
// Share computation
// ---------------------------------------------------------------------------

/**
 * Computes `expense_shares` from `splitMode` + inputs, enforcing every rule
 * from the plan's Phase 4.1 brief:
 *  - `equal` → split across ALL current trip members, largest-remainder.
 *  - `solo` → the full amount as one member's share; that member (via
 *    `beneficiaryId` or `sharesInput[0].userId`) must be a trip member.
 *  - `custom` → client supplies every `{ userId, shareMinor }`; every user
 *    must be a trip member, no duplicates, and the shares must sum to
 *    exactly `amountMinor` (rejected with 400 otherwise).
 */
export function computeShares(params: {
  tripId: string;
  splitMode: SplitMode;
  amountMinor: number;
  sharesInput: ShareInput[] | undefined;
  beneficiaryId: number | undefined;
}): { userId: number; shareMinor: number }[] {
  const { tripId, splitMode, amountMinor, sharesInput, beneficiaryId } = params;
  const memberIds = new Set(getTripMembers(tripId).map((m) => m.id));

  if (splitMode === 'equal') {
    // Stable, deterministic tie-break order for the largest remainder —
    // ascending user id, independent of join-timestamp granularity.
    const orderedIds = [...memberIds].sort((a, b) => a - b);
    const amounts = splitEqual(amountMinor, orderedIds.length);
    return orderedIds.map((userId, i) => ({ userId, shareMinor: amounts[i] ?? 0 }));
  }

  if (splitMode === 'solo') {
    const soloUserId = beneficiaryId ?? sharesInput?.[0]?.userId;
    if (soloUserId === undefined) {
      throw new AppError(
        400,
        'invalid_request',
        'solo split requires beneficiaryId or shares[0].userId',
      );
    }
    if (!memberIds.has(soloUserId)) {
      throw new AppError(
        400,
        'invalid_request',
        'solo beneficiary must be a trip member',
      );
    }
    return [{ userId: soloUserId, shareMinor: amountMinor }];
  }

  // custom
  if (!sharesInput || sharesInput.length === 0) {
    throw new AppError(
      400,
      'invalid_request',
      'custom split requires a non-empty shares array',
    );
  }
  const seen = new Set<number>();
  const result: { userId: number; shareMinor: number }[] = [];
  let sum = 0;
  for (const share of sharesInput) {
    if (share.shareMinor === undefined || !Number.isInteger(share.shareMinor)) {
      throw new AppError(
        400,
        'invalid_request',
        'custom split requires an integer shareMinor for every entry',
      );
    }
    if (!memberIds.has(share.userId)) {
      throw new AppError(
        400,
        'invalid_request',
        `user ${share.userId} is not a trip member`,
      );
    }
    if (seen.has(share.userId)) {
      throw new AppError(
        400,
        'invalid_request',
        `duplicate custom share for user ${share.userId}`,
      );
    }
    seen.add(share.userId);
    sum += share.shareMinor;
    result.push({ userId: share.userId, shareMinor: share.shareMinor });
  }
  if (sum !== amountMinor) {
    throw new AppError(
      400,
      'invalid_request',
      `custom shares sum (${sum}) must equal amountMinor (${amountMinor})`,
    );
  }
  return result;
}

/** Throws `400 invalid_request` unless `userId` is a current member of `tripId`. */
export function requireMemberUser(
  tripId: string,
  userId: number,
  roleLabel: string,
): void {
  const isMember = getTripMembers(tripId).some((m) => m.id === userId);
  if (!isMember) {
    throw new AppError(
      400,
      'invalid_request',
      `${roleLabel} (user ${userId}) is not a trip member`,
    );
  }
}

// ---------------------------------------------------------------------------
// Row <-> API shape mapping
// ---------------------------------------------------------------------------

export function toExpenseWithShares(
  row: ExpenseRow,
  shareRows: ExpenseShareRow[],
): ExpenseWithShares {
  return {
    id: row.id,
    tripId: row.tripId,
    type: row.type as ExpenseType,
    payerId: row.payerId,
    status: row.status as ExpenseStatus,
    amountMinor: row.amountMinor,
    currency: row.currency,
    rateToBase: row.rateToBase,
    rateOverridden: Boolean(row.rateOverridden),
    amountBaseMinor: row.amountBaseMinor,
    description: row.description,
    category: row.category,
    splitMode: row.splitMode as SplitMode,
    spentOn: row.spentOn,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    shares: shareRows.map((s) => ({
      expenseId: s.expenseId,
      userId: s.userId,
      shareMinor: s.shareMinor,
    })),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Fetches an expense row by id regardless of soft-delete state, or throws 404. */
export function getExpenseRowOrThrow(expenseId: string): ExpenseRow {
  const row = db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.id, expenseId))
    .get();
  if (!row) {
    throw new AppError(404, 'expense_not_found', 'Expense not found');
  }
  return row;
}

export function getExpenseSharesRows(expenseId: string): ExpenseShareRow[] {
  return db
    .select()
    .from(schema.expenseShares)
    .where(eq(schema.expenseShares.expenseId, expenseId))
    .all();
}

const DEFAULT_EXPENSES_LIMIT = 50;
const MAX_EXPENSES_LIMIT = 200;

export interface ExpensesPage {
  items: ExpenseWithShares[];
  nextCursor: string | null;
}

/**
 * Non-deleted expenses for a trip, newest-`spentOn`-first (ties broken by
 * `createdAt` then `id`, both desc, for a fully deterministic order), each
 * with its shares. Light keyset pagination: `before` is the `id` of the
 * last item from a previous page; the response's `nextCursor` is the `id`
 * to pass as the next page's `before`, or `null` once there's nothing more.
 *
 * Loads the full non-deleted expense list into memory rather than a SQL
 * keyset `WHERE` — trips realistically hold tens to low hundreds of
 * expenses (a travel group, not a ledger at scale), so this stays simple
 * without a real performance cost.
 */
export function getTripExpensesPage(
  tripId: string,
  opts: { limit?: number; before?: string } = {},
): ExpensesPage {
  const limit = Math.min(
    Math.max(opts.limit ?? DEFAULT_EXPENSES_LIMIT, 1),
    MAX_EXPENSES_LIMIT,
  );

  const rows = db
    .select()
    .from(schema.expenses)
    .where(and(eq(schema.expenses.tripId, tripId), isNull(schema.expenses.deletedAt)))
    .orderBy(
      desc(schema.expenses.spentOn),
      desc(schema.expenses.createdAt),
      desc(schema.expenses.id),
    )
    .all();

  let startIndex = 0;
  if (opts.before) {
    const idx = rows.findIndex((row) => row.id === opts.before);
    startIndex = idx === -1 ? 0 : idx + 1;
  }

  const page = rows.slice(startIndex, startIndex + limit);
  const nextCursor =
    startIndex + limit < rows.length ? (page[page.length - 1]?.id ?? null) : null;

  if (page.length === 0) {
    return { items: [], nextCursor: null };
  }

  const shareRows = db
    .select()
    .from(schema.expenseShares)
    .where(
      inArray(
        schema.expenseShares.expenseId,
        page.map((row) => row.id),
      ),
    )
    .all();

  const sharesByExpense = new Map<string, ExpenseShareRow[]>();
  for (const share of shareRows) {
    const list = sharesByExpense.get(share.expenseId) ?? [];
    list.push(share);
    sharesByExpense.set(share.expenseId, list);
  }

  return {
    items: page.map((row) => toExpenseWithShares(row, sharesByExpense.get(row.id) ?? [])),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateExpenseInput {
  tripId: string;
  createdBy: number;
  /** Omit/undefined → a `'planned'` expense (no payer yet, excluded from balances). */
  payerId: number | undefined;
  amountMinor: number;
  currency: string;
  baseCurrency: string;
  splitMode: SplitMode;
  sharesInput: ShareInput[] | undefined;
  beneficiaryId: number | undefined;
  description: string | null | undefined;
  category: string | null | undefined;
  spentOn: string | undefined;
  rateToBaseInput: number | undefined;
  rateOverriddenInput: boolean | undefined;
}

/** `POST /api/trips/:id/expenses` — validates, computes shares/rate/base amount, inserts in one transaction. */
export function createExpense(input: CreateExpenseInput): ExpenseWithShares {
  // No payer → a 'planned' (budgeted, not-yet-paid) expense: skip the payer
  // membership check and mark it planned. Shares + base amount are still
  // computed (the split intent and budget value are known); it just stays out
  // of balances until a payer is assigned (see updateExpense / balances.ts).
  const isPlanned = input.payerId === undefined;
  if (!isPlanned) {
    requireMemberUser(input.tripId, input.payerId as number, 'payer');
  }

  const shares = computeShares({
    tripId: input.tripId,
    splitMode: input.splitMode,
    amountMinor: input.amountMinor,
    sharesInput: input.sharesInput,
    beneficiaryId: input.beneficiaryId,
  });

  const now = new Date().toISOString();
  const spentOn = input.spentOn ?? now.slice(0, 10);

  const { rateToBase, rateOverridden } = resolveRate(
    input.currency,
    input.baseCurrency,
    input.rateToBaseInput,
    input.rateOverriddenInput,
    spentOn,
  );
  const amountBaseMinor = computeAmountBaseMinor(
    input.amountMinor,
    input.currency,
    input.baseCurrency,
    rateToBase,
  );

  const row: ExpenseRow = {
    id: nanoid(EXPENSE_ID_LENGTH),
    tripId: input.tripId,
    type: 'expense',
    payerId: input.payerId ?? null,
    status: isPlanned ? 'planned' : 'paid',
    amountMinor: input.amountMinor,
    currency: input.currency,
    rateToBase,
    rateOverridden: rateOverridden ? 1 : 0,
    amountBaseMinor,
    description: input.description ?? null,
    category: input.category ?? null,
    splitMode: input.splitMode,
    spentOn,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  db.transaction((tx) => {
    tx.insert(schema.expenses).values(row).run();
    tx.insert(schema.expenseShares)
      .values(
        shares.map((s) => ({
          expenseId: row.id,
          userId: s.userId,
          shareMinor: s.shareMinor,
        })),
      )
      .run();
  });

  return toExpenseWithShares(
    row,
    shares.map((s) => ({
      expenseId: row.id,
      userId: s.userId,
      shareMinor: s.shareMinor,
    })),
  );
}

export interface UpdateExpenseInput {
  amountMinor?: number;
  currency?: string;
  payerId?: number;
  splitMode?: SplitMode;
  shares?: ShareInput[];
  beneficiaryId?: number;
  description?: string | null;
  category?: string | null;
  spentOn?: string;
  rateToBase?: number;
  rateOverridden?: boolean;
}

/**
 * `PATCH /api/expenses/:id` — merges `body` onto `existing`, recomputes
 * shares/rate/`amount_base_minor` from the resulting *effective* state, and
 * writes it all in one transaction (shares are replaced wholesale rather
 * than diffed — trip-scale share counts make that simplest and cheapest).
 *
 * Split-intent preservation: when the split mode itself isn't changing,
 * omitted `shares`/`beneficiaryId` fall back to what's already stored
 * (`existingShares`) so an edit that only touches e.g. `description` doesn't
 * disturb a custom split's per-member weights or a solo expense's
 * beneficiary. Switching to a *different* split mode always requires the
 * new mode's inputs explicitly (no guessing which member should inherit a
 * solo/custom role it never had).
 */
export function updateExpense(
  existing: ExpenseRow,
  tripBaseCurrency: string,
  body: UpdateExpenseInput,
): ExpenseWithShares {
  const existingShares = getExpenseSharesRows(existing.id);

  // Payer may be absent (a 'planned' expense edited while still unpaid).
  // Providing `payerId` is the "mark as paid" transition. Only validate
  // membership when there actually is a payer; derive status from it.
  const effectivePayerId = body.payerId ?? existing.payerId;
  if (effectivePayerId !== null) {
    requireMemberUser(existing.tripId, effectivePayerId, 'payer');
  }
  const effectiveStatus: ExpenseStatus = effectivePayerId !== null ? 'paid' : 'planned';

  const effectiveAmount = body.amountMinor ?? existing.amountMinor;
  const effectiveCurrency = body.currency ?? existing.currency;
  const effectiveSplitMode = body.splitMode ?? (existing.splitMode as SplitMode);
  const effectiveSpentOn = body.spentOn ?? existing.spentOn;
  const effectiveDescription =
    body.description !== undefined ? body.description : existing.description;
  const effectiveCategory =
    body.category !== undefined ? body.category : existing.category;

  let sharesInput = body.shares;
  let beneficiaryId = body.beneficiaryId;
  const modeUnchanged = effectiveSplitMode === (existing.splitMode as SplitMode);
  if (sharesInput === undefined && effectiveSplitMode === 'custom' && modeUnchanged) {
    sharesInput = existingShares.map((s) => ({
      userId: s.userId,
      shareMinor: s.shareMinor,
    }));
  }
  if (
    beneficiaryId === undefined &&
    effectiveSplitMode === 'solo' &&
    modeUnchanged &&
    existingShares.length > 0
  ) {
    beneficiaryId = existingShares[0]?.userId;
  }

  const shares = computeShares({
    tripId: existing.tripId,
    splitMode: effectiveSplitMode,
    amountMinor: effectiveAmount,
    sharesInput,
    beneficiaryId,
  });

  // Reusing the stored rate is only valid when it still describes the
  // effective (currency, date) pair: a currency change obviously needs a
  // fresh lookup, but so does a date change for an AUTO (non-overridden)
  // rate — that rate was resolved for the OLD `spentOn`, so keeping it
  // across a back-dated/forward-dated edit would silently apply the wrong
  // day's rate. A manual override, in contrast, is a deliberate user choice
  // and must survive a date change untouched.
  const currencyUnchanged = effectiveCurrency === existing.currency;
  const spentOnChanged = effectiveSpentOn !== existing.spentOn;
  const canReuseStoredRate =
    currencyUnchanged && (Boolean(existing.rateOverridden) || !spentOnChanged);
  const rateToBaseInput =
    body.rateToBase ?? (canReuseStoredRate ? existing.rateToBase : undefined);
  const rateOverriddenInput =
    body.rateOverridden ?? (canReuseStoredRate ? Boolean(existing.rateOverridden) : undefined);
  const { rateToBase, rateOverridden } = resolveRate(
    effectiveCurrency,
    tripBaseCurrency,
    rateToBaseInput,
    rateOverriddenInput,
    effectiveSpentOn,
  );
  const amountBaseMinor = computeAmountBaseMinor(
    effectiveAmount,
    effectiveCurrency,
    tripBaseCurrency,
    rateToBase,
  );

  const now = new Date().toISOString();
  const updatedRow: ExpenseRow = {
    ...existing,
    payerId: effectivePayerId,
    status: effectiveStatus,
    amountMinor: effectiveAmount,
    currency: effectiveCurrency,
    rateToBase,
    rateOverridden: rateOverridden ? 1 : 0,
    amountBaseMinor,
    description: effectiveDescription ?? null,
    category: effectiveCategory ?? null,
    splitMode: effectiveSplitMode,
    spentOn: effectiveSpentOn,
    updatedAt: now,
  };

  db.transaction((tx) => {
    tx.update(schema.expenses)
      .set(updatedRow)
      .where(eq(schema.expenses.id, existing.id))
      .run();
    tx.delete(schema.expenseShares)
      .where(eq(schema.expenseShares.expenseId, existing.id))
      .run();
    tx.insert(schema.expenseShares)
      .values(
        shares.map((s) => ({
          expenseId: existing.id,
          userId: s.userId,
          shareMinor: s.shareMinor,
        })),
      )
      .run();
  });

  return toExpenseWithShares(
    updatedRow,
    shares.map((s) => ({
      expenseId: existing.id,
      userId: s.userId,
      shareMinor: s.shareMinor,
    })),
  );
}

export interface CreateSettlementInput {
  tripId: string;
  createdBy: number;
  /** The debtor — who is paying. */
  payerId: number;
  /** The creditor — who is being paid back. */
  receiverId: number;
  amountMinor: number;
  currency: string;
  baseCurrency: string;
  description: string | null | undefined;
  category: string | null | undefined;
  spentOn: string | undefined;
  rateToBaseInput: number | undefined;
  rateOverriddenInput: boolean | undefined;
}

/**
 * `POST /api/trips/:id/settlements` (Phase 6.3) — plan §4's settlement
 * modeling: "D pays C amount X" is a row with `type: 'settlement'`,
 * `payer_id = D` (the debtor), and exactly one share row — `user_id = C`
 * (the receiver/creditor), `share_minor` = the FULL `amount_minor`. That
 * single-full-share shape is structurally identical to a `'solo'`-split
 * expense (one member's share is the whole amount), so this reuses
 * `splitMode: 'solo'` rather than adding a new DB-level split mode — the
 * schema's `expenses_split_mode_check` only allows `'equal'|'custom'|
 * 'solo'` anyway, and Phase 6's balance math (`lib/balances.ts`) relies on
 * exactly this shape to fold settlements into the same per-share proportional
 * allocation as expenses, for free.
 *
 * Reuses the exact same rate/conversion pipeline as `createExpense`
 * (`resolveRate` + `computeAmountBaseMinor`) — Phase 6.4's "multi-currency
 * settle" requirement (pay back in THB what was spent in EUR) is nothing
 * more than this shared conversion path applied to a settlement row.
 */
export function createSettlement(input: CreateSettlementInput): ExpenseWithShares {
  requireMemberUser(input.tripId, input.payerId, 'payer');
  requireMemberUser(input.tripId, input.receiverId, 'receiver');
  if (input.payerId === input.receiverId) {
    throw new AppError(
      400,
      'invalid_request',
      'A settlement must have a different payer and receiver',
    );
  }

  const now = new Date().toISOString();
  const spentOn = input.spentOn ?? now.slice(0, 10);

  const { rateToBase, rateOverridden } = resolveRate(
    input.currency,
    input.baseCurrency,
    input.rateToBaseInput,
    input.rateOverriddenInput,
    spentOn,
  );
  const amountBaseMinor = computeAmountBaseMinor(
    input.amountMinor,
    input.currency,
    input.baseCurrency,
    rateToBase,
  );

  const row: ExpenseRow = {
    id: nanoid(EXPENSE_ID_LENGTH),
    tripId: input.tripId,
    type: 'settlement',
    payerId: input.payerId,
    status: 'paid', // a settlement is, by definition, a paid transfer
    amountMinor: input.amountMinor,
    currency: input.currency,
    rateToBase,
    rateOverridden: rateOverridden ? 1 : 0,
    amountBaseMinor,
    description: input.description ?? null,
    category: input.category ?? null,
    splitMode: 'solo',
    spentOn,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  const shares = [{ userId: input.receiverId, shareMinor: input.amountMinor }];

  db.transaction((tx) => {
    tx.insert(schema.expenses).values(row).run();
    tx.insert(schema.expenseShares)
      .values(
        shares.map((s) => ({
          expenseId: row.id,
          userId: s.userId,
          shareMinor: s.shareMinor,
        })),
      )
      .run();
  });

  return toExpenseWithShares(
    row,
    shares.map((s) => ({ expenseId: row.id, userId: s.userId, shareMinor: s.shareMinor })),
  );
}

/** `DELETE /api/expenses/:id` — soft delete; idempotent (re-deleting just re-stamps `deletedAt`). */
export function softDeleteExpense(expenseId: string): void {
  const now = new Date().toISOString();
  db.update(schema.expenses)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(schema.expenses.id, expenseId))
    .run();
}

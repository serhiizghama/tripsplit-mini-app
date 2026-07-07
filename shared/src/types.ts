/**
 * Shared domain types (STUB — Phase 0).
 *
 * Mirrors the data model in IMPLEMENTATION_PLAN.md §4. These are plain TS
 * interfaces, not DB row types or Drizzle schema — Phase 1 ("Backend
 * Foundation: DB + Auth") owns the actual SQLite/Drizzle schema and may
 * refine these. Kept here so web and server can share request/response
 * shapes without duplicating them.
 *
 * Money rule: every amount is an integer in the currency's minor units
 * (see currencies.ts `exponent`). Never a float. Never a helper that
 * divides money by a non-integer.
 */

export type SplitMode = 'equal' | 'custom' | 'solo';

export type ExpenseType = 'expense' | 'settlement';

/**
 * Expense lifecycle: `'planned'` = budgeted but not yet paid (no payer assigned
 * yet, excluded from balances); `'paid'` = a payer is set and it counts toward
 * who-owes-whom. Settlements are always `'paid'`.
 */
export type ExpenseStatus = 'planned' | 'paid';

export type RateSource = 'open-er-api' | 'fawazahmed0' | 'coingecko' | 'manual';

export interface User {
  id: number; // Telegram user id
  firstName: string;
  lastName?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  lang: string; // resolved UI language: 'en' | 'ru' | 'uk'
  createdAt: string;
  updatedAt: string;
}

export interface Trip {
  id: string; // nanoid(12)
  title: string;
  baseCurrency: string; // ISO 4217 or 'USDT'
  inviteCode: string; // nanoid(16)
  createdBy: number;
  createdAt: string;
  archivedAt?: string | null;
}

export interface TripMember {
  tripId: string;
  userId: number;
  joinedAt: string;
}

/**
 * `/api/me` trip-list item — Phase 3. Same fields as `Trip` plus a cheap
 * member count so the (future) trip switcher can render "3 members" without
 * a second round trip. Computed server-side from `trip_members`.
 */
export interface TripSummary extends Trip {
  memberCount: number;
}

/**
 * A trip member as embedded in trip-detail responses (Phase 3) — enough to
 * render an avatar (`photoUrl` → `/api/avatar/:userId` proxy → initials) and
 * a name/username line. Deliberately keeps `firstName`/`lastName` separate
 * (rather than a single flattened `name`) so the same `initials()` helper
 * used for the current user also works for other members.
 */
export interface TripMemberView {
  id: number; // Telegram user id
  firstName: string;
  lastName?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  joinedAt: string;
}

/**
 * Full trip detail — `GET /api/trips/:id`, `POST /api/trips/join`, and
 * `PATCH /api/trips/:id` all return this shape (Phase 3).
 */
export interface TripDetail extends Trip {
  members: TripMemberView[];
  /**
   * Non-deleted expenses, `spentOn` desc (ties broken by `createdAt` then
   * `id`, both desc, for a fully deterministic order) — Phase 4. Lightly
   * paginated: see `expensesNextCursor`.
   */
  expenses: ExpenseWithShares[];
  /**
   * Opaque cursor (an expense id) for the next older page — pass it back as
   * `?expensesBefore=` on `GET /api/trips/:id`. `null`/absent when the
   * current page reached the end.
   */
  expensesNextCursor?: string | null;
  // Balances (net per member, transfer suggestions) deliberately do NOT live
  // on this shape — Phase 6 ships them as their own `GET
  // /api/trips/:id/balances` (`BalancesResponse` below) instead, so the
  // trip-feed fetch (which doesn't need balances) never pays for computing
  // them. See `useBalances` (web/src/api/queries.ts).
  inviteLink: string;
}

/** `POST /api/trips` request body — Phase 3.1. */
export interface CreateTripRequest {
  title: string;
  baseCurrency: string;
}

/** `POST /api/trips` response — Phase 3.1. */
export interface CreateTripResponse {
  trip: Trip;
  inviteLink: string;
}

/** `POST /api/trips/join` request body — `inviteCode` comes from `start_param`. */
export interface JoinTripRequest {
  inviteCode: string;
}

/**
 * `GET /api/trips/join-info?code=<inviteCode>` response — Phase 3.3 invite
 * preview. Lets the join screen show WHICH trip and WHO set it up before the
 * user commits to joining. Keyed by the (random 16-char) invite code, so it
 * reveals nothing a code-holder couldn't already get by joining outright.
 */
export interface TripJoinInfo {
  title: string;
  baseCurrency: string;
  /** First name of the trip's creator — the person who set the trip up. */
  createdByName: string;
  memberCount: number;
}

/**
 * `PATCH /api/trips/:id` request body — Phase 3.1. At least one field must
 * be present; `baseCurrency` is rejected once the trip has any (non-deleted)
 * expenses.
 */
export interface UpdateTripRequest {
  title?: string;
  baseCurrency?: string;
}

export interface ExpenseShare {
  expenseId: string;
  userId: number;
  /** In ORIGINAL currency minor units. Sum of shares === expense.amountMinor. */
  shareMinor: number;
}

export interface Expense {
  id: string; // nanoid(12)
  tripId: string;
  type: ExpenseType;
  /** `null` only for a `'planned'` expense (no payer assigned yet). */
  payerId: number | null;
  /** `'planned'` (budgeted, no payer, not in balances) or `'paid'`. */
  status: ExpenseStatus;
  amountMinor: number; // original currency, minor units
  currency: string;
  rateToBase: number; // fixed at spentOn date; user-overridable
  rateOverridden: boolean;
  amountBaseMinor: number; // converted once, stored
  description?: string | null;
  category?: string | null;
  splitMode: SplitMode;
  spentOn: string; // date
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

/** An expense (or, from Phase 6, a settlement) with its computed shares. */
export interface ExpenseWithShares extends Expense {
  shares: ExpenseShare[];
}

/** A single custom/solo share entry in a create/update expense request. */
export interface ExpenseShareInput {
  userId: number;
  /**
   * Required for `splitMode: 'custom'` (every entry). For `splitMode: 'solo'`,
   * `shares: [{ userId }]` (shareMinor omitted) is an accepted alternative to
   * `beneficiaryId` — the server assigns the full amount to that one user.
   * Ignored entirely for `splitMode: 'equal'`.
   */
  shareMinor?: number;
}

/**
 * `POST /api/trips/:id/expenses` request body — Phase 4.1. The server derives
 * `expense_shares` from `splitMode` + these inputs (see
 * IMPLEMENTATION_PLAN.md's Phase 4 brief / `server/src/lib/expenses.ts`'s
 * `computeShares` for the exact per-mode rules), and always computes +
 * stores `amountBaseMinor` itself — never trust a client-supplied one.
 *
 * Rate boundary with Phase 5 (currency engine): `rateToBase`/`rateOverridden`
 * are accepted here so every expense always has *some* rate on write, but
 * Phase 4 never fetches a rate itself. See `resolveRate` in
 * `server/src/lib/expenses.ts` for the exact fallback rules and the
 * `TODO(Phase 5)` marking where the auto-rate lookup plugs in.
 */
export interface CreateExpenseRequest {
  amountMinor: number;
  currency: string;
  /**
   * Who paid. Omit to create a `'planned'` expense (budgeted, no payer yet) —
   * it's logged and split-previewed but excluded from balances until a payer
   * is assigned via `PATCH /api/expenses/:id`.
   */
  payerId?: number;
  splitMode: SplitMode;
  /** Required for `'custom'` (every trip-member share); see `ExpenseShareInput`. */
  shares?: ExpenseShareInput[];
  /** `'solo'` split's sole share-holder; alternative to `shares: [{ userId }]`. */
  beneficiaryId?: number;
  description?: string | null;
  /** Emoji category key (see `EXPENSE_CATEGORIES` in `categories.ts`), or any short string. */
  category?: string | null;
  /** Date (`YYYY-MM-DD`, UTC); defaults to today when omitted. */
  spentOn?: string;
  rateToBase?: number;
  rateOverridden?: boolean;
}

/**
 * `PATCH /api/expenses/:id` request body — every field is optional/partial.
 * Fields omitted keep their existing stored value; split intent (mode +
 * custom weights or solo beneficiary) is preserved from the stored
 * `expense_shares` when the split mode itself doesn't change — see
 * `updateExpense` in `server/src/lib/expenses.ts`.
 */
export type UpdateExpenseRequest = Partial<CreateExpenseRequest>;

export interface Rate {
  date: string; // YYYY-MM-DD (UTC)
  base: string; // always 'USD' internally
  currency: string;
  rate: number;
  source: RateSource;
}

/**
 * Per-member balance line — Phase 6 (`GET /api/trips/:id/balances`). All
 * three fields are in **trip base-currency minor units**, computed over
 * every non-deleted `expense`- and `settlement`-type row (plan §4):
 *
 *     netBaseMinor = paidBaseMinor - owedBaseMinor
 *
 * Positive `netBaseMinor` -> this member is owed money (creditor); negative
 * -> this member owes money (debtor). `Σ netBaseMinor` over every member of
 * a trip is always exactly `0` (see `server/src/lib/balances.ts`'s
 * `allocateProportional`, which is what keeps this exact down to the minor
 * unit despite currency-conversion rounding).
 */
export interface MemberBalance {
  userId: number;
  /** Sum of `amountBaseMinor` for rows this member paid (`payerId`). */
  paidBaseMinor: number;
  /** Sum of this member's `expense_shares` rows, converted to base. */
  owedBaseMinor: number;
  /** `paidBaseMinor - owedBaseMinor`. Positive = is owed money. */
  netBaseMinor: number;
}

/**
 * One suggested transfer from the greedy min-cash-flow simplification (plan
 * §4's "Transfer suggestions"): `fromUserId` (a debtor) should pay
 * `toUserId` (a creditor) `amountBaseMinor` (trip base-currency minor
 * units) to move both closer to zero. The full `transfers` list produced by
 * `server/src/lib/balances.ts`'s `computeTransfers` settles every non-zero
 * balance in at most `n - 1` transfers for `n` members with a non-zero net.
 */
export interface TransferSuggestion {
  fromUserId: number;
  toUserId: number;
  amountBaseMinor: number;
}

/**
 * Per-currency spend total — Phase 6's "per-currency breakdown". Scope
 * decision (see `server/src/lib/balances.ts` doc comment): **`expense`-type
 * rows only**, summed in each currency's own ORIGINAL minor units
 * (`amountMinor`, not the base-converted amount) — settlements are
 * transfers between members, not new trip spend, so they're excluded here.
 */
export interface CurrencyTotal {
  currency: string;
  totalMinor: number;
}

/** `GET /api/trips/:id/balances` response — Phase 6 (plan §5). */
export interface BalancesResponse {
  balances: MemberBalance[];
  transfers: TransferSuggestion[];
  perCurrency: CurrencyTotal[];
  baseCurrency: string;
}

/**
 * `POST /api/trips/:id/settlements` request body — Phase 6.3/6.4. Models
 * "`payerId` (the debtor) pays `receiverId` (the creditor) `amountMinor`
 * `currency`" — the server builds the single `expense_shares` row
 * (`receiverId` gets the full `amountMinor` share, mirroring a `'solo'`
 * split) and converts to base exactly like an expense (`rateToBase`/
 * `rateOverridden` optional overrides, same rate boundary as
 * `CreateExpenseRequest`).
 */
export interface CreateSettlementRequest {
  /** The debtor — the member who is paying. */
  payerId: number;
  /** The creditor — the member being paid back. */
  receiverId: number;
  amountMinor: number;
  currency: string;
  description?: string | null;
  category?: string | null;
  /** Date (`YYYY-MM-DD`, UTC); defaults to today when omitted. */
  spentOn?: string;
  rateToBase?: number;
  rateOverridden?: boolean;
}

/** `GET /api/me` response — the authenticated user + the trips they belong to. */
export interface MeResponse {
  user: User;
  trips: TripSummary[];
}

/**
 * `PATCH /api/me` request body — Phase 7 i18n §9's "user override stored in
 * `users.lang`". This is the *only* thing that changes a user's `lang` after
 * their first-seen insert — see `server/src/middleware/auth.ts`'s
 * `upsertUserFromTelegram` doc comment for why the per-request upsert no
 * longer overwrites it from Telegram's `language_code` on every call.
 * Response shape is the same `MeResponse` as `GET /api/me`.
 */
export interface UpdateMeRequest {
  lang: 'en' | 'ru' | 'uk';
}

/** Shape of a JSON error response — see IMPLEMENTATION_PLAN.md §5. */
export interface ApiErrorBody {
  code: string;
  message: string;
}

/**
 * Per-category spend total — trip insights' "by category" breakdown.
 * `category` mirrors the expense's own nullable `category` column; `null` is
 * its own group (uncategorized spend), not dropped.
 */
export interface CategoryTotal {
  category: string | null;
  totalBaseMinor: number;
}

/** Per-day spend total — trip insights' "by day" breakdown. `date` is `YYYY-MM-DD` (`spentOn`). */
export interface DailyTotal {
  date: string;
  totalBaseMinor: number;
}

/** Per-member paid total — trip insights' "by member" breakdown. Includes members who paid nothing (`paidBaseMinor: 0`). */
export interface MemberSpend {
  userId: number;
  paidBaseMinor: number;
}

/** The single largest paid expense in a trip, as surfaced by trip insights. */
export interface LargestExpense {
  amountBaseMinor: number;
  amountMinor: number;
  currency: string;
  category: string | null;
  description: string | null;
}

/**
 * `GET /api/trips/:id/insights` response — trip statistics computed over
 * every non-deleted, `status: 'paid'`, `type: 'expense'` row (settlements and
 * still-`planned` expenses are excluded — see `server/src/lib/insights.ts`).
 * All amounts are trip base-currency minor units.
 */
export interface InsightsResponse {
  baseCurrency: string;
  /** Sum of `amountBaseMinor` over every counted row. */
  totalBaseMinor: number;
  /** Count of counted rows. */
  expenseCount: number;
  /** Number of distinct `spentOn` dates among counted rows. */
  dayCount: number;
  /** `round(totalBaseMinor / dayCount)`; `0` when `dayCount` is `0`. */
  avgPerDayBaseMinor: number;
  /** The single largest counted expense, or `null` if there are none. */
  largest: LargestExpense | null;
  /** Sorted by `totalBaseMinor` descending. */
  byCategory: CategoryTotal[];
  /** Sorted by `date` ascending. */
  byDay: DailyTotal[];
  /** Every current trip member, sorted by `paidBaseMinor` descending then `userId` ascending. */
  byMember: MemberSpend[];
}

/**
 * `GET /api/health` response — Phase 8.2. Stays public (no auth) so an
 * external uptime monitor can hit it with no credentials. `lastRateFetch` is
 * `null` when the `rates` table is empty (fresh deploy, before the first
 * daily fetch/backfill has ever run) rather than an error — that's a normal,
 * expected state, not a health failure by itself.
 */
export interface HealthResponse {
  ok: boolean;
  db: 'up' | 'down';
  lastRateFetch: { date: string; ageHours: number } | null;
  uptimeSeconds: number;
}

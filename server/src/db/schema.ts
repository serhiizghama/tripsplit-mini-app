/**
 * Drizzle ORM schema — mirrors IMPLEMENTATION_PLAN.md §4 EXACTLY (table/column
 * names, types, PKs, FKs, CHECK constraints, defaults). See that file for the
 * canonical SQL and column comments; this file is the source of truth for
 * `drizzle-kit generate`, which emits the actual SQL migrations into
 * `server/drizzle/`.
 *
 * Money rule: amount columns are INTEGER minor units, never floats. Rates are
 * REAL. Timestamps are TEXT ISO-8601 strings (app-generated, not SQLite
 * `CURRENT_TIMESTAMP`, so behavior is identical in tests and prod).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

/** users: Telegram identity, cached profile. */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: false }), // Telegram user id
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  username: text('username'),
  photoUrl: text('photo_url'), // from initData (Bot API 8.0+), best-effort
  lang: text('lang').notNull().default('en'), // resolved UI language
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const trips = sqliteTable('trips', {
  id: text('id').primaryKey(), // nanoid(12)
  title: text('title').notNull(),
  baseCurrency: text('base_currency').notNull(), // ISO 4217 or 'USDT'
  inviteCode: text('invite_code').notNull().unique(), // nanoid(16), fits 64-char startapp limit
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
});

export const tripMembers = sqliteTable(
  'trip_members',
  {
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    joinedAt: text('joined_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.tripId, table.userId] })],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(), // nanoid(12)
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    type: text('type').notNull(), // 'expense' | 'settlement' — see CHECK below
    // settlement: payer_id pays, single share row = receiver
    // Nullable ONLY for 'planned' expenses (budgeted but not yet paid — no payer
    // assigned yet). Enforced consistent with `status` by a CHECK below.
    payerId: integer('payer_id').references(() => users.id),
    // 'planned' | 'paid'. A 'planned' expense has no payer yet and is excluded
    // from balances until someone is assigned as payer (then it becomes 'paid').
    // Settlements are always 'paid'. See CHECK below.
    status: text('status').notNull().default('paid'),
    amountMinor: integer('amount_minor').notNull(), // original currency, minor units
    currency: text('currency').notNull(),
    rateToBase: real('rate_to_base').notNull(), // fixed at spent_on date; user-overridable
    rateOverridden: integer('rate_overridden').notNull().default(0),
    amountBaseMinor: integer('amount_base_minor').notNull(), // converted once, stored
    description: text('description'), // optional
    category: text('category'), // nullable; emoji-key, e.g. 'food'
    splitMode: text('split_mode').notNull().default('equal'), // 'equal'|'custom'|'solo' (intent!) — see CHECK below
    spentOn: text('spent_on').notNull(), // date, defaults today
    createdBy: integer('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'), // soft delete
  },
  (table) => [
    check('expenses_type_check', sql`${table.type} IN ('expense','settlement')`),
    check(
      'expenses_split_mode_check',
      sql`${table.splitMode} IN ('equal','custom','solo')`,
    ),
    check('expenses_status_check', sql`${table.status} IN ('planned','paid')`),
    // A 'paid' row must have a payer; a 'planned' row must not — keeps the
    // two-state lifecycle self-consistent at the DB level.
    check(
      'expenses_planned_payer_check',
      sql`(${table.status} = 'paid' AND ${table.payerId} IS NOT NULL) OR (${table.status} = 'planned' AND ${table.payerId} IS NULL)`,
    ),
  ],
);

export const expenseShares = sqliteTable(
  'expense_shares',
  {
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    shareMinor: integer('share_minor').notNull(), // in ORIGINAL currency minor units
    // invariant (app-enforced, not a DB constraint): SUM(share_minor) == amount_minor (largest-remainder rounding)
  },
  (table) => [primaryKey({ columns: [table.expenseId, table.userId] })],
);

// trip↔group-chat binding, created by `/link` in the bot. A trip may be
// linked to multiple chats; a chat may host multiple trips.
export const tripChats = sqliteTable(
  'trip_chats',
  {
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    chatId: integer('chat_id').notNull(), // Telegram chat id (groups are negative)
    chatTitle: text('chat_title'), // best-effort group title, for display in Settings
    linkedBy: integer('linked_by')
      .notNull()
      .references(() => users.id), // who ran /link
    linkedAt: text('linked_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.tripId, table.chatId] })],
);

export const rates = sqliteTable(
  'rates',
  {
    date: text('date').notNull(), // YYYY-MM-DD (UTC)
    base: text('base').notNull(), // always 'USD' internally
    currency: text('currency').notNull(),
    rate: real('rate').notNull(),
    source: text('source').notNull(), // 'open-er-api' | 'fawazahmed0' | 'coingecko' | 'manual'
    // rule (app-enforced): past dates are never overwritten
  },
  (table) => [primaryKey({ columns: [table.date, table.base, table.currency] })],
);

/**
 * Trip service helpers — Phase 3.1/3.3 (+ Phase 4's expense embedding in
 * `toTripDetail`). Shared by `routes/trips.ts` (and, for the member count,
 * `src/index.ts`'s `/api/me`) so membership checks and the trip-detail
 * assembly logic exist exactly once.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { TripDetail } from '@tripsplit/shared';

import { db, schema } from '../db/index.js';
import { AppError } from './errors.js';
import { getTripExpensesPage } from './expenses.js';
import { getTripMembers } from './members.js';

type TripRow = typeof schema.trips.$inferSelect;

/** Fetches a trip by id, or throws the `404 trip_not_found` the plan calls for. */
export function getTripOrThrow(tripId: string): TripRow {
  const trip = db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).get();
  if (!trip) {
    throw new AppError(404, 'trip_not_found', 'Trip not found');
  }
  return trip;
}

/**
 * Loads the trip and verifies `userId` is a member, else throws — `404` if
 * the trip itself doesn't exist, `403 forbidden` if it exists but the caller
 * isn't a member. Every trip-scoped route must call this before doing
 * anything else, so another user's trip is never leaked.
 */
export function requireMembership(tripId: string, userId: number): TripRow {
  const trip = getTripOrThrow(tripId);

  const membership = db
    .select()
    .from(schema.tripMembers)
    .where(
      and(eq(schema.tripMembers.tripId, tripId), eq(schema.tripMembers.userId, userId)),
    )
    .get();

  if (!membership) {
    throw new AppError(403, 'forbidden', 'You are not a member of this trip');
  }
  return trip;
}

/**
 * Invite deep link. Uses the BOT deep-link form `https://t.me/<bot>?start=<code>`
 * (NOT the Mini App `t.me/<bot>/<app>?startapp=` form) so invites work without
 * a BotFather-registered Mini App: tapping it makes Telegram send `/start <code>`
 * to the bot, which replies with a Web App button that carries the code into
 * the app (see server/src/bot.ts + web getStartParam). Falls back to a
 * placeholder username so the API never 500s over missing env.
 */
export function buildInviteLink(inviteCode: string): string {
  const botUsername = process.env.BOT_USERNAME || 'your_bot';
  return `https://t.me/${botUsername}?start=${inviteCode}`;
}

/** True if the trip has at least one non-soft-deleted expense row. */
export function hasNonDeletedExpenses(tripId: string): boolean {
  const row = db
    .select({ id: schema.expenses.id })
    .from(schema.expenses)
    .where(and(eq(schema.expenses.tripId, tripId), isNull(schema.expenses.deletedAt)))
    .limit(1)
    .get();
  return Boolean(row);
}

/**
 * Assembles the full `TripDetail` response shape used by `GET /api/trips/:id`,
 * `POST /api/trips/join`, and `PATCH /api/trips/:id`. `expensesOpts` lets
 * `GET /api/trips/:id` forward its `?expensesLimit=&expensesBefore=` query
 * params through to the (Phase 4) expense pagination; every other caller
 * gets the default first page.
 */
export function toTripDetail(
  trip: TripRow,
  expensesOpts: { expensesLimit?: number; expensesBefore?: string } = {},
): TripDetail {
  const expensesPage = getTripExpensesPage(trip.id, {
    limit: expensesOpts.expensesLimit,
    before: expensesOpts.expensesBefore,
  });

  return {
    id: trip.id,
    title: trip.title,
    baseCurrency: trip.baseCurrency,
    inviteCode: trip.inviteCode,
    createdBy: trip.createdBy,
    createdAt: trip.createdAt,
    archivedAt: trip.archivedAt,
    members: getTripMembers(trip.id),
    expenses: expensesPage.items,
    expensesNextCursor: expensesPage.nextCursor,
    inviteLink: buildInviteLink(trip.inviteCode),
  };
}

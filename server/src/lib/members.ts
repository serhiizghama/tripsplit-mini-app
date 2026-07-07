/**
 * Trip-membership read helper, split out of `lib/trips.ts` (Phase 3) so
 * `lib/expenses.ts` (Phase 4) can depend on `getTripMembers` — payer/share
 * validation and the equal-split computation both need the current member
 * list — without a circular import between `trips.ts` (which needs expense
 * helpers to assemble `TripDetail.expenses`) and `expenses.ts` (which needs
 * membership). Both of those files import from here instead of each other
 * for this one function.
 */
import { eq } from 'drizzle-orm';
import type { TripMemberView } from '@tripsplit/shared';

import { db, schema } from '../db/index.js';

/** All members of a trip, joined-date ascending (creator first). */
export function getTripMembers(tripId: string): TripMemberView[] {
  const rows = db
    .select({ user: schema.users, joinedAt: schema.tripMembers.joinedAt })
    .from(schema.tripMembers)
    .innerJoin(schema.users, eq(schema.tripMembers.userId, schema.users.id))
    .where(eq(schema.tripMembers.tripId, tripId))
    .orderBy(schema.tripMembers.joinedAt)
    .all();

  return rows.map(({ user, joinedAt }) => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    photoUrl: user.photoUrl,
    joinedAt,
  }));
}

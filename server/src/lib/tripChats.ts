/**
 * `trip_chats` service — Export & Group Nudges plan
 * (`docs/EXPORT_NUDGES_PLAN.md`) task T3. Backs the bot's `/link`/`/unlink`
 * commands and gives T4's nudge hooks / T5's export the linked-chat lookups
 * they send to. A trip may be linked to multiple chats; a chat may (in
 * theory) host multiple trips — the PK is `(trip_id, chat_id)`.
 */
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';

type TripRow = typeof schema.trips.$inferSelect;
type TripChatRow = typeof schema.tripChats.$inferSelect;

export interface LinkTripChatParams {
  inviteCode: string;
  chatId: number;
  chatTitle?: string | null;
  linkedBy: number;
}

/**
 * Resolves `inviteCode` to a trip (case-sensitive exact match, same as the
 * join flow — see `routes/trips.ts`'s `POST /join`) and upserts the
 * `(tripId, chatId)` binding. Re-linking the same chat to the same trip
 * refreshes `chatTitle`/`linkedBy`/`linkedAt`. Returns `undefined` for an
 * unknown code — the caller replies with `linkUnknownCode`.
 */
export function linkTripChat(params: LinkTripChatParams): { trip: TripRow } | undefined {
  const trip = db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.inviteCode, params.inviteCode))
    .get();
  if (!trip) return undefined;

  const now = new Date().toISOString();
  db.insert(schema.tripChats)
    .values({
      tripId: trip.id,
      chatId: params.chatId,
      chatTitle: params.chatTitle ?? null,
      linkedBy: params.linkedBy,
      linkedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.tripChats.tripId, schema.tripChats.chatId],
      set: {
        chatTitle: params.chatTitle ?? null,
        linkedBy: params.linkedBy,
        linkedAt: now,
      },
    })
    .run();

  return { trip };
}

/**
 * Removes ALL `trip_chats` bindings for `chatId` — a chat is usually linked
 * to one trip, so `/unlink` (no args) clearing everything keeps the command
 * simple. Returns the titles of the trips that were unlinked, for the
 * confirmation message(s).
 */
export function unlinkChat(chatId: number): { tripTitles: string[] } {
  const rows = db
    .select({ trip: schema.trips })
    .from(schema.tripChats)
    .innerJoin(schema.trips, eq(schema.tripChats.tripId, schema.trips.id))
    .where(eq(schema.tripChats.chatId, chatId))
    .all();

  db.delete(schema.tripChats).where(eq(schema.tripChats.chatId, chatId)).run();

  return { tripTitles: rows.map((r) => r.trip.title) };
}

/** All chat bindings for a trip — used by T4's nudges / T5's export to find where to post. */
export function getLinkedChats(tripId: string): TripChatRow[] {
  return db.select().from(schema.tripChats).where(eq(schema.tripChats.tripId, tripId)).all();
}

/** Removes a single `(tripId, chatId)` binding — used for auto-unlink from `botSend.ts`. */
export function removeChatBinding(tripId: string, chatId: number): void {
  db.delete(schema.tripChats)
    .where(and(eq(schema.tripChats.tripId, tripId), eq(schema.tripChats.chatId, chatId)))
    .run();
}

/** All trips linked to a chat — backs `/summary`. */
export function getTripsForChat(chatId: number): TripRow[] {
  return db
    .select({ trip: schema.trips })
    .from(schema.tripChats)
    .innerJoin(schema.trips, eq(schema.tripChats.tripId, schema.trips.id))
    .where(eq(schema.tripChats.chatId, chatId))
    .all()
    .map((r) => r.trip);
}

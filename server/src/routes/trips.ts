/**
 * Trip CRUD + invite/join routes — IMPLEMENTATION_PLAN.md §5, Phase 3.1/3.3.
 * Mounted at `/api/trips` in `src/index.ts`, behind the `/api/*` auth
 * middleware, so `c.get('user')` is always populated here.
 *
 * Request bodies are camelCase (`baseCurrency`, `inviteCode`), matching the
 * `@tripsplit/shared` TS types and every existing response shape in this
 * codebase (`MeResponse`, `AuthUser`, ...) — the plan's §5 pseudocode writes
 * `base_currency`/`invite_code` at the illustrative/DB-column level, but
 * there's no case-conversion layer anywhere in the app, so camelCase
 * end-to-end keeps request and response bodies consistent with each other.
 */
import type {
  BalancesResponse,
  CreateTripResponse,
  ExpenseWithShares,
  ExportTripResponse,
  InsightsResponse,
  TripDetail,
  TripJoinInfo,
  TripWrapResponse,
} from '@tripsplit/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db, schema } from '../db/index.js';
import { getTripBalances } from '../lib/balances.js';
import { resolveBotLocale } from '../lib/botMessages.js';
import { sendBotMessage } from '../lib/botSend.js';
import { AppError } from '../lib/errors.js';
import { createExpense, createSettlement } from '../lib/expenses.js';
import { getTripInsights } from '../lib/insights.js';
import { getTripMembers } from '../lib/members.js';
import {
  notifyExpenseCreated,
  notifySettlementCreated,
  notifyTripClosed,
} from '../lib/notify.js';
import { buildTripSummaryMessage } from '../lib/summary.js';
import { getLinkedChats } from '../lib/tripChats.js';
import {
  buildInviteLink,
  getTripOrThrow,
  hasNonDeletedExpenses,
  requireActiveTrip,
  requireMembership,
  toTripDetail,
} from '../lib/trips.js';
import { getTripWrap } from '../lib/wrap.js';
import { currencyCodeSchema, validateJsonBody } from '../lib/validate.js';

const TRIP_ID_LENGTH = 12;
const INVITE_CODE_LENGTH = 16;

// Phase 4.1: `POST /:id/expenses` body — see IMPLEMENTATION_PLAN.md's Phase 4
// brief and `@tripsplit/shared`'s `CreateExpenseRequest` doc comment for the
// exact per-split-mode rules `computeShares` (lib/expenses.ts) enforces.
const expenseShareInputSchema = z.object({
  userId: z.number().int(),
  shareMinor: z.number().int().optional(),
});

const createExpenseSchema = z.object({
  amountMinor: z.number().int().positive(),
  currency: currencyCodeSchema,
  // Optional: omit to create a 'planned' expense (budgeted, no payer yet).
  payerId: z.number().int().optional(),
  splitMode: z.enum(['equal', 'custom', 'solo']),
  shares: z.array(expenseShareInputSchema).optional(),
  beneficiaryId: z.number().int().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(8).nullable().optional(),
  spentOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'spentOn must be an ISO date (YYYY-MM-DD)')
    .optional(),
  rateToBase: z.number().positive().optional(),
  rateOverridden: z.boolean().optional(),
});

// Phase 6.3/6.4: `POST /:id/settlements` body — see `@tripsplit/shared`'s
// `CreateSettlementRequest` and `createSettlement` (lib/expenses.ts) for the
// exact modeling ("payerId pays, receiverId gets the single full share").
const createSettlementSchema = z.object({
  payerId: z.number().int(),
  receiverId: z.number().int(),
  amountMinor: z.number().int().positive(),
  currency: currencyCodeSchema,
  description: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(8).nullable().optional(),
  spentOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'spentOn must be an ISO date (YYYY-MM-DD)')
    .optional(),
  rateToBase: z.number().positive().optional(),
  rateOverridden: z.boolean().optional(),
});

const createTripSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120, 'Title is too long'),
  baseCurrency: currencyCodeSchema,
});

const updateTripSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(120, 'Title is too long')
      .optional(),
    baseCurrency: currencyCodeSchema.optional(),
  })
  .refine((body) => body.title !== undefined || body.baseCurrency !== undefined, {
    message: 'At least one of title or baseCurrency must be provided',
  });

const joinTripSchema = z.object({
  inviteCode: z.string().trim().min(1, 'inviteCode is required'),
});

export const tripsRouter = new Hono();

// POST /api/trips — create a trip; the creator becomes its first member.
tripsRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = await validateJsonBody(c, createTripSchema);
  const now = new Date().toISOString();

  const trip = {
    id: nanoid(TRIP_ID_LENGTH),
    title: body.title,
    baseCurrency: body.baseCurrency,
    inviteCode: nanoid(INVITE_CODE_LENGTH),
    createdBy: user.id,
    createdAt: now,
    archivedAt: null as string | null,
  };

  db.insert(schema.trips).values(trip).run();
  db.insert(schema.tripMembers)
    .values({ tripId: trip.id, userId: user.id, joinedAt: now })
    .run();

  const response: CreateTripResponse = {
    trip,
    inviteLink: buildInviteLink(trip.inviteCode),
  };
  return c.json(response, 201);
});

// POST /api/trips/join — join by invite code; idempotent if already a member.
// Registered before `/:id` so it can never be shadowed by the param route.
tripsRouter.post('/join', async (c) => {
  const user = c.get('user');
  const body = await validateJsonBody(c, joinTripSchema);

  const trip = db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.inviteCode, body.inviteCode))
    .get();
  if (!trip) {
    throw new AppError(404, 'trip_not_found', 'No trip matches this invite code');
  }

  const existingMembership = db
    .select()
    .from(schema.tripMembers)
    .where(
      and(eq(schema.tripMembers.tripId, trip.id), eq(schema.tripMembers.userId, user.id)),
    )
    .get();

  if (!existingMembership) {
    db.insert(schema.tripMembers)
      .values({ tripId: trip.id, userId: user.id, joinedAt: new Date().toISOString() })
      .run();
  }

  const response: TripDetail = toTripDetail(trip);
  return c.json(response);
});

// GET /api/trips/join-info?code=<inviteCode> — invite preview (Phase 3.3):
// the trip title, its creator's name, and member count for an invite code,
// WITHOUT joining, so the join screen can show "who + which trip" first.
// Registered before `/:id` so the literal path is never captured as an :id.
// Reveals only what an invite-code holder could get by joining anyway.
tripsRouter.get('/join-info', (c) => {
  const code = c.req.query('code')?.trim();
  if (!code) {
    throw new AppError(400, 'invalid_request', 'code query param is required');
  }

  const trip = db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.inviteCode, code))
    .get();
  if (!trip) {
    throw new AppError(404, 'trip_not_found', 'No trip matches this invite code');
  }

  const members = getTripMembers(trip.id);
  const creator = members.find((m) => m.id === trip.createdBy);

  const response: TripJoinInfo = {
    title: trip.title,
    baseCurrency: trip.baseCurrency,
    createdByName: creator?.firstName ?? 'TripSplit',
    memberCount: members.length,
  };
  return c.json(response);
});

// GET /api/trips/:id — trip + members + a page of expenses; balances land in
// Phase 6. `?expensesLimit=&expensesBefore=` forward to the (Phase 4) light
// keyset pagination — see `getTripExpensesPage` in lib/expenses.ts.
tripsRouter.get('/:id', (c) => {
  const user = c.get('user');
  const tripId = c.req.param('id');
  const trip = requireMembership(tripId, user.id);

  const limitParam = c.req.query('expensesLimit');
  const parsedLimit = limitParam ? Number(limitParam) : undefined;
  const expensesLimit =
    parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : undefined;
  const expensesBefore = c.req.query('expensesBefore') || undefined;

  return c.json(toTripDetail(trip, { expensesLimit, expensesBefore }));
});

// PATCH /api/trips/:id — rename; base currency locked once expenses exist.
tripsRouter.patch('/:id', async (c) => {
  const user = c.get('user');
  const tripId = c.req.param('id');
  const trip = requireMembership(tripId, user.id);
  const body = await validateJsonBody(c, updateTripSchema);

  if (
    body.baseCurrency !== undefined &&
    body.baseCurrency !== trip.baseCurrency &&
    hasNonDeletedExpenses(tripId)
  ) {
    throw new AppError(
      409,
      'base_currency_locked',
      'Base currency cannot change once the trip has expenses',
    );
  }

  db.update(schema.trips)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.baseCurrency !== undefined ? { baseCurrency: body.baseCurrency } : {}),
    })
    .where(eq(schema.trips.id, tripId))
    .run();

  const updated = getTripOrThrow(tripId);
  return c.json(toTripDetail(updated));
});

// GET /api/trips/:id/balances — Phase 6.1/§5. Membership-checked; net per
// member + minimal transfer list + per-currency spend breakdown, all
// computed fresh from non-deleted expense+settlement rows (see
// lib/balances.ts). Deliberately its own endpoint rather than embedded in
// `toTripDetail` — the plain trip-feed fetch never needs balances, so it
// never pays to compute them (see `@tripsplit/shared`'s `TripDetail` doc
// comment).
tripsRouter.get('/:id/balances', (c) => {
  const user = c.get('user');
  const tripId = c.req.param('id');
  const trip = requireMembership(tripId, user.id);

  const response: BalancesResponse = getTripBalances(tripId, trip.baseCurrency);
  return c.json(response);
});

// GET /api/trips/:id/insights — trip statistics: totals, averages, and
// category/day/member breakdowns, all computed fresh from non-deleted,
// paid, expense-type rows (see lib/insights.ts). Membership-checked, and
// its own endpoint for the same reason as `/balances` above — the plain
// trip-feed fetch never needs it.
tripsRouter.get('/:id/insights', (c) => {
  const user = c.get('user');
  const tripId = c.req.param('id');
  const trip = requireMembership(tripId, user.id);

  const response: InsightsResponse = getTripInsights(tripId, trip.baseCurrency);
  return c.json(response);
});

// POST /api/trips/:id/export — Export & Group Nudges plan T5. Posts the same
// summary `/summary` sends (see lib/summary.ts) to the trip's linked group
// chat(s) if any, else DMs the requesting user (who has always `/start`-ed
// the bot). Unlike T4's nudges this awaits the send — the user explicitly
// asked for it and needs to know whether it actually went out.
tripsRouter.post('/:id/export', async (c) => {
  const user = c.get('user');
  const tripId = c.req.param('id');
  const trip = requireMembership(tripId, user.id);

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    throw new AppError(
      502,
      'export_failed',
      'Bot is not configured — export cannot be delivered',
    );
  }

  const locale = resolveBotLocale(user.lang);
  const html = buildTripSummaryMessage(trip, locale);

  const linkedChats = getLinkedChats(tripId);
  if (linkedChats.length > 0) {
    const results = await Promise.all(
      linkedChats.map((chat) => sendBotMessage(botToken, chat.chatId, html)),
    );
    if (results.some(Boolean)) {
      const response: ExportTripResponse = { delivered: 'group' };
      return c.json(response);
    }
    // Every linked chat send failed (e.g. all auto-unlinked mid-flight) — fall through to DM.
  }

  const dmDelivered = await sendBotMessage(botToken, user.id, html);
  if (!dmDelivered) {
    throw new AppError(502, 'export_failed', 'Could not deliver the trip export');
  }

  const response: ExportTripResponse = { delivered: 'dm' };
  return c.json(response);
});

// POST /api/trips/:id/settlements — Phase 6.3/6.4. Membership-checked;
// payer and receiver must both be current trip members (enforced inside
// `createSettlement`, lib/expenses.ts). A dedicated route rather than
// overloading `POST /:id/expenses` with a `type` field — the settlement
// request shape (`payerId`/`receiverId`/no `splitMode`/`shares`) is
// meaningfully different from an expense's, so keeping them separate avoids
// a union-typed body with fields that only make sense for one or the other.
tripsRouter.post('/:id/settlements', async (c) => {
  const user = c.get('user');
  const tripId = c.req.param('id');
  const trip = requireMembership(tripId, user.id);
  requireActiveTrip(trip);
  const body = await validateJsonBody(c, createSettlementSchema);

  const settlement: ExpenseWithShares = createSettlement({
    tripId,
    createdBy: user.id,
    payerId: body.payerId,
    receiverId: body.receiverId,
    amountMinor: body.amountMinor,
    currency: body.currency,
    baseCurrency: trip.baseCurrency,
    description: body.description,
    category: body.category,
    spentOn: body.spentOn,
    rateToBaseInput: body.rateToBase,
    rateOverriddenInput: body.rateOverridden,
  });

  void notifySettlementCreated(trip, user, settlement);
  return c.json(settlement, 201);
});

// POST /api/trips/:id/expenses — Phase 4.1. Membership-checked; the payer
// and every referenced share user must also be current trip members
// (enforced inside `createExpense`/`computeShares`, lib/expenses.ts).
// `type` is always 'expense' here — settlements are their own route above.
tripsRouter.post('/:id/expenses', async (c) => {
  const user = c.get('user');
  const tripId = c.req.param('id');
  const trip = requireMembership(tripId, user.id);
  requireActiveTrip(trip);
  const body = await validateJsonBody(c, createExpenseSchema);

  const expense: ExpenseWithShares = createExpense({
    tripId,
    createdBy: user.id,
    payerId: body.payerId,
    amountMinor: body.amountMinor,
    currency: body.currency,
    baseCurrency: trip.baseCurrency,
    splitMode: body.splitMode,
    sharesInput: body.shares,
    beneficiaryId: body.beneficiaryId,
    description: body.description,
    category: body.category,
    spentOn: body.spentOn,
    rateToBaseInput: body.rateToBase,
    rateOverriddenInput: body.rateOverridden,
  });

  void notifyExpenseCreated(trip, user, expense);
  return c.json(expense, 201);
});

// GET /api/trips/:id/wrap — Trip Wrap plan (`docs/TRIP_WRAP_PLAN.md`) task W2.
// Membership-checked, no archived check: available as a live preview on an
// active trip too, not just after close (see `lib/wrap.ts` for the math).
tripsRouter.get('/:id/wrap', (c) => {
  const user = c.get('user');
  const tripId = c.req.param('id');
  const trip = requireMembership(tripId, user.id);

  const response: TripWrapResponse = getTripWrap(trip);
  return c.json(response);
});

// POST /api/trips/:id/close — "Finish trip" (task W2). Stamps `archivedAt`,
// fires the farewell card to any linked chat (fire-and-forget — a Telegram
// outage never fails the close, see `notify.ts`'s `notifyTripClosed`), and
// returns the same wrap payload `GET /:id/wrap` would.
tripsRouter.post('/:id/close', async (c) => {
  const user = c.get('user');
  const tripId = c.req.param('id');
  const trip = requireMembership(tripId, user.id);

  if (trip.archivedAt) {
    throw new AppError(409, 'trip_archived', 'This trip is already closed');
  }

  db.update(schema.trips)
    .set({ archivedAt: new Date().toISOString() })
    .where(eq(schema.trips.id, tripId))
    .run();

  const updated = getTripOrThrow(tripId);
  void notifyTripClosed(updated, user);

  const response: TripWrapResponse = getTripWrap(updated);
  return c.json(response);
});

// POST /api/trips/:id/reopen — the undo path for `/close` (task W2). Clears
// `archivedAt`; no farewell/notification on the way back in.
tripsRouter.post('/:id/reopen', async (c) => {
  const user = c.get('user');
  const tripId = c.req.param('id');
  const trip = requireMembership(tripId, user.id);

  if (!trip.archivedAt) {
    throw new AppError(409, 'trip_not_archived', 'This trip is not archived');
  }

  db.update(schema.trips)
    .set({ archivedAt: null })
    .where(eq(schema.trips.id, tripId))
    .run();

  const updated = getTripOrThrow(tripId);
  return c.json(toTripDetail(updated));
});

export default tripsRouter;

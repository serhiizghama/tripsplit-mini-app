import { serve } from '@hono/node-server';
import type { MeResponse, TripSummary, User } from '@tripsplit/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { startBot } from './bot.js';
import { db, schema } from './db/index.js';
import { logger } from './lib/logger.js';
import { AppError, toErrorBody } from './lib/errors.js';
import { getHealthStatus } from './lib/health.js';
import { getTripMembers } from './lib/members.js';
import { runDailyRateFetchOnce, scheduleRateCron } from './lib/rates.js';
import { validateJsonBody } from './lib/validate.js';
import { createAuthMiddleware } from './middleware/auth.js';
import type { AuthUser } from './middleware/auth.js';
import { createRateLimitMiddleware } from './middleware/rateLimit.js';
import { createAvatarRouter } from './routes/avatar.js';
import { expensesRouter } from './routes/expenses.js';
import { ratesRouter } from './routes/rates.js';
import { tripsRouter } from './routes/trips.js';

/**
 * TripSplit API — Phase 1 (DB + Auth) + Phase 3 (Trips, Members, Invites,
 * Avatars) + Phase 4 (Expenses Core) + Phase 5 (Currency Engine) + Phase 6
 * (Balances & Settlements).
 *
 * This process only ever serves `/api/*`. In production, nginx serves the
 * built web SPA (`web/dist`) at `/` and reverse-proxies `/api` to this
 * process — see docs/deploy/nginx.split.conf.sample and docs/deploy/SETUP.md.
 * There is no static-file serving here on purpose.
 *
 * `GET /api/trips/:id/balances` and `POST /api/trips/:id/settlements`
 * (Phase 6) are mounted on `tripsRouter` itself (routes/trips.ts) — nothing
 * extra to wire up here.
 */

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN env var is required (see .env.example)');
}

const app = new Hono();

app.get('/', (c) => c.text('TripSplit API'));

// Phase 8.2: enhanced health check. Stays public/unauthenticated (no
// middleware runs before this in the chain — both the auth middleware below
// AND the rate limiter carve out an explicit `/api/health` exception, so
// this is never blocked by either regardless of mount order). Checks the DB
// with a cheap `SELECT 1` and reports the most recent cached rate's age;
// `ok: false` + HTTP 503 only when the DB check itself fails — never leaks
// internals (see lib/health.ts's doc comment).
app.get('/api/health', (c) => {
  const status = getHealthStatus();
  return c.json(status, status.ok ? 200 : 503);
});

// Applied to all /api/* routes; the middleware itself carves out an
// exception for /api/health so it stays public regardless of route order.
app.use('/api/*', createAuthMiddleware(BOT_TOKEN));

// Phase 8.3: per-user rate limiting. Mounted AFTER auth (keys on
// `c.get('user').id`) and, like the auth middleware, excludes /api/health.
// See middleware/rateLimit.ts for limits + the VITEST test-safety guard.
app.use('/api/*', createRateLimitMiddleware());

// Phase 3.1/3.3: trip CRUD + invite/join, all membership-checked.
// Phase 4.1: `POST /:id/expenses` is mounted on this same router (nested
// under a trip); see routes/trips.ts.
app.route('/api/trips', tripsRouter);

// Phase 4.1: PATCH/DELETE are top-level (an expense id alone doesn't nest
// under a trip path) — see routes/expenses.ts.
app.route('/api/expenses', expensesRouter);

// Phase 3.4: avatar proxy — see routes/avatar.ts for the full fallback story.
app.route('/api/avatar', createAvatarRouter(BOT_TOKEN));

// Phase 5.4: cached cross-rate lookup — local-only, no external call in
// this hot path. See routes/rates.ts + lib/rates.ts.
app.route('/api/rates', ratesRouter);

/**
 * Builds the `GET`/`PATCH /api/me` response from a fresh DB read of
 * `authUser.id` — shared so `PATCH` (Phase 7) returns exactly the same shape
 * `GET` does, post-update, without duplicating the trips-join logic.
 */
function buildMeResponse(userId: number): MeResponse {
  const userRow = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!userRow) {
    // Cannot happen for an authenticated request: the auth middleware just
    // upserted this exact row.
    throw new AppError(500, 'internal_error', 'User not found');
  }

  const user: User = {
    id: userRow.id,
    firstName: userRow.firstName,
    lastName: userRow.lastName,
    username: userRow.username,
    photoUrl: userRow.photoUrl,
    lang: userRow.lang,
    createdAt: userRow.createdAt,
    updatedAt: userRow.updatedAt,
  };

  const rows = db
    .select({ trip: schema.trips })
    .from(schema.tripMembers)
    .innerJoin(schema.trips, eq(schema.tripMembers.tripId, schema.trips.id))
    .where(eq(schema.tripMembers.userId, userId))
    .all();

  // `getTripMembers` is reused (rather than a raw COUNT query) so this stays
  // in lockstep with the exact same membership join `GET /api/trips/:id`
  // uses — trip sizes are tiny (a handful of travelers), so the extra user
  // rows fetched per trip are not a real cost here.
  const trips: TripSummary[] = rows.map(({ trip }) => ({
    id: trip.id,
    title: trip.title,
    baseCurrency: trip.baseCurrency,
    inviteCode: trip.inviteCode,
    createdBy: trip.createdBy,
    createdAt: trip.createdAt,
    archivedAt: trip.archivedAt,
    memberCount: getTripMembers(trip.id).length,
  }));

  return { user, trips };
}

app.get('/api/me', (c) => {
  const authUser = c.get('user');
  return c.json(buildMeResponse(authUser.id));
});

// Phase 7 §9: "user override stored in users.lang" — the only write path for
// a user's language after their first-seen insert (see
// `middleware/auth.ts`'s `upsertUserFromTelegram` doc comment for the other
// half of this fix: the per-request upsert no longer clobbers it).
const updateMeSchema = z.object({
  lang: z.enum(['en', 'ru', 'uk']),
});

app.patch('/api/me', async (c) => {
  const authUser: AuthUser = c.get('user');
  const body = await validateJsonBody(c, updateMeSchema);

  db.update(schema.users)
    .set({ lang: body.lang, updatedAt: new Date().toISOString() })
    .where(eq(schema.users.id, authUser.id))
    .run();

  return c.json(buildMeResponse(authUser.id));
});

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(toErrorBody(err), err.status);
  }
  logger.error({ err }, 'unhandled error');
  return c.json({ code: 'internal_error', message: 'Internal server error' }, 500);
});

const port = Number(process.env.PORT ?? 8080);

// Vitest imports this module to exercise `app` via `app.request(...)` — it
// must not also try to bind a real port, schedule a real cron job, or fire a
// real rate fetch. Vitest sets `process.env.VITEST` (relied on here and in
// lib/rates.ts's doc comment); tests inject `rates` rows directly or mock
// `fetch` instead.
if (!process.env.VITEST) {
  // Phase 5.2: daily 01:00 UTC rate-fetch cron + a one-off "today" backfill
  // on boot, so a fresh deploy has rates cached before the first request
  // needs them. Both are internally non-fatal (lib/rates.ts wraps every
  // fetch in try/catch and logs via pino) — a rate-API outage never crashes
  // boot, it just means today's rates stay whatever was last cached.
  scheduleRateCron();
  void runDailyRateFetchOnce();

  // Minimal /start → "Open TripSplit" Web App button (see bot.ts). Non-fatal:
  // startBot swallows its own errors so a Telegram outage never crashes the API.
  startBot(BOT_TOKEN);

  serve({ fetch: app.fetch, port }, (info) => {
    logger.info(`TripSplit API listening on http://localhost:${info.port}`);
  });
}

export default app;

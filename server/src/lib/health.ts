/**
 * `GET /api/health` support — Phase 8.2 (IMPLEMENTATION_PLAN.md, "Phase 8 —
 * Hardening, Backup & Ops"). Stays public/unauthenticated (see
 * `middleware/auth.ts`'s explicit `/api/health` carve-out and `src/index.ts`)
 * so an external uptime monitor (`scripts/uptime-ping.sh`) can hit it with no
 * credentials — this module must therefore never leak internals (stack
 * traces, file paths, secrets) into its response, only the coarse shape
 * below.
 *
 * `db: 'down'` happens when a cheap `SELECT 1` against the raw better-
 * sqlite3 handle throws — a closed/corrupt connection, a permissions issue,
 * disk full, etc. Deliberately checked with the raw `sqlite` handle (not a
 * drizzle query) so this stays a minimal, dependency-light smoke test of
 * "can we talk to the DB at all" rather than exercising the schema.
 */
import { desc } from 'drizzle-orm';
import type { HealthResponse } from '@tripsplit/shared';

import { db, schema, sqlite } from '../db/index.js';

export type HealthStatus = HealthResponse;

/** Cheap DB liveness check: a raw `SELECT 1`, never a drizzle/schema query. */
function isDbUp(): boolean {
  try {
    sqlite.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

/**
 * The most recently fetched rates date (`MAX(rates.date)`) and how many
 * hours old it is, relative to that date's UTC midnight. `null` when the
 * `rates` table has no rows yet (fresh deploy, before the first daily
 * fetch/backfill) — a normal state, not a failure.
 *
 * Only ever called when `isDbUp()` already returned true — a broken DB
 * connection must short-circuit to `lastRateFetch: null` in the caller
 * rather than let this throw a second time.
 */
function getLastRateFetch(): { date: string; ageHours: number } | null {
  const row = db
    .select({ date: schema.rates.date })
    .from(schema.rates)
    .orderBy(desc(schema.rates.date))
    .limit(1)
    .get();
  if (!row) return null;

  const dateMs = new Date(`${row.date}T00:00:00Z`).getTime();
  const ageHours = Math.max(0, (Date.now() - dateMs) / (60 * 60 * 1000));
  // One decimal place is plenty of precision for a monitoring signal — this
  // is "how stale is today's rate", not a value anything computes with.
  return { date: row.date, ageHours: Math.round(ageHours * 10) / 10 };
}

/** Builds the full `GET /api/health` body. Never throws. */
export function getHealthStatus(): HealthStatus {
  const dbUp = isDbUp();
  return {
    ok: dbUp,
    db: dbUp ? 'up' : 'down',
    lastRateFetch: dbUp ? getLastRateFetch() : null,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

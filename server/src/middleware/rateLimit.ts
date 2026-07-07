/**
 * Per-user rate-limit middleware — Phase 8.3 (IMPLEMENTATION_PLAN.md, "Phase
 * 8 — Hardening, Backup & Ops"). Mounted on `/api/*` in `src/index.ts`,
 * AFTER the auth middleware (it needs `c.get('user')` to key the bucket) and
 * BEFORE every route handler.
 *
 * Fixed-window counter, per authenticated user id, in-memory (a single pm2
 * `fork`-mode process — see `ecosystem.config.cjs` — so no cross-process
 * coordination is needed; if this ever runs with `instances > 1` the limit
 * would be per-process, which is an acceptable trade-off for a 2-10-person
 * trip app, not worth a Redis dependency). `/api/health` is excluded — it
 * must stay reachable by an uptime monitor regardless of app traffic, and it
 * runs before the auth middleware anyway (no `user` to key on).
 *
 * Limits are generous by design (plan §8.3: "per-user, generous limits
 * suitable for 2-10 people actively logging expenses") — this exists to stop
 * a runaway client/bug from hammering the single SQLite writer, not to
 * throttle normal usage.
 *
 * **Test-safety:** under `VITEST`, defaults jump to an effectively unlimited
 * count so the existing integration-test suite (which fires many requests
 * per test file against one signed-in test user) never trips the limiter by
 * accident. `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS` env vars override this in
 * *either* environment — `test/rateLimit.test.ts` sets both to a tiny value
 * before booting its own app instance to exercise the 429 path deliberately.
 */
import type { Context, Next } from 'hono';

import { AppError } from '../lib/errors.js';

const DEFAULT_MAX_REQUESTS = 120;
const DEFAULT_WINDOW_MS = 60_000;
/** Effectively unlimited — VITEST's default so unrelated tests never 429. */
const VITEST_DEFAULT_MAX_REQUESTS = 1_000_000;

interface Bucket {
  windowStart: number;
  count: number;
}

function resolvePositiveIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Builds the middleware with its own private bucket map — a fresh instance
 * per call, so each `createAuthMiddleware`-style app boot (including every
 * `bootTestApp()` in tests, which does a full `vi.resetModules()`) starts
 * with an empty rate-limit state, never bleeding counts across test files.
 */
export function createRateLimitMiddleware() {
  const maxRequests =
    resolvePositiveIntEnv('RATE_LIMIT_MAX') ??
    (process.env.VITEST ? VITEST_DEFAULT_MAX_REQUESTS : DEFAULT_MAX_REQUESTS);
  const windowMs = resolvePositiveIntEnv('RATE_LIMIT_WINDOW_MS') ?? DEFAULT_WINDOW_MS;

  const buckets = new Map<number, Bucket>();

  return async function rateLimit(c: Context, next: Next) {
    // /api/health is public and unauthenticated — never rate-limited (mirrors
    // the auth middleware's own carve-out in middleware/auth.ts).
    if (c.req.path === '/api/health') {
      await next();
      return;
    }

    // This middleware is mounted after the auth middleware, so `user` is
    // always set for every path that reaches here — but fall back to a
    // shared bucket key rather than throwing if that assumption is ever
    // violated by a future route wiring change.
    const userId = c.get('user')?.id ?? 0;

    const now = Date.now();
    let bucket = buckets.get(userId);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { windowStart: now, count: 0 };
      buckets.set(userId, bucket);
    }
    bucket.count += 1;

    if (bucket.count > maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.windowStart + windowMs - now) / 1000),
      );
      c.header('Retry-After', String(retryAfterSeconds));
      throw new AppError(429, 'rate_limited', 'Too many requests — please slow down.');
    }

    await next();
  };
}

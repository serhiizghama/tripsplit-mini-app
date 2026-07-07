/**
 * Rate-limit middleware tests — Phase 8.3 (IMPLEMENTATION_PLAN.md, "Phase 8
 * — Hardening, Backup & Ops"). `middleware/rateLimit.ts` defaults to a
 * VITEST-only effectively-unlimited bucket so the rest of the suite never
 * trips it by accident — this file is the one place that deliberately
 * overrides `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS` via env *before*
 * `bootTestApp()` boots a fresh app instance, to drive the 429 path for
 * real through the actual Hono app (`app.request(...)`), then waits out the
 * (tiny) window to prove it recovers.
 */
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it } from 'vitest';

import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

function authHeaderFor(userId: number, firstName = 'Test'): string {
  const initDataRaw = sign(
    { user: { id: userId, first_name: firstName } },
    TEST_BOT_TOKEN,
    new Date(),
  );
  return `tma ${initDataRaw}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Rate-limit middleware (low override)', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_WINDOW_MS;
    current?.cleanup();
    current = undefined;
  });

  it('429s once the per-user limit is exceeded, with Retry-After, then recovers after the window', async () => {
    process.env.RATE_LIMIT_MAX = '3';
    process.env.RATE_LIMIT_WINDOW_MS = '300';
    current = await bootTestApp();
    const { app } = current;
    const headers = { Authorization: authHeaderFor(1) };

    // First 3 requests within the window are allowed.
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/api/me', { headers });
      expect(res.status).toBe(200);
    }

    // The 4th request in the same window is rejected.
    const limited = await app.request('/api/me', { headers });
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.code).toBe('rate_limited');
    expect(typeof body.message).toBe('string');
    const retryAfter = limited.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);

    // After the window elapses, the same user is allowed again.
    await sleep(350);
    const recovered = await app.request('/api/me', { headers });
    expect(recovered.status).toBe(200);
  });

  it('tracks separate buckets per user — one user being limited does not affect another', async () => {
    process.env.RATE_LIMIT_MAX = '1';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    current = await bootTestApp();
    const { app } = current;

    const user1 = { Authorization: authHeaderFor(101) };
    const user2 = { Authorization: authHeaderFor(102) };

    expect((await app.request('/api/me', { headers: user1 })).status).toBe(200);
    expect((await app.request('/api/me', { headers: user1 })).status).toBe(429);
    // A different user still gets their own first request through.
    expect((await app.request('/api/me', { headers: user2 })).status).toBe(200);
  });

  it('never rate-limits GET /api/health, even past the low override', async () => {
    process.env.RATE_LIMIT_MAX = '1';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    current = await bootTestApp();
    const { app } = current;

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
    }
  });
});

/**
 * Avatar proxy graceful-failure tests — Phase 3.4. `bootTestApp()` runs with
 * `TEST_BOT_TOKEN`, a dummy value that is not a real Telegram bot token, so
 * every call this route makes to `api.telegram.org` genuinely fails (auth
 * error if the sandbox has network access, a connection error/timeout if it
 * doesn't) — this exercises the *real* fallback path end-to-end rather than
 * mocking it away. The route has its own 5s-per-call timeout (see
 * `src/routes/avatar.ts`), so this stays bounded even with no network at
 * all; the per-test timeout below gives it headroom.
 *
 * This is exactly the "cannot fully verify without a real BOT_TOKEN + a user
 * with a public profile photo" case called out in the Phase 3 task: what we
 * *can* prove, and do here, is that every failure mode degrades to a non-2xx
 * so the client's `photoUrl` → proxy → initials fallback chain proceeds.
 */
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it } from 'vitest';

import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

function authHeaderFor(userId: number): string {
  const initDataRaw = sign(
    { user: { id: userId, first_name: 'Test' } },
    TEST_BOT_TOKEN,
    new Date(),
  );
  return `tma ${initDataRaw}`;
}

describe('GET /api/avatar/:userId', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('falls back to a non-2xx when the bot token is fake / the user has no reachable photo', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/avatar/123456', {
      headers: { Authorization: authHeaderFor(1) },
    });

    expect(res.ok).toBe(false);
    const body = await res.json();
    expect(body.code).toBe('avatar_not_found');
  }, 10000);

  it('returns a graceful non-2xx (not a 500) for a malformed user id', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/avatar/not-a-number', {
      headers: { Authorization: authHeaderFor(1) },
    });

    expect(res.status).toBeLessThan(500);
    expect(res.ok).toBe(false);
    expect((await res.json()).code).toBe('avatar_not_found');
  });

  it('is auth-protected like every other /api/* route', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/avatar/123456');
    expect(res.status).toBe(401);
  });
});

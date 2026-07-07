import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it } from 'vitest';

import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

describe('GET /api/me', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('returns the authenticated user and an empty trips list', async () => {
    current = await bootTestApp();
    const { app } = current;

    const initDataRaw = sign({ user: { id: 42, first_name: 'Bo' } }, TEST_BOT_TOKEN, new Date());

    const res = await app.request('/api/me', {
      headers: { Authorization: `tma ${initDataRaw}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user: expect.objectContaining({ id: 42, firstName: 'Bo', lang: 'en' }),
      trips: [],
    });
  });

  it('returns 401 JSON without an Authorization header', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/me');

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ code: 'unauthorized', message: expect.any(String) });
  });
});

describe('PATCH /api/me', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('updates the stored lang and returns the new MeResponse', async () => {
    current = await bootTestApp();
    const { app } = current;

    const initDataRaw = sign(
      { user: { id: 42, first_name: 'Bo', language_code: 'en' } },
      TEST_BOT_TOKEN,
      new Date(),
    );
    const authHeaders = { Authorization: `tma ${initDataRaw}` };

    const patchRes = await app.request('/api/me', {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 'ru' }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.user).toMatchObject({ id: 42, lang: 'ru' });

    // Persisted — a fresh GET reflects it too, not just the PATCH response.
    const getRes = await app.request('/api/me', { headers: authHeaders });
    expect((await getRes.json()).user.lang).toBe('ru');
  });

  it('rejects an unsupported lang value with 400 invalid_request', async () => {
    current = await bootTestApp();
    const { app } = current;

    const initDataRaw = sign({ user: { id: 43, first_name: 'X' } }, TEST_BOT_TOKEN, new Date());

    const res = await app.request('/api/me', {
      method: 'PATCH',
      headers: { Authorization: `tma ${initDataRaw}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 'fr' }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('a later request with a different Telegram language_code does not undo the PATCH', async () => {
    current = await bootTestApp();
    const { app } = current;

    const firstSeen = sign(
      { user: { id: 44, first_name: 'Y', language_code: 'ru' } },
      TEST_BOT_TOKEN,
      new Date(),
    );
    await app.request('/api/me', { headers: { Authorization: `tma ${firstSeen}` } });

    await app.request('/api/me', {
      method: 'PATCH',
      headers: { Authorization: `tma ${firstSeen}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 'uk' }),
    });

    // Telegram resends a *different* language_code on the next launch —
    // the user's explicit choice ('uk') must still win.
    const laterLaunch = sign(
      { user: { id: 44, first_name: 'Y', language_code: 'en' } },
      TEST_BOT_TOKEN,
      new Date(),
    );
    const res = await app.request('/api/me', { headers: { Authorization: `tma ${laterLaunch}` } });
    expect((await res.json()).user.lang).toBe('uk');
  });
});

// GET /api/health moved to its own file — see test/health.test.ts (Phase 8.2
// grew it from a static `{ok: true}` into a real DB + rate-age check).

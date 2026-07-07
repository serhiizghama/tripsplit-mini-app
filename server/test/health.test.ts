/**
 * `GET /api/health` tests — Phase 8.2 (IMPLEMENTATION_PLAN.md, "Phase 8 —
 * Hardening, Backup & Ops"). Same `bootTestApp()` pattern as every other API
 * test file — an isolated temp-file SQLite DB per test.
 *
 * Covers: the route stays public (no Authorization header needed); the
 * shape when the DB is up with no rates yet (`lastRateFetch: null`); the
 * shape with seeded rate rows (`lastRateFetch` reflects `MAX(date)` and a
 * correctly computed `ageHours`); and the DB-down path (503 + `ok: false`),
 * simulated by closing the raw sqlite handle — the most direct way to make a
 * real `SELECT 1` actually fail without mocking anything.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { bootTestApp, type TestApp } from './helpers.js';

function seedRate(testApp: TestApp, date: string, currency = 'THB', rate = 33): void {
  const { db, schema } = testApp;
  db.insert(schema.rates).values({ date, base: 'USD', currency, rate, source: 'open-er-api' }).run();
}

describe('GET /api/health', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('is public and returns 200 with no Authorization header', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  it('reports lastRateFetch: null when the rates table is empty', async () => {
    current = await bootTestApp();
    const { app } = current;

    const res = await app.request('/api/health');
    const body = await res.json();

    expect(body.lastRateFetch).toBeNull();
  });

  it('reports the most recent rate date and a correctly computed ageHours', async () => {
    current = await bootTestApp();
    const { app } = current;

    // A fixed past date — deterministic regardless of what time of day this
    // test happens to run at (a naive "N hours ago" instant, truncated back
    // to a date, drifts by up to 24h depending on the current UTC
    // time-of-day — this pins the date string directly instead).
    const pastDate = '2026-01-15';
    seedRate(current, pastDate);
    // A second, older row — MAX(date) must pick the more recent one.
    seedRate(current, '2020-01-01', 'EUR', 0.9);

    const res = await app.request('/api/health');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.lastRateFetch.date).toBe(pastDate);

    // Mirror lib/health.ts's own formula rather than hand-picking a window —
    // the two `Date.now()` calls (this one and the one inside the request)
    // are milliseconds apart, utterly negligible at hour-level precision.
    const expectedAgeHours =
      (Date.now() - Date.parse(`${pastDate}T00:00:00Z`)) / (60 * 60 * 1000);
    expect(body.lastRateFetch.ageHours).toBeCloseTo(expectedAgeHours, 1);
  });

  it('returns db: "down" and HTTP 503 when the DB connection is broken', async () => {
    current = await bootTestApp();
    const { app, sqlite } = current;

    // Simulate an outage the most direct way: close the real connection, so
    // the health check's own `SELECT 1` genuinely throws — no mocking.
    sqlite.close();

    const res = await app.request('/api/health');

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.db).toBe('down');
    expect(body.lastRateFetch).toBeNull();

    // Prevent the afterEach cleanup from trying to touch the now-closed
    // handle in a way that throws — file removal itself is still safe.
  });
});

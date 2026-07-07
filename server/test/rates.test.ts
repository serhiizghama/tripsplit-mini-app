/**
 * Currency Engine tests — Phase 5 (IMPLEMENTATION_PLAN.md §4/§6). Same
 * signed-fixture + temp-DB pattern as the other API test files
 * (`bootTestApp()`, `helpers.ts`) — every test boots its own isolated
 * temp-file SQLite DB, so `db`/`schema`/`../src/lib/rates.js` etc. all
 * resolve to that test's own fresh module graph (see `helpers.ts`'s doc
 * comment on `vi.resetModules()` per boot).
 *
 * Covers:
 *  - cross-rate math + exponent handling in a full `amount_base_minor`
 *    conversion (mirrors `expenses.test.ts`'s VND->EUR worked example, but
 *    for real cached rates instead of a client-supplied `rateToBase`);
 *  - the fetch fallback chain (open.er-api -> fawazahmed0 jsDelivr ->
 *    fawazahmed0 pages.dev), with `global.fetch` mocked — no real network
 *    calls anywhere in this suite;
 *  - the never-overwrite-past-dates rule (today may still refresh);
 *  - historical/nearest-earlier lookups;
 *  - `GET /api/rates` staying strictly local (fetch is never called); and
 *  - the Phase 4 `resolveRate` wiring: a non-base-currency expense with no
 *    client-supplied rate now uses the cached cross-rate, not the old
 *    Phase-4 default-1 placeholder.
 */
import { sign } from '@tma.js/init-data-node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootTestApp, TEST_BOT_TOKEN, type TestApp } from './helpers.js';

function authHeaderFor(userId: number, firstName = 'Test'): string {
  const initDataRaw = sign(
    { user: { id: userId, first_name: firstName } },
    TEST_BOT_TOKEN,
    new Date(),
  );
  return `tma ${initDataRaw}`;
}

/** A fixed, deterministic "past" date for every seeded-rate test below. */
const RATE_DATE = '2026-01-15';

type RateSourceValue = 'open-er-api' | 'fawazahmed0' | 'coingecko' | 'manual';

function seedRates(
  testApp: TestApp,
  date: string,
  rows: { currency: string; rate: number; source?: RateSourceValue }[],
): void {
  const { db, schema } = testApp;
  for (const row of rows) {
    db.insert(schema.rates)
      .values({
        date,
        base: 'USD',
        currency: row.currency,
        rate: row.rate,
        source: row.source ?? 'open-er-api',
      })
      .run();
  }
}

function findRateRow(testApp: TestApp, date: string, currency: string) {
  const { db, schema } = testApp;
  return db
    .select()
    .from(schema.rates)
    .all()
    .find((r) => r.date === date && r.currency === currency);
}

// Fixed USD-base rates shared across the cross-rate/exponent tests below.
const USD_THB = 33;
const USD_EUR = 0.9;
const USD_VND = 25000;
const USD_LAK = 22000;
const USD_UAH = 41;
const USD_USDT = 1.001;

describe('Currency Engine: cross-rate math + exponent handling (local cache)', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('computes THB->EUR and USDT->LAK crosses via USD, matching hand-computed values', async () => {
    current = await bootTestApp();
    seedRates(current, RATE_DATE, [
      { currency: 'THB', rate: USD_THB },
      { currency: 'EUR', rate: USD_EUR },
      { currency: 'VND', rate: USD_VND },
      { currency: 'LAK', rate: USD_LAK },
      { currency: 'UAH', rate: USD_UAH },
      { currency: 'USDT', rate: USD_USDT },
    ]);

    const { getCrossRateLocal } = await import('../src/lib/rates.js');

    const thbToEur = getCrossRateLocal(RATE_DATE, 'THB', 'EUR');
    expect(thbToEur?.rate).toBe(USD_EUR / USD_THB);

    const usdtToLak = getCrossRateLocal(RATE_DATE, 'USDT', 'LAK');
    expect(usdtToLak?.rate).toBe(USD_LAK / USD_USDT);

    const vndToUah = getCrossRateLocal(RATE_DATE, 'VND', 'UAH');
    expect(vndToUah?.rate).toBe(USD_UAH / USD_VND);

    // Same-currency is always the trivial identity, regardless of cache state.
    expect(getCrossRateLocal(RATE_DATE, 'EUR', 'EUR')?.rate).toBe(1);
  });

  it('exponent handling: THB/VND/LAK/UAH/USDT -> EUR amount_base_minor conversions are exact', async () => {
    current = await bootTestApp();
    seedRates(current, RATE_DATE, [
      { currency: 'THB', rate: USD_THB },
      { currency: 'EUR', rate: USD_EUR },
      { currency: 'VND', rate: USD_VND },
      { currency: 'LAK', rate: USD_LAK },
      { currency: 'UAH', rate: USD_UAH },
      { currency: 'USDT', rate: USD_USDT },
    ]);

    const { getCrossRateLocal } = await import('../src/lib/rates.js');
    const { computeAmountBaseMinor } = await import('../src/lib/expenses.js');

    // THB (exp 2) -> EUR (exp 2): 100.00 THB
    const thbEur = getCrossRateLocal(RATE_DATE, 'THB', 'EUR')!.rate;
    expect(computeAmountBaseMinor(10000, 'THB', 'EUR', thbEur)).toBe(273);

    // VND (exp 0) -> EUR (exp 2): 1,234,567 VND
    const vndEur = getCrossRateLocal(RATE_DATE, 'VND', 'EUR')!.rate;
    expect(computeAmountBaseMinor(1234567, 'VND', 'EUR', vndEur)).toBe(4444);

    // LAK (exp 2) -> EUR (exp 2): 5,000.00 LAK
    const lakEur = getCrossRateLocal(RATE_DATE, 'LAK', 'EUR')!.rate;
    expect(computeAmountBaseMinor(500000, 'LAK', 'EUR', lakEur)).toBe(20);

    // UAH (exp 2) -> EUR (exp 2): 1,234.56 UAH
    const uahEur = getCrossRateLocal(RATE_DATE, 'UAH', 'EUR')!.rate;
    expect(computeAmountBaseMinor(123456, 'UAH', 'EUR', uahEur)).toBe(2710);

    // USDT (exp 2) -> EUR (exp 2): 2,500.00 USDT
    const usdtEur = getCrossRateLocal(RATE_DATE, 'USDT', 'EUR')!.rate;
    expect(computeAmountBaseMinor(250000, 'USDT', 'EUR', usdtEur)).toBe(224775);
  });
});

describe('Currency Engine: fetch fallback chain (mocked fetch, no real network)', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('falls back to fawazahmed0 when open.er-api fails, and includes the USDT row', async () => {
    current = await bootTestApp();

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('open.er-api.com')) {
        throw new Error('simulated open.er-api outage');
      }
      if (url.includes('cdn.jsdelivr.net')) {
        return new Response(
          JSON.stringify({ date: RATE_DATE, usd: { thb: 33.5, eur: 0.91, usdt: 1.002 } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchDailyUsdRates } = await import('../src/lib/rates.js');
    const entries = await fetchDailyUsdRates();

    expect(entries.every((e) => e.source === 'fawazahmed0')).toBe(true);
    const usdt = entries.find((e) => e.currency === 'USDT');
    expect(usdt).toBeDefined();
    expect(usdt?.rate).toBe(1.002);
  });

  it('falls back to the pages.dev host when the jsDelivr CDN fails', async () => {
    current = await bootTestApp();

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('cdn.jsdelivr.net')) {
        throw new Error('simulated jsDelivr outage');
      }
      if (url.includes('currency-api.pages.dev')) {
        return new Response(JSON.stringify({ date: RATE_DATE, usd: { thb: 33.1, usdt: 1.0 } }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchFawazahmed0Rates } = await import('../src/lib/rates.js');
    const entries = await fetchFawazahmed0Rates('latest');

    expect(entries.find((e) => e.currency === 'THB')?.rate).toBe(33.1);
    expect(entries.every((e) => e.source === 'fawazahmed0')).toBe(true);
  });

  it('when open.er-api succeeds, a supplementary fawazahmed0 fetch adds the USDT row', async () => {
    current = await bootTestApp();

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('open.er-api.com')) {
        return new Response(
          JSON.stringify({ result: 'success', rates: { USD: 1, THB: 33.24, EUR: 0.87 } }),
          { status: 200 },
        );
      }
      if (url.includes('cdn.jsdelivr.net')) {
        return new Response(JSON.stringify({ date: RATE_DATE, usd: { usdt: 1.001 } }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchDailyUsdRates } = await import('../src/lib/rates.js');
    const entries = await fetchDailyUsdRates();

    const thb = entries.find((e) => e.currency === 'THB');
    expect(thb).toMatchObject({ rate: 33.24, source: 'open-er-api' });
    const usdt = entries.find((e) => e.currency === 'USDT');
    expect(usdt).toMatchObject({ rate: 1.001, source: 'fawazahmed0' });
  });
});

describe('Currency Engine: past dates are never overwritten', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('an upsert for an already-cached past date leaves the original row untouched', async () => {
    current = await bootTestApp();
    const pastDate = '2020-06-01';
    seedRates(current, pastDate, [{ currency: 'THB', rate: 30, source: 'manual' }]);

    const { upsertRates } = await import('../src/lib/rates.js');
    upsertRates(pastDate, [{ currency: 'THB', rate: 999, source: 'open-er-api' }]);

    const row = findRateRow(current, pastDate, 'THB');
    expect(row?.rate).toBe(30);
    expect(row?.source).toBe('manual');
  });

  it("today's date MAY be refreshed (upsert updates, not just inserts)", async () => {
    current = await bootTestApp();
    const { todayUtcDate, upsertRates } = await import('../src/lib/rates.js');
    const today = todayUtcDate();

    upsertRates(today, [{ currency: 'THB', rate: 30, source: 'open-er-api' }]);
    upsertRates(today, [{ currency: 'THB', rate: 31, source: 'open-er-api' }]);

    const row = findRateRow(current, today, 'THB');
    expect(row?.rate).toBe(31);
  });
});

describe('Currency Engine: historical / nearest-earlier lookups', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('getUsdRateLocal falls back to the nearest earlier cached date when the exact date is missing', async () => {
    current = await bootTestApp();
    seedRates(current, '2026-01-01', [{ currency: 'THB', rate: 33 }]);

    const { getUsdRateLocal } = await import('../src/lib/rates.js');
    const result = getUsdRateLocal('2026-01-10', 'THB');

    expect(result).toBeDefined();
    expect(result?.rate).toBe(33);
    // The "source note": the served date differs from what was requested.
    expect(result?.date).toBe('2026-01-01');
  });

  it('getHistoricalUsdRate fetches + upserts a date-pinned rate on cache miss', async () => {
    current = await bootTestApp();
    const historicalDate = '2025-12-25';

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain(historicalDate);
      return new Response(JSON.stringify({ date: historicalDate, usd: { thb: 34.5 } }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getHistoricalUsdRate } = await import('../src/lib/rates.js');
    const result = await getHistoricalUsdRate(historicalDate, 'THB');

    expect(result).toMatchObject({ date: historicalDate, rate: 34.5, source: 'fawazahmed0' });

    // And it was upserted for next time (no exact-date row existed before).
    const row = findRateRow(current, historicalDate, 'THB');
    expect(row?.rate).toBe(34.5);
  });

  it('getHistoricalUsdRate falls back to nearest-earlier-in-cache when both fetch hosts fail', async () => {
    current = await bootTestApp();
    seedRates(current, '2025-11-01', [{ currency: 'THB', rate: 32 }]);

    const fetchMock = vi.fn(async () => {
      throw new Error('simulated total outage');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getHistoricalUsdRate } = await import('../src/lib/rates.js');
    const result = await getHistoricalUsdRate('2025-11-15', 'THB');

    expect(result).toMatchObject({ date: '2025-11-01', rate: 32 });
  });
});

describe('GET /api/rates', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
    current?.cleanup();
    current = undefined;
  });

  it('returns a local cross-rate and never calls fetch', async () => {
    current = await bootTestApp();
    const { app } = current;
    seedRates(current, RATE_DATE, [
      { currency: 'THB', rate: USD_THB },
      { currency: 'EUR', rate: USD_EUR },
    ]);

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await app.request(`/api/rates?date=${RATE_DATE}&currency=THB&base=EUR`, {
      headers: { Authorization: authHeaderFor(1) },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      date: RATE_DATE,
      currency: 'THB',
      base: 'EUR',
      rate: USD_EUR / USD_THB,
      source: 'open-er-api',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the nearest earlier cached date locally, still without calling fetch', async () => {
    current = await bootTestApp();
    const { app } = current;
    seedRates(current, '2026-01-01', [
      { currency: 'THB', rate: USD_THB },
      { currency: 'EUR', rate: USD_EUR },
    ]);

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await app.request(`/api/rates?date=2026-01-20&currency=THB&base=EUR`, {
      headers: { Authorization: authHeaderFor(1) },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toBe('2026-01-01');
    expect(body.rate).toBe(USD_EUR / USD_THB);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('404s with no external call when nothing is cached at all for that currency', async () => {
    current = await bootTestApp();
    const { app } = current;

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await app.request(`/api/rates?date=${RATE_DATE}&currency=THB&base=EUR`, {
      headers: { Authorization: authHeaderFor(1) },
    });

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Phase 4 integration: expense creation uses the cached cross-rate', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('a non-base-currency expense with no client rate uses the cached cross-rate, not a default of 1', async () => {
    current = await bootTestApp();
    const { app } = current;
    seedRates(current, RATE_DATE, [
      { currency: 'THB', rate: USD_THB },
      { currency: 'EUR', rate: USD_EUR },
    ]);

    const tripRes = await app.request('/api/trips', {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Thailand', baseCurrency: 'EUR' }),
    });
    expect(tripRes.status).toBe(201);
    const trip = (await tripRes.json()).trip as { id: string };

    const expenseRes = await app.request(`/api/trips/${trip.id}/expenses`, {
      method: 'POST',
      headers: { Authorization: authHeaderFor(1), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountMinor: 100000,
        currency: 'THB',
        payerId: 1,
        splitMode: 'solo',
        beneficiaryId: 1,
        spentOn: RATE_DATE,
      }),
    });
    expect(expenseRes.status).toBe(201);
    const expense = await expenseRes.json();

    const expectedRate = USD_EUR / USD_THB;
    expect(expense.rateToBase).toBe(expectedRate);
    expect(expense.rateOverridden).toBe(false);
    expect(expense.amountBaseMinor).toBe(2727);
  });
});

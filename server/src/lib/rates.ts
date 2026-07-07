/**
 * Currency rate engine — Phase 5 (IMPLEMENTATION_PLAN.md §4/§6, "Currency
 * Engine"). Internal model: every rate is stored vs **USD** base
 * (`rates.base = 'USD'`, per the schema); any currency->any currency
 * conversion is a cross via USD:
 *
 *     rate(A -> B) = rate(USD -> B) / rate(USD -> A)
 *
 * where `rate(USD -> X)` is the stored `rates.rate` for `(date, 'USD', X)`.
 *
 * **Fetch strategy** (daily cron + startup backfill, both wired in
 * `src/index.ts`):
 *  - Primary: `open.er-api.com` (~166 fiat currencies, no USDT).
 *  - On primary failure: `fawazahmed0/exchange-api` (jsDelivr CDN, then the
 *    `pages.dev` host if jsDelivr itself fails) — covers everything
 *    including USDT in one payload.
 *  - On primary *success*, a small supplementary fawazahmed0 fetch adds just
 *    the USDT row (open.er-api never has it).
 *  - Every fetched payload is filtered down to currencies this app's
 *    registry knows about (`@tripsplit/shared`'s `CURRENCIES`) — fawazahmed0
 *    returns ~340 entries, mostly crypto tokens we don't support, and there
 *    is no reason to let those rows into `rates`.
 *  - Past dates are NEVER overwritten (`onConflictDoNothing`); `date ===
 *    today` may be refreshed (`onConflictDoUpdate`) since intraday rates can
 *    shift and a re-run (cron + a same-day server restart) should reflect
 *    the latest pull.
 *
 * **Hot-path rule:** `getUsdRateLocal`/`getCrossRateLocal` below are pure
 * local SQLite reads and are the ONLY rate lookups `GET /api/rates`
 * (`routes/rates.ts`) and `resolveRate` (`lib/expenses.ts`) are allowed to
 * call — never `fetch`, so the add-expense form's prefill and expense
 * creation itself never block on network. `getHistoricalUsdRate` *does*
 * call `fetch` on a cache-miss date (plan §6's "historical lookup" for
 * back-dated expenses) — see its own doc comment for why nothing in this
 * phase wires it into a request-serving path.
 *
 * **VITEST guard placement:** none of the functions in this module check
 * `process.env.VITEST` themselves — tests mock `global.fetch` and call
 * `fetchOpenErApiRates`/`fetchFawazahmed0Rates`/`fetchDailyUsdRates`/
 * `runDailyRateFetchOnce`/`getHistoricalUsdRate` directly, so an internal
 * guard would make them untestable. What actually needs (and gets) the
 * VITEST guard is the *automatic* triggering of a real fetch at boot: the
 * one-off startup backfill and the cron registration, both gated in
 * `src/index.ts` the exact same way the real `serve()` call already is.
 * Nothing in this module runs anything on import — every side effect is an
 * explicit function call from `src/index.ts`.
 */
import { and, desc, eq, lte } from 'drizzle-orm';
import { findCurrency } from '@tripsplit/shared';
import type { RateSource } from '@tripsplit/shared';
import cron from 'node-cron';

import { db, schema } from '../db/index.js';
import { logger } from './logger.js';

const OPEN_ER_API_URL = 'https://open.er-api.com/v6/latest/USD';

function fawazahmed0JsDelivrUrl(dateSegment: string): string {
  return `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dateSegment}/v1/currencies/usd.min.json`;
}

function fawazahmed0PagesDevUrl(dateSegment: string): string {
  return `https://${dateSegment}.currency-api.pages.dev/v1/currencies/usd.min.json`;
}

const FETCH_TIMEOUT_MS = 10_000;

export interface RateEntry {
  currency: string;
  rate: number;
  source: RateSource;
}

export interface LocalRate {
  rate: number;
  /**
   * The date this rate actually applies to. Equals the requested date on an
   * exact cache hit; an earlier date when the lookup fell back to the
   * nearest earlier cached row — this IS the "source note" plan §6 calls
   * for: callers can tell a rate is stale by comparing this to what they
   * asked for.
   */
  date: string;
  source: RateSource;
}

/** Today's date (UTC), `YYYY-MM-DD` — matches `spentOn`'s format everywhere else. */
export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${url} responded with HTTP ${res.status}`);
    }
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

/** Keeps only rows for currencies `@tripsplit/shared`'s registry knows about. */
function filterKnownCurrencies(entries: RateEntry[]): RateEntry[] {
  return entries.filter((entry) => findCurrency(entry.currency) !== undefined);
}

/**
 * Primary source (plan §6): `open.er-api.com`, one keyless call, ~166 fiat
 * currencies (THB/VND/LAK/UAH all confirmed — Appendix B), no USDT. Throws
 * on any failure (bad status, malformed body) so the caller can fall back.
 */
export async function fetchOpenErApiRates(): Promise<RateEntry[]> {
  const data = (await fetchJson(OPEN_ER_API_URL)) as {
    result?: string;
    rates?: Record<string, number>;
  };
  if (data.result !== 'success' || !data.rates) {
    throw new Error('open.er-api response missing a successful rates payload');
  }
  const entries: RateEntry[] = Object.entries(data.rates).map(([currency, rate]) => ({
    currency: currency.toUpperCase(),
    rate: Number(rate),
    source: 'open-er-api',
  }));
  return filterKnownCurrencies(entries);
}

/**
 * fawazahmed0/exchange-api (plan §6): fallback for fiat, the only source for
 * **USDT**, and (via date-pinned URLs) historical rates. `dateSegment` is
 * `'latest'` for the daily fetch or `'YYYY-MM-DD'` for a historical pull.
 * Tries the jsDelivr CDN first, then the `pages.dev` host — "volunteer-run,
 * no SLA -> fallback chain mandatory" (plan §12's risk table).
 */
export async function fetchFawazahmed0Rates(dateSegment: string): Promise<RateEntry[]> {
  let data: unknown;
  try {
    data = await fetchJson(fawazahmed0JsDelivrUrl(dateSegment));
  } catch (err) {
    logger.warn(
      { err, dateSegment },
      'rates: fawazahmed0 jsDelivr fetch failed, trying pages.dev fallback host',
    );
    data = await fetchJson(fawazahmed0PagesDevUrl(dateSegment));
  }

  const usd = (data as { usd?: Record<string, number> }).usd;
  if (!usd) {
    throw new Error('fawazahmed0 response missing a usd rates payload');
  }
  const entries: RateEntry[] = Object.entries(usd).map(([currency, rate]) => ({
    currency: currency.toUpperCase(),
    rate: Number(rate),
    source: 'fawazahmed0',
  }));
  return filterKnownCurrencies(entries);
}

/**
 * The full daily fetch strategy (plan §6): open.er-api primary; on failure,
 * fawazahmed0 covers everything (incl. USDT) as a single fallback fetch. On
 * primary success, a small supplementary fawazahmed0 fetch adds just the
 * USDT row that open.er-api never carries.
 */
export async function fetchDailyUsdRates(): Promise<RateEntry[]> {
  let primary: RateEntry[];
  try {
    primary = await fetchOpenErApiRates();
  } catch (primaryErr) {
    logger.warn(
      { err: primaryErr },
      'rates: open.er-api fetch failed, falling back to fawazahmed0 for all rates',
    );
    return fetchFawazahmed0Rates('latest');
  }

  try {
    const fawazahmed0 = await fetchFawazahmed0Rates('latest');
    const usdt = fawazahmed0.find((entry) => entry.currency === 'USDT');
    return usdt ? [...primary, usdt] : primary;
  } catch (usdtErr) {
    logger.warn(
      { err: usdtErr },
      'rates: supplementary USDT fetch from fawazahmed0 failed; continuing without it',
    );
    return primary;
  }
}

const RATE_CONFLICT_TARGET = [schema.rates.date, schema.rates.base, schema.rates.currency];

/**
 * Inserts `entries` for `date` (always `base = 'USD'`). Past dates are NEVER
 * overwritten — an existing row for `(date, 'USD', currency)` wins over
 * whatever's in `entries`. `date === todayUtcDate()` is the one exception:
 * today's rows may be refreshed (`onConflictDoUpdate`), since a same-day
 * cron re-run or restart pulling a fresher intraday rate is expected, not a
 * data-integrity violation.
 */
export function upsertRates(date: string, entries: RateEntry[]): void {
  const isToday = date === todayUtcDate();

  db.transaction((tx) => {
    for (const entry of entries) {
      const values = {
        date,
        base: 'USD',
        currency: entry.currency,
        rate: entry.rate,
        source: entry.source,
      };
      const insert = tx.insert(schema.rates).values(values);
      if (isToday) {
        insert
          .onConflictDoUpdate({
            target: RATE_CONFLICT_TARGET,
            set: { rate: entry.rate, source: entry.source },
          })
          .run();
      } else {
        insert.onConflictDoNothing({ target: RATE_CONFLICT_TARGET }).run();
      }
    }
  });
}

/**
 * Fetches + upserts today's USD rates via the full fallback chain. Non-fatal
 * by design (plan §5.2): wraps everything in try/catch and logs via pino —
 * a rate-API outage (or both APIs down) must never crash the process, it
 * just means today's rates stay whatever was last cached (or absent, in
 * which case `resolveRate`'s local lookup safely defaults to `1`).
 */
export async function runDailyRateFetchOnce(): Promise<void> {
  try {
    const entries = await fetchDailyUsdRates();
    upsertRates(todayUtcDate(), entries);
    logger.info({ count: entries.length }, 'rates: daily fetch + upsert complete');
  } catch (err) {
    logger.error({ err }, 'rates: daily fetch failed on both primary and fallback sources');
  }
}

let scheduledTask: ReturnType<typeof cron.schedule> | undefined;

/**
 * Registers the daily 01:00 UTC rate-fetch job (plan §6). Call once at boot
 * — gated behind `!process.env.VITEST` at the call site in `src/index.ts`,
 * mirroring the existing `serve()` guard, so tests never schedule a real
 * timer that could fire a live fetch in the background.
 */
export function scheduleRateCron(): void {
  scheduledTask = cron.schedule(
    '0 1 * * *',
    () => {
      void runDailyRateFetchOnce();
    },
    { timezone: 'UTC' },
  );
}

/** Stops the cron job, if one was scheduled. Exposed for graceful shutdown / tests. */
export function stopRateCron(): void {
  scheduledTask?.stop();
  scheduledTask = undefined;
}

// ---------------------------------------------------------------------------
// Local (no-fetch) lookups — the only primitives the hot paths may use.
// ---------------------------------------------------------------------------

/**
 * The most recent stored USD->`currency` rate on or before `date` — an exact
 * cache hit if `date` itself is cached, otherwise the nearest earlier cached
 * date (both cases are just "the latest row with `date <= requested`",
 * ordered descending — one query covers both, `USD` itself is trivially `1`
 * without needing a seeded row). Never calls `fetch`. Returns `undefined`
 * only when there is truly no cached row for `currency` on or before `date`.
 */
export function getUsdRateLocal(date: string, currency: string): LocalRate | undefined {
  if (currency === 'USD') {
    return { rate: 1, date, source: 'manual' };
  }
  const row = db
    .select()
    .from(schema.rates)
    .where(
      and(
        eq(schema.rates.base, 'USD'),
        eq(schema.rates.currency, currency),
        lte(schema.rates.date, date),
      ),
    )
    .orderBy(desc(schema.rates.date))
    .limit(1)
    .get();
  if (!row) return undefined;
  return { rate: row.rate, date: row.date, source: row.source as RateSource };
}

/**
 * Cross-rate `from -> to` for `date`, local cache only:
 * `rate(A->B) = rate(USD->B) / rate(USD->A)`. `undefined` only when NEITHER
 * side has any cached row on or before `date` — `resolveRate` (lib/expenses.ts)
 * falls back to a safe default of `1` in that case. When one side's lookup
 * fell back to an earlier date than the other, the *staler* (earlier) of the
 * two is reported as this result's `date`/`source`, since that's the
 * limiting factor on how current the answer actually is.
 */
export function getCrossRateLocal(
  date: string,
  from: string,
  to: string,
): LocalRate | undefined {
  if (from === to) {
    return { rate: 1, date, source: 'manual' };
  }
  const usdToFrom = getUsdRateLocal(date, from);
  const usdToTo = getUsdRateLocal(date, to);
  if (!usdToFrom || !usdToTo) return undefined;

  const staler = usdToFrom.date <= usdToTo.date ? usdToFrom : usdToTo;
  return {
    rate: usdToTo.rate / usdToFrom.rate,
    date: staler.date,
    source: staler.source,
  };
}

function getExactUsdRateRow(date: string, currency: string): LocalRate | undefined {
  if (currency === 'USD') {
    return { rate: 1, date, source: 'manual' };
  }
  const row = db
    .select()
    .from(schema.rates)
    .where(
      and(
        eq(schema.rates.base, 'USD'),
        eq(schema.rates.currency, currency),
        eq(schema.rates.date, date),
      ),
    )
    .get();
  if (!row) return undefined;
  return { rate: row.rate, date: row.date, source: row.source as RateSource };
}

/**
 * Historical lookup (plan §6, "5.3 Historical lookup") — for a currency/date
 * combination that isn't cached yet: exact cache hit -> use it; cache miss
 * -> fetch fawazahmed0's date-pinned URL for that exact date and upsert
 * whatever it returns (subject to the same never-overwrite-past-dates rule
 * as everything else); if that also fails (or the currency isn't in the
 * response) -> the nearest earlier cached date, same as `getUsdRateLocal`.
 *
 * This DOES call `fetch`, unlike `getUsdRateLocal`/`getCrossRateLocal`
 * above. Nothing in Phase 5 wires it into a request-serving hot path: the
 * add-expense flow's rate boundary (`resolveRate`, lib/expenses.ts) and
 * `GET /api/rates` both must stay local-only and non-blocking per the plan's
 * "form prefill hot path must be local-only" / "expense creation doesn't
 * block on network" rules, so a synchronous historical fetch has no safe
 * place to run from *within* this phase's request handlers. It's exported
 * and fully tested as a ready-to-use primitive for whichever future caller
 * needs a real (rather than nearest-earlier-approximated) historical rate —
 * e.g. a background cache-warming pass — without re-litigating that
 * constraint. See the Phase 5 report's "Notes for Phase 6" for the same
 * point.
 */
export async function getHistoricalUsdRate(
  date: string,
  currency: string,
): Promise<LocalRate | undefined> {
  const exact = getExactUsdRateRow(date, currency);
  if (exact) return exact;

  try {
    const entries = await fetchFawazahmed0Rates(date);
    upsertRates(date, entries);
    const found = entries.find((entry) => entry.currency === currency.toUpperCase());
    if (found) return { rate: found.rate, date, source: found.source };
  } catch (err) {
    logger.warn({ err, date, currency }, 'rates: historical fetch failed');
  }

  return getUsdRateLocal(date, currency);
}

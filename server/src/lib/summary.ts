/**
 * Trip summary formatter — Export & Group Nudges plan
 * (`docs/EXPORT_NUDGES_PLAN.md`) task T2. Turns a trip's already-computed
 * balances/insights into the HTML message `/summary` (T3) and `POST
 * /api/trips/:id/export` (T5) post to chat, and the one-line "biggest debt"
 * hint T4's nudges append for social pressure.
 *
 * Deliberately does none of its own money/balance math — `getTripBalances`
 * (`lib/balances.ts`) and `getTripInsights` (`lib/insights.ts`) are the
 * single source of truth for that; this module only formats their output
 * through `botMessages`.
 */
import { schema } from '../db/index.js';
import { botMessages, formatBotMoney, type BotLocale } from './botMessages.js';
import { getTripBalances } from './balances.js';
import { getTripInsights } from './insights.js';
import { getTripMembers } from './members.js';
import { getTripWrap } from './wrap.js';

/** Callers (route handlers, bot commands) already have this via `requireMembership`/`getTripOrThrow`. */
export type TripRow = typeof schema.trips.$inferSelect;

function buildNameMap(tripId: string): Map<number, string> {
  return new Map(getTripMembers(tripId).map((m) => [m.id, m.firstName]));
}

/** Trip member's display name, falling back to `userFallback` for a userId with no member row (shouldn't happen, defensive). */
function nameResolver(tripId: string, locale: BotLocale): (userId: number) => string {
  const nameById = buildNameMap(tripId);
  return (userId) => nameById.get(userId) ?? botMessages[locale].userFallback(userId);
}

/**
 * Full HTML summary message: trip title, total spent (base currency),
 * per-currency totals, net balance per member, and either the suggested
 * transfers or the "all settled" empty state — same sections/scope as the
 * web Balance screen (`BalanceScreen.tsx`) plus Stats' total-spent line.
 */
export function buildTripSummaryMessage(trip: TripRow, locale: BotLocale): string {
  const msgs = botMessages[locale];
  const nameFor = nameResolver(trip.id, locale);
  const money = (amountMinor: number, currency = trip.baseCurrency) =>
    formatBotMoney(amountMinor, currency, locale);

  const insights = getTripInsights(trip.id, trip.baseCurrency);
  const { balances, transfers, perCurrency } = getTripBalances(
    trip.id,
    trip.baseCurrency,
  );

  const sections: string[] = [
    msgs.summaryHeader(trip.title),
    msgs.summaryTotalSpent(money(insights.totalBaseMinor)),
  ];

  if (perCurrency.length > 0) {
    sections.push(
      [
        msgs.summaryPerCurrencyHeader(),
        ...perCurrency.map((c) =>
          msgs.summaryPerCurrencyLine(money(c.totalMinor, c.currency)),
        ),
      ].join('\n'),
    );
  }

  sections.push(
    [
      msgs.summaryBalancesHeader(),
      ...balances.map((b) =>
        msgs.summaryNetLine({
          name: nameFor(b.userId),
          amount: money(Math.abs(b.netBaseMinor)),
          status: b.netBaseMinor > 0 ? 'owed' : b.netBaseMinor < 0 ? 'owes' : 'settled',
        }),
      ),
    ].join('\n'),
  );

  sections.push(
    transfers.length === 0
      ? msgs.summaryAllSettled()
      : [
          msgs.summarySuggestedTransfersHeader(),
          ...transfers.map((t) =>
            msgs.summaryTransferLine({
              from: nameFor(t.fromUserId),
              to: nameFor(t.toUserId),
              amount: money(t.amountBaseMinor),
            }),
          ),
        ].join('\n'),
  );

  return sections.join('\n\n');
}

/**
 * One-line "biggest suggested transfer" hint for nudges (T4) — the single
 * transfer with the largest `amountBaseMinor`, or `undefined` once the trip
 * is fully settled (no transfers left). Deliberately picks the largest
 * amount rather than `transfers[0]`: `computeTransfers`' greedy order isn't
 * itself a size ranking (see `lib/balances.ts`), just a settle-one-side-at-
 * a-time sequence.
 */
export function buildTopDebtHint(trip: TripRow, locale: BotLocale): string | undefined {
  const { transfers } = getTripBalances(trip.id, trip.baseCurrency);
  if (transfers.length === 0) return undefined;

  const biggest = transfers.reduce((max, t) =>
    t.amountBaseMinor > max.amountBaseMinor ? t : max,
  );
  const nameFor = nameResolver(trip.id, locale);

  return botMessages[locale].topDebtHint({
    from: nameFor(biggest.fromUserId),
    to: nameFor(biggest.toUserId),
    amount: formatBotMoney(biggest.amountBaseMinor, trip.baseCurrency, locale),
  });
}

/**
 * `POST /:id/close`'s farewell card — Trip Wrap plan (`docs/TRIP_WRAP_PLAN.md`)
 * task W2. A compact celebratory summary built from `getTripWrap` (lib/wrap.ts):
 * headline stats, up to 3 award lines (sponsor / biggest expense / top
 * category champion — each shown only when earned, see `computeTripWrap`),
 * and the settle-state line. Awards like bookkeeper/busiestDay/currencyCollector
 * are deliberately left off — the card stays short enough to read at a glance;
 * the full award list lives on the wrap page itself.
 */
export function buildTripFarewellMessage(trip: TripRow, locale: BotLocale): string {
  const msgs = botMessages[locale];
  const nameFor = nameResolver(trip.id, locale);
  const wrap = getTripWrap(trip);
  const money = (amountMinor: number) =>
    formatBotMoney(amountMinor, wrap.baseCurrency, locale);

  const lines: string[] = [
    msgs.farewellHeader(wrap.title),
    msgs.farewellStats({
      total: money(wrap.totalBaseMinor),
      expenseCount: wrap.expenseCount,
      dayCount: wrap.dayCount,
    }),
  ];

  const sponsor = wrap.awards.find((a) => a.kind === 'sponsor');
  if (sponsor?.userId !== undefined && sponsor.amountBaseMinor !== undefined) {
    lines.push(
      msgs.farewellSponsor({
        name: nameFor(sponsor.userId),
        amount: money(sponsor.amountBaseMinor),
      }),
    );
  }

  const biggestExpense = wrap.awards.find((a) => a.kind === 'biggestExpense');
  if (
    biggestExpense?.userId !== undefined &&
    biggestExpense.amountBaseMinor !== undefined
  ) {
    lines.push(
      msgs.farewellBiggestExpense({
        name: nameFor(biggestExpense.userId),
        amount: money(biggestExpense.amountBaseMinor),
        description: biggestExpense.description,
      }),
    );
  }

  // `awards` lists categoryChampion entries in top-category order (see
  // wrap.ts), so the first one found here is the #1 category by spend.
  const topCategory = wrap.awards.find((a) => a.kind === 'categoryChampion');
  if (
    topCategory?.userId !== undefined &&
    topCategory.amountBaseMinor !== undefined &&
    topCategory.category !== undefined
  ) {
    lines.push(
      msgs.farewellCategoryChampion({
        name: nameFor(topCategory.userId),
        amount: money(topCategory.amountBaseMinor),
        category: topCategory.category,
      }),
    );
  }

  lines.push(
    wrap.settled
      ? msgs.farewellSettled()
      : msgs.farewellOutstanding({ count: wrap.outstandingTransfers.length }),
  );

  return lines.join('\n');
}

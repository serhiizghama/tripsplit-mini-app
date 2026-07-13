/**
 * Wrap screen award → display-line mapping (`docs/TRIP_WRAP_PLAN.md` task
 * W3). Split into pure functions, same reasoning as `exportSummary.ts`: the
 * emoji/title/value-line branching per `WrapAward.kind` is unit-testable
 * without rendering anything (`vitest.config.ts` is pure-logic-only, no
 * jsdom) — `WrapScreen.tsx` just calls these per award row.
 */
import { EXPENSE_CATEGORY_NAME_KEYS } from '@tripsplit/shared';
import type { WrapAward } from '@tripsplit/shared';

import type { Translator } from '../i18n';

type FixedAwardKind = Exclude<WrapAward['kind'], 'categoryChampion'>;

const AWARD_EMOJI: Record<FixedAwardKind, string> = {
  sponsor: '💰',
  bookkeeper: '🧾',
  biggestExpense: '💥',
  busiestDay: '⚡',
  priciestDay: '📉',
  currencyCollector: '🌍',
  settlements: '🤝',
};

/** Every kind but `categoryChampion` has a fixed glyph — that one's IS the category itself. */
export function wrapAwardEmoji(award: WrapAward): string {
  return award.kind === 'categoryChampion'
    ? (award.category ?? '📦')
    : AWARD_EMOJI[award.kind];
}

const AWARD_TITLE_KEYS: Record<FixedAwardKind, string> = {
  sponsor: 'wrap.awardSponsor',
  bookkeeper: 'wrap.awardBookkeeper',
  biggestExpense: 'wrap.awardBiggestExpense',
  busiestDay: 'wrap.awardBusiestDay',
  priciestDay: 'wrap.awardPriciestDay',
  currencyCollector: 'wrap.awardCurrencyCollector',
  settlements: 'wrap.awardSettlements',
};

/** `categoryChampion`'s title interpolates the localized category name; every other kind is a fixed string. */
export function wrapAwardTitle(t: Translator, award: WrapAward): string {
  if (award.kind === 'categoryChampion') {
    const nameKey = award.category
      ? (EXPENSE_CATEGORY_NAME_KEYS as Record<string, string | undefined>)[award.category]
      : undefined;
    return t('wrap.awardCategoryChampion', {
      category: nameKey ? t(nameKey) : (award.category ?? ''),
    });
  }
  return t(AWARD_TITLE_KEYS[award.kind]);
}

export interface WrapAwardLineHelpers {
  money: (amountMinor: number, currency: string) => string;
  /** Formats a bare `YYYY-MM-DD` `spentOn` date — same shape as `useFormatters().dayHeader`. */
  date: (spentOn: string) => string;
  baseCurrency: string;
}

/** The award row's secondary line — money/count/date, whichever fits the kind. */
export function wrapAwardValueLine(
  t: Translator,
  award: WrapAward,
  { money, date, baseCurrency }: WrapAwardLineHelpers,
): string {
  switch (award.kind) {
    case 'sponsor':
    case 'categoryChampion':
      return money(award.amountBaseMinor ?? 0, baseCurrency);
    case 'bookkeeper':
      return t('wrap.expensesLogged', { count: award.count ?? 0 });
    case 'biggestExpense':
      return award.description
        ? `${award.description} · ${money(award.amountBaseMinor ?? 0, baseCurrency)}`
        : money(award.amountBaseMinor ?? 0, baseCurrency);
    case 'busiestDay':
      return t('wrap.expensesOnDay', {
        count: award.count ?? 0,
        date: date(award.date ?? ''),
      });
    case 'priciestDay':
      return t('wrap.priciestDayDetail', {
        amount: money(award.amountBaseMinor ?? 0, baseCurrency),
        date: date(award.date ?? ''),
      });
    case 'currencyCollector':
      return t('wrap.currenciesCount', { count: award.count ?? 0 });
    case 'settlements':
      return t('wrap.settlementsDetail', {
        count: award.count ?? 0,
        amount: money(award.amountBaseMinor ?? 0, baseCurrency),
      });
  }
}

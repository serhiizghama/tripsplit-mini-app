import { describe, expect, it } from 'vitest';
import type { WrapAward } from '@tripsplit/shared';

import { wrapAwardEmoji, wrapAwardTitle, wrapAwardValueLine } from './wrapAwards';
import { createTranslator } from '../i18n/t';
import en from '../i18n/en.json';

const t = createTranslator('en', en);
const money = (amountMinor: number, currency: string) =>
  `${(amountMinor / 100).toFixed(2)} ${currency}`;
const date = (spentOn: string) => `on ${spentOn}`;
const helpers = { money, date, baseCurrency: 'USD' };

describe('wrapAwardEmoji', () => {
  it('uses the fixed glyph for every kind but categoryChampion', () => {
    expect(wrapAwardEmoji({ kind: 'sponsor', userId: 1, amountBaseMinor: 100 })).toBe(
      '💰',
    );
    expect(wrapAwardEmoji({ kind: 'settlements', count: 2, amountBaseMinor: 500 })).toBe(
      '🤝',
    );
  });

  it('uses the category glyph itself for categoryChampion', () => {
    const award: WrapAward = {
      kind: 'categoryChampion',
      userId: 1,
      amountBaseMinor: 100,
      category: '🍺',
    };
    expect(wrapAwardEmoji(award)).toBe('🍺');
  });

  it('falls back to the catch-all glyph when categoryChampion has no category', () => {
    const award: WrapAward = {
      kind: 'categoryChampion',
      userId: 1,
      amountBaseMinor: 100,
    };
    expect(wrapAwardEmoji(award)).toBe('📦');
  });
});

describe('wrapAwardTitle', () => {
  it('resolves a fixed title for a simple kind', () => {
    expect(wrapAwardTitle(t, { kind: 'sponsor', userId: 1, amountBaseMinor: 100 })).toBe(
      en['wrap.awardSponsor'],
    );
    expect(wrapAwardTitle(t, { kind: 'busiestDay', date: '2026-07-10', count: 3 })).toBe(
      en['wrap.awardBusiestDay'],
    );
  });

  it('interpolates the localized category name for categoryChampion', () => {
    const award: WrapAward = {
      kind: 'categoryChampion',
      userId: 1,
      amountBaseMinor: 100,
      category: '🍺',
    };
    expect(wrapAwardTitle(t, award)).toBe(
      (en['wrap.awardCategoryChampion'] as string).replace(
        '{category}',
        en['category.drinks'],
      ),
    );
  });
});

describe('wrapAwardValueLine', () => {
  it('sponsor: shows the paid amount', () => {
    const award: WrapAward = { kind: 'sponsor', userId: 1, amountBaseMinor: 12345 };
    expect(wrapAwardValueLine(t, award, helpers)).toBe('123.45 USD');
  });

  it('bookkeeper: shows the pluralized expenses-logged count', () => {
    const award: WrapAward = { kind: 'bookkeeper', userId: 1, count: 1 };
    expect(wrapAwardValueLine(t, award, helpers)).toBe(
      t('wrap.expensesLogged', { count: 1 }),
    );
  });

  it('biggestExpense: combines description and amount when there is a description', () => {
    const award: WrapAward = {
      kind: 'biggestExpense',
      userId: 1,
      amountBaseMinor: 5000,
      description: 'Scuba diving',
    };
    expect(wrapAwardValueLine(t, award, helpers)).toBe('Scuba diving · 50.00 USD');
  });

  it('biggestExpense: falls back to a bare amount with no description', () => {
    const award: WrapAward = { kind: 'biggestExpense', userId: 1, amountBaseMinor: 5000 };
    expect(wrapAwardValueLine(t, award, helpers)).toBe('50.00 USD');
  });

  it('busiestDay: shows the count + formatted date', () => {
    const award: WrapAward = { kind: 'busiestDay', date: '2026-07-10', count: 4 };
    expect(wrapAwardValueLine(t, award, helpers)).toBe(
      t('wrap.expensesOnDay', { count: 4, date: 'on 2026-07-10' }),
    );
  });

  it('settlements: shows the count + total volume', () => {
    const award: WrapAward = { kind: 'settlements', count: 2, amountBaseMinor: 1000 };
    expect(wrapAwardValueLine(t, award, helpers)).toBe(
      t('wrap.settlementsDetail', { count: 2, amount: '10.00 USD' }),
    );
  });
});

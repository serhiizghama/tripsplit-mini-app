/**
 * Pure unit tests for the `botMessages` dictionary itself (no DB) — covers
 * the pieces `summary.test.ts` doesn't exercise: `/link`/`/unlink` copy,
 * per-event nudge builders (expense add/update/delete, settlement), and
 * `formatBotMoney`. See `summary.test.ts` for `escapeHtml`/`resolveBotLocale`
 * and the full `buildTripSummaryMessage`/`buildTopDebtHint` composition.
 */
import { describe, expect, it } from 'vitest';

import { botMessages, formatBotMoney } from '../src/lib/botMessages.js';

/** `Intl.NumberFormat('ru', ...)` separates the amount from a trailing symbol with a NBSP, not a plain space. */
const NBSP = ' ';

describe('formatBotMoney', () => {
  it('formats with the currency-specific exponent and locale grouping', () => {
    expect(formatBotMoney(10050, 'USD', 'en')).toBe('$100.50');
    expect(formatBotMoney(10050, 'USD', 'ru')).toBe(`100,50${NBSP}$`);
    expect(formatBotMoney(500000, 'VND', 'en')).toBe('₫500,000'); // exponent 0
  });

  it('falls back to the registry symbol for a code Intl does not recognize as ISO 4217', () => {
    expect(formatBotMoney(500, 'USDT', 'en')).toBe('₮5.00');
  });
});

describe('link/unlink messages', () => {
  it('en/ru/uk all escape a malicious trip title in linkSuccess/unlinkSuccess', () => {
    const title = '<script>alert(1)</script>';
    for (const locale of ['en', 'ru', 'uk'] as const) {
      const linked = botMessages[locale].linkSuccess(title);
      const unlinked = botMessages[locale].unlinkSuccess(title);
      expect(linked).not.toContain('<script>');
      expect(unlinked).not.toContain('<script>');
      expect(linked).toContain('&lt;script&gt;');
      expect(unlinked).toContain('&lt;script&gt;');
    }
  });

  it('bad-code and usage-hint copy exists for every locale and mentions /link', () => {
    for (const locale of ['en', 'ru', 'uk'] as const) {
      expect(botMessages[locale].linkUnknownCode().length).toBeGreaterThan(0);
      expect(botMessages[locale].linkUsageHint()).toContain('/link');
      expect(botMessages[locale].unlinkNothingLinked().length).toBeGreaterThan(0);
    }
  });
});

describe('expense nudges', () => {
  it('en: expenseAdded includes actor, amount, description+category, and a planned marker', () => {
    const msg = botMessages.en.expenseAdded({
      actorName: 'Bob',
      amount: '$12.50',
      description: 'Tuk-tuk',
      category: '🚕',
      planned: true,
    });
    expect(msg).toContain('<b>Bob</b> added an expense: $12.50');
    expect(msg).toContain('🚕 Tuk-tuk');
    expect(msg).toContain('(planned — no payer yet)');
  });

  it('omits the detail suffix entirely when there is no description or category', () => {
    const msg = botMessages.en.expenseUpdated({ actorName: 'Bob', amount: '$5.00' });
    expect(msg).toBe('✏️ <b>Bob</b> updated an expense: $5.00');
  });

  it('appends a pre-rendered topDebtHint on its own line when present', () => {
    const hint = botMessages.en.topDebtHint({
      from: 'Anna',
      to: 'Bob',
      amount: '$50.00',
    });
    const msg = botMessages.en.expenseDeleted({
      actorName: 'Bob',
      amount: '$5.00',
      topDebtHint: hint,
    });
    expect(msg.split('\n')).toEqual([
      '🗑️ <b>Bob</b> deleted an expense: $5.00',
      '👉 Biggest debt: Anna → Bob: $50.00',
    ]);
  });

  it('escapes actor name, description, and category (all user-controlled)', () => {
    const msg = botMessages.en.expenseAdded({
      actorName: '<b>Bob</b>',
      amount: '$1.00',
      description: '<i>lunch</i>',
      category: '<u>x</u>',
    });
    expect(msg).not.toContain('<b>Bob</b>');
    expect(msg).not.toContain('<i>lunch</i>');
    expect(msg).toContain('&lt;b&gt;Bob&lt;/b&gt;');
    expect(msg).toContain('&lt;i&gt;lunch&lt;/i&gt;');
    expect(msg).toContain('&lt;u&gt;x&lt;/u&gt;');
  });

  it('ru/uk use the gendered-bracket verb convention for add/update/delete', () => {
    expect(botMessages.ru.expenseAdded({ actorName: 'Аня', amount: '10 $' })).toContain(
      'добавил(а)',
    );
    expect(botMessages.ru.expenseUpdated({ actorName: 'Аня', amount: '10 $' })).toContain(
      'изменил(а)',
    );
    expect(botMessages.ru.expenseDeleted({ actorName: 'Аня', amount: '10 $' })).toContain(
      'удалил(а)',
    );
    expect(botMessages.uk.expenseAdded({ actorName: 'Аня', amount: '10 $' })).toContain(
      'додав(ла)',
    );
    expect(botMessages.uk.expenseUpdated({ actorName: 'Аня', amount: '10 $' })).toContain(
      'змінив(ла)',
    );
    expect(botMessages.uk.expenseDeleted({ actorName: 'Аня', amount: '10 $' })).toContain(
      'видалив(ла)',
    );
  });
});

describe('settlement nudge', () => {
  it('en/ru/uk mention both actor and receiver plus the amount', () => {
    const en = botMessages.en.settlementRecorded({
      actorName: 'Bob',
      receiverName: 'Anna',
      amount: '$25.00',
    });
    expect(en).toBe('🤝 <b>Bob</b> settled up with <b>Anna</b>: $25.00');

    const ru = botMessages.ru.settlementRecorded({
      actorName: 'Боб',
      receiverName: 'Аня',
      amount: '25,00 $',
    });
    expect(ru).toContain('рассчитался(лась)');
    expect(ru).toContain('<b>Боб</b>');
    expect(ru).toContain('<b>Аня</b>');

    const uk = botMessages.uk.settlementRecorded({
      actorName: 'Боб',
      receiverName: 'Аня',
      amount: '25,00 $',
    });
    expect(uk).toContain('розрахувався(лася)');
  });
});

describe('userFallback', () => {
  it('matches the web app copy convention ("User {id}" / "Пользователь {id}" / "Користувач {id}")', () => {
    expect(botMessages.en.userFallback(42)).toBe('User 42');
    expect(botMessages.ru.userFallback(42)).toBe('Пользователь 42');
    expect(botMessages.uk.userFallback(42)).toBe('Користувач 42');
  });
});

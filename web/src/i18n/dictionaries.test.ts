/**
 * i18n completeness check — Phase 7 DoD: "confirm all three dictionaries
 * have the same key set". `en.json` is the source; `ru.json`/`uk.json` must
 * define every key `en.json` does (and no extra ones), including matching
 * plural-form shapes (both `Dictionary`-typed).
 */
import { describe, expect, it } from 'vitest';

import en from './en.json';
import ru from './ru.json';
import uk from './uk.json';

function keySet(dict: Record<string, unknown>): string[] {
  return Object.keys(dict).sort();
}

describe('locale dictionary completeness', () => {
  it('ru.json has exactly the same key set as en.json', () => {
    expect(keySet(ru)).toEqual(keySet(en));
  });

  it('uk.json has exactly the same key set as en.json', () => {
    expect(keySet(uk)).toEqual(keySet(en));
  });

  it('every value is a non-empty string or a plural-form object with at least one form', () => {
    for (const dict of [en, ru, uk]) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === 'string') {
          expect(value.length, `${key} should not be empty`).toBeGreaterThan(0);
        } else {
          expect(typeof value, `${key} should be a string or object`).toBe('object');
          expect(Object.keys(value).length, `${key} plural map should not be empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('includes currency.* name keys matching @tripsplit/shared\'s currency registry', async () => {
    const { CURRENCIES } = await import('@tripsplit/shared');
    for (const currency of CURRENCIES) {
      expect(en, `en.json missing ${currency.nameKey}`).toHaveProperty(currency.nameKey);
      expect(ru, `ru.json missing ${currency.nameKey}`).toHaveProperty(currency.nameKey);
      expect(uk, `uk.json missing ${currency.nameKey}`).toHaveProperty(currency.nameKey);
    }
  });

  it('includes category.* name keys matching @tripsplit/shared\'s category registry', async () => {
    const { EXPENSE_CATEGORY_NAME_KEYS } = await import('@tripsplit/shared');
    for (const nameKey of Object.values(EXPENSE_CATEGORY_NAME_KEYS)) {
      expect(en).toHaveProperty(nameKey);
      expect(ru).toHaveProperty(nameKey);
      expect(uk).toHaveProperty(nameKey);
    }
  });
});

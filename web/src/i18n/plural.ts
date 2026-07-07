/**
 * ICU-lite plural form selector — IMPLEMENTATION_PLAN.md §9 ("ICU-lite plural
 * for RU/UK forms — hand-rolled 3-form rule"). Hand-rolled on purpose (no
 * `Intl.PluralRules` dependency needed for just two rule shapes, and this way
 * the exact CLDR rule is visible and unit-tested in one place).
 *
 * Two shapes only, matching this app's 3 locales:
 *  - EN (2-form, CLDR "west" pattern): `n === 1` -> 'one', else 'other'.
 *  - RU/UK (3-form Slavic pattern, CLDR one/few/many): driven by `n % 10` and
 *    `n % 100` —
 *      one:  n%10 === 1 && n%100 !== 11                          (1, 21, 31, ...)
 *      few:  n%10 in [2,4] && n%100 not in [12,14]                (2-4, 22-24, ...)
 *      many: everything else                                     (0, 5-20, 25-30, ...)
 *    CLDR also defines a 4th 'other' form for non-integer quantities (e.g.
 *    "2.5"), which never occurs here (member/expense counts are always
 *    integers) — dictionaries still provide an 'other' fallback (see
 *    `t.ts`'s `resolvePluralForm`) equal to 'many' for robustness, but the
 *    selector itself never returns it for RU/UK.
 */
export type PluralForm = 'one' | 'few' | 'many' | 'other';

/** Locales that use the 2-form English-style rule (`one` | `other`). */
const TWO_FORM_LOCALES = new Set(['en']);

export function selectPluralForm(locale: string, count: number): PluralForm {
  const n = Math.abs(Math.trunc(count));

  if (TWO_FORM_LOCALES.has(locale)) {
    return n === 1 ? 'one' : 'other';
  }

  // RU/UK 3-form Slavic rule (also the correct fallback for any locale not
  // explicitly listed above — there are only 3 locales in this app).
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'few';
  return 'many';
}

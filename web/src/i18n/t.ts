/**
 * Hand-rolled `t(key, params?)` — IMPLEMENTATION_PLAN.md §9 ("Tiny helper
 * (`t(key, params)`"). No i18next/FormatJS: interpolation is a single regex
 * replace, plural resolution defers to `plural.ts`'s `selectPluralForm`.
 */
import type { Dictionary, Locale } from './locales';
import { selectPluralForm } from './plural';

export type TranslateParams = Record<string, string | number> & { count?: number };

const INTERPOLATION_PATTERN = /\{(\w+)\}/g;

function interpolate(template: string, params: TranslateParams | undefined): string {
  if (!params) return template;
  return template.replace(INTERPOLATION_PATTERN, (match, token: string) => {
    const value = params[token];
    return value === undefined ? match : String(value);
  });
}

/**
 * Builds a `t()` bound to one locale's dictionary. Missing keys fall back to
 * the raw key itself (visibly wrong rather than silently blank — easy to
 * spot in a screenshot/QA pass) and log a warning in dev.
 */
export function createTranslator(locale: Locale, dictionary: Dictionary) {
  return function t(key: string, params?: TranslateParams): string {
    const entry = dictionary[key];

    if (entry === undefined) {
      if (import.meta.env.DEV) {
        console.warn(`[i18n] missing key "${key}" for locale "${locale}"`);
      }
      return key;
    }

    if (typeof entry === 'string') {
      return interpolate(entry, params);
    }

    // Plural-form map (see `locales.ts`'s `DictionaryValue`) — `count` selects
    // the CLDR form via `selectPluralForm`, falling back to 'other'/'many' if
    // a particular locale's dictionary doesn't define the exact form picked
    // (shouldn't happen given `dictionaries.test.ts`, but stay defensive).
    const count = params?.count ?? 0;
    const form = selectPluralForm(locale, count);
    const template = entry[form] ?? entry.other ?? entry.many ?? entry.one ?? Object.values(entry)[0];
    return template ? interpolate(template, params) : key;
  };
}

export type Translator = ReturnType<typeof createTranslator>;

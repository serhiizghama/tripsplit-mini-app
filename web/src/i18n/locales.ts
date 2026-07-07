/**
 * Locale registry — IMPLEMENTATION_PLAN.md §9. Three flat JSON dictionaries
 * (`en.json` is the source; `ru.json`/`uk.json` mirror its exact key set —
 * enforced by `dictionaries.test.ts`), bundled directly (no lazy-loading: all
 * three together are a few KB of JSON text, far cheaper than a real i18n
 * library — see the plan's bundle-size constraint, §7.5).
 */
import en from './en.json';
import ru from './ru.json';
import uk from './uk.json';

export type Locale = 'en' | 'ru' | 'uk';

export const DEFAULT_LOCALE: Locale = 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'ru', 'uk'];

/** A dictionary value is either a plain string or a plural-form map (see `plural.ts`). */
export type DictionaryValue = string | Partial<Record<'one' | 'few' | 'many' | 'other', string>>;
export type Dictionary = Record<string, DictionaryValue>;

export const DICTIONARIES: Record<Locale, Dictionary> = { en, ru, uk };

export function isSupportedLocale(value: string | undefined | null): value is Locale {
  return value === 'en' || value === 'ru' || value === 'uk';
}

/**
 * Native-language labels for the language switcher (Settings screen). These
 * are deliberately NOT part of the translatable dictionaries — the point of
 * a language picker is that each option is spelled in ITS OWN language
 * regardless of the currently active UI locale (so a Russian-reading user
 * who somehow ended up on the English UI can still recognize "Русский").
 */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
  uk: 'Українська',
};

/**
 * Best-effort initial-locale guess from the browser/webview's own language
 * (`navigator.language`), used only until the authoritative `me.user.lang`
 * (server-resolved from Telegram's `language_code`, §9) loads — see
 * `LocaleContext.tsx`'s `useSyncLocaleFromServer`. Telegram's WebView sets
 * `navigator.language` to the client's own locale too, so this avoids an
 * English flash for RU/UK users on first paint.
 */
export function guessInitialLocale(): Locale {
  try {
    const lang = (navigator.language || '').toLowerCase();
    if (lang.startsWith('ru')) return 'ru';
    if (lang.startsWith('uk')) return 'uk';
  } catch {
    // `navigator` unavailable (non-browser test environment) — fall through.
  }
  return DEFAULT_LOCALE;
}

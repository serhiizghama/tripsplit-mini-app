/** Public surface of the i18n module — see IMPLEMENTATION_PLAN.md §9. */
export { LocaleProvider } from './LocaleContext';
export { useLocale, useT, useFormatters } from './hooks';
export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  LOCALE_NATIVE_NAMES,
  isSupportedLocale,
  guessInitialLocale,
  type Locale,
} from './locales';
export { selectPluralForm, type PluralForm } from './plural';
export type { Translator, TranslateParams } from './t';

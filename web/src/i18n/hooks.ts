/**
 * i18n hooks — split from `LocaleContext.tsx` (which exports only the
 * `LocaleProvider` component) purely to keep Fast Refresh happy; see
 * `context.ts`'s doc comment.
 */
import { useContext } from 'react';

import { LocaleContext } from './context';
import type { LocaleContextValue } from './context';
import type { Locale } from './locales';
import type { Translator } from './t';

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale/useT/useFormatters must be used within <LocaleProvider>');
  }
  return ctx;
}

/** Current locale + setter (the Settings screen's language switcher uses the setter directly). */
export function useLocale(): readonly [Locale, (locale: Locale) => void] {
  const { locale, setLocale } = useLocaleContext();
  return [locale, setLocale] as const;
}

/** `t(key, params?)` bound to the current locale's dictionary — see `t.ts`. */
export function useT(): Translator {
  return useLocaleContext().t;
}

/** `Intl`-backed money/date formatters bound to the current locale. */
export function useFormatters() {
  const { formatMoney: money, formatDayHeader: dayHeader, formatShortDate: shortDate } =
    useLocaleContext();
  return { money, dayHeader, shortDate };
}

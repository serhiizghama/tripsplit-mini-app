/**
 * Locale provider — IMPLEMENTATION_PLAN.md §9 ("locale context in React").
 * Wraps the whole app (see `main.tsx`) so every screen can call `useT()`
 * (from `hooks.ts`) for strings and `useFormatters()` for `Intl`-backed
 * money/date display, all bound to the same current `Locale`.
 *
 * Initial locale is a client-only best-effort guess (`guessInitialLocale`,
 * from `navigator.language`) so RU/UK users don't see an English flash
 * before `GET /api/me` resolves; `AppShell`'s locale-sync effect then
 * corrects it to the server-authoritative `me.user.lang` (which Telegram's
 * `language_code` resolves to server-side, or the user's own `PATCH
 * /api/me` override — see `server/src/middleware/auth.ts`).
 */
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { formatDayHeader, formatShortDate } from '../lib/date';
import { formatMoney } from '../lib/money';
import { LocaleContext } from './context';
import type { LocaleContextValue } from './context';
import { DICTIONARIES, guessInitialLocale } from './locales';
import type { Locale } from './locales';
import { createTranslator } from './t';

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(guessInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState((prev) => (prev === next ? prev : next));
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: createTranslator(locale, DICTIONARIES[locale]),
      formatMoney: (amountMinor: number, currency: string) =>
        formatMoney(amountMinor, currency, locale),
      formatDayHeader: (spentOn: string) => formatDayHeader(spentOn, locale),
      formatShortDate: (iso: string) => formatShortDate(iso, locale),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

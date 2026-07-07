/**
 * Raw locale context object — split out from `LocaleContext.tsx` (which
 * exports only the `LocaleProvider` component) and `hooks.ts` (which exports
 * only hooks) purely so Fast Refresh stays happy; same pattern already used
 * for `components/MemberAvatar.tsx` / `lib/avatarPerson.ts` — see that
 * file's doc comment (`react-refresh/only-export-components`).
 */
import { createContext } from 'react';

import type { Locale } from './locales';
import type { Translator } from './t';

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translator;
  formatMoney: (amountMinor: number, currency: string) => string;
  formatDayHeader: (spentOn: string) => string;
  formatShortDate: (iso: string) => string;
}

export const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

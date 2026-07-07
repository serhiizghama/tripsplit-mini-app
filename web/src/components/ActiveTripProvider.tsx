/**
 * Active-trip provider — invisible plumbing for the (future) multi-trip
 * switcher UI. Wraps the whole app (see `main.tsx`, inside `LocaleProvider`)
 * so `useCurrentTrip()` (`api/queries.ts`) can resolve "the" trip against a
 * persisted, switchable id instead of always picking `trips[0]`. Mirrors
 * `i18n/LocaleContext.tsx`'s provider structure.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  ActiveTripContext,
  getStoredActiveTripId,
  setStoredActiveTripId,
} from '../lib/activeTrip';
import type { ActiveTripContextValue } from '../lib/activeTrip';

export function ActiveTripProvider({ children }: { children: ReactNode }) {
  const [activeTripId, setState] = useState<string | null>(getStoredActiveTripId);

  const setActiveTripId = useCallback((id: string) => {
    setStoredActiveTripId(id);
    setState(id);
  }, []);

  const value = useMemo<ActiveTripContextValue>(
    () => ({ activeTripId, setActiveTripId }),
    [activeTripId, setActiveTripId],
  );

  return <ActiveTripContext.Provider value={value}>{children}</ActiveTripContext.Provider>;
}

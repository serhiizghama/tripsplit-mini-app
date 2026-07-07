/**
 * Active-trip id, persisted client-side — invisible plumbing for the (future)
 * multi-trip switcher UI. `localStorage` is plenty for a single-device
 * preference like this (no server round trip needed); wrapped in try/catch
 * since Telegram WebViews occasionally run with storage disabled (e.g. some
 * in-app browser privacy modes) — mirrors `lib/lastCurrency.ts`.
 *
 * The context + hook live here too (rather than a `.tsx` component file) so
 * this stays a plain `.ts` module and can export non-component values without
 * tripping `react-refresh/only-export-components` — same reasoning as
 * `i18n/context.ts` / `lib/avatarPerson.ts`.
 */
import { createContext, useContext } from 'react';

const STORAGE_KEY = 'tripsplit:activeTripId';

/** Reads the persisted active-trip id, or `null` if unset/unavailable. */
export function getStoredActiveTripId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persists the active-trip id; pass `null` to clear it. */
export function setStoredActiveTripId(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    // Ignore — worst case, the active trip doesn't survive a reload.
  }
}

/**
 * Pure resolution logic for `useCurrentTrip()` (`api/queries.ts`): the stored
 * id wins if it still names a trip the user belongs to, otherwise falls back
 * to the first trip in `/api/me`'s list (same default as before there was a
 * switcher) — `undefined` when the user has no trips at all.
 */
export function resolveActiveTripId(
  trips: { id: string }[],
  storedId: string | null,
): string | undefined {
  if (storedId !== null && trips.some((trip) => trip.id === storedId)) {
    return storedId;
  }
  return trips[0]?.id;
}

/** Context value shared by `ActiveTripProvider` and `useActiveTrip`. */
export interface ActiveTripContextValue {
  activeTripId: string | null;
  setActiveTripId: (id: string) => void;
}

export const ActiveTripContext = createContext<ActiveTripContextValue | null>(null);

/** Current active-trip id + setter — throws outside `<ActiveTripProvider>`. */
export function useActiveTrip(): ActiveTripContextValue {
  const ctx = useContext(ActiveTripContext);
  if (!ctx) {
    throw new Error('useActiveTrip must be used within ActiveTripProvider');
  }
  return ctx;
}

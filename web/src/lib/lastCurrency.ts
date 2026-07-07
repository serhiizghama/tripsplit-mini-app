/**
 * Last-used expense currency, persisted client-side — plan §6/§8: the
 * add-expense sheet's currency chip "defaults to last used". `localStorage`
 * is plenty for a single-device preference like this (no server round trip
 * needed); wrapped in try/catch since Telegram WebViews occasionally run
 * with storage disabled (e.g. some in-app browser privacy modes).
 */
const STORAGE_KEY = 'tripsplit:lastCurrency';

export function getLastCurrency(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setLastCurrency(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Ignore — worst case, next sheet just falls back to the trip's base currency.
  }
}

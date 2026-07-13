import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from './client';
import { markAuthExpired } from '../lib/authExpiredBus';
import { emitToast } from '../lib/toastBus';

/** Only ApiError carries a real, user-safe message — see `api/client.ts`. */
function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong';
}

/**
 * A 401 means Telegram's signed `initData` expired mid-session (plan §12's
 * "initData 1h expiry during long sessions" risk) — every OTHER error is a
 * normal, transient failure. `middleware/auth.ts`'s server side never
 * returns 401 for any other reason (a missing/forged/expired header), so
 * this status code alone is enough to tell the two apart, with no need to
 * inspect the error's `code` string.
 */
function isSessionExpiredError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/**
 * Phase 8.4's graceful-401 handling: routes a session-expired error to
 * `authExpiredBus` instead of the regular error toast. `App.tsx` subscribes
 * to that bus and swaps the ENTIRE router tree for a friendly "reopen the
 * app" screen — a toast alone would leave whatever broken/partial screen was
 * already rendered, and there is no in-page token refresh to perform
 * (Telegram only re-issues a fresh `initData` on a new launch).
 *
 * Exported (rather than only used inline below) so it's unit-testable
 * without rendering a single React component — see `queryClient.test.ts`.
 */
export function handleQueryError(err: unknown): void {
  if (isSessionExpiredError(err)) {
    markAuthExpired();
    return;
  }
  emitToast(errorMessage(err));
}

/**
 * Same as `handleQueryError`, but for mutations only: skips the toast
 * entirely when `meta: { silent: true }` — the caller already shows its own,
 * more specific (and localized) error toast from the mutation's own
 * `onError` (e.g. `BalanceScreen`'s export button), so a second, generic
 * English one would just be noise. Exported for the same reason as
 * `handleQueryError` — unit-testable without rendering anything.
 */
export function handleMutationError(
  err: unknown,
  meta: { silent?: boolean } | undefined,
): void {
  if (meta?.silent) return;
  handleQueryError(err);
}

/**
 * Plan §3: "the server is the single source of truth; no clever client
 * caches" — refetch-on-focus/reconnect are TanStack Query's own defaults,
 * kept explicit here so that intent survives a future default change.
 *
 * Phase 7.3 ("offline/error toast for failed requests"): `QueryCache`/
 * `MutationCache`'s global `onError` is the one place that sees EVERY failed
 * request, including background refetches a screen's own inline
 * `Placeholder`+Retry state (Phase 3-6) never renders for (e.g. a
 * refetch-on-focus that fails while stale data is still shown). See
 * `lib/toastBus.ts` for why this is a plain event emitter rather than
 * something routed through React context.
 *
 * `retry` skips the default single retry for a session-expired 401 —
 * retrying with the exact same stale `initData` can only ever fail the same
 * way again, so it'd just delay `handleQueryError` from firing for no
 * benefit (and needlessly spends one of the rate limiter's per-user request
 * slots — `server/src/middleware/rateLimit.ts`).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => !isSessionExpiredError(error) && failureCount < 1,
    },
  },
  queryCache: new QueryCache({ onError: handleQueryError }),
  mutationCache: new MutationCache({
    onError: (err, _variables, _context, mutation) =>
      handleMutationError(err, mutation.meta),
  }),
});

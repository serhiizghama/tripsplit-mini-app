/**
 * Minimal pub-sub for the app-wide "session expired" signal — Phase 8.4's
 * graceful-401 handling (IMPLEMENTATION_PLAN.md §12: "initData 1h expiry
 * during long sessions -> surprise 401"). Same shape as `toastBus.ts` (a
 * plain event bus, not React context) and for the same reason:
 * `api/queryClient.ts` constructs its `QueryClient` — and therefore this
 * bus's only producer, `handleQueryError` — at module scope, before any
 * component/provider exists.
 *
 * Deliberately a single boolean flag rather than a message queue: once any
 * request 401s, the user's entire session is stale (Telegram only re-issues
 * a fresh `initData` on a new app launch, never via any in-page action) —
 * there's nothing more specific to queue, and every subsequent 401 from
 * other in-flight requests just restates the same fact.
 */
export type AuthExpiredListener = (expired: boolean) => void;

const listeners = new Set<AuthExpiredListener>();
let expired = false;

/** Marks the session expired and notifies every subscriber. Idempotent. */
export function markAuthExpired(): void {
  if (expired) return;
  expired = true;
  for (const listener of listeners) listener(true);
}

/**
 * Production code has no "un-expire" path — a real fix requires the user to
 * actually reopen the app, which tears down this whole module graph and
 * starts fresh anyway. Exported only so tests can reset shared state between
 * cases without reaching for `vi.resetModules()` for a one-flag module.
 */
export function resetAuthExpiredForTests(): void {
  expired = false;
}

export function subscribeAuthExpired(listener: AuthExpiredListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isAuthExpired(): boolean {
  return expired;
}

/**
 * Minimal pub-sub for cross-cutting toast messages — Phase 7.3's "offline/
 * error toast for failed requests". A plain event bus (not React context) on
 * purpose: `queryClient.ts`'s `QueryClient` is constructed at module scope,
 * before any component (and therefore any context provider) exists, but its
 * `QueryCache`/`MutationCache` `onError` callbacks are exactly where a
 * *global* "some request failed in the background" signal belongs — the
 * per-screen `Placeholder` + Retry states (Phase 3-6) already cover the
 * handful of primary queries; this catches everything else (a stale
 * background refetch, an unhandled mutation, ...).
 */
export type ToastListener = (message: string) => void;

const listeners = new Set<ToastListener>();

export function emitToast(message: string): void {
  for (const listener of listeners) listener(message);
}

export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

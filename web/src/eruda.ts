/**
 * Eruda dev console toggle (Phase 0 / §7 dev loop).
 *
 * Telegram's in-app WebView has no attached devtools, so debugging on a
 * real phone needs an in-page console. Loading Eruda unconditionally
 * would bloat the production bundle and expose a debug console to real
 * users, so it is:
 *   - dev-only (`import.meta.env.DEV`), AND
 *   - opt-in via `?eruda=1` in the URL (also honored inside the Telegram
 *     WebView, since the Mini App URL can carry query params).
 *
 * Usage: open the dev-tunnel URL (see scripts/dev-tunnel.sh) with
 * `?eruda=1` appended, e.g. https://<tunnel>.trycloudflare.com/?eruda=1
 *
 * Loaded from a CDN via dynamic import so it never lands in
 * `web/dist` — this file is a thin conditional wrapper, wired from
 * main.tsx. Phase 2 can extend the condition (e.g. also gate on a
 * `start_param` flag) once the TG SDK is wired up.
 */

const ERUDA_CDN_URL = 'https://cdn.jsdelivr.net/npm/eruda';

export async function maybeLoadEruda(): Promise<void> {
  if (!import.meta.env.DEV) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get('eruda') !== '1') return;

  // Dynamic <script> injection rather than a bare dynamic import(): Eruda
  // is a plain UMD/global script, not an ES module, so this is more
  // reliable across bundlers than `import(ERUDA_CDN_URL)`.
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ERUDA_CDN_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load eruda from CDN'));
    document.head.appendChild(script);
  });

  const eruda = (window as unknown as { eruda?: { init: () => void } }).eruda;
  eruda?.init();
}

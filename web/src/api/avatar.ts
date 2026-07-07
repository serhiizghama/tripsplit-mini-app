/**
 * `GET /api/avatar/:userId` client — Phase 3.4/3.5.
 *
 * This route is auth-protected like every other `/api/*` endpoint (see
 * `server/src/routes/avatar.ts`), which means a plain `<img src="/api/avatar/…">`
 * can't work: browsers never attach custom headers (our
 * `Authorization: tma …`) to image requests. Instead we fetch the bytes
 * ourselves with the same header the rest of the app uses, turn them into a
 * `Blob`, and hand the component an object URL. A failed/404 fetch resolves
 * to `undefined`, which is exactly what `MemberAvatar` needs to fall through
 * to the initials circle — the last link in the plan §7 fallback chain
 * (`photoUrl` → this proxy → initials).
 */
import { useEffect, useState } from 'react';

import { getInitDataRaw } from '../telegram/launchData';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');

async function fetchAvatarObjectUrl(
  userId: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  const headers = new Headers();
  const initDataRaw = getInitDataRaw();
  if (initDataRaw) {
    headers.set('Authorization', `tma ${initDataRaw}`);
  }

  const res = await fetch(`${API_BASE}/avatar/${userId}`, { headers, signal });
  if (!res.ok) return undefined;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Fetches the avatar proxy for `userId` and returns an object URL once
 * loaded, or `undefined` while loading / on any failure. Pass `undefined`
 * for `userId` to skip the fetch entirely (e.g. when a direct `photoUrl` is
 * already available and this proxy isn't needed).
 */
export function useAvatarSrc(userId: number | undefined): string | undefined {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    setSrc(undefined);
    if (userId === undefined) return;

    const controller = new AbortController();
    let objectUrl: string | undefined;

    fetchAvatarObjectUrl(userId, controller.signal)
      .then((url) => {
        if (controller.signal.aborted) return;
        objectUrl = url;
        setSrc(url);
      })
      .catch(() => {
        // Network error, abort, etc. — leave `src` unset so the caller
        // falls back to initials; this is a normal, expected outcome.
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId]);

  return src;
}

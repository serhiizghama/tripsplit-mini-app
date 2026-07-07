/**
 * Centralized API client — Phase 2.3.
 *
 * Matches the Phase 1 auth contract exactly (see
 * `server/src/middleware/auth.ts`): every request carries
 * `Authorization: tma <initDataRaw>` when we have one, JSON in/out, and
 * errors are `{code, message}` (`ApiErrorBody`).
 *
 * Base URL is configurable via `VITE_API_BASE` (defaults to `/api`, which is
 * both what nginx reverse-proxies in production and what `vite.config.ts`'s
 * dev proxy forwards to the local server during `npm run dev`).
 */
import type { ApiErrorBody } from '@tripsplit/shared';

import { getInitDataRaw } from '../telegram/launchData';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
  }
}

async function parseErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (typeof body.code === 'string' && typeof body.message === 'string') {
      return { code: body.code, message: body.message };
    }
  } catch {
    // Non-JSON error body (e.g. a dev-proxy 404 HTML page) — fall through.
  }
  return { code: 'unknown_error', message: `Request failed with status ${res.status}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const initDataRaw = getInitDataRaw();
  if (initDataRaw) {
    headers.set('Authorization', `tma ${initDataRaw}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

function toJsonBody(body: unknown): string | undefined {
  return body === undefined ? undefined : JSON.stringify(body);
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: toJsonBody(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: toJsonBody(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

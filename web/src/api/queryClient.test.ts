/**
 * `handleQueryError` tests — Phase 8.4's graceful-401 handling. Drives the
 * exact function `queryClient`'s `QueryCache`/`MutationCache` wire into
 * `onError`, without rendering any component or a real failed network
 * request — a 401 `ApiError` (the only way the server ever returns 401, per
 * `server/src/middleware/auth.ts`) must route to `authExpiredBus`, and
 * every other error must still hit the regular toast bus untouched.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from './client';
import { handleMutationError, handleQueryError } from './queryClient';
import { isAuthExpired, resetAuthExpiredForTests } from '../lib/authExpiredBus';
import { subscribeToast } from '../lib/toastBus';

function unauthorizedError(message = 'Invalid or expired Telegram init data'): ApiError {
  return new ApiError(401, { code: 'unauthorized', message });
}

describe('handleQueryError', () => {
  afterEach(() => {
    resetAuthExpiredForTests();
  });

  it('routes a 401 ApiError to authExpiredBus, not the toast', () => {
    const toastMessages: string[] = [];
    const unsubscribe = subscribeToast((message) => toastMessages.push(message));

    expect(isAuthExpired()).toBe(false);
    handleQueryError(unauthorizedError());

    expect(isAuthExpired()).toBe(true);
    expect(toastMessages).toEqual([]);
    unsubscribe();
  });

  it('routes a non-401 ApiError to the toast, leaving authExpiredBus untouched', () => {
    const toastMessages: string[] = [];
    const unsubscribe = subscribeToast((message) => toastMessages.push(message));

    handleQueryError(
      new ApiError(500, { code: 'internal_error', message: 'Something broke' }),
    );

    expect(isAuthExpired()).toBe(false);
    expect(toastMessages).toEqual(['Something broke']);
    unsubscribe();
  });

  it('routes a plain Error (e.g. a network failure) to the toast the same way', () => {
    const toastMessages: string[] = [];
    const unsubscribe = subscribeToast((message) => toastMessages.push(message));

    handleQueryError(new Error('network down'));

    expect(isAuthExpired()).toBe(false);
    expect(toastMessages).toEqual(['network down']);
    unsubscribe();
  });

  it('a 403 (membership) error is NOT treated as a session expiry', () => {
    const toastMessages: string[] = [];
    const unsubscribe = subscribeToast((message) => toastMessages.push(message));

    handleQueryError(new ApiError(403, { code: 'forbidden', message: 'Not a member' }));

    expect(isAuthExpired()).toBe(false);
    expect(toastMessages).toEqual(['Not a member']);
    unsubscribe();
  });
});

describe('handleMutationError', () => {
  it('skips the toast when the mutation opts out via meta: { silent: true }', () => {
    const toastMessages: string[] = [];
    const unsubscribe = subscribeToast((message) => toastMessages.push(message));

    handleMutationError(
      new ApiError(502, { code: 'export_failed', message: 'Could not deliver' }),
      {
        silent: true,
      },
    );

    expect(toastMessages).toEqual([]);
    unsubscribe();
  });

  it('falls through to handleQueryError when meta is absent or not silent', () => {
    const toastMessages: string[] = [];
    const unsubscribe = subscribeToast((message) => toastMessages.push(message));

    handleMutationError(
      new ApiError(500, { code: 'internal_error', message: 'Broke' }),
      undefined,
    );

    expect(toastMessages).toEqual(['Broke']);
    unsubscribe();
  });
});

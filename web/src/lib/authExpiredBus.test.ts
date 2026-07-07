/**
 * `authExpiredBus` pub-sub tests — Phase 8.4's graceful-401 handling. Plain
 * logic, no DOM/React needed (matches this workspace's `node`-environment
 * vitest config — see `vitest.config.ts`'s doc comment).
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  isAuthExpired,
  markAuthExpired,
  resetAuthExpiredForTests,
  subscribeAuthExpired,
} from './authExpiredBus';

describe('authExpiredBus', () => {
  afterEach(() => {
    resetAuthExpiredForTests();
  });

  it('starts non-expired', () => {
    expect(isAuthExpired()).toBe(false);
  });

  it('marks expired and notifies subscribers with true', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeAuthExpired((expired) => seen.push(expired));

    markAuthExpired();

    expect(isAuthExpired()).toBe(true);
    expect(seen).toEqual([true]);
    unsubscribe();
  });

  it('is idempotent — a second markAuthExpired call does not notify again', () => {
    markAuthExpired();
    const seen: boolean[] = [];
    const unsubscribe = subscribeAuthExpired((expired) => seen.push(expired));

    markAuthExpired();

    expect(seen).toEqual([]);
    unsubscribe();
  });

  it('unsubscribe stops further notifications', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeAuthExpired((expired) => seen.push(expired));
    unsubscribe();

    markAuthExpired();

    expect(seen).toEqual([]);
  });
});

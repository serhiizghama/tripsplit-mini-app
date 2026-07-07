/**
 * DB bootstrap pragma tests — Phase 8.4 (IMPLEMENTATION_PLAN.md §12's
 * "SQLite single-writer under concurrency" risk). Asserts `createDb`
 * actually applies the pragmas `src/db/index.ts` sets on every connection —
 * WAL mode (already relied on implicitly by every other test) and the
 * `busy_timeout` this phase adds, so brief write contention retries instead
 * of failing immediately with `SQLITE_BUSY`.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { bootTestApp, type TestApp } from './helpers.js';

describe('DB bootstrap pragmas', () => {
  let current: TestApp | undefined;

  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  it('sets busy_timeout so brief write contention retries instead of erroring immediately', async () => {
    current = await bootTestApp();
    const { sqlite } = current;

    const result = sqlite.pragma('busy_timeout', { simple: true });
    expect(result).toBe(5000);
  });

  it('runs in WAL mode', async () => {
    current = await bootTestApp();
    const { sqlite } = current;

    const result = sqlite.pragma('journal_mode', { simple: true });
    expect(String(result).toLowerCase()).toBe('wal');
  });

  it('has foreign keys enabled', async () => {
    current = await bootTestApp();
    const { sqlite } = current;

    const result = sqlite.pragma('foreign_keys', { simple: true });
    expect(result).toBe(1);
  });
});

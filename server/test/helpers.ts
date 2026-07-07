/**
 * Test-only helpers: boots a fresh instance of the server app against an
 * isolated temp-file SQLite DB, so every test gets its own migrated database
 * with no cross-test bleed.
 *
 * `vi.resetModules()` clears Vitest's module registry before each dynamic
 * import of `../src/index.js`, so every call gets its own module graph —
 * and therefore its own DB singleton (see `src/db/index.ts`) and its own
 * `BOT_TOKEN`-bound auth middleware (see `src/index.ts`) — even when called
 * multiple times from the same test file.
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Hono } from 'hono';
import { vi } from 'vitest';

/** Dummy signing secret used for both signing fixtures and server validation in tests. */
export const TEST_BOT_TOKEN = 'test-bot-token-0123456789abcdef0123456789abcdef';

export interface TestApp {
  app: Hono;
  dbPath: string;
  cleanup: () => void;
  /**
   * The exact `db`/`schema` singleton this app instance is wired to (see
   * `src/db/index.ts`) — handed out so tests can set up rows the HTTP API
   * has no way to create yet (e.g. an `expenses` row, to exercise the
   * base-currency-lock guard ahead of Phase 4 shipping the expenses API).
   * Safe to import a second time without `vi.resetModules()`: Vitest caches
   * modules per reset-epoch, so this resolves to the same instance
   * `../src/index.js` already initialized above.
   */
  db: typeof import('../src/db/index.js').db;
  schema: typeof import('../src/db/index.js').schema;
  /**
   * The raw better-sqlite3 handle (Phase 8.2) — exposed so a health-check
   * test can simulate a DB outage (`sqlite.close()`) and assert `GET
   * /api/health` reports `db: 'down'` / HTTP 503, without any other test
   * needing to touch this lower-level handle.
   */
  sqlite: typeof import('../src/db/index.js').sqlite;
}

export async function bootTestApp(): Promise<TestApp> {
  const dbPath = join(tmpdir(), `tripsplit-test-${randomUUID()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.BOT_TOKEN = TEST_BOT_TOKEN;

  vi.resetModules();
  const mod = (await import('../src/index.js')) as { default: Hono };
  const dbMod = await import('../src/db/index.js');

  const cleanup = () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      rmSync(dbPath + suffix, { force: true });
    }
  };

  return {
    app: mod.default,
    dbPath,
    cleanup,
    db: dbMod.db,
    schema: dbMod.schema,
    sqlite: dbMod.sqlite,
  };
}

/**
 * Single DB module: opens SQLite (better-sqlite3), applies Drizzle migrations
 * on boot (so a fresh DB_PATH self-initializes), and exports the drizzle
 * instance + schema for the rest of the app.
 *
 * `createDb()` is also used directly by tests to spin up an isolated
 * temp-file database per test file.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema.js';

export { schema };
export type Schema = typeof schema;

// server/drizzle — the SQL migrations emitted by `npm run db:generate --workspace=server`.
//
// Resolved against `process.cwd()`, NOT `import.meta.url`: this module is
// bundled by tsup into a single flat `dist/index.js` in production, which
// would change the on-disk depth of an `import.meta.url`-relative path
// between `tsx` dev (multi-file, this file lives at `src/db/index.ts`) and
// the tsup build (single file at `dist/index.js`). `process.cwd()` is stable
// across both because every real invocation (npm scripts, pm2's `cwd` in
// ecosystem.config.cjs, vitest) runs with the `server/` package dir as cwd —
// the same convention `DB_PATH`'s `./data/tripsplit.db` default relies on.
const MIGRATIONS_FOLDER = join(process.cwd(), 'drizzle');

export function createDb(dbPath: string) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  // FK enforcement is OFF *during migrations*, ON for runtime (set after
  // migrate() below). drizzle's SQLite "table rebuild" migrations (create
  // __new_x + copy + DROP old + rename — used whenever a column's nullability
  // or a CHECK changes, e.g. 0001's nullable payer_id) DROP a table that other
  // tables FK-reference (expense_shares → expenses). SQLite ignores the
  // migration file's own `PRAGMA foreign_keys=OFF` because migrate() runs
  // inside a transaction (the pragma is a no-op mid-transaction) — so setting
  // it here, before that transaction opens, is the only place it takes effect.
  sqlite.pragma('foreign_keys = OFF');
  // Phase 8.4 (IMPLEMENTATION_PLAN.md §12's "SQLite single-writer under
  // concurrency" risk): if a write hits the DB while another write already
  // holds the lock, SQLite retries internally for up to this many ms before
  // giving up with SQLITE_BUSY — instead of erroring immediately on the
  // first brief contention. better-sqlite3 is synchronous (no async races
  // within this process), so the only real contention is two near-
  // simultaneous requests from different trip members; 2-10 users means
  // this is rare and short-lived, so a few seconds of retry headroom is
  // plenty without ever risking a request hanging noticeably.
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  // Migrations done — enforce referential integrity for all runtime queries.
  sqlite.pragma('foreign_keys = ON');

  return { sqlite, db };
}

const dbPath = process.env.DB_PATH ?? './data/tripsplit.db';
const instance = createDb(dbPath);

export const db = instance.db;
export const sqlite = instance.sqlite;

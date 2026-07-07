/**
 * Smoke test for the Phase 9.2 CLI scripts (`scripts/seed.ts` /
 * `scripts/reset.ts`) — IMPLEMENTATION_PLAN.md "MVP Launch & Field Test".
 *
 * Spawns the REAL CLI (via the same `tsx` binary `npm run seed`/`npm run
 * reset` use) as a child process, rather than importing the scripts'
 * internals directly. That's deliberate, not just convenient: both scripts
 * dynamically `import('../server/src/db/index.js')` after setting
 * `process.env.DB_PATH` (see each script's own comment on why), and that
 * module's `const instance = createDb(dbPath)` runs exactly ONCE per
 * process, the first time it's ever imported — a second dynamic import
 * within the SAME process (even with a different `DB_PATH`) would silently
 * return the already-cached first instance instead of opening the new path.
 * Separate child processes (one per CLI invocation, exactly how a real user
 * runs these) sidestep that entirely, and this also exercises the actual
 * argv parsing / confirmation gate / exit codes a unit-level import never
 * would.
 *
 * Uses a throwaway `os.tmpdir()`-based DB path, same convention as
 * `test/helpers.ts`'s `bootTestApp` — never the real `server/data/` DB.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(SERVER_DIR, '..');
const SEED_SCRIPT = join(REPO_ROOT, 'scripts', 'seed.ts');
const RESET_SCRIPT = join(REPO_ROOT, 'scripts', 'reset.ts');
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

const TABLES = ['users', 'trips', 'trip_members', 'expenses', 'expense_shares', 'rates'];

function countRows(dbPath: string, table: string): number {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    return (sqlite.prepare(`SELECT count(*) as c FROM ${table}`).get() as { c: number })
      .c;
  } finally {
    sqlite.close();
  }
}

describe('seed + reset CLI scripts (Phase 9.2)', () => {
  let dbPath: string | undefined;

  afterEach(() => {
    if (dbPath) {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        rmSync(dbPath + suffix, { force: true });
      }
      dbPath = undefined;
    }
  });

  it('seed builds a Σnet=0 demo trip; reset refuses unconfirmed, wipes when confirmed', () => {
    dbPath = join(tmpdir(), `tripsplit-seedtest-${randomUUID()}.db`);

    // --- seed --------------------------------------------------------
    const seedOut = execFileSync(TSX_BIN, [SEED_SCRIPT, '--db', dbPath], {
      cwd: SERVER_DIR,
      encoding: 'utf8',
    });
    expect(seedOut).toContain('Demo trip seeded');
    expect(seedOut).toContain('Expenses:     10');
    expect(seedOut).toContain('Settlements:  1');
    expect(seedOut).toMatch(/Σ net = 0 minor units/);

    expect(countRows(dbPath, 'users')).toBe(3);
    expect(countRows(dbPath, 'trips')).toBe(1);
    expect(countRows(dbPath, 'trip_members')).toBe(3);
    expect(countRows(dbPath, 'expenses')).toBe(11); // 10 expenses + 1 settlement
    expect(countRows(dbPath, 'rates')).toBe(4);

    // Invariant (Phase 4): every expense/settlement's shares sum exactly
    // to its amount_minor.
    const sqlite = new Database(dbPath, { readonly: true });
    const mismatches = sqlite
      .prepare(
        `SELECT e.id FROM expenses e JOIN expense_shares s ON s.expense_id = e.id
           GROUP BY e.id HAVING e.amount_minor != SUM(s.share_minor)`,
      )
      .all();
    sqlite.close();
    expect(mismatches).toEqual([]);

    // --- reset without confirmation: must refuse, must not touch data -
    expect(() =>
      execFileSync(TSX_BIN, [RESET_SCRIPT, '--db', dbPath as string], {
        cwd: SERVER_DIR,
        encoding: 'utf8',
      }),
    ).toThrow();
    expect(countRows(dbPath, 'trips')).toBe(1);

    // --- reset with --yes: wipes every table ---------------------------
    const resetOut = execFileSync(TSX_BIN, [RESET_SCRIPT, '--db', dbPath, '--yes'], {
      cwd: SERVER_DIR,
      encoding: 'utf8',
    });
    expect(resetOut).toContain('Reset complete');
    for (const table of TABLES) {
      expect(countRows(dbPath, table)).toBe(0);
    }
  }, 30_000);
});

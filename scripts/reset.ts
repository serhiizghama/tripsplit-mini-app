/**
 * TripSplit destructive reset script — IMPLEMENTATION_PLAN.md Phase 9.2 ("MVP
 * Launch & Field Test"). Wipes ALL app data (every row, every table) from a
 * SQLite DB so the owner can clear seeded/test data before real use.
 *
 * Guarded by TWO independent gates — both must pass before anything is
 * touched:
 *
 *   1. Confirmation: `--yes` flag OR `CONFIRM=1` env var. Missing -> refuses,
 *      exit 1, nothing touched.
 *   2. Production-path guard: if the resolved DB path "looks like
 *      production" (see `looksLikeProductionPath` below), `--force` flag OR
 *      `FORCE=1` env var is ALSO required. Missing -> refuses, exit 1,
 *      nothing touched, even if gate 1 already passed.
 *
 * Two wipe strategies:
 *   - Default: delete every row from every table (in FK-safe order), inside
 *     one transaction. Keeps the DB file and its migrated schema intact —
 *     the running server (or the next `npm run dev`) doesn't need a restart
 *     to "recreate" anything.
 *   - `--delete-file`: instead removes the DB file itself plus its
 *     `-wal`/`-shm`/`-journal` siblings. The next `createDb()` call (e.g. the
 *     server booting, or `scripts/seed.ts`) re-runs migrations from scratch
 *     against a brand-new empty file.
 *
 * Usage:
 *   npm run reset --workspace=server -- --yes                # row-wipe, keeps schema
 *   npm run reset --workspace=server -- --yes --delete-file   # deletes the .db file + siblings
 *   CONFIRM=1 npm run reset --workspace=server                # same as --yes
 *   npm run reset --workspace=server -- --yes --db /abs/path/prod.db --force
 */
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

function die(message: string): never {
  console.error(`reset: ${message}`);
  process.exit(1);
}

function resolveDbPath(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') return argv[i + 1] ?? die('--db requires a path argument');
    if (arg?.startsWith('--db=')) return arg.slice('--db='.length);
  }
  return process.env.DB_PATH ?? './data/tripsplit.db';
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/**
 * Heuristic only — there's no bulletproof way to know "is this really
 * production" from a path string alone, so this errs on the side of
 * BLOCKING. Deliberately matches whole path SEGMENTS (split on the path
 * separator), never a raw substring — an earlier draft used
 * `path.includes('test')`, which happily "matched" `/home/faketest/...` and
 * would have let a real-looking production path slip through unforced; see
 * the Phase 9 report for that bug.
 *
 * Safe (only needs `--yes`), checked first:
 *  - Anywhere under `os.tmpdir()` — Node's own canonical scratch directory
 *    (on macOS this is `/var/folders/.../T`, NOT `/tmp` — exactly the kind
 *    of path a naive `/var/` substring/segment check would otherwise flag
 *    as "production", so this exact-prefix check has to run before the
 *    production-segment check below, not after).
 *  - Any path segment exactly `tmp`, `temp`, `scratch`, or `demo`.
 *
 * Otherwise treated as production-looking (needs `--yes` AND `--force`) when
 * either `NODE_ENV=production` (set by `ecosystem.config.cjs` on the real
 * VPS process) or a path segment exactly matches `home`, `srv`, `var`, `opt`
 * (the real deployed layout in `docs/deploy/SETUP.md` is
 * `/home/<deploy-user>/apps/tripsplit/...`), or any segment contains `prod`
 * (catches `production`, `prod-data`, etc.).
 */
function looksLikeProductionPath(dbPath: string): boolean {
  const resolvedPath = resolve(dbPath);
  const resolvedTmpDir = resolve(tmpdir());
  if (resolvedPath.toLowerCase().startsWith(resolvedTmpDir.toLowerCase())) return false;

  const segments = resolvedPath.toLowerCase().split(sep).filter(Boolean);
  const safeSegments = new Set(['tmp', 'temp', 'scratch', 'test', 'demo']);
  if (segments.some((s) => safeSegments.has(s))) return false;

  if (process.env.NODE_ENV === 'production') return true;
  const prodSegments = new Set(['home', 'srv', 'var', 'opt']);
  return segments.some((s) => prodSegments.has(s) || s.includes('prod'));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dbPath = resolveDbPath(argv);
  const resolvedPath = resolve(dbPath);
  const confirmed = hasFlag(argv, 'yes') || process.env.CONFIRM === '1';
  const forced = hasFlag(argv, 'force') || process.env.FORCE === '1';
  const deleteFile = hasFlag(argv, 'delete-file');

  if (!confirmed) {
    die(
      `refusing to wipe '${resolvedPath}' without confirmation. ` +
        `Re-run with --yes (or CONFIRM=1) once you're sure. Nothing was touched.`,
    );
  }

  if (looksLikeProductionPath(dbPath) && !forced) {
    die(
      `'${resolvedPath}' looks like a production path. Refusing without ` +
        `--force (or FORCE=1) as an extra safeguard. Nothing was touched.`,
    );
  }

  if (deleteFile) {
    console.log(`==> Deleting DB file and WAL siblings: ${resolvedPath}`);
    let removed = 0;
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const path = dbPath + suffix;
      if (existsSync(path)) {
        rmSync(path, { force: true });
        removed++;
        console.log(`    removed ${resolve(path)}`);
      }
    }
    console.log(
      removed > 0
        ? '==> Done — file(s) removed.'
        : '==> Nothing to remove (file did not exist).',
    );
    return;
  }

  // Must be set BEFORE the first dynamic import of anything that
  // transitively loads `server/src/db/index.ts` — see `scripts/seed.ts`'s
  // matching comment for why (that module reads `process.env.DB_PATH`
  // exactly once, at its own top-level, the first time it's evaluated).
  process.env.DB_PATH = dbPath;
  const { db, schema } = await import('../server/src/db/index.js');

  const tables = [
    { name: 'expense_shares', table: schema.expenseShares },
    { name: 'expenses', table: schema.expenses },
    { name: 'trip_members', table: schema.tripMembers },
    { name: 'trips', table: schema.trips },
    { name: 'rates', table: schema.rates },
    { name: 'users', table: schema.users },
  ] as const;

  console.log(`==> Wiping all rows from: ${resolvedPath}`);
  const before: Record<string, number> = {};
  for (const { name, table } of tables) {
    before[name] = db.select().from(table).all().length;
  }

  db.transaction((tx) => {
    for (const { table } of tables) {
      tx.delete(table).run();
    }
  });

  const after: Record<string, number> = {};
  for (const { name, table } of tables) {
    after[name] = db.select().from(table).all().length;
  }

  console.log('\n    table            before -> after');
  for (const { name } of tables) {
    console.log(
      `    ${name.padEnd(16)} ${String(before[name]).padStart(6)} -> ${after[name]}`,
    );
  }
  console.log('\n==> Reset complete.');
}

main().catch((err: unknown) => {
  console.error('reset: failed —', err);
  process.exit(1);
});

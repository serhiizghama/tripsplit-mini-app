/**
 * TripSplit demo-data seed script — IMPLEMENTATION_PLAN.md Phase 9.2 ("MVP
 * Launch & Field Test"). Populates a SQLite DB with a realistic-looking, but
 * OBVIOUSLY FAKE, demo trip: 3 "Demo <Name>" users, one EUR-base trip, 10
 * expenses spread across 4 currencies (THB/VND/EUR/USDT) using all three
 * split modes (equal/solo/custom) and a few category emoji, plus one
 * cross-currency settlement.
 *
 * Every money-bearing row goes through the REAL service helpers
 * (`createExpense`/`createSettlement` from `server/src/lib/expenses.ts`) —
 * never a raw, hand-computed insert — so the seeded data has exactly the
 * same rounding/conversion/share invariants a real user's expenses would
 * have (see those functions' own doc comments). A handful of `rates` rows
 * are seeded directly (source: `'manual'`) so THB/VND/USDT actually convert
 * to the EUR base at fixed, realistic-looking rates instead of silently
 * falling back to `resolveRate`'s "nothing cached yet" default of `1`.
 *
 * Usage — run with `server/` as the working directory, so the DB module's
 * `process.cwd()`-relative migrations folder resolves correctly (see
 * `server/src/db/index.ts`'s own comment on why that matters):
 *
 *   npm run seed --workspace=server                        # uses server/.env's DB_PATH (or its default, ./data/tripsplit.db)
 *   npm run seed --workspace=server -- --db ./data/demo.db  # explicit path
 *   DB_PATH=/abs/path/demo.db npm run seed --workspace=server
 *
 * SAFETY: this script only INSERTS — it never deletes anything (see
 * `scripts/reset.ts` for that) — but it still runs against whatever
 * `--db`/`DB_PATH` resolves to. Point it at a throwaway file when
 * experimenting; don't seed demo data into a DB that already holds real
 * trip data unless you actually want the demo trip mixed in with it.
 */
import { findCurrency, getCurrencyExponent } from '@tripsplit/shared';
import { nanoid } from 'nanoid';

const TRIP_ID_LENGTH = 12;
const INVITE_CODE_LENGTH = 16;

// Obviously-fake Telegram user ids — real Telegram user ids don't live in
// this range, and every name is prefixed "Demo" so this data can never be
// mistaken for a real person even out of context (see the trip title too).
const ALICE = 900_000_001;
const BOB = 900_000_002;
const CHRIS = 900_000_003;

function die(message: string): never {
  console.error(`seed: ${message}`);
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

/** `120000` VND (exponent 0) -> "120000 ₫"; `4500` EUR (exponent 2) -> "45.00 €". */
function formatMinor(amountMinor: number, currency: string): string {
  const exponent = getCurrencyExponent(currency);
  const symbol = findCurrency(currency)?.symbol ?? currency;
  return `${(amountMinor / 10 ** exponent).toFixed(exponent)} ${symbol}`;
}

async function main(): Promise<void> {
  const dbPath = resolveDbPath(process.argv.slice(2));
  // Must be set BEFORE the first dynamic import of anything that transitively
  // loads `server/src/db/index.ts` — that module reads `process.env.DB_PATH`
  // exactly once, at its own top-level, the first time it's evaluated (see
  // `server/test/helpers.ts`'s `bootTestApp` for the same pattern/reasoning).
  process.env.DB_PATH = dbPath;

  const { db, schema } = await import('../server/src/db/index.js');
  const { createExpense, createSettlement } =
    await import('../server/src/lib/expenses.js');
  const { buildInviteLink } = await import('../server/src/lib/trips.js');
  const { getTripBalances } = await import('../server/src/lib/balances.js');

  console.log(`==> Seeding demo data into: ${dbPath}`);

  const now = new Date().toISOString();

  // --- Demo users (obviously fake) ---------------------------------------
  db.insert(schema.users)
    .values([
      {
        id: ALICE,
        firstName: 'Demo',
        lastName: 'Alice',
        username: 'demo_alice',
        photoUrl: null,
        lang: 'en',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: BOB,
        firstName: 'Demo',
        lastName: 'Bob',
        username: 'demo_bob',
        photoUrl: null,
        lang: 'ru',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: CHRIS,
        firstName: 'Demo',
        lastName: 'Chris',
        username: 'demo_chris',
        photoUrl: null,
        lang: 'uk',
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();

  // --- Trip ---------------------------------------------------------------
  const tripId = nanoid(TRIP_ID_LENGTH);
  const inviteCode = nanoid(INVITE_CODE_LENGTH);
  const BASE_CURRENCY = 'EUR';

  db.insert(schema.trips)
    .values({
      id: tripId,
      title: 'Demo Trip — Southeast Asia (seeded, not a real trip)',
      baseCurrency: BASE_CURRENCY,
      inviteCode,
      createdBy: ALICE,
      createdAt: now,
      archivedAt: null,
    })
    .run();

  db.insert(schema.tripMembers)
    .values([
      { tripId, userId: ALICE, joinedAt: now },
      { tripId, userId: BOB, joinedAt: now },
      { tripId, userId: CHRIS, joinedAt: now },
    ])
    .run();

  // --- Rates (manual, fixed, realistic-looking vs USD) --------------------
  // Dated before every expense's `spentOn` below, so `getCrossRateLocal`'s
  // "nearest earlier cached date" rule applies these to every expense — the
  // EUR row is needed too, even though EUR is the trip base (rate 1 there is
  // handled by `resolveRate`'s same-currency shortcut), because the THB/VND/
  // USDT cross-rate math is `rate(USD->EUR) / rate(USD->X)`.
  const RATE_DATE = '2026-06-25';
  db.insert(schema.rates)
    .values([
      { date: RATE_DATE, base: 'USD', currency: 'THB', rate: 36.2, source: 'manual' },
      { date: RATE_DATE, base: 'USD', currency: 'VND', rate: 25_800, source: 'manual' },
      { date: RATE_DATE, base: 'USD', currency: 'EUR', rate: 0.91, source: 'manual' },
      { date: RATE_DATE, base: 'USD', currency: 'USDT', rate: 0.9999, source: 'manual' },
    ])
    .run();

  // --- Expenses: 10 across THB/VND/EUR/USDT, equal/solo/custom splits -----
  const base = { tripId, createdBy: ALICE, baseCurrency: BASE_CURRENCY } as const;
  let expenseCount = 0;
  function addExpense(
    input: Omit<Parameters<typeof createExpense>[0], keyof typeof base>,
  ) {
    createExpense({ ...base, ...input });
    expenseCount++;
  }

  addExpense({
    payerId: ALICE,
    amountMinor: 120_000,
    currency: 'THB',
    splitMode: 'equal',
    sharesInput: undefined,
    beneficiaryId: undefined,
    description: 'Pad thai dinner',
    category: '🍜',
    spentOn: '2026-07-01',
    rateToBaseInput: undefined,
    rateOverriddenInput: undefined,
  });
  addExpense({
    payerId: BOB,
    amountMinor: 45_000,
    currency: 'THB',
    splitMode: 'solo',
    sharesInput: undefined,
    beneficiaryId: BOB,
    description: 'Tuk-tuk (solo errand)',
    category: '🚕',
    spentOn: '2026-07-01',
    rateToBaseInput: undefined,
    rateOverriddenInput: undefined,
  });
  addExpense({
    payerId: CHRIS,
    amountMinor: 850_000,
    currency: 'VND',
    splitMode: 'equal',
    sharesInput: undefined,
    beneficiaryId: undefined,
    description: 'Hanoi street food tour',
    category: '🍜',
    spentOn: '2026-07-02',
    rateToBaseInput: undefined,
    rateOverriddenInput: undefined,
  });
  addExpense({
    payerId: ALICE,
    amountMinor: 4500,
    currency: 'EUR',
    splitMode: 'custom',
    sharesInput: [
      { userId: ALICE, shareMinor: 2000 },
      { userId: BOB, shareMinor: 1500 },
      { userId: CHRIS, shareMinor: 1000 },
    ],
    beneficiaryId: undefined,
    description: 'Museum tickets',
    category: '🎟️',
    spentOn: '2026-07-02',
    rateToBaseInput: undefined,
    rateOverriddenInput: undefined,
  });
  addExpense({
    payerId: BOB,
    amountMinor: 2500,
    currency: 'USDT',
    splitMode: 'equal',
    sharesInput: undefined,
    beneficiaryId: undefined,
    description: 'SIM cards',
    category: '📦',
    spentOn: '2026-07-02',
    rateToBaseInput: undefined,
    rateOverriddenInput: undefined,
  });
  addExpense({
    payerId: CHRIS,
    amountMinor: 320_000,
    currency: 'THB',
    splitMode: 'equal',
    sharesInput: undefined,
    beneficiaryId: undefined,
    description: 'Hotel (shared room)',
    category: '🏨',
    spentOn: '2026-07-03',
    rateToBaseInput: undefined,
    rateOverriddenInput: undefined,
  });
  addExpense({
    payerId: ALICE,
    amountMinor: 1_200_000,
    currency: 'VND',
    splitMode: 'equal',
    sharesInput: undefined,
    beneficiaryId: undefined,
    description: 'Ha Long Bay day trip',
    category: '🎟️',
    spentOn: '2026-07-03',
    rateToBaseInput: undefined,
    rateOverriddenInput: undefined,
  });
  addExpense({
    payerId: BOB,
    amountMinor: 1250,
    currency: 'EUR',
    splitMode: 'solo',
    sharesInput: undefined,
    beneficiaryId: BOB,
    description: 'Coffee run',
    category: '🍜',
    spentOn: '2026-07-04',
    rateToBaseInput: undefined,
    rateOverriddenInput: undefined,
  });
  addExpense({
    payerId: ALICE,
    amountMinor: 6000,
    currency: 'USDT',
    splitMode: 'custom',
    sharesInput: [
      { userId: ALICE, shareMinor: 4000 },
      { userId: CHRIS, shareMinor: 2000 },
    ],
    beneficiaryId: undefined,
    description: 'Scooter rental deposit',
    category: '🚕',
    spentOn: '2026-07-04',
    rateToBaseInput: undefined,
    rateOverriddenInput: undefined,
  });
  addExpense({
    payerId: BOB,
    amountMinor: 98_000,
    currency: 'THB',
    splitMode: 'equal',
    sharesInput: undefined,
    beneficiaryId: undefined,
    description: 'Night market shopping',
    category: '🛍️',
    spentOn: '2026-07-05',
    rateToBaseInput: undefined,
    rateOverriddenInput: undefined,
  });

  // --- One settlement (multi-currency: pay back a EUR-base debt in THB) ---
  // Picks the actual current max-debtor/max-creditor pair rather than a
  // hardcoded user, so this stays correct even if the expense list above
  // changes. Deliberately a PARTIAL settlement (a fixed demo amount, not the
  // exact computed debt) — that's the realistic case ("Settle" with an
  // editable amount, plan §8).
  const preBalances = getTripBalances(tripId, BASE_CURRENCY);
  const debtor = [...preBalances.balances].sort(
    (a, b) => a.netBaseMinor - b.netBaseMinor,
  )[0];
  const creditor = [...preBalances.balances].sort(
    (a, b) => b.netBaseMinor - a.netBaseMinor,
  )[0];

  let settlementCount = 0;
  if (
    debtor &&
    creditor &&
    debtor.userId !== creditor.userId &&
    debtor.netBaseMinor < 0
  ) {
    createSettlement({
      tripId,
      createdBy: ALICE,
      payerId: debtor.userId,
      receiverId: creditor.userId,
      amountMinor: 100_000, // 1,000.00 THB
      currency: 'THB',
      baseCurrency: BASE_CURRENCY,
      description: 'Partial settle-up (paid back in THB)',
      category: null,
      spentOn: '2026-07-05',
      rateToBaseInput: undefined,
      rateOverriddenInput: undefined,
    });
    settlementCount = 1;
  }

  // --- Summary --------------------------------------------------------------
  const finalBalances = getTripBalances(tripId, BASE_CURRENCY);
  const names: Record<number, string> = {
    [ALICE]: 'Demo Alice',
    [BOB]: 'Demo Bob',
    [CHRIS]: 'Demo Chris',
  };

  console.log('\n==> Demo trip seeded');
  console.log(`    Trip id:      ${tripId}`);
  console.log(`    Invite code:  ${inviteCode}`);
  console.log(`    Invite link:  ${buildInviteLink(inviteCode)}`);
  console.log(
    `    Members:      Demo Alice (${ALICE}), Demo Bob (${BOB}), Demo Chris (${CHRIS})`,
  );
  console.log(`    Expenses:     ${expenseCount}`);
  console.log(`    Settlements:  ${settlementCount}`);

  console.log(`\n    Balances (${BASE_CURRENCY}, base currency):`);
  for (const b of finalBalances.balances) {
    console.log(
      `      ${(names[b.userId] ?? String(b.userId)).padEnd(12)} net ${formatMinor(b.netBaseMinor, BASE_CURRENCY).padStart(10)}  ` +
        `(paid ${formatMinor(b.paidBaseMinor, BASE_CURRENCY)}, owed ${formatMinor(b.owedBaseMinor, BASE_CURRENCY)})`,
    );
  }
  const sumNet = finalBalances.balances.reduce((sum, b) => sum + b.netBaseMinor, 0);
  console.log(`      Σ net = ${sumNet} minor units (must be 0)`);

  console.log('\n    Suggested transfers:');
  if (finalBalances.transfers.length === 0) {
    console.log('      (none — already settled)');
  }
  for (const t of finalBalances.transfers) {
    console.log(
      `      ${names[t.fromUserId] ?? t.fromUserId} -> ${names[t.toUserId] ?? t.toUserId}: ` +
        `${formatMinor(t.amountBaseMinor, BASE_CURRENCY)}`,
    );
  }

  console.log('\n    Per-currency spend (expenses only):');
  for (const c of finalBalances.perCurrency) {
    console.log(`      ${c.currency}: ${formatMinor(c.totalMinor, c.currency)}`);
  }
  console.log('');
}

main().catch((err: unknown) => {
  console.error('seed: failed —', err);
  process.exit(1);
});

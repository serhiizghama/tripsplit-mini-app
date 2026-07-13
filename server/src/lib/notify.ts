/**
 * Group-chat nudges on money mutations — Export & Group Nudges plan
 * (`docs/EXPORT_NUDGES_PLAN.md`) task T4. One `notify*` fn per mutation kind,
 * called from the expense/settlement route handlers right after the write
 * commits (better-sqlite3 is sync, so the DB already reflects the mutation
 * by the time these run — `buildTopDebtHint` therefore sees post-mutation
 * balances for free, no extra scheduling needed).
 *
 * Fire-and-forget by convention: each fn returns its `Promise<void>` so
 * tests can await it directly, but every route call site does
 * `void notifyX(...)` — the API response is never delayed by a Telegram
 * round-trip, and every step is wrapped in `sendNudgeToLinkedChats` so a
 * Telegram outage can never surface as a mutation failure.
 *
 * No linked chats (the common case — nobody `/link`-ed this trip's group
 * yet) → returns before building any message or touching balances.
 */
import type { ExpenseWithShares } from '@tripsplit/shared';

import {
  botMessages,
  formatBotMoney,
  resolveBotLocale,
  type BotLocale,
  type ExpenseNudgeParams,
} from './botMessages.js';
import { sendBotMessage } from './botSend.js';
import { logger } from './logger.js';
import { getTripMembers } from './members.js';
import { buildTopDebtHint, type TripRow } from './summary.js';
import { getLinkedChats } from './tripChats.js';

/** Whoever performed the mutation — the route's `c.get('user')` row satisfies this. */
export interface NudgeActor {
  firstName: string;
  lang: string;
}

/**
 * Runs `buildHtml` (only once there's actually somewhere to send it, and
 * only once — the balance lookup inside `buildTopDebtHint` isn't free) and
 * broadcasts the result to every chat linked to `trip`. Never throws:
 * `sendBotMessage` already swallows per-chat failures, and this wraps the
 * rest (locale/balance formatting) too, so a bad actor/expense shape can't
 * turn a nudge bug into a 500 on the mutation that triggered it.
 */
async function sendNudgeToLinkedChats(trip: TripRow, buildHtml: () => string): Promise<void> {
  try {
    const chats = getLinkedChats(trip.id);
    if (chats.length === 0) return;

    // Same env var index.ts reads BOT_TOKEN from; missing in tests/local dev
    // without a bot configured means "can't send" rather than a hard error.
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) return;

    const html = buildHtml();
    await Promise.all(chats.map((chat) => sendBotMessage(botToken, chat.chatId, html)));
  } catch (err) {
    logger.error({ err, tripId: trip.id }, 'notify: failed to send nudge');
  }
}

/** Trip member's display name, falling back to `userFallback` — mirrors `summary.ts`'s `nameResolver`. */
function memberName(tripId: string, userId: number, locale: BotLocale): string {
  const member = getTripMembers(tripId).find((m) => m.id === userId);
  return member?.firstName ?? botMessages[locale].userFallback(userId);
}

/**
 * The subset of an expense a nudge needs — deliberately just the raw DB
 * columns (`status` as `string`, not the narrowed `ExpenseStatus` union) so
 * both `ExpenseWithShares` (create/update's return value) and the plain
 * `ExpenseRow` (`getExpenseRowOrThrow`'s result, used for delete — see
 * `notifyExpenseDeleted`) satisfy this without a shares array in hand.
 */
export interface NudgeExpenseShape {
  amountMinor: number;
  currency: string;
  description?: string | null;
  category?: string | null;
  status: string;
}

/**
 * `expense.category` already stores the picker's emoji glyph itself (see
 * `@tripsplit/shared`'s `EXPENSE_CATEGORIES` doc comment) — no name-key to
 * resolve, so it's passed straight through to `botMessages`.
 */
function expenseNudgeParams(
  actor: NudgeActor,
  trip: TripRow,
  expense: NudgeExpenseShape,
  locale: BotLocale,
): ExpenseNudgeParams {
  return {
    actorName: actor.firstName,
    amount: formatBotMoney(expense.amountMinor, expense.currency, locale),
    description: expense.description,
    category: expense.category,
    planned: expense.status === 'planned',
    topDebtHint: buildTopDebtHint(trip, locale),
  };
}

export function notifyExpenseCreated(
  trip: TripRow,
  actor: NudgeActor,
  expense: NudgeExpenseShape,
): Promise<void> {
  return sendNudgeToLinkedChats(trip, () => {
    const locale = resolveBotLocale(actor.lang);
    return botMessages[locale].expenseAdded(expenseNudgeParams(actor, trip, expense, locale));
  });
}

export function notifyExpenseUpdated(
  trip: TripRow,
  actor: NudgeActor,
  expense: NudgeExpenseShape,
): Promise<void> {
  return sendNudgeToLinkedChats(trip, () => {
    const locale = resolveBotLocale(actor.lang);
    return botMessages[locale].expenseUpdated(expenseNudgeParams(actor, trip, expense, locale));
  });
}

/** `expense` should be the row read BEFORE the soft delete — same shape, `softDeleteExpense` only stamps `deletedAt`. */
export function notifyExpenseDeleted(
  trip: TripRow,
  actor: NudgeActor,
  expense: NudgeExpenseShape,
): Promise<void> {
  return sendNudgeToLinkedChats(trip, () => {
    const locale = resolveBotLocale(actor.lang);
    return botMessages[locale].expenseDeleted(expenseNudgeParams(actor, trip, expense, locale));
  });
}

/** Receiver is resolved from the settlement's own share row (`shares[0].userId` — see `createSettlement`), not re-passed in. */
export function notifySettlementCreated(
  trip: TripRow,
  actor: NudgeActor,
  settlement: ExpenseWithShares,
): Promise<void> {
  return sendNudgeToLinkedChats(trip, () => {
    const locale = resolveBotLocale(actor.lang);
    const receiverId = settlement.shares[0]?.userId;
    return botMessages[locale].settlementRecorded({
      actorName: actor.firstName,
      receiverName:
        receiverId !== undefined
          ? memberName(trip.id, receiverId, locale)
          : botMessages[locale].userFallback(settlement.payerId ?? 0),
      amount: formatBotMoney(settlement.amountMinor, settlement.currency, locale),
      topDebtHint: buildTopDebtHint(trip, locale),
    });
  });
}

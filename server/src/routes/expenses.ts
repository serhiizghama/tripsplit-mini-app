/**
 * Top-level expense routes — `PATCH`/`DELETE /api/expenses/:id`
 * (IMPLEMENTATION_PLAN.md §5, Phase 4.1). These don't nest under
 * `/api/trips/:id` (an expense id alone is enough to look it up; the trip id
 * is derived from the row itself) — mounted at `/api/expenses` in
 * `src/index.ts`. `POST /api/trips/:id/expenses` (creation) lives on
 * `routes/trips.ts` instead, since it genuinely is trip-nested.
 */
import type { UpdateExpenseRequest } from '@tripsplit/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  getExpenseRowOrThrow,
  softDeleteExpense,
  updateExpense,
} from '../lib/expenses.js';
import { AppError } from '../lib/errors.js';
import { notifyExpenseDeleted, notifyExpenseUpdated } from '../lib/notify.js';
import { requireActiveTrip, requireMembership } from '../lib/trips.js';
import { currencyCodeSchema, validateJsonBody } from '../lib/validate.js';

const expenseShareInputSchema = z.object({
  userId: z.number().int(),
  shareMinor: z.number().int().optional(),
});

// Every field optional/partial — see `UpdateExpenseRequest`'s doc comment
// (`@tripsplit/shared`) and `updateExpense` (lib/expenses.ts) for exactly how
// omitted fields fall back to the stored row / split intent.
const updateExpenseSchema = z.object({
  amountMinor: z.number().int().positive().optional(),
  currency: currencyCodeSchema.optional(),
  payerId: z.number().int().optional(),
  splitMode: z.enum(['equal', 'custom', 'solo']).optional(),
  shares: z.array(expenseShareInputSchema).optional(),
  beneficiaryId: z.number().int().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(8).nullable().optional(),
  spentOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'spentOn must be an ISO date (YYYY-MM-DD)')
    .optional(),
  rateToBase: z.number().positive().optional(),
  rateOverridden: z.boolean().optional(),
});

export const expensesRouter = new Hono();

// PATCH /api/expenses/:id — edit; re-validates membership on the parent
// trip, recomputes shares/rate/amount_base_minor from the merged effective
// state, and bumps updated_at. A soft-deleted expense can't be edited.
expensesRouter.patch('/:id', async (c) => {
  const user = c.get('user');
  const expenseId = c.req.param('id');
  const existing = getExpenseRowOrThrow(expenseId);
  const trip = requireMembership(existing.tripId, user.id);
  requireActiveTrip(trip);

  if (existing.deletedAt) {
    throw new AppError(404, 'expense_not_found', 'Expense not found');
  }

  const body: UpdateExpenseRequest = await validateJsonBody(c, updateExpenseSchema);
  const updated = updateExpense(existing, trip.baseCurrency, body);
  void notifyExpenseUpdated(trip, user, updated);
  return c.json(updated);
});

// DELETE /api/expenses/:id — soft delete; membership-checked. Idempotent:
// deleting an already-deleted expense just re-stamps deleted_at and still
// returns 204.
expensesRouter.delete('/:id', (c) => {
  const user = c.get('user');
  const expenseId = c.req.param('id');
  const existing = getExpenseRowOrThrow(expenseId);
  const trip = requireMembership(existing.tripId, user.id);
  requireActiveTrip(trip);

  softDeleteExpense(expenseId);
  // `existing` is read BEFORE the delete — softDeleteExpense only stamps
  // deletedAt, so amount/currency/description are still the pre-delete values.
  void notifyExpenseDeleted(trip, user, existing);
  return c.body(null, 204);
});

export default expensesRouter;

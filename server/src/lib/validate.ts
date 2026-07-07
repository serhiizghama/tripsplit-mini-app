/**
 * zod request-validation helper. No write endpoints exist yet in Phase 1, but
 * this is wired up now so Phase 3+ (trips/expenses APIs) can validate bodies
 * consistently: parse+validate, or throw an AppError the central error
 * handler turns into a 400 `{code:'invalid_request', message}`.
 */
import { findCurrency } from '@tripsplit/shared';
import type { Context } from 'hono';
import { z } from 'zod';

import { AppError } from './errors.js';

/**
 * ISO-4217-or-'USDT' currency code schema, shared by `routes/trips.ts`
 * (trip `baseCurrency`) and `routes/expenses.ts`/`routes/trips.ts`'s
 * expense `currency`) — one source of truth for "is this a currency we
 * know about" (`@tripsplit/shared`'s `findCurrency`, Phase 5 will expand
 * the registry it checks against without any call site changing).
 */
export const currencyCodeSchema = z
  .string()
  .refine((code) => Boolean(findCurrency(code)), {
    message: 'Unknown currency code',
  });

/** Validates `c.req.json()` against `schema`; throws AppError(400) on failure. */
export async function validateJsonBody<Schema extends z.ZodType>(
  c: Context,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError(400, 'invalid_request', 'Request body must be valid JSON');
  }
  return parseOrThrow(schema, body);
}

/** Validates an arbitrary value (e.g. headers, query params) against `schema`. */
export function parseOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message =
      result.error.issues.map((issue) => issue.message).join('; ') || 'Invalid request';
    throw new AppError(400, 'invalid_request', message);
  }
  return result.data;
}

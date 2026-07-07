/**
 * `GET /api/rates` — IMPLEMENTATION_PLAN.md §5/§6, Phase 5.4. Cached
 * `currency -> base` cross-rate lookup for a given `date`, used by the
 * add-expense form to prefill the rate field **instantly**: this route only
 * ever reads the local SQLite `rates` cache (`getCrossRateLocal`,
 * lib/rates.ts) — it never calls out to a rate API, so it can't be slow or
 * flaky in the hot path.
 *
 * Mounted at `/api/rates` in `src/index.ts`, behind the `/api/*` auth
 * middleware (any authenticated user may look up a rate; it isn't
 * trip-scoped data).
 */
import { Hono } from 'hono';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { getCrossRateLocal } from '../lib/rates.js';
import { currencyCodeSchema, parseOrThrow } from '../lib/validate.js';

const rateQuerySchema = z.object({
  date: z
    .string({ message: 'date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be an ISO date (YYYY-MM-DD)'),
  currency: currencyCodeSchema,
  base: currencyCodeSchema,
});

export const ratesRouter = new Hono();

// GET /api/rates?date=&currency=&base= — see the module doc comment above.
ratesRouter.get('/', (c) => {
  const { date, currency, base } = parseOrThrow(rateQuerySchema, {
    date: c.req.query('date'),
    currency: c.req.query('currency'),
    base: c.req.query('base'),
  });

  const result = getCrossRateLocal(date, currency, base);
  if (!result) {
    throw new AppError(
      404,
      'rate_not_found',
      `No cached rate available for ${currency} on or before ${date}`,
    );
  }

  return c.json({
    date: result.date,
    currency,
    base,
    rate: result.rate,
    source: result.source,
  });
});

export default ratesRouter;

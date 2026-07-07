/**
 * Shared money-conversion math — Phase 5 (IMPLEMENTATION_PLAN.md §6/§9).
 * Lives in `@tripsplit/shared` (rather than duplicated in `server` and
 * `web`) so the server's authoritative `amount_base_minor` computation and
 * the add-expense form's live "≈ 41.20 EUR" preview are always the exact
 * same formula — the server remains the single source of truth (plan §3),
 * this just guarantees the client's preview never drifts out of sync with
 * what the server will actually store.
 */
import { getCurrencyExponent } from './currencies.js';

/**
 * `amount_base_minor = round(amount_minor * 10^(baseExponent - origExponent) * rate)`
 * — plan §3's money representation + §4's `amount_base_minor` column.
 * Money rule: integer minor units in, integer minor units out — never a
 * float amount anywhere in the pipeline.
 *
 * Worked example (cross-exponent): 100_000 VND minor (VND exponent 0, so
 * that's 100,000 VND) at rate 0.000038 to an EUR (exponent 2) trip base:
 * `round(100000 * 10^(2-0) * 0.000038) = round(100000 * 100 * 0.000038)
 * = round(380) = 380` → 3.80 EUR.
 */
export function computeAmountBaseMinor(
  amountMinor: number,
  currency: string,
  baseCurrency: string,
  rateToBase: number,
): number {
  const origExponent = getCurrencyExponent(currency);
  const baseExponent = getCurrencyExponent(baseCurrency);
  return Math.round(amountMinor * 10 ** (baseExponent - origExponent) * rateToBase);
}

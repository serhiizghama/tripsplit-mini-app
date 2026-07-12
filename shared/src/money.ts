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

/**
 * Inverse of `computeAmountBaseMinor`: how many minor units of `currency`
 * equal a given base-currency total at `rateToBase`. Used by the settlement
 * sheet to turn a fixed base-currency debt into the amount to pay in whatever
 * currency the user picks (e.g. "you owe €100" → "≈ ฿3,800").
 *
 * Returns `undefined` for a non-positive/non-finite rate — there's no
 * meaningful inverse. Rounding is not a perfect round-trip: feeding the result
 * back through `computeAmountBaseMinor` may differ by one minor unit. That's
 * fine here — the settlement's stored `amount_base_minor` is always recomputed
 * server-side from the submitted amount (the single source of truth), so this
 * only drives the editable input's suggested value.
 */
export function computeAmountFromBaseMinor(
  baseMinor: number,
  currency: string,
  baseCurrency: string,
  rateToBase: number,
): number | undefined {
  if (!Number.isFinite(rateToBase) || rateToBase <= 0) return undefined;
  const origExponent = getCurrencyExponent(currency);
  const baseExponent = getCurrencyExponent(baseCurrency);
  return Math.round((baseMinor * 10 ** (origExponent - baseExponent)) / rateToBase);
}

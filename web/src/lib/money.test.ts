import { describe, expect, it } from 'vitest';

import { computeAmountBaseMinor, computeAmountFromBaseMinor } from './money';

describe('computeAmountFromBaseMinor', () => {
  it('inverts computeAmountBaseMinor within one minor unit (same-exponent cross)', () => {
    // €100.00 debt (base EUR, exp 2) paid in THB (exp 2) at THB->EUR 0.026.
    const debtBaseMinor = 10_000;
    const amount = computeAmountFromBaseMinor(debtBaseMinor, 'THB', 'EUR', 0.026);
    expect(amount).toBe(384_615); // ฿3,846.15
    expect(computeAmountBaseMinor(amount!, 'THB', 'EUR', 0.026)).toBe(debtBaseMinor);
  });

  it('handles a cross-exponent pair (base EUR exp 2 -> VND exp 0)', () => {
    // €3.80 debt paid in VND at VND->EUR 0.000038 — the inverse of money.ts's
    // worked example (100,000 VND -> 380 base minor).
    const amount = computeAmountFromBaseMinor(380, 'VND', 'EUR', 0.000038);
    expect(amount).toBe(100_000);
    expect(computeAmountBaseMinor(amount!, 'VND', 'EUR', 0.000038)).toBe(380);
  });

  it('returns the base amount unchanged when currency equals base (rate 1)', () => {
    expect(computeAmountFromBaseMinor(12_345, 'EUR', 'EUR', 1)).toBe(12_345);
  });

  it('returns undefined for a non-positive or non-finite rate', () => {
    expect(computeAmountFromBaseMinor(10_000, 'THB', 'EUR', 0)).toBeUndefined();
    expect(computeAmountFromBaseMinor(10_000, 'THB', 'EUR', -0.026)).toBeUndefined();
    expect(computeAmountFromBaseMinor(10_000, 'THB', 'EUR', Number.NaN)).toBeUndefined();
  });
});

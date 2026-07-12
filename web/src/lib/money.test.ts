import { describe, expect, it } from 'vitest';

import {
  computeAmountBaseMinor,
  computeAmountFromBaseMinor,
  formatAmountForDisplay,
  parseAmountToMinor,
  sanitizeAmountInput,
} from './money';

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

describe('sanitizeAmountInput', () => {
  it('strips grouping whitespace and normalizes a comma decimal to a dot', () => {
    expect(sanitizeAmountInput('1 960 000.00')).toBe('1960000.00');
    expect(sanitizeAmountInput('1,5')).toBe('1.5');
    expect(sanitizeAmountInput('12ab3')).toBe('123');
  });

  it('keeps only the first dot', () => {
    expect(sanitizeAmountInput('1.2.3')).toBe('1.23');
  });
});

describe('formatAmountForDisplay', () => {
  it('groups the integer part in threes and leaves the fraction alone', () => {
    const out = formatAmountForDisplay('1960000.00');
    expect(sanitizeAmountInput(out)).toBe('1960000.00'); // round-trip
    expect(out.replace(/\d/g, '').length).toBe(3); // two group separators + the dot
    expect(out.endsWith('.00')).toBe(true);
  });

  it('preserves a trailing dot while typing', () => {
    expect(sanitizeAmountInput(formatAmountForDisplay('1000.'))).toBe('1000.');
  });

  it('handles empty and sub-thousand inputs without a separator', () => {
    expect(formatAmountForDisplay('')).toBe('');
    expect(formatAmountForDisplay('12')).toBe('12');
    expect(formatAmountForDisplay('999')).toBe('999');
  });

  it('round-trips through sanitize so parsing is unchanged', () => {
    for (const raw of ['1960000.00', '0.50', '1000', '1234567', '999999999.99']) {
      const shown = formatAmountForDisplay(raw);
      expect(parseAmountToMinor(sanitizeAmountInput(shown), 'EUR')).toBe(
        parseAmountToMinor(raw, 'EUR'),
      );
    }
  });
});

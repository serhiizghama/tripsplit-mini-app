import { describe, expect, it } from 'vitest';

import { deriveCustomShares, splitEqualMinor } from './customSplit';

describe('splitEqualMinor', () => {
  it('splits evenly when divisible', () => {
    expect(splitEqualMinor(10, 2)).toEqual([5, 5]);
  });

  it('hands the leftover minor units to the first parts', () => {
    expect(splitEqualMinor(10, 3)).toEqual([4, 3, 3]);
    expect(splitEqualMinor(100, 3)).toEqual([34, 33, 33]);
  });

  it('always sums back to the total', () => {
    for (const [total, count] of [
      [1000, 7],
      [333, 4],
      [1, 3],
    ] as const) {
      expect(splitEqualMinor(total, count).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('handles zero, negative, and empty edge cases', () => {
    expect(splitEqualMinor(0, 3)).toEqual([0, 0, 0]);
    expect(splitEqualMinor(-5, 2)).toEqual([0, 0]);
    expect(splitEqualMinor(7, 0)).toEqual([]);
  });
});

describe('deriveCustomShares', () => {
  it('two members: locking one auto-fills the other (total - locked)', () => {
    expect(deriveCustomShares([1, 2], 1000, { 1: 600 })).toEqual({ 1: 600, 2: 400 });
  });

  it('nothing locked: splits equally among everyone', () => {
    expect(deriveCustomShares([1, 2], 1000, {})).toEqual({ 1: 500, 2: 500 });
    expect(deriveCustomShares([1, 2, 3], 1000, {})).toEqual({ 1: 334, 2: 333, 3: 333 });
  });

  it('three members: one locked, the rest split the remainder', () => {
    expect(deriveCustomShares([1, 2, 3], 1000, { 1: 400 })).toEqual({
      1: 400,
      2: 300,
      3: 300,
    });
  });

  it('three members: two locked, the last takes the exact remainder', () => {
    expect(deriveCustomShares([1, 2, 3], 1000, { 1: 400, 2: 100 })).toEqual({
      1: 400,
      2: 100,
      3: 500,
    });
  });

  it('never overwrites a locked value and always sums to total when an auto member exists', () => {
    const derived = deriveCustomShares([1, 2, 3], 997, { 2: 111 });
    expect(derived[2]).toBe(111); // locked, untouched
    expect(Object.values(derived).reduce((a, b) => a + b, 0)).toBe(997); // exact
  });

  it('over-locked: auto members drop to zero (caller shows "over by N")', () => {
    expect(deriveCustomShares([1, 2], 1000, { 1: 1200 })).toEqual({ 1: 1200, 2: 0 });
  });

  it('all locked and mismatched: returns the locked values as-is (under/over)', () => {
    expect(deriveCustomShares([1, 2], 1000, { 1: 600, 2: 300 })).toEqual({
      1: 600,
      2: 300,
    });
  });
});

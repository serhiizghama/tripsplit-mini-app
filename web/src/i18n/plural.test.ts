/**
 * Plural-selector unit tests — Phase 7 DoD: "the plural selector (EN 2-form
 * + RU/UK 3-form with representative numbers incl. 1, 2, 5, 11, 21, 22, 25)".
 */
import { describe, expect, it } from 'vitest';

import { selectPluralForm } from './plural';

describe('selectPluralForm — en (2-form)', () => {
  it.each([
    [0, 'other'],
    [1, 'one'],
    [2, 'other'],
    [5, 'other'],
    [11, 'other'],
    [21, 'other'],
    [22, 'other'],
    [25, 'other'],
    [100, 'other'],
  ] as const)('%i -> %s', (n, expected) => {
    expect(selectPluralForm('en', n)).toBe(expected);
  });
});

describe('selectPluralForm — ru (3-form Slavic)', () => {
  it.each([
    [0, 'many'],
    [1, 'one'],
    [2, 'few'],
    [3, 'few'],
    [4, 'few'],
    [5, 'many'],
    [10, 'many'],
    [11, 'many'],
    [12, 'many'],
    [14, 'many'],
    [15, 'many'],
    [20, 'many'],
    [21, 'one'],
    [22, 'few'],
    [24, 'few'],
    [25, 'many'],
    [100, 'many'],
    [101, 'one'],
    [102, 'few'],
    [111, 'many'], // mod100 === 11 -> many, not one
    [112, 'many'], // mod100 in [12,14] -> many, not few
  ] as const)('%i -> %s', (n, expected) => {
    expect(selectPluralForm('ru', n)).toBe(expected);
  });
});

describe('selectPluralForm — uk (same Slavic 3-form rule as ru)', () => {
  it.each([
    [1, 'one'],
    [2, 'few'],
    [5, 'many'],
    [11, 'many'],
    [21, 'one'],
    [22, 'few'],
    [25, 'many'],
  ] as const)('%i -> %s', (n, expected) => {
    expect(selectPluralForm('uk', n)).toBe(expected);
  });
});

it('treats negative counts the same as their absolute value', () => {
  expect(selectPluralForm('ru', -1)).toBe('one');
  expect(selectPluralForm('ru', -5)).toBe('many');
  expect(selectPluralForm('en', -1)).toBe('one');
});

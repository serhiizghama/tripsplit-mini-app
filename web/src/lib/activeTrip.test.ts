/**
 * `resolveActiveTripId` tests — the pure core of the (future) multi-trip
 * switcher's persistence. No localStorage/React involved here; those are
 * exercised through `ActiveTripProvider` at runtime instead.
 */
import { describe, expect, it } from 'vitest';

import { resolveActiveTripId } from './activeTrip';

describe('resolveActiveTripId', () => {
  it('returns the stored id when it matches a trip in the list', () => {
    const trips = [{ id: 'trip-a' }, { id: 'trip-b' }];
    expect(resolveActiveTripId(trips, 'trip-b')).toBe('trip-b');
  });

  it('falls back to the first trip when the stored id matches none', () => {
    const trips = [{ id: 'trip-a' }, { id: 'trip-b' }];
    expect(resolveActiveTripId(trips, 'trip-unknown')).toBe('trip-a');
  });

  it('falls back to the first trip when there is no stored id', () => {
    const trips = [{ id: 'trip-a' }, { id: 'trip-b' }];
    expect(resolveActiveTripId(trips, null)).toBe('trip-a');
  });

  it('returns undefined for an empty trip list', () => {
    expect(resolveActiveTripId([], null)).toBeUndefined();
  });
});

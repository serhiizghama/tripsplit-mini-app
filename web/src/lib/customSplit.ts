/**
 * Custom-split allocation — the "auto-distribute the remainder" model behind
 * the add-expense sheet's manual split. Members the user typed a value for are
 * "locked"; everyone else splits the leftover (`total - Σlocked`) equally.
 * Pure integer (minor-unit) math with no currency/React dependency, so it's
 * unit-testable on its own and can't drift from what the sheet submits.
 */

/**
 * Splits an integer `total` into `count` parts as equally as possible, handing
 * the `total % count` leftover minor units to the first parts (largest-
 * remainder, deterministic — mirrors the server's `splitEqual`). `total <= 0`
 * yields all zeros; `count <= 0` yields an empty list.
 */
export function splitEqualMinor(total: number, count: number): number[] {
  if (count <= 0) return [];
  if (total <= 0) return new Array(count).fill(0);
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Every member's share (minor units) for the custom split: locked members keep
 * their exact typed value, the rest split `total - Σlocked` equally among
 * themselves. Auto members get 0 when the locked entries already meet or exceed
 * the total (an over-allocation the caller surfaces as "over by N"). Locked
 * members are read from `lockedMinor` (only the ids the user typed); iteration
 * order follows `memberIds` so the largest-remainder tie-break is stable.
 */
export function deriveCustomShares(
  memberIds: number[],
  totalMinor: number,
  lockedMinor: Record<number, number>,
): Record<number, number> {
  const result: Record<number, number> = {};
  const autoIds: number[] = [];
  let lockedSum = 0;

  for (const id of memberIds) {
    if (id in lockedMinor) {
      result[id] = lockedMinor[id]!;
      lockedSum += lockedMinor[id]!;
    } else {
      autoIds.push(id);
    }
  }

  const autoShares = splitEqualMinor(Math.max(totalMinor - lockedSum, 0), autoIds.length);
  autoIds.forEach((id, i) => {
    result[id] = autoShares[i] ?? 0;
  });

  return result;
}

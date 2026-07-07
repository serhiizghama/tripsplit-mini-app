/**
 * Plain (non-component) helpers shared by `MemberAvatar.tsx` — split out so
 * that file only exports the component itself (keeps Fast Refresh happy;
 * see `react-refresh/only-export-components`).
 */

export interface AvatarPerson {
  id: number;
  firstName: string;
  lastName?: string | null;
  photoUrl?: string | null;
}

// Soft, modern palette — picked deterministically per person so the same
// member always gets the same hue. Also imitated by other per-id color
// pickers (e.g. `TripSwitcherSheet`'s trip tiles) so every "colored tile for
// an id" moment in the app draws from the one palette.
export const AVATAR_COLORS = [
  '#1677ff',
  '#00b578',
  '#ff8f1f',
  '#8a5cff',
  '#00b1c9',
  '#f5317f',
  '#5b8c00',
  '#ff6430',
];

/**
 * Same helper `SettingsScreen.tsx` had inline since Phase 1/2 — moved here
 * so both the current-user cell and every trip-member cell (Phase 3) share
 * one implementation.
 */
export function initials(person: Pick<AvatarPerson, 'firstName' | 'lastName'>): string {
  const first = person.firstName.trim().charAt(0);
  const last = (person.lastName ?? '').trim().charAt(0);
  return (first + last).toUpperCase() || '?';
}

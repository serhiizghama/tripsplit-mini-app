/**
 * Locale-aware date formatting — Phase 7 §9 ("all... date formatting via
 * `Intl.DateTimeFormat` with the active locale"). Two shapes are needed
 * across the app: the feed's day-group header (`formatDayHeader`) and a
 * plain short date (`formatShortDate`, e.g. a member's "joined on" date).
 */

/**
 * Formats a bare `YYYY-MM-DD` date (no time component — `Expense.spentOn`)
 * as a day-group header, e.g. "Mon, Jul 6, 2026" (en) / "пн, 6 июл. 2026 г."
 * (ru). Parsed/formatted as UTC explicitly: reading the bare date back in
 * the viewer's local timezone could otherwise shift it to the adjacent day.
 */
export function formatDayHeader(spentOn: string, locale = 'en'): string {
  const date = new Date(`${spentOn}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/** Formats a full ISO timestamp (e.g. `TripMemberView.joinedAt`) as a short locale date. */
export function formatShortDate(iso: string, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale).format(new Date(iso));
}

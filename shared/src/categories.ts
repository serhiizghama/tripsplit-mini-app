/**
 * Curated expense category emoji set — plan §8's add-expense sheet
 * "category emoji row" (optional field). `Expense.category` stores the
 * emoji glyph itself rather than a name-key: there's no i18n label to
 * localize (an emoji reads the same in every locale), so this is the
 * simplest correct model — no Phase 7 i18n dictionary needed for the
 * *stored value*.
 *
 * The server does not restrict `category` to this exact set (any short
 * string is accepted — see `server/src/routes/trips.ts`'s expense schema);
 * this is only the picker's curated list. `📦` (Other) stays last as the
 * catch-all/fallback chip.
 */
export const EXPENSE_CATEGORIES = [
  '🍜', // food
  '🍺', // drinks
  '🛒', // groceries
  '🚕', // taxi
  '🚆', // transport
  '✈️', // flights
  '⛽', // fuel
  '🚗', // car rental
  '🏨', // hotel
  '🎟️', // tickets
  '🎒', // activities
  '🛍️', // shopping
  '🎁', // souvenirs
  '💊', // medicine
  '📶', // connectivity
  '💵', // fees
  '📦', // other (catch-all, keep last)
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * i18n dictionary key for each category's *accessible label* (Phase 7) — the
 * emoji itself is still what's stored/rendered as the chip glyph (see above),
 * this is only used for `aria-label`/`title` so screen readers and hover
 * tooltips get a real word instead of just an emoji glyph. Keys resolved via
 * `web/src/i18n`'s `t()`; see `en.json`'s `category.*` entries.
 */
export const EXPENSE_CATEGORY_NAME_KEYS: Record<ExpenseCategory, string> = {
  '🍜': 'category.food',
  '🍺': 'category.drinks',
  '🛒': 'category.groceries',
  '🚕': 'category.taxi',
  '🚆': 'category.transport',
  '✈️': 'category.flights',
  '⛽': 'category.fuel',
  '🚗': 'category.car',
  '🏨': 'category.hotel',
  '🎟️': 'category.tickets',
  '🎒': 'category.activities',
  '🛍️': 'category.shopping',
  '🎁': 'category.souvenirs',
  '💊': 'category.medicine',
  '📶': 'category.connectivity',
  '💵': 'category.fees',
  '📦': 'category.other',
};

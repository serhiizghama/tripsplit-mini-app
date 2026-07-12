/**
 * Money parsing/formatting helpers — Phase 4.2/4.3. Mirrors the server's
 * money rule (IMPLEMENTATION_PLAN.md §3): amounts are always integer minor
 * units in memory/over the wire; only the presentation boundary (here) ever
 * divides by `10 ** exponent`, and only for display.
 *
 * `parseAmountToMinor` avoids `Math.round(decimal * 10 ** exponent)` on
 * purpose — binary floating point makes that misround some perfectly
 * ordinary inputs (e.g. certain amounts land on `x.9999999999997`). Doing
 * the scaling with string/integer arithmetic instead means every input is
 * exact.
 */
import { findCurrency, getCurrencyExponent } from '@tripsplit/shared';

// Re-exported so the add-expense sheet's "≈ 41.20 EUR" live preview
// (Phase 5.7) uses the exact same conversion formula the server stores —
// see `shared/src/money.ts`'s doc comment for why this lives in
// `@tripsplit/shared` rather than being duplicated here.
export { computeAmountBaseMinor, computeAmountFromBaseMinor } from '@tripsplit/shared';

/**
 * Parses a user-entered decimal amount (e.g. `"12.5"`, `"1,234.56"`) into
 * integer minor units for `currency`. Returns `undefined` for anything that
 * isn't a non-negative decimal number (empty input, stray letters, a bare
 * "-", ...). More fractional digits than the currency's exponent allows are
 * rounded (half-up) into the last representable minor unit rather than
 * rejected — forgiving of e.g. a stray extra digit while typing.
 */
export function parseAmountToMinor(input: string, currency: string): number | undefined {
  const trimmed = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;

  const exponent = getCurrencyExponent(currency);
  const [intPart, fracPart = ''] = trimmed.split('.');
  const paddedFrac = (fracPart + '0'.repeat(exponent)).slice(0, exponent);
  const roundingDigit = fracPart.slice(exponent, exponent + 1);

  let minor = Number(`${intPart}${paddedFrac}`);
  if (!Number.isFinite(minor)) return undefined;
  if (roundingDigit !== '' && Number(roundingDigit) >= 5) {
    minor += 1;
  }
  return minor;
}

/** Inverse of `parseAmountToMinor` — minor units back to a decimal string for an editable input. */
export function minorToAmountInput(amountMinor: number, currency: string): string {
  const exponent = getCurrencyExponent(currency);
  if (exponent === 0) return String(amountMinor);
  return (amountMinor / 10 ** exponent).toFixed(exponent);
}

/**
 * Thousands separator used to display amounts — a narrow no-break space
 * (U+202F): thin, keeps the number on one line, and (unlike a comma) never
 * collides with the decimal point `parseAmountToMinor` reads.
 */
const AMOUNT_GROUP_SEPARATOR = '\u202F';

/**
 * Strips grouping/whitespace and normalizes a decimal comma to a dot, leaving
 * only the raw `\d+(\.\d*)?` string the rest of the money pipeline expects.
 * Run on every amount-field `onChange` so state stays raw while the input
 * *displays* a grouped value (see `formatAmountForDisplay`).
 */
export function sanitizeAmountInput(input: string): string {
  const cleaned = input.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  // Keep the first dot, drop any later ones ("1.2.3" -> "1.23").
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

/**
 * Groups the integer part of a raw amount string in threes for display
 * (e.g. `"1960000.00"` -> `"1 960 000.00"`). The fractional part and a
 * trailing dot are left untouched so mid-typing states render as typed. The
 * inverse is `sanitizeAmountInput`; `formatAmountForDisplay` is display-only —
 * never store its output in state.
 */
export function formatAmountForDisplay(raw: string): string {
  if (raw === '') return '';
  const dotIndex = raw.indexOf('.');
  const intPart = dotIndex === -1 ? raw : raw.slice(0, dotIndex);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, AMOUNT_GROUP_SEPARATOR);
  return dotIndex === -1 ? grouped : grouped + raw.slice(dotIndex);
}

/**
 * Human-readable money string (e.g. `"€12.50"`, `"₫500,000"`), locale-aware
 * (Phase 7 §9: "all currency/date formatting via `Intl.NumberFormat`/
 * `Intl.DateTimeFormat` with the active locale").
 *
 * Tries `Intl.NumberFormat(locale, { style: 'currency', currency })` first —
 * this gets locale-correct digit grouping/decimal separators (e.g. RU/UK use
 * a comma decimal and space grouping) "for free". A good number of registry
 * entries aren't valid ISO 4217 codes `Intl` recognizes (`USDT`, `CNH`,
 * `FOK`, `KID`, `SLE`, `TVD`, `XCG`, `ZWG`, ...), which makes the `currency`
 * style throw a `RangeError` — that path falls back to our own `symbol`
 * table with a locale-aware *plain* number format instead. Either way, the
 * currency's own `exponent` (never `Intl`'s built-in guess) decides decimal
 * places, per the plan's "VND/LAK zero-decimal handled by `Intl`
 * automatically" — we still pass it explicitly since our registry is the
 * single source of truth for money math throughout the app.
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = 'en',
): string {
  const meta = findCurrency(currency);
  const exponent = meta?.exponent ?? 2;
  const value = amountMinor / 10 ** exponent;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(value);
  } catch {
    // Unknown-to-Intl currency code — fall back to the registry's own symbol.
    const formattedNumber = new Intl.NumberFormat(locale, {
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(value);
    return meta ? `${meta.symbol}${formattedNumber}` : `${formattedNumber} ${currency}`;
  }
}

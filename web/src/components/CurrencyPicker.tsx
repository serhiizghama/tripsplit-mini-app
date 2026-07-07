/**
 * Currency picker — Phase 5 (IMPLEMENTATION_PLAN.md §6's "Currency picker
 * UX": curated top list first, then a searchable full list). Shared by
 * `CreateTripPlaceholder.tsx` (trip base currency) and `AddExpenseSheet.tsx`
 * (expense currency) so the ~167-entry registry (`@tripsplit/shared`'s
 * `CURRENCIES`, Phase 5.1) never renders as one giant wall of chips.
 *
 * "Curated top" here is the static list from `getTopCurrencies()` (THB, VND,
 * LAK, UAH, USD, EUR, USDT) plus whatever dynamic `extraCodes` the caller
 * passes — the plan's "trip base + last-used" part, which is inherently
 * per-screen state, not something `@tripsplit/shared` can know about. The
 * currently-selected `value` is always pinned into the top row too, so a
 * previously-picked exotic currency never disappears without a re-search.
 * Typing in the search box surfaces the rest of the registry, filtered by
 * ISO code (currency *names* aren't localized until Phase 7 fills in the
 * `nameKey` dictionaries, so code-only search is what's actually useful
 * today).
 *
 * Redesigned onto antd-mobile (shared `Chip`/`ChipRow` pills + `SearchBar`);
 * the curated/search filtering and the exported props are unchanged.
 */
import { useMemo, useState } from 'react';
import { SearchBar } from 'antd-mobile';
import { CURRENCIES, findCurrency, getTopCurrencies } from '@tripsplit/shared';
import type { Currency } from '@tripsplit/shared';

import { Chip, ChipRow } from './ui';
import { useT } from '../i18n';

const MAX_SEARCH_RESULTS = 30;

function CurrencyChip({
  currency,
  selected,
  onSelect,
}: {
  currency: Currency;
  selected: boolean;
  onSelect: (code: string) => void;
}) {
  const t = useT();
  return (
    <Chip selected={selected} title={t(currency.nameKey)} onClick={() => onSelect(currency.code)}>
      {currency.symbol} {currency.code}
    </Chip>
  );
}

export function CurrencyPicker({
  value,
  onChange,
  extraCodes = [],
}: {
  value: string;
  onChange: (code: string) => void;
  /** Dynamic codes to pin ahead of the static curated list (trip base, last-used), deduped automatically. */
  extraCodes?: (string | undefined)[];
}) {
  const t = useT();
  const [search, setSearch] = useState('');

  const topCurrencies = useMemo(() => {
    const codes = [value, ...extraCodes.filter((c): c is string => Boolean(c))].concat(
      getTopCurrencies().map((c) => c.code),
    );
    const seen = new Set<string>();
    const result: Currency[] = [];
    for (const code of codes) {
      if (seen.has(code)) continue;
      seen.add(code);
      const currency = findCurrency(code);
      if (currency) result.push(currency);
    }
    return result;
  }, [value, extraCodes]);

  const topCodes = useMemo(() => new Set(topCurrencies.map((c) => c.code)), [topCurrencies]);

  const searchResults = useMemo(() => {
    const query = search.trim().toUpperCase();
    if (!query) return [];
    // Matches by ISO code OR the currency's localized display name — e.g. a
    // ru-locale user can type "бат" and still find THB (Phase 7's currency
    // `nameKey`s finally get used here, not just reserved).
    return CURRENCIES.filter(
      (c) =>
        !topCodes.has(c.code) &&
        (c.code.includes(query) || t(c.nameKey).toUpperCase().includes(query)),
    ).slice(0, MAX_SEARCH_RESULTS);
  }, [search, topCodes, t]);

  function select(code: string) {
    onChange(code);
    setSearch('');
  }

  return (
    <>
      <ChipRow>
        {topCurrencies.map((currency) => (
          <CurrencyChip
            key={currency.code}
            currency={currency}
            selected={currency.code === value}
            onSelect={select}
          />
        ))}
      </ChipRow>
      <div style={{ padding: '0 16px 12px' }}>
        <SearchBar
          placeholder={t('currency.searchPlaceholder')}
          value={search}
          onChange={(val) => setSearch(val)}
        />
      </div>
      {search.trim() && (
        <ChipRow>
          {searchResults.length > 0 ? (
            searchResults.map((currency) => (
              <CurrencyChip
                key={currency.code}
                currency={currency}
                selected={false}
                onSelect={select}
              />
            ))
          ) : (
            <span style={{ color: 'var(--ts-hint)', fontSize: 13 }}>{t('currency.noMatch')}</span>
          )}
        </ChipRow>
      )}
    </>
  );
}

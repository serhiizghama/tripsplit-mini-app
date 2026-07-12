/**
 * Currency registry — Phase 5 ("Currency Engine", IMPLEMENTATION_PLAN.md §6).
 *
 * Replaces the Phase 0 7-entry stub with the full active-currency registry:
 * every fiat currency `open.er-api.com`'s `/v6/latest/USD` returns (166,
 * live-verified 2026-07-06 — Appendix B) plus **USDT** (sourced from
 * `fawazahmed0/exchange-api`, which open.er-api doesn't carry) — 167 total.
 *
 * `exponent` is the ISO 4217 minor-unit exponent — the number of decimal
 * places used when storing amounts as integer minor units. Never store or
 * compute money as floats; multiply/divide by 10 ** exponent only at the
 * presentation boundary (Intl.NumberFormat, Phase 7). Exponents follow the
 * official ISO 4217 table:
 *  - **0** (no subunit in practice): BIF, CLP, DJF, GNF, ISK, JPY, KMF, KRW,
 *    PYG, RWF, UGX, VND, VUV, XAF, XOF, XPF.
 *  - **3** (mills, not cents): BHD, IQD, JOD, KWD, LYD, OMR, TND.
 *  - **4**: CLF (Chile's Unidad de Fomento — not a circulating currency, but
 *    open.er-api returns a rate for it, so it's included for completeness).
 *  - Everything else (incl. LAK — despite VND/JPY/KRW's exponent-0 company,
 *    the Lao kip's ISO 4217 minor unit is 2) defaults to **2**.
 *
 * `symbol` uses a recognizable currency symbol/prefix where one is in common
 * use (THB ฿, VND ₫, EUR €, ...); currencies without a widely-recognized
 * short symbol fall back to their ISO code itself (e.g. `AOA` → `"AOA"`),
 * which is exactly what most apps do too and reads unambiguously either way.
 *
 * `nameKey` is the i18n dictionary key for the display name (`currency.<lowercase
 * code>`, e.g. `currency.thb`) — Phase 7 fills in the EN/RU/UK dictionaries;
 * this only reserves the keys.
 */

export interface Currency {
  /** ISO 4217 alpha code, or 'USDT' (not an ISO currency but treated as one). */
  code: string;
  /** Symbol or short label shown next to amounts. */
  symbol: string;
  /** Minor-unit exponent, e.g. 2 for cents, 0 for currencies with no subunit in practice. */
  exponent: number;
  /** i18n dictionary key for the display name (resolved via the locale's t()). */
  nameKey: string;
}

/**
 * Full registry, alphabetical by code. Sourced from `open.er-api.com`'s fiat
 * list (166 currencies, live-verified 2026-07-06) plus `USDT`. See the
 * module doc comment above for the exponent-override rationale.
 */
export const CURRENCIES: readonly Currency[] = [
  { code: 'AED', symbol: 'AED', exponent: 2, nameKey: 'currency.aed' },
  { code: 'AFN', symbol: 'AFN', exponent: 2, nameKey: 'currency.afn' },
  { code: 'ALL', symbol: 'L', exponent: 2, nameKey: 'currency.all' },
  { code: 'AMD', symbol: '֏', exponent: 2, nameKey: 'currency.amd' },
  { code: 'ANG', symbol: 'ANG', exponent: 2, nameKey: 'currency.ang' },
  { code: 'AOA', symbol: 'AOA', exponent: 2, nameKey: 'currency.aoa' },
  { code: 'ARS', symbol: 'AR$', exponent: 2, nameKey: 'currency.ars' },
  { code: 'AUD', symbol: 'A$', exponent: 2, nameKey: 'currency.aud' },
  { code: 'AWG', symbol: 'AWG', exponent: 2, nameKey: 'currency.awg' },
  { code: 'AZN', symbol: '₼', exponent: 2, nameKey: 'currency.azn' },
  { code: 'BAM', symbol: 'BAM', exponent: 2, nameKey: 'currency.bam' },
  { code: 'BBD', symbol: 'Bds$', exponent: 2, nameKey: 'currency.bbd' },
  { code: 'BDT', symbol: '৳', exponent: 2, nameKey: 'currency.bdt' },
  { code: 'BGN', symbol: 'лв', exponent: 2, nameKey: 'currency.bgn' },
  { code: 'BHD', symbol: 'BD', exponent: 3, nameKey: 'currency.bhd' },
  { code: 'BIF', symbol: 'BIF', exponent: 0, nameKey: 'currency.bif' },
  { code: 'BMD', symbol: 'BMD', exponent: 2, nameKey: 'currency.bmd' },
  { code: 'BND', symbol: 'B$', exponent: 2, nameKey: 'currency.bnd' },
  { code: 'BOB', symbol: 'Bs.', exponent: 2, nameKey: 'currency.bob' },
  { code: 'BRL', symbol: 'R$', exponent: 2, nameKey: 'currency.brl' },
  { code: 'BSD', symbol: 'B$', exponent: 2, nameKey: 'currency.bsd' },
  { code: 'BTN', symbol: 'BTN', exponent: 2, nameKey: 'currency.btn' },
  { code: 'BWP', symbol: 'BWP', exponent: 2, nameKey: 'currency.bwp' },
  { code: 'BYN', symbol: 'BYN', exponent: 2, nameKey: 'currency.byn' },
  { code: 'BZD', symbol: 'BZD', exponent: 2, nameKey: 'currency.bzd' },
  { code: 'CAD', symbol: 'C$', exponent: 2, nameKey: 'currency.cad' },
  { code: 'CDF', symbol: 'CDF', exponent: 2, nameKey: 'currency.cdf' },
  { code: 'CHF', symbol: 'CHF', exponent: 2, nameKey: 'currency.chf' },
  { code: 'CLF', symbol: 'CLF', exponent: 4, nameKey: 'currency.clf' },
  { code: 'CLP', symbol: 'CLP$', exponent: 0, nameKey: 'currency.clp' },
  { code: 'CNH', symbol: '¥', exponent: 2, nameKey: 'currency.cnh' },
  { code: 'CNY', symbol: '¥', exponent: 2, nameKey: 'currency.cny' },
  { code: 'COP', symbol: 'COL$', exponent: 2, nameKey: 'currency.cop' },
  { code: 'CRC', symbol: '₡', exponent: 2, nameKey: 'currency.crc' },
  { code: 'CUP', symbol: '$MN', exponent: 2, nameKey: 'currency.cup' },
  { code: 'CVE', symbol: 'CVE', exponent: 2, nameKey: 'currency.cve' },
  { code: 'CZK', symbol: 'Kč', exponent: 2, nameKey: 'currency.czk' },
  { code: 'DJF', symbol: 'DJF', exponent: 0, nameKey: 'currency.djf' },
  { code: 'DKK', symbol: 'kr', exponent: 2, nameKey: 'currency.dkk' },
  { code: 'DOP', symbol: 'RD$', exponent: 2, nameKey: 'currency.dop' },
  { code: 'DZD', symbol: 'DA', exponent: 2, nameKey: 'currency.dzd' },
  { code: 'EGP', symbol: 'E£', exponent: 2, nameKey: 'currency.egp' },
  { code: 'ERN', symbol: 'ERN', exponent: 2, nameKey: 'currency.ern' },
  { code: 'ETB', symbol: 'Br', exponent: 2, nameKey: 'currency.etb' },
  { code: 'EUR', symbol: '€', exponent: 2, nameKey: 'currency.eur' },
  { code: 'FJD', symbol: 'FJ$', exponent: 2, nameKey: 'currency.fjd' },
  { code: 'FKP', symbol: 'FKP', exponent: 2, nameKey: 'currency.fkp' },
  { code: 'FOK', symbol: 'FOK', exponent: 2, nameKey: 'currency.fok' },
  { code: 'GBP', symbol: '£', exponent: 2, nameKey: 'currency.gbp' },
  { code: 'GEL', symbol: '₾', exponent: 2, nameKey: 'currency.gel' },
  { code: 'GGP', symbol: 'GGP', exponent: 2, nameKey: 'currency.ggp' },
  { code: 'GHS', symbol: 'GH₵', exponent: 2, nameKey: 'currency.ghs' },
  { code: 'GIP', symbol: 'GIP', exponent: 2, nameKey: 'currency.gip' },
  { code: 'GMD', symbol: 'GMD', exponent: 2, nameKey: 'currency.gmd' },
  { code: 'GNF', symbol: 'GNF', exponent: 0, nameKey: 'currency.gnf' },
  { code: 'GTQ', symbol: 'Q', exponent: 2, nameKey: 'currency.gtq' },
  { code: 'GYD', symbol: 'GYD', exponent: 2, nameKey: 'currency.gyd' },
  { code: 'HKD', symbol: 'HK$', exponent: 2, nameKey: 'currency.hkd' },
  { code: 'HNL', symbol: 'L', exponent: 2, nameKey: 'currency.hnl' },
  { code: 'HRK', symbol: 'HRK', exponent: 2, nameKey: 'currency.hrk' },
  { code: 'HTG', symbol: 'HTG', exponent: 2, nameKey: 'currency.htg' },
  { code: 'HUF', symbol: 'Ft', exponent: 2, nameKey: 'currency.huf' },
  { code: 'IDR', symbol: 'Rp', exponent: 2, nameKey: 'currency.idr' },
  { code: 'ILS', symbol: '₪', exponent: 2, nameKey: 'currency.ils' },
  { code: 'IMP', symbol: 'IMP', exponent: 2, nameKey: 'currency.imp' },
  { code: 'INR', symbol: '₹', exponent: 2, nameKey: 'currency.inr' },
  { code: 'IQD', symbol: 'ID', exponent: 3, nameKey: 'currency.iqd' },
  { code: 'IRR', symbol: 'IRR', exponent: 2, nameKey: 'currency.irr' },
  { code: 'ISK', symbol: 'kr', exponent: 0, nameKey: 'currency.isk' },
  { code: 'JEP', symbol: 'JEP', exponent: 2, nameKey: 'currency.jep' },
  { code: 'JMD', symbol: 'J$', exponent: 2, nameKey: 'currency.jmd' },
  { code: 'JOD', symbol: 'JD', exponent: 3, nameKey: 'currency.jod' },
  { code: 'JPY', symbol: '¥', exponent: 0, nameKey: 'currency.jpy' },
  { code: 'KES', symbol: 'KSh', exponent: 2, nameKey: 'currency.kes' },
  { code: 'KGS', symbol: 'KGS', exponent: 2, nameKey: 'currency.kgs' },
  { code: 'KHR', symbol: '៛', exponent: 2, nameKey: 'currency.khr' },
  { code: 'KID', symbol: 'KID', exponent: 2, nameKey: 'currency.kid' },
  { code: 'KMF', symbol: 'KMF', exponent: 0, nameKey: 'currency.kmf' },
  { code: 'KRW', symbol: '₩', exponent: 0, nameKey: 'currency.krw' },
  { code: 'KWD', symbol: 'KD', exponent: 3, nameKey: 'currency.kwd' },
  { code: 'KYD', symbol: 'KYD', exponent: 2, nameKey: 'currency.kyd' },
  { code: 'KZT', symbol: '₸', exponent: 2, nameKey: 'currency.kzt' },
  { code: 'LAK', symbol: '₭', exponent: 2, nameKey: 'currency.lak' },
  { code: 'LBP', symbol: 'LBP', exponent: 2, nameKey: 'currency.lbp' },
  { code: 'LKR', symbol: 'Rs', exponent: 2, nameKey: 'currency.lkr' },
  { code: 'LRD', symbol: 'LRD', exponent: 2, nameKey: 'currency.lrd' },
  { code: 'LSL', symbol: 'LSL', exponent: 2, nameKey: 'currency.lsl' },
  { code: 'LYD', symbol: 'LD', exponent: 3, nameKey: 'currency.lyd' },
  { code: 'MAD', symbol: 'MAD', exponent: 2, nameKey: 'currency.mad' },
  { code: 'MDL', symbol: 'L', exponent: 2, nameKey: 'currency.mdl' },
  { code: 'MGA', symbol: 'MGA', exponent: 2, nameKey: 'currency.mga' },
  { code: 'MKD', symbol: 'ден', exponent: 2, nameKey: 'currency.mkd' },
  { code: 'MMK', symbol: 'K', exponent: 2, nameKey: 'currency.mmk' },
  { code: 'MNT', symbol: 'MNT', exponent: 2, nameKey: 'currency.mnt' },
  { code: 'MOP', symbol: 'MOP', exponent: 2, nameKey: 'currency.mop' },
  { code: 'MRU', symbol: 'MRU', exponent: 2, nameKey: 'currency.mru' },
  { code: 'MUR', symbol: 'MUR', exponent: 2, nameKey: 'currency.mur' },
  { code: 'MVR', symbol: 'MVR', exponent: 2, nameKey: 'currency.mvr' },
  { code: 'MWK', symbol: 'MK', exponent: 2, nameKey: 'currency.mwk' },
  { code: 'MXN', symbol: 'Mex$', exponent: 2, nameKey: 'currency.mxn' },
  { code: 'MYR', symbol: 'RM', exponent: 2, nameKey: 'currency.myr' },
  { code: 'MZN', symbol: 'MZN', exponent: 2, nameKey: 'currency.mzn' },
  { code: 'NAD', symbol: 'NAD', exponent: 2, nameKey: 'currency.nad' },
  { code: 'NGN', symbol: '₦', exponent: 2, nameKey: 'currency.ngn' },
  { code: 'NIO', symbol: 'C$', exponent: 2, nameKey: 'currency.nio' },
  { code: 'NOK', symbol: 'kr', exponent: 2, nameKey: 'currency.nok' },
  { code: 'NPR', symbol: 'Rs', exponent: 2, nameKey: 'currency.npr' },
  { code: 'NZD', symbol: 'NZ$', exponent: 2, nameKey: 'currency.nzd' },
  { code: 'OMR', symbol: 'OMR', exponent: 3, nameKey: 'currency.omr' },
  { code: 'PAB', symbol: 'PAB', exponent: 2, nameKey: 'currency.pab' },
  { code: 'PEN', symbol: 'S/', exponent: 2, nameKey: 'currency.pen' },
  { code: 'PGK', symbol: 'K', exponent: 2, nameKey: 'currency.pgk' },
  { code: 'PHP', symbol: '₱', exponent: 2, nameKey: 'currency.php' },
  { code: 'PKR', symbol: '₨', exponent: 2, nameKey: 'currency.pkr' },
  { code: 'PLN', symbol: 'zł', exponent: 2, nameKey: 'currency.pln' },
  { code: 'PYG', symbol: '₲', exponent: 0, nameKey: 'currency.pyg' },
  { code: 'QAR', symbol: 'QR', exponent: 2, nameKey: 'currency.qar' },
  { code: 'RON', symbol: 'lei', exponent: 2, nameKey: 'currency.ron' },
  { code: 'RSD', symbol: 'дин', exponent: 2, nameKey: 'currency.rsd' },
  { code: 'RUB', symbol: '₽', exponent: 2, nameKey: 'currency.rub' },
  { code: 'RWF', symbol: 'RF', exponent: 0, nameKey: 'currency.rwf' },
  { code: 'SAR', symbol: 'SR', exponent: 2, nameKey: 'currency.sar' },
  { code: 'SBD', symbol: 'SBD', exponent: 2, nameKey: 'currency.sbd' },
  { code: 'SCR', symbol: 'SCR', exponent: 2, nameKey: 'currency.scr' },
  { code: 'SDG', symbol: 'SDG', exponent: 2, nameKey: 'currency.sdg' },
  { code: 'SEK', symbol: 'kr', exponent: 2, nameKey: 'currency.sek' },
  { code: 'SGD', symbol: 'S$', exponent: 2, nameKey: 'currency.sgd' },
  { code: 'SHP', symbol: 'SHP', exponent: 2, nameKey: 'currency.shp' },
  { code: 'SLE', symbol: 'SLE', exponent: 2, nameKey: 'currency.sle' },
  { code: 'SLL', symbol: 'SLL', exponent: 2, nameKey: 'currency.sll' },
  { code: 'SOS', symbol: 'SOS', exponent: 2, nameKey: 'currency.sos' },
  { code: 'SRD', symbol: 'SRD', exponent: 2, nameKey: 'currency.srd' },
  { code: 'SSP', symbol: 'SSP', exponent: 2, nameKey: 'currency.ssp' },
  { code: 'STN', symbol: 'STN', exponent: 2, nameKey: 'currency.stn' },
  { code: 'SYP', symbol: 'SYP', exponent: 2, nameKey: 'currency.syp' },
  { code: 'SZL', symbol: 'SZL', exponent: 2, nameKey: 'currency.szl' },
  { code: 'THB', symbol: '฿', exponent: 2, nameKey: 'currency.thb' },
  { code: 'TJS', symbol: 'TJS', exponent: 2, nameKey: 'currency.tjs' },
  { code: 'TMT', symbol: 'TMT', exponent: 2, nameKey: 'currency.tmt' },
  { code: 'TND', symbol: 'DT', exponent: 3, nameKey: 'currency.tnd' },
  { code: 'TOP', symbol: 'T$', exponent: 2, nameKey: 'currency.top' },
  { code: 'TRY', symbol: '₺', exponent: 2, nameKey: 'currency.try' },
  { code: 'TTD', symbol: 'TT$', exponent: 2, nameKey: 'currency.ttd' },
  { code: 'TVD', symbol: 'TVD', exponent: 2, nameKey: 'currency.tvd' },
  { code: 'TWD', symbol: 'NT$', exponent: 2, nameKey: 'currency.twd' },
  { code: 'TZS', symbol: 'TSh', exponent: 2, nameKey: 'currency.tzs' },
  { code: 'UAH', symbol: '₴', exponent: 2, nameKey: 'currency.uah' },
  { code: 'UGX', symbol: 'USh', exponent: 0, nameKey: 'currency.ugx' },
  { code: 'USD', symbol: '$', exponent: 2, nameKey: 'currency.usd' },
  { code: 'USDT', symbol: '₮', exponent: 2, nameKey: 'currency.usdt' },
  { code: 'UYU', symbol: '$U', exponent: 2, nameKey: 'currency.uyu' },
  { code: 'UZS', symbol: 'soʻm', exponent: 2, nameKey: 'currency.uzs' },
  { code: 'VES', symbol: 'Bs.S', exponent: 2, nameKey: 'currency.ves' },
  { code: 'VND', symbol: '₫', exponent: 0, nameKey: 'currency.vnd' },
  { code: 'VUV', symbol: 'VT', exponent: 0, nameKey: 'currency.vuv' },
  { code: 'WST', symbol: 'WS$', exponent: 2, nameKey: 'currency.wst' },
  { code: 'XAF', symbol: 'FCFA', exponent: 0, nameKey: 'currency.xaf' },
  { code: 'XCD', symbol: 'EC$', exponent: 2, nameKey: 'currency.xcd' },
  { code: 'XCG', symbol: 'XCG', exponent: 2, nameKey: 'currency.xcg' },
  { code: 'XDR', symbol: 'XDR', exponent: 2, nameKey: 'currency.xdr' },
  { code: 'XOF', symbol: 'CFA', exponent: 0, nameKey: 'currency.xof' },
  { code: 'XPF', symbol: 'CFP', exponent: 0, nameKey: 'currency.xpf' },
  { code: 'YER', symbol: 'YER', exponent: 2, nameKey: 'currency.yer' },
  { code: 'ZAR', symbol: 'R', exponent: 2, nameKey: 'currency.zar' },
  { code: 'ZMW', symbol: 'ZK', exponent: 2, nameKey: 'currency.zmw' },
  { code: 'ZWG', symbol: 'ZWG', exponent: 2, nameKey: 'currency.zwg' },
  { code: 'ZWL', symbol: 'ZWL', exponent: 2, nameKey: 'currency.zwl' },
] as const;

export function findCurrency(code: string): Currency | undefined {
  return CURRENCIES.find((c) => c.code === code);
}

export function getCurrencyExponent(code: string): number {
  return findCurrency(code)?.exponent ?? 2;
}

/**
 * Static curated "top" list (plan §6's currency-picker UX) — surfaced first,
 * ahead of the searchable full `CURRENCIES` list. This is deliberately just
 * the static part named in the plan (THB, VND, LAK, UAH, USD, EUR, USDT);
 * the *dynamic* part of "curated top" — the trip's own base currency and the
 * user's last-used currency — is handled by the picker UI itself (see
 * `web/src/components/CurrencyPicker.tsx`), which merges those in ahead of
 * this static list so they don't require a shared-package change per trip.
 */
export const TOP_CURRENCY_CODES: readonly string[] = [
  'THB',
  'VND',
  'LAK',
  'UAH',
  'USD',
  'EUR',
  'USDT',
] as const;

/** Resolves `TOP_CURRENCY_CODES` to full `Currency` records, in that fixed order. */
export function getTopCurrencies(): Currency[] {
  return TOP_CURRENCY_CODES.map((code) => findCurrency(code)).filter(
    (c): c is Currency => c !== undefined,
  );
}

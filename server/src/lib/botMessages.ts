/**
 * Server-side i18n for bot-sent chat messages — Export & Group Nudges plan
 * (`docs/EXPORT_NUDGES_PLAN.md`) task T2. Web's `web/src/i18n/*.json` is
 * client-only (React `t()`), so bot texts (posted via the Telegram HTML
 * `parse_mode`) get their own small, dependency-free dictionary here rather
 * than sharing that pipeline. Tone mirrors the web copy and `branding/
 * bot-texts.md`; gendered RU/UK verbs use the same `сделал(а)`-style bracket
 * convention already used throughout `web/src/i18n/ru.json`/`uk.json`.
 *
 * Locale pick (per the plan): the acting user's stored `lang` — the person
 * who added the expense / requested the export / sent the command.
 *
 * All builder functions return complete HTML-safe strings ready to send with
 * `parse_mode: 'HTML'` — every user-controlled string (names, trip titles,
 * descriptions, categories) is escaped internally via `escapeHtml` before
 * interpolation, so callers never have to remember to do it themselves.
 * Pre-formatted amounts (from `formatBotMoney`) and pre-rendered hint lines
 * (from `topDebtHint`) are trusted and interpolated as-is.
 */
import { findCurrency, getCurrencyExponent } from '@tripsplit/shared';

export type BotLocale = 'en' | 'ru' | 'uk';

/** Prefix-matches a Telegram/user `lang` string (e.g. `'ru-RU'`) to a supported bot locale; defaults to `'en'`. */
export function resolveBotLocale(lang: string | undefined): BotLocale {
  const prefix = lang?.trim().slice(0, 2).toLowerCase();
  if (prefix === 'ru') return 'ru';
  if (prefix === 'uk') return 'uk';
  return 'en';
}

/**
 * Escapes the 3 characters Telegram's HTML `parse_mode` requires escaped
 * outside of `pre`/`code` entities (`&`, `<`, `>` — quotes are only special
 * inside tag attributes, which this codebase never builds from user input).
 */
export function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Bot-side equivalent of `web/src/lib/money.ts`'s `formatMoney` — same
 * `Intl.NumberFormat` + registry-symbol-fallback approach (see that file's
 * doc comment for why the fallback exists: several registry codes like
 * `USDT`/`CNH`/`FOK` aren't valid ISO 4217 codes `Intl` recognizes). Can't
 * import the web copy directly (server doesn't depend on the `web`
 * workspace), so this mirrors it against the same `@tripsplit/shared`
 * registry instead of reimplementing the money math.
 */
export function formatBotMoney(
  amountMinor: number,
  currency: string,
  locale: BotLocale,
): string {
  const meta = findCurrency(currency);
  const exponent = getCurrencyExponent(currency);
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
    const formattedNumber = new Intl.NumberFormat(locale, {
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(value);
    return meta ? `${meta.symbol}${formattedNumber}` : `${formattedNumber} ${currency}`;
  }
}

export interface ExpenseNudgeParams {
  /** Whoever triggered the action. */
  actorName: string;
  /** Pre-formatted amount + currency (e.g. `formatBotMoney(...)`). */
  amount: string;
  description?: string | null;
  /** Emoji or short label — see `EXPENSE_CATEGORIES`; not restricted server-side, so still escaped. */
  category?: string | null;
  /** `'planned'` (no payer yet) expenses are still nudged on create, marked as such. */
  planned?: boolean;
  /** One-line biggest-transfer hint, pre-rendered via `topDebtHint()`. */
  topDebtHint?: string;
}

export interface SettlementNudgeParams {
  actorName: string;
  receiverName: string;
  amount: string;
  topDebtHint?: string;
}

export interface NetLineParams {
  name: string;
  /** Pre-formatted, unsigned (absolute-value) amount. Ignored when `status: 'settled'`. */
  amount: string;
  /** `'owed'` = positive net (is owed money), `'owes'` = negative net, `'settled'` = net is zero. */
  status: 'owed' | 'owes' | 'settled';
}

export interface TransferLineParams {
  from: string;
  to: string;
  amount: string;
}

export interface BotMessages {
  linkSuccess(tripTitle: string): string;
  linkUnknownCode(): string;
  linkUsageHint(): string;
  unlinkSuccess(tripTitle: string): string;
  unlinkNothingLinked(): string;

  expenseAdded(params: ExpenseNudgeParams): string;
  expenseUpdated(params: ExpenseNudgeParams): string;
  expenseDeleted(params: ExpenseNudgeParams): string;
  settlementRecorded(params: SettlementNudgeParams): string;
  /** The "biggest suggested transfer" one-liner appended to nudges for social pressure. */
  topDebtHint(params: TransferLineParams): string;

  summaryHeader(tripTitle: string): string;
  summaryTotalSpent(amount: string): string;
  summaryPerCurrencyHeader(): string;
  summaryPerCurrencyLine(amount: string): string;
  summaryBalancesHeader(): string;
  summaryNetLine(params: NetLineParams): string;
  summarySuggestedTransfersHeader(): string;
  summaryTransferLine(params: TransferLineParams): string;
  summaryAllSettled(): string;

  /** Fallback label for a member whose row isn't loaded — mirrors web's `common.userFallback`. */
  userFallback(id: number): string;
}

/** `"— 🍜 Dinner"` / `"— Dinner"` / `"— 🍜"` / `""` — shared across locales, no language-specific words. */
function expenseDetailSuffix(
  description?: string | null,
  category?: string | null,
): string {
  const parts = [
    category ? escapeHtml(category) : '',
    description ? escapeHtml(description) : '',
  ].filter(Boolean);
  return parts.length > 0 ? ` — ${parts.join(' ')}` : '';
}

/** Appends a pre-rendered hint line (e.g. `topDebtHint(...)`) on its own line, or nothing. */
function hintSuffix(hint?: string): string {
  return hint ? `\n${hint}` : '';
}

const en: BotMessages = {
  linkSuccess: (tripTitle) =>
    `✅ This chat now receives updates for <b>${escapeHtml(tripTitle)}</b>.`,
  linkUnknownCode: () =>
    "⚠️ That invite code isn't valid — check the code and try again.",
  linkUsageHint: () => 'Link this chat to a trip: <code>/link &lt;code&gt;</code>',
  unlinkSuccess: (tripTitle) =>
    `🔓 This chat no longer receives updates for <b>${escapeHtml(tripTitle)}</b>.`,
  unlinkNothingLinked: () => "This chat isn't linked to a trip yet.",

  expenseAdded: ({
    actorName,
    amount,
    description,
    category,
    planned,
    topDebtHint: hint,
  }) =>
    `💸 <b>${escapeHtml(actorName)}</b> added an expense: ${amount}${expenseDetailSuffix(description, category)}` +
    `${planned ? ' (planned — no payer yet)' : ''}${hintSuffix(hint)}`,
  expenseUpdated: ({ actorName, amount, description, category, topDebtHint: hint }) =>
    `✏️ <b>${escapeHtml(actorName)}</b> updated an expense: ${amount}${expenseDetailSuffix(description, category)}${hintSuffix(hint)}`,
  expenseDeleted: ({ actorName, amount, description, category, topDebtHint: hint }) =>
    `🗑️ <b>${escapeHtml(actorName)}</b> deleted an expense: ${amount}${expenseDetailSuffix(description, category)}${hintSuffix(hint)}`,
  settlementRecorded: ({ actorName, receiverName, amount, topDebtHint: hint }) =>
    `🤝 <b>${escapeHtml(actorName)}</b> settled up with <b>${escapeHtml(receiverName)}</b>: ${amount}${hintSuffix(hint)}`,
  topDebtHint: ({ from, to, amount }) =>
    `👉 Biggest debt: ${escapeHtml(from)} → ${escapeHtml(to)}: ${amount}`,

  summaryHeader: (tripTitle) => `📊 <b>${escapeHtml(tripTitle)}</b> — summary`,
  summaryTotalSpent: (amount) => `Total spent: <b>${amount}</b>`,
  summaryPerCurrencyHeader: () => 'Spend by currency:',
  summaryPerCurrencyLine: (amount) => `• ${amount}`,
  summaryBalancesHeader: () => 'Balances:',
  summaryNetLine: ({ name, amount, status }) => {
    const escaped = escapeHtml(name);
    if (status === 'owed') return `• ${escaped} is owed ${amount}`;
    if (status === 'owes') return `• ${escaped} owes ${amount}`;
    return `• ${escaped} — settled up`;
  },
  summarySuggestedTransfersHeader: () => 'Suggested transfers:',
  summaryTransferLine: ({ from, to, amount }) =>
    `• ${escapeHtml(from)} → ${escapeHtml(to)}: ${amount}`,
  summaryAllSettled: () => "✅ Everyone's settled up — no transfers needed.",

  userFallback: (id) => `User ${id}`,
};

const ru: BotMessages = {
  linkSuccess: (tripTitle) =>
    `✅ Этот чат теперь получает уведомления по поездке «<b>${escapeHtml(tripTitle)}</b>».`,
  linkUnknownCode: () =>
    '⚠️ Такого кода приглашения нет — проверьте код и попробуйте снова.',
  linkUsageHint: () => 'Чтобы привязать чат к поездке: <code>/link &lt;код&gt;</code>',
  unlinkSuccess: (tripTitle) =>
    `🔓 Этот чат больше не получает уведомления по поездке «<b>${escapeHtml(tripTitle)}</b>».`,
  unlinkNothingLinked: () => 'Этот чат пока не привязан ни к одной поездке.',

  expenseAdded: ({
    actorName,
    amount,
    description,
    category,
    planned,
    topDebtHint: hint,
  }) =>
    `💸 <b>${escapeHtml(actorName)}</b> добавил(а) расход: ${amount}${expenseDetailSuffix(description, category)}` +
    `${planned ? ' (план — без плательщика)' : ''}${hintSuffix(hint)}`,
  expenseUpdated: ({ actorName, amount, description, category, topDebtHint: hint }) =>
    `✏️ <b>${escapeHtml(actorName)}</b> изменил(а) расход: ${amount}${expenseDetailSuffix(description, category)}${hintSuffix(hint)}`,
  expenseDeleted: ({ actorName, amount, description, category, topDebtHint: hint }) =>
    `🗑️ <b>${escapeHtml(actorName)}</b> удалил(а) расход: ${amount}${expenseDetailSuffix(description, category)}${hintSuffix(hint)}`,
  settlementRecorded: ({ actorName, receiverName, amount, topDebtHint: hint }) =>
    `🤝 <b>${escapeHtml(actorName)}</b> рассчитался(лась) с <b>${escapeHtml(receiverName)}</b>: ${amount}${hintSuffix(hint)}`,
  topDebtHint: ({ from, to, amount }) =>
    `👉 Самый большой долг: ${escapeHtml(from)} → ${escapeHtml(to)}: ${amount}`,

  summaryHeader: (tripTitle) => `📊 «<b>${escapeHtml(tripTitle)}</b>» — итоги`,
  summaryTotalSpent: (amount) => `Всего потрачено: <b>${amount}</b>`,
  summaryPerCurrencyHeader: () => 'Расходы по валютам:',
  summaryPerCurrencyLine: (amount) => `• ${amount}`,
  summaryBalancesHeader: () => 'Баланс:',
  summaryNetLine: ({ name, amount, status }) => {
    const escaped = escapeHtml(name);
    if (status === 'owed') return `• ${escaped} получит ${amount}`;
    if (status === 'owes') return `• ${escaped} должен(на) ${amount}`;
    return `• ${escaped} — без долгов`;
  },
  summarySuggestedTransfersHeader: () => 'Кто кому переводит:',
  summaryTransferLine: ({ from, to, amount }) =>
    `• ${escapeHtml(from)} → ${escapeHtml(to)}: ${amount}`,
  summaryAllSettled: () => '✅ Все расчёты закрыты — переводов не требуется.',

  userFallback: (id) => `Пользователь ${id}`,
};

const uk: BotMessages = {
  linkSuccess: (tripTitle) =>
    `✅ Цей чат тепер отримує сповіщення щодо подорожі «<b>${escapeHtml(tripTitle)}</b>».`,
  linkUnknownCode: () =>
    '⚠️ Такого коду запрошення немає — перевірте код і спробуйте ще раз.',
  linkUsageHint: () => 'Щоб прив’язати чат до подорожі: <code>/link &lt;код&gt;</code>',
  unlinkSuccess: (tripTitle) =>
    `🔓 Цей чат більше не отримує сповіщення щодо подорожі «<b>${escapeHtml(tripTitle)}</b>».`,
  unlinkNothingLinked: () => 'Цей чат ще не прив’язаний до жодної подорожі.',

  expenseAdded: ({
    actorName,
    amount,
    description,
    category,
    planned,
    topDebtHint: hint,
  }) =>
    `💸 <b>${escapeHtml(actorName)}</b> додав(ла) витрату: ${amount}${expenseDetailSuffix(description, category)}` +
    `${planned ? ' (план — без платника)' : ''}${hintSuffix(hint)}`,
  expenseUpdated: ({ actorName, amount, description, category, topDebtHint: hint }) =>
    `✏️ <b>${escapeHtml(actorName)}</b> змінив(ла) витрату: ${amount}${expenseDetailSuffix(description, category)}${hintSuffix(hint)}`,
  expenseDeleted: ({ actorName, amount, description, category, topDebtHint: hint }) =>
    `🗑️ <b>${escapeHtml(actorName)}</b> видалив(ла) витрату: ${amount}${expenseDetailSuffix(description, category)}${hintSuffix(hint)}`,
  settlementRecorded: ({ actorName, receiverName, amount, topDebtHint: hint }) =>
    `🤝 <b>${escapeHtml(actorName)}</b> розрахувався(лася) з <b>${escapeHtml(receiverName)}</b>: ${amount}${hintSuffix(hint)}`,
  topDebtHint: ({ from, to, amount }) =>
    `👉 Найбільший борг: ${escapeHtml(from)} → ${escapeHtml(to)}: ${amount}`,

  summaryHeader: (tripTitle) => `📊 «<b>${escapeHtml(tripTitle)}</b>» — підсумки`,
  summaryTotalSpent: (amount) => `Всього витрачено: <b>${amount}</b>`,
  summaryPerCurrencyHeader: () => 'Витрати за валютами:',
  summaryPerCurrencyLine: (amount) => `• ${amount}`,
  summaryBalancesHeader: () => 'Баланс:',
  summaryNetLine: ({ name, amount, status }) => {
    const escaped = escapeHtml(name);
    if (status === 'owed') return `• ${escaped} отримає ${amount}`;
    if (status === 'owes') return `• ${escaped} винен(на) ${amount}`;
    return `• ${escaped} — без боргів`;
  },
  summarySuggestedTransfersHeader: () => 'Хто кому переказує:',
  summaryTransferLine: ({ from, to, amount }) =>
    `• ${escapeHtml(from)} → ${escapeHtml(to)}: ${amount}`,
  summaryAllSettled: () => '✅ Усі розрахунки закрито — перекази не потрібні.',

  userFallback: (id) => `Користувач ${id}`,
};

export const botMessages: Record<BotLocale, BotMessages> = { en, ru, uk };

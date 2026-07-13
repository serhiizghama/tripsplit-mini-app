/**
 * Add/edit-expense sheet — Phase 4.2/4.4 + Phase 5.7 (rate prefill/preview).
 * Field order follows plan §8's "3-interaction happy path": amount
 * (autofocus) → currency (last-used default) → payer (defaults to me) →
 * split (defaults equal-among-all; solo/custom are one tap away) →
 * optional description/category/date/rate. Typing an amount and tapping the
 * Telegram MainButton (or the in-form fallback button, when MainButton isn't
 * available) is the whole flow.
 *
 * Same route component handles both `/add-expense` (create) and
 * `/expense/:expenseId` (edit, Phase 4.4): editing reconstructs the stored
 * split *intent* — `splitMode` + the actual `shares` rows — from the
 * trip-detail response already in the TanStack Query cache.
 *
 * Rate field (Phase 5.7): when `currency !== baseCurrency`, `useRate` prefills
 * a real cross-rate; editing it sets `rateTouched`, which is what makes the
 * submit body include an explicit `rateToBase`/`rateOverridden: true`.
 *
 * Redesigned onto antd-mobile (Popup sheet + card sections); all form state,
 * validation, mutations, rate machinery, and telegram MainButton wiring are
 * unchanged. Note antd-mobile inputs pass their value directly to `onChange`
 * (not a DOM event).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, List, Segmented } from 'antd-mobile';
import { hapticFeedback, hideKeyboard } from '@tma.js/sdk-react';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_NAME_KEYS } from '@tripsplit/shared';
import type { CreateExpenseRequest, SplitMode, TripMemberView } from '@tripsplit/shared';
import { useNavigate, useParams } from 'react-router';

import { useCreateExpense, useDeleteExpense, useUpdateExpense } from '../api/mutations';
import { useCurrentTrip, useRate } from '../api/queries';
import { CurrencyPicker } from '../components/CurrencyPicker';
import { ListSkeleton } from '../components/ListSkeleton';
import {
  CategoryGrid,
  CategoryTile,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  SectionTitle,
  Sheet,
} from '../components/ui';
import { useFormatters, useT } from '../i18n';
import { getLastCurrency, setLastCurrency } from '../lib/lastCurrency';
import { deriveCustomShares } from '../lib/customSplit';
import {
  computeAmountBaseMinor,
  formatAmountForDisplay,
  minorToAmountInput,
  parseAmountToMinor,
  sanitizeAmountInput,
} from '../lib/money';
import { useClosingConfirmation } from '../telegram/useClosingConfirmation';
import {
  useMainButtonAvailable,
  useMainButtonSubmit,
} from '../telegram/useMainButtonSubmit';
import './screens.css';

const SPLIT_MODES: { mode: SplitMode; labelKey: string }[] = [
  { mode: 'equal', labelKey: 'expense.splitEqual' },
  { mode: 'solo', labelKey: 'expense.splitSolo' },
  { mode: 'custom', labelKey: 'expense.splitCustom' },
];

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Horizontal chip picker reused for both "paid by" and the solo beneficiary — plan §8's "one tap to switch". */
function MemberChipRow({
  members,
  selectedId,
  onSelect,
}: {
  members: TripMemberView[];
  selectedId: number | undefined;
  onSelect: (userId: number) => void;
}) {
  return (
    <ChipRow centered>
      {members.map((member) => (
        <Chip
          key={member.id}
          selected={member.id === selectedId}
          onClick={() => onSelect(member.id)}
        >
          {member.firstName}
        </Chip>
      ))}
    </ChipRow>
  );
}

export function AddExpenseSheet() {
  const navigate = useNavigate();
  const { expenseId } = useParams<{ expenseId?: string }>();
  const isEditing = expenseId !== undefined;
  const t = useT();
  const { money } = useFormatters();

  const { me, tripId, trip } = useCurrentTrip();
  const createExpense = useCreateExpense(tripId);
  const updateExpense = useUpdateExpense(tripId);
  const deleteExpense = useDeleteExpense(tripId);

  const existingExpense = useMemo(
    () => (isEditing ? trip.data?.expenses.find((e) => e.id === expenseId) : undefined),
    [isEditing, trip.data, expenseId],
  );

  // --- Form state ------------------------------------------------------
  const [amountInput, setAmountInput] = useState('');
  const [currency, setCurrency] = useState('USD');
  // `true` = a "planned" expense (budgeted, no payer yet, excluded from
  // balances until a payer is assigned). Defaults to false (paid), so the
  // normal happy path is unchanged.
  const [isPlanned, setIsPlanned] = useState(false);
  const [payerId, setPayerId] = useState<number>();
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [soloBeneficiaryId, setSoloBeneficiaryId] = useState<number>();
  const [customShares, setCustomShares] = useState<Record<number, string>>({});
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [spentOn, setSpentOn] = useState(todayUtcDate());
  const [rateInput, setRateInput] = useState('1');
  const [rateTouched, setRateTouched] = useState(false);
  const [formTouched, setFormTouched] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // `true` once the one-shot prefill below has run. The rate-autofill effect
  // is gated on this (as STATE, not a ref) so it can't fire during the same
  // commit the prefill runs in — otherwise it would autofill from the stale
  // initial `currency` ('USD') using a cached cross-rate and clobber an edited
  // expense's real rate (the UAH-priced-as-USD ×44 bug).
  const [hydrated, setHydrated] = useState(false);

  const initializedRef = useRef(false);

  // Prefill exactly once, as soon as the data this sheet needs is ready —
  // create mode needs the trip + current user; edit mode also needs the
  // expense itself (so it can reconstruct the stored split intent).
  useEffect(() => {
    if (initializedRef.current) return;
    if (!trip.data || !me.data) return;
    if (isEditing && !existingExpense) return;

    initializedRef.current = true;

    if (existingExpense) {
      setAmountInput(
        minorToAmountInput(existingExpense.amountMinor, existingExpense.currency),
      );
      setCurrency(existingExpense.currency);
      setIsPlanned(existingExpense.status === 'planned');
      setPayerId(existingExpense.payerId ?? undefined);
      setSplitMode(existingExpense.splitMode);
      setDescription(existingExpense.description ?? '');
      setCategory(existingExpense.category ?? null);
      setSpentOn(existingExpense.spentOn);
      setRateInput(String(existingExpense.rateToBase));
      setRateTouched(existingExpense.rateOverridden);
      if (existingExpense.splitMode === 'solo') {
        setSoloBeneficiaryId(existingExpense.shares[0]?.userId);
      }
      if (existingExpense.splitMode === 'custom') {
        const shares: Record<number, string> = {};
        for (const share of existingExpense.shares) {
          shares[share.userId] = minorToAmountInput(
            share.shareMinor,
            existingExpense.currency,
          );
        }
        setCustomShares(shares);
      }
    } else {
      setCurrency(getLastCurrency() ?? trip.data.baseCurrency);
      setPayerId(me.data.user.id);
      setSoloBeneficiaryId(me.data.user.id);
    }
    // Marks the end of prefill: only now may the rate-autofill effect run,
    // so it never races the currency/rateTouched values set just above.
    setHydrated(true);
  }, [trip.data, me.data, isEditing, existingExpense]);

  const members = trip.data?.members ?? [];
  const baseCurrency = trip.data?.baseCurrency;
  const needsRate = baseCurrency !== undefined && currency !== baseCurrency;

  // Phase 5.7: instant local-cache rate prefill. Only fetched when it's
  // actually needed (different currency than the trip base).
  const rateQuery = useRate(
    needsRate && baseCurrency
      ? { date: spentOn, currency, base: baseCurrency }
      : undefined,
  );

  // Prefill the rate field from the fetched cross-rate as long as the user
  // hasn't manually edited it — an edit (rateTouched) always wins.
  useEffect(() => {
    if (!hydrated || !needsRate || rateTouched || rateQuery.data === undefined) return;
    setRateInput(String(rateQuery.data.rate));
  }, [hydrated, needsRate, rateTouched, rateQuery.data]);

  const amountMinor = parseAmountToMinor(amountInput, currency);

  const parsedRateForPreview = Number(rateInput);
  const previewBaseMinor =
    needsRate &&
    baseCurrency &&
    amountMinor !== undefined &&
    Number.isFinite(parsedRateForPreview) &&
    parsedRateForPreview > 0
      ? computeAmountBaseMinor(amountMinor, currency, baseCurrency, parsedRateForPreview)
      : undefined;

  // Custom split (derived model): `customShares` holds only the values the user
  // typed (locked); everyone else auto-splits the remainder. Display values,
  // the total, and the submitted shares all come from `derivedShares`, so a
  // locked field is never overwritten and — as long as one member is still
  // auto — the shares always sum to the amount exactly.
  const lockedMinor: Record<number, number> = {};
  for (const [id, raw] of Object.entries(customShares)) {
    if (raw.trim() === '') continue; // empty = auto, not a locked 0
    lockedMinor[Number(id)] = parseAmountToMinor(raw, currency) ?? 0;
  }
  const derivedShares =
    amountMinor !== undefined
      ? deriveCustomShares(
          members.map((m) => m.id),
          amountMinor,
          lockedMinor,
        )
      : {};
  const customShareTotal = Object.values(derivedShares).reduce((sum, s) => sum + s, 0);
  const splitDiff = amountMinor !== undefined ? customShareTotal - amountMinor : 0;

  function markTouched() {
    if (!formTouched) setFormTouched(true);
  }

  function handleAmountChange(value: string) {
    setAmountInput(sanitizeAmountInput(value));
    markTouched();
  }

  function handleCurrencyChange(code: string) {
    setCurrency(code);
    // A manual rate override was tied to the *previous* currency's rate —
    // switching currency should re-prefill from the fresh cross-rate.
    setRateTouched(false);
    markTouched();
  }

  function handleSplitModeChange(mode: SplitMode) {
    setSplitMode(mode);
    markTouched();
    // No prefill needed: with nothing locked, the derived model already shows
    // an equal split as the starting point, and each field the user types locks
    // that member while the rest auto-rebalance to the remainder.
  }

  function buildRequestBody(): CreateExpenseRequest | undefined {
    setErrorMessage(undefined);

    if (amountMinor === undefined || amountMinor <= 0) {
      setErrorMessage(t('expense.errorInvalidAmount'));
      return undefined;
    }
    // A planned expense has no payer yet; only a paid one must name who paid.
    if (!isPlanned && payerId === undefined) {
      setErrorMessage(t('expense.errorPickPayer'));
      return undefined;
    }

    let shares: CreateExpenseRequest['shares'];
    let beneficiaryId: number | undefined;

    if (splitMode === 'solo') {
      if (soloBeneficiaryId === undefined) {
        setErrorMessage(t('expense.errorPickBeneficiary'));
        return undefined;
      }
      beneficiaryId = soloBeneficiaryId;
    } else if (splitMode === 'custom') {
      if (members.length === 0) {
        setErrorMessage(t('expense.errorNoMembers'));
        return undefined;
      }
      shares = members.map((member) => ({
        userId: member.id,
        shareMinor: derivedShares[member.id] ?? 0,
      }));
      if (customShareTotal !== amountMinor) {
        setErrorMessage(
          t('expense.errorCustomMismatch', {
            actual: money(customShareTotal, currency),
            expected: money(amountMinor, currency),
          }),
        );
        return undefined;
      }
    }

    let rateToBase: number | undefined;
    let rateOverridden: boolean | undefined;
    if (needsRate && rateTouched) {
      const parsedRate = Number(rateInput);
      if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
        setErrorMessage(t('rate.errorInvalid'));
        return undefined;
      }
      rateToBase = parsedRate;
      rateOverridden = true;
    }

    return {
      amountMinor,
      currency,
      // Omit payer entirely when planned → server stores it as 'planned'.
      payerId: isPlanned ? undefined : payerId,
      splitMode,
      shares,
      beneficiaryId,
      description: description.trim() ? description.trim() : null,
      category,
      spentOn,
      rateToBase,
      rateOverridden,
    };
  }

  function handleSubmit() {
    const body = buildRequestBody();
    if (!body) {
      hapticFeedback.notificationOccurred.ifAvailable('error');
      return;
    }
    setLastCurrency(body.currency);

    const onSuccess = () => {
      hapticFeedback.notificationOccurred.ifAvailable('success');
      hideKeyboard.ifAvailable();
      setFormTouched(false);
      navigate(-1);
    };
    const onError = (err: unknown) => {
      hapticFeedback.notificationOccurred.ifAvailable('error');
      setErrorMessage(err instanceof Error ? err.message : t('expense.errorGeneric'));
    };

    if (isEditing && expenseId) {
      updateExpense.mutate({ expenseId, body }, { onSuccess, onError });
    } else {
      createExpense.mutate(body, { onSuccess, onError });
    }
  }

  function handleDelete() {
    if (!expenseId) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    deleteExpense.mutate(expenseId, {
      onSuccess: () => {
        hapticFeedback.notificationOccurred.ifAvailable('success');
        setFormTouched(false);
        navigate(-1);
      },
      onError: (err) => {
        hapticFeedback.notificationOccurred.ifAvailable('error');
        setErrorMessage(
          err instanceof Error ? err.message : t('expense.errorDeleteFailed'),
        );
      },
    });
  }

  /** Rate section footer — Phase 5.7's live "≈ 41.20 EUR" preview + staleness note. */
  function rateFooterText(): string {
    if (rateQuery.isPending && !rateTouched) {
      return t('rate.lookingUp');
    }
    if (previewBaseMinor !== undefined && baseCurrency) {
      const usedStaleRate =
        !rateTouched && rateQuery.data !== undefined && rateQuery.data.date !== spentOn;
      const staleNote = usedStaleRate
        ? t('rate.staleNote', { date: rateQuery.data?.date ?? '' })
        : '';
      return `${t('rate.preview', { amount: money(previewBaseMinor, baseCurrency) })}${staleNote}`;
    }
    if (rateQuery.isError && !rateTouched) {
      return t('rate.noCached');
    }
    return t('rate.enterManually', { currency: baseCurrency ?? '' });
  }

  const isPending = createExpense.isPending || updateExpense.isPending;
  const mainButtonAvailable = useMainButtonAvailable();
  useMainButtonSubmit({
    text: isEditing ? t('expense.save') : t('expense.addTitle'),
    enabled: !isPending,
    onClick: handleSubmit,
  });
  useClosingConfirmation(formTouched);

  const notFound =
    isEditing && !trip.isPending && !trip.isError && trip.data && !existingExpense;

  const close = () => navigate(-1);

  return (
    <Sheet
      title={isEditing ? t('expense.editTitle') : t('expense.addTitle')}
      onClose={close}
    >
      {tripId === undefined && (
        <EmptyState glyph="🧳" description={t('expense.noTripPlaceholder')} />
      )}

      {tripId !== undefined && (trip.isPending || me.isPending) && (
        <div style={{ paddingTop: 12 }}>
          <ListSkeleton rows={4} />
        </div>
      )}

      {tripId !== undefined && trip.isError && (
        <ErrorState
          title={t('expense.loadErrorHeader')}
          description={trip.error.message}
          retryLabel={t('common.retry')}
          onRetry={() => trip.refetch()}
        />
      )}

      {notFound && (
        <EmptyState glyph="🧾" description={t('expense.notFoundPlaceholder')} />
      )}

      {tripId !== undefined && trip.data && me.data && !notFound && (
        <>
          <SectionTitle>{t('expense.amountHeader')}</SectionTitle>
          <div className="ts-card ts-card--pad">
            <Input
              className="ts-amount-input ts-nums"
              placeholder="0.00"
              inputMode="decimal"
              autoFocus={!isEditing}
              value={formatAmountForDisplay(amountInput)}
              onChange={handleAmountChange}
            />
          </div>

          <SectionTitle>{t('expense.currencyHeader')}</SectionTitle>
          <div className="ts-card">
            <CurrencyPicker
              value={currency}
              onChange={handleCurrencyChange}
              extraCodes={[baseCurrency, getLastCurrency()]}
            />
          </div>

          <SectionTitle>{t('expense.statusHeader')}</SectionTitle>
          <div className="ts-card ts-card--pad">
            <Segmented
              block
              value={isPlanned ? 'planned' : 'paid'}
              onChange={(value) => {
                setIsPlanned(value === 'planned');
                markTouched();
              }}
              options={[
                { value: 'paid', label: t('expense.statusPaid') },
                { value: 'planned', label: t('expense.statusPlanned') },
              ]}
            />
          </div>

          {!isPlanned && (
            <>
              <SectionTitle>{t('expense.paidByHeader')}</SectionTitle>
              <div className="ts-card">
                <MemberChipRow
                  members={members}
                  selectedId={payerId}
                  onSelect={(id) => {
                    setPayerId(id);
                    markTouched();
                  }}
                />
              </div>
            </>
          )}

          <SectionTitle>{t('expense.splitHeader')}</SectionTitle>
          <div className="ts-card ts-card--pad">
            <Segmented
              block
              value={splitMode}
              onChange={(value) => handleSplitModeChange(value as SplitMode)}
              options={SPLIT_MODES.map(({ mode, labelKey }) => ({
                value: mode,
                label: t(labelKey),
              }))}
            />
            {splitMode === 'equal' && (
              <div className="ts-inline-hint">
                {t('expense.splitEqualFooter', { count: members.length })}
              </div>
            )}
          </div>

          {splitMode === 'solo' && (
            <div className="ts-card" style={{ marginTop: 8 }}>
              <MemberChipRow
                members={members}
                selectedId={soloBeneficiaryId}
                onSelect={(id) => {
                  setSoloBeneficiaryId(id);
                  markTouched();
                }}
              />
            </div>
          )}

          {splitMode === 'custom' && (
            <List mode="card" style={{ marginTop: 8 }}>
              {members.map((member) => {
                const locked = member.id in customShares;
                const displayRaw = locked
                  ? (customShares[member.id] ?? '')
                  : amountMinor === undefined
                    ? ''
                    : minorToAmountInput(derivedShares[member.id] ?? 0, currency);
                return (
                  <List.Item
                    key={member.id}
                    extra={
                      <div style={{ width: 110 }}>
                        <Input
                          className={locked ? 'ts-nums' : 'ts-nums ts-share-auto'}
                          inputMode="decimal"
                          placeholder="0.00"
                          style={{ '--text-align': 'right' }}
                          value={formatAmountForDisplay(displayRaw)}
                          onChange={(value) => {
                            const raw = sanitizeAmountInput(value);
                            setCustomShares((prev) => {
                              const next = { ...prev };
                              // Clearing a field un-locks the member so they
                              // rejoin the auto-split; typing locks them.
                              if (raw === '') delete next[member.id];
                              else next[member.id] = raw;
                              return next;
                            });
                            markTouched();
                          }}
                        />
                      </div>
                    }
                  >
                    {member.firstName}
                  </List.Item>
                );
              })}
              <List.Item
                description={
                  amountMinor === undefined ? undefined : (
                    <span className={splitDiff === 0 ? 'ts-split-ok' : 'ts-split-warn'}>
                      {splitDiff === 0
                        ? t('expense.splitBalanced')
                        : splitDiff > 0
                          ? t('expense.splitOver', { amount: money(splitDiff, currency) })
                          : t('expense.splitUnder', {
                              amount: money(-splitDiff, currency),
                            })}
                    </span>
                  )
                }
              >
                {t('expense.totalLabel')}
              </List.Item>
            </List>
          )}

          <SectionTitle>{t('expense.descriptionHeader')}</SectionTitle>
          <div className="ts-card ts-card--pad">
            <Input
              placeholder={t('expense.descriptionPlaceholder')}
              value={description}
              onChange={(value) => {
                setDescription(value);
                markTouched();
              }}
            />
          </div>

          <SectionTitle>{t('expense.categoryHeader')}</SectionTitle>
          <div className="ts-card">
            <CategoryGrid>
              {EXPENSE_CATEGORIES.map((emoji) => (
                <CategoryTile
                  key={emoji}
                  selected={category === emoji}
                  glyph={emoji}
                  label={t(EXPENSE_CATEGORY_NAME_KEYS[emoji])}
                  onClick={() => {
                    setCategory(category === emoji ? null : emoji);
                    markTouched();
                  }}
                />
              ))}
            </CategoryGrid>
          </div>

          <SectionTitle>{t('expense.dateHeader')}</SectionTitle>
          <div className="ts-card ts-card--pad">
            <Input
              type="date"
              value={spentOn}
              onChange={(value) => {
                setSpentOn(value);
                markTouched();
              }}
            />
          </div>

          {needsRate && (
            <>
              <SectionTitle>
                {t('rate.header', { currency, base: baseCurrency ?? '' })}
              </SectionTitle>
              <div className="ts-card ts-card--pad">
                <Input
                  className="ts-nums"
                  inputMode="decimal"
                  value={rateInput}
                  onChange={(value) => {
                    setRateInput(value);
                    setRateTouched(true);
                    markTouched();
                  }}
                />
              </div>
              <div className="ts-section-hint">{rateFooterText()}</div>
            </>
          )}

          {errorMessage && (
            <div className="ts-form-error" role="alert">
              ⚠️ {errorMessage}
            </div>
          )}

          {!mainButtonAvailable && (
            <div className="ts-sheet-actions">
              <Button
                color="primary"
                size="large"
                block
                disabled={isPending}
                loading={isPending}
                onClick={handleSubmit}
              >
                {isEditing ? t('expense.save') : t('expense.addTitle')}
              </Button>
            </div>
          )}

          {isEditing && (
            <>
              <div className="ts-sheet-delete">
                <Button
                  color="danger"
                  fill={confirmingDelete ? 'solid' : 'outline'}
                  size="large"
                  block
                  onClick={handleDelete}
                  loading={deleteExpense.isPending}
                >
                  {confirmingDelete ? t('expense.confirmDelete') : t('expense.delete')}
                </Button>
              </div>
              <div className="ts-section-hint">{t('expense.deleteFooter')}</div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

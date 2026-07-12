/**
 * Settlement sheet — Phase 6.3/6.4. Reached from the Balance screen's
 * "Settle" button (`navigate('/settle', { state: {...} })`), prefilled with
 * the suggested transfer's payer (debtor), receiver (creditor), and amount
 * (converted into the trip's base currency — the default settlement
 * currency). The amount is editable, which is what makes a **partial**
 * settlement possible; the currency is also editable (Phase 6.4 — "pay back
 * in THB what was spent in EUR"), reusing the exact same rate-prefill/
 * override machinery `AddExpenseSheet` uses (Phase 5.7) so this stays on the
 * one authoritative conversion path (`resolveRate` server-side).
 *
 * Payer/receiver are NOT editable here — they come from the tapped
 * suggestion, keeping the flow at "tap Settle (1) -> tap the sheet's
 * MainButton (2)" (plan §8's "≤2 taps" requirement). Opening this route
 * directly (no `location.state`) shows a placeholder pointing back at the
 * Balance tab instead of a broken form.
 *
 * Redesigned onto antd-mobile (Popup sheet + card sections), mirroring
 * `AddExpenseSheet`; all form state, validation, the settlement mutation, the
 * rate prefill/preview machinery, and the telegram MainButton wiring are
 * unchanged. Note antd-mobile inputs pass their value directly to `onChange`
 * (not a DOM event).
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Input, List } from 'antd-mobile';
import { hapticFeedback, hideKeyboard } from '@tma.js/sdk-react';
import type { CreateSettlementRequest } from '@tripsplit/shared';
import { useLocation, useNavigate } from 'react-router';

import { useCreateSettlement } from '../api/mutations';
import { useCurrentTrip, useRate } from '../api/queries';
import { CurrencyPicker } from '../components/CurrencyPicker';
import { ListSkeleton } from '../components/ListSkeleton';
import { MemberAvatar } from '../components/MemberAvatar';
import { EmptyState, ErrorState, SectionTitle, Sheet } from '../components/ui';
import { useFormatters, useT } from '../i18n';
import {
  computeAmountBaseMinor,
  computeAmountFromBaseMinor,
  minorToAmountInput,
  parseAmountToMinor,
} from '../lib/money';
import { useClosingConfirmation } from '../telegram/useClosingConfirmation';
import {
  useMainButtonAvailable,
  useMainButtonSubmit,
} from '../telegram/useMainButtonSubmit';
import './screens.css';

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface SettlementPrefill {
  fromUserId: number;
  toUserId: number;
  amountBaseMinor: number;
}

function isSettlementPrefill(value: unknown): value is SettlementPrefill {
  const v = value as Partial<SettlementPrefill> | null | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.fromUserId === 'number' &&
    typeof v.toUserId === 'number' &&
    typeof v.amountBaseMinor === 'number'
  );
}

export function SettlementSheet() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = isSettlementPrefill(location.state) ? location.state : undefined;
  const t = useT();
  const { money } = useFormatters();

  const { tripId, trip } = useCurrentTrip();
  const createSettlement = useCreateSettlement(tripId);

  const [currency, setCurrency] = useState('USD');
  const [amountInput, setAmountInput] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [ready, setReady] = useState(false);
  const [spentOn, setSpentOn] = useState(todayUtcDate());
  const [description, setDescription] = useState('');
  const [rateInput, setRateInput] = useState('1');
  const [rateTouched, setRateTouched] = useState(false);
  const [formTouched, setFormTouched] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (!trip.data) return;
    initializedRef.current = true;

    setCurrency(trip.data.baseCurrency);
    if (prefill) {
      setAmountInput(minorToAmountInput(prefill.amountBaseMinor, trip.data.baseCurrency));
    }
    setReady(true);
  }, [trip.data, prefill]);

  const baseCurrency = trip.data?.baseCurrency;
  const needsRate = baseCurrency !== undefined && currency !== baseCurrency;

  // Phase 6.4: same instant local-cache rate prefill as the add-expense
  // sheet (Phase 5.7) — only fetched when settling in a non-base currency.
  const rateQuery = useRate(
    needsRate && baseCurrency
      ? { date: spentOn, currency, base: baseCurrency }
      : undefined,
  );

  useEffect(() => {
    if (!needsRate || rateTouched || rateQuery.data === undefined) return;
    setRateInput(String(rateQuery.data.rate));
  }, [needsRate, rateTouched, rateQuery.data]);

  // The rate the amount auto-conversion below should use: a manual override
  // when the user typed one, otherwise the prefilled cache rate; `1` when
  // paying in the base currency (no conversion).
  const effectiveRate = !needsRate
    ? 1
    : rateTouched
      ? Number(rateInput)
      : rateQuery.data?.rate;

  // The debt is fixed in the trip's base currency, so when the user switches
  // the settlement currency (and hasn't manually edited the amount), refill
  // the amount with that debt converted into the chosen currency — answering
  // "how much THB clears my €100 debt" instead of silently reinterpreting the
  // same number in the new currency. A manual amount edit (partial settlement)
  // sets `amountTouched` and opts out, leaving the entered value alone.
  useEffect(() => {
    if (!ready || amountTouched || !prefill || baseCurrency === undefined) return;
    if (!needsRate) {
      setAmountInput(minorToAmountInput(prefill.amountBaseMinor, baseCurrency));
      return;
    }
    if (
      effectiveRate === undefined ||
      !Number.isFinite(effectiveRate) ||
      effectiveRate <= 0
    )
      return;
    const converted = computeAmountFromBaseMinor(
      prefill.amountBaseMinor,
      currency,
      baseCurrency,
      effectiveRate,
    );
    if (converted !== undefined) {
      setAmountInput(minorToAmountInput(converted, currency));
    }
  }, [ready, amountTouched, prefill, baseCurrency, needsRate, currency, effectiveRate]);

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

  const members = trip.data?.members ?? [];
  const membersById = new Map(members.map((m) => [m.id, m]));
  const payer = prefill ? membersById.get(prefill.fromUserId) : undefined;
  const receiver = prefill ? membersById.get(prefill.toUserId) : undefined;

  function markTouched() {
    if (!formTouched) setFormTouched(true);
  }

  function buildRequestBody(): CreateSettlementRequest | undefined {
    setErrorMessage(undefined);

    if (!prefill) {
      setErrorMessage(t('settle.openFromBalance'));
      return undefined;
    }
    if (amountMinor === undefined || amountMinor <= 0) {
      setErrorMessage(t('expense.errorInvalidAmount'));
      return undefined;
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
      payerId: prefill.fromUserId,
      receiverId: prefill.toUserId,
      amountMinor,
      currency,
      spentOn,
      description: description.trim() ? description.trim() : null,
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

    createSettlement.mutate(body, {
      onSuccess: () => {
        hapticFeedback.notificationOccurred.ifAvailable('success');
        hideKeyboard.ifAvailable();
        setFormTouched(false);
        navigate(-1);
      },
      onError: (err) => {
        hapticFeedback.notificationOccurred.ifAvailable('error');
        setErrorMessage(err instanceof Error ? err.message : t('settle.errorGeneric'));
      },
    });
  }

  function rateFooterText(): string {
    if (rateQuery.isPending && !rateTouched) {
      return t('rate.lookingUp');
    }
    if (previewBaseMinor !== undefined && baseCurrency) {
      return t('rate.preview', { amount: money(previewBaseMinor, baseCurrency) });
    }
    if (rateQuery.isError && !rateTouched) {
      return t('rate.noCached');
    }
    return t('rate.enterManually', { currency: baseCurrency ?? '' });
  }

  const mainButtonAvailable = useMainButtonAvailable();
  useMainButtonSubmit({
    text: t('settle.confirm'),
    enabled: !createSettlement.isPending && prefill !== undefined,
    onClick: handleSubmit,
  });
  useClosingConfirmation(formTouched);

  return (
    <Sheet title={t('settle.title')} onClose={() => navigate(-1)}>
      {!prefill && <EmptyState glyph="🤝" description={t('settle.openFromBalance')} />}

      {prefill && (trip.isPending || !trip.data) && (
        <div style={{ paddingTop: 12 }}>
          <ListSkeleton rows={3} />
        </div>
      )}

      {prefill && trip.isError && (
        <ErrorState
          title={t('settle.loadErrorHeader')}
          description={trip.error.message}
          retryLabel={t('common.retry')}
          onRetry={() => trip.refetch()}
        />
      )}

      {prefill && trip.data && (
        <>
          <SectionTitle>{t('settle.who')}</SectionTitle>
          <List mode="card">
            <List.Item
              prefix={payer ? <MemberAvatar person={payer} /> : undefined}
              description={t('settle.pays')}
            >
              {payer?.firstName ?? t('common.userFallback', { id: prefill.fromUserId })}
            </List.Item>
            <List.Item
              prefix={receiver ? <MemberAvatar person={receiver} /> : undefined}
              description={t('settle.receives')}
            >
              {receiver?.firstName ?? t('common.userFallback', { id: prefill.toUserId })}
            </List.Item>
          </List>

          <SectionTitle>{t('settle.amountHeader')}</SectionTitle>
          <div className="ts-card ts-card--pad">
            <Input
              className="ts-amount-input ts-nums"
              placeholder="0.00"
              inputMode="decimal"
              autoFocus
              value={amountInput}
              onChange={(value) => {
                setAmountInput(value);
                setAmountTouched(true);
                markTouched();
              }}
            />
          </div>
          <div className="ts-section-hint">{t('settle.amountFooter')}</div>

          <SectionTitle>{t('settle.currencyHeader')}</SectionTitle>
          <div className="ts-card">
            <CurrencyPicker
              value={currency}
              onChange={(code) => {
                setCurrency(code);
                setRateTouched(false);
                markTouched();
              }}
              extraCodes={[baseCurrency]}
            />
          </div>

          <SectionTitle>{t('settle.dateHeader')}</SectionTitle>
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

          <SectionTitle>{t('settle.noteHeader')}</SectionTitle>
          <div className="ts-card ts-card--pad">
            <Input
              placeholder={t('settle.notePlaceholder')}
              value={description}
              onChange={(value) => {
                setDescription(value);
                markTouched();
              }}
            />
          </div>

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
                disabled={createSettlement.isPending}
                loading={createSettlement.isPending}
                onClick={handleSubmit}
              >
                {t('settle.confirm')}
              </Button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

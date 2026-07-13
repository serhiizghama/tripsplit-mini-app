/**
 * Balance dashboard — plan §8 screen 3, Phase 6.2. Talks to `GET
 * /api/trips/:id/balances` (`useBalances`, Phase 6.1) and renders:
 *  - a hero card for the current user's net position, whose gradient hue
 *    encodes the state (green when owed, coral when owing, blue when settled);
 *  - the minimal-transfers list, each row with a "Settle" button that opens
 *    the prefilled settlement sheet (`/settle`, Phase 6.3);
 *  - per-person paid/share totals; and
 *  - the per-currency spend breakdown.
 *
 * Redesigned onto antd-mobile (hero card + card-mode `List`s); all balance
 * math, routing, and i18n are unchanged.
 */
import { Button, List, Toast } from 'antd-mobile';
import type {
  MemberBalance,
  TransferSuggestion,
  TripMemberView,
} from '@tripsplit/shared';
import { useNavigate } from 'react-router';

import { useExportTrip } from '../api/mutations';
import { useBalances, useCurrentTrip } from '../api/queries';
import { ArchivedTripBanner } from '../components/ArchivedTripBanner';
import { ListSkeleton } from '../components/ListSkeleton';
import { MemberAvatar } from '../components/MemberAvatar';
import { TripSwitcherBar } from '../components/TripSwitcherBar';
import { EmptyState, ErrorState, SectionTitle } from '../components/ui';
import { useFormatters, useT } from '../i18n';
import type { Translator } from '../i18n';
import { exportSuccessMessage } from '../lib/exportSummary';
import './screens.css';

function memberFirstName(
  t: Translator,
  member: TripMemberView | undefined,
  userId: number,
): string {
  return member?.firstName ?? t('common.userFallback', { id: userId });
}

function Hero({
  myUserId,
  balances,
  transfers,
  membersById,
  baseCurrency,
}: {
  myUserId: number;
  balances: MemberBalance[];
  transfers: TransferSuggestion[];
  membersById: Map<number, TripMemberView>;
  baseCurrency: string;
}) {
  const t = useT();
  const { money } = useFormatters();
  const mine = balances.find((b) => b.userId === myUserId);
  const net = mine?.netBaseMinor ?? 0;

  if (net === 0) {
    return (
      <div className="ts-hero ts-hero--settled">
        <div className="ts-hero-eyebrow">{t('balance.sectionHeader')}</div>
        <div className="ts-hero-amount ts-nums">{money(0, baseCurrency)}</div>
        <div className="ts-hero-caption">✅ {t('balance.allSettled')}</div>
      </div>
    );
  }

  // With exactly one transfer touching the current user (the common 2-person
  // case), name the counterparty directly. With 3+ members and several
  // transfers, fall back to a plain "You are owed / You owe" total.
  const myTransfers = transfers.filter(
    (tr) => tr.fromUserId === myUserId || tr.toUserId === myUserId,
  );

  let leadText: string;
  if (myTransfers.length === 1) {
    const transfer = myTransfers[0]!;
    const otherId =
      transfer.fromUserId === myUserId ? transfer.toUserId : transfer.fromUserId;
    const otherName = memberFirstName(t, membersById.get(otherId), otherId);
    leadText =
      net > 0
        ? t('balance.owesYou', { name: otherName })
        : t('balance.youOwe', { name: otherName });
  } else {
    leadText = net > 0 ? t('balance.youAreOwedTotal') : t('balance.youOweTotal');
  }

  return (
    <div className={`ts-hero ${net > 0 ? 'ts-hero--owed' : 'ts-hero--owe'}`}>
      <div className="ts-hero-eyebrow">{leadText}</div>
      <div className="ts-hero-amount ts-nums">{money(Math.abs(net), baseCurrency)}</div>
    </div>
  );
}

function TransferRow({
  transfer,
  membersById,
  baseCurrency,
  archived,
  onSettle,
}: {
  transfer: TransferSuggestion;
  membersById: Map<number, TripMemberView>;
  baseCurrency: string;
  archived: boolean;
  onSettle: (transfer: TransferSuggestion) => void;
}) {
  const t = useT();
  const { money } = useFormatters();
  const from = membersById.get(transfer.fromUserId);
  const to = membersById.get(transfer.toUserId);

  return (
    <List.Item
      prefix={from ? <MemberAvatar person={from} size={32} /> : undefined}
      description={`${memberFirstName(t, from, transfer.fromUserId)} → ${memberFirstName(t, to, transfer.toUserId)}`}
      extra={
        archived ? undefined : (
          <Button color="primary" size="small" onClick={() => onSettle(transfer)}>
            {t('balance.settle')}
          </Button>
        )
      }
    >
      <span className="ts-nums">{money(transfer.amountBaseMinor, baseCurrency)}</span>
    </List.Item>
  );
}

/**
 * Thin diverging bar under a person's paid/share line — a glanceable accent
 * for net position, reusing the hero's owed/owe semantic colors. Fill grows
 * from the center baseline: right + green when owed, left + coral when
 * owing, no fill when settled. Purely decorative (the amount is already
 * announced via `extra`), so it's hidden from assistive tech.
 */
function NetBar({
  netBaseMinor,
  maxAbsNet,
}: {
  netBaseMinor: number;
  maxAbsNet: number;
}) {
  if (netBaseMinor === 0) {
    return (
      <div className="ts-net-bar" aria-hidden="true">
        <span className="ts-net-bar-zero" />
      </div>
    );
  }

  const halfPct = maxAbsNet > 0 ? (Math.abs(netBaseMinor) / maxAbsNet) * 50 : 0;
  const isPositive = netBaseMinor > 0;

  return (
    <div className="ts-net-bar" aria-hidden="true">
      <span
        className={`ts-net-bar-fill ${isPositive ? 'ts-net-bar-fill--pos' : 'ts-net-bar-fill--neg'}`}
        style={
          isPositive
            ? { left: '50%', width: `${halfPct}%` }
            : { right: '50%', width: `${halfPct}%` }
        }
      />
    </div>
  );
}

function PersonTotalRow({
  balance,
  member,
  baseCurrency,
  maxAbsNet,
}: {
  balance: MemberBalance;
  member: TripMemberView | undefined;
  baseCurrency: string;
  maxAbsNet: number;
}) {
  const t = useT();
  const { money } = useFormatters();
  const netClass =
    balance.netBaseMinor > 0
      ? 'ts-amount-pos'
      : balance.netBaseMinor < 0
        ? 'ts-amount-neg'
        : '';

  return (
    <List.Item
      prefix={member ? <MemberAvatar person={member} size={36} /> : undefined}
      description={
        <>
          {t('balance.paidShare', {
            paid: money(balance.paidBaseMinor, baseCurrency),
            share: money(balance.owedBaseMinor, baseCurrency),
          })}
          <NetBar netBaseMinor={balance.netBaseMinor} maxAbsNet={maxAbsNet} />
        </>
      }
      extra={
        <span className={`ts-nums ${netClass}`} style={{ fontWeight: 600 }}>
          {balance.netBaseMinor === 0
            ? '—'
            : money(Math.abs(balance.netBaseMinor), baseCurrency)}
        </span>
      }
    >
      {memberFirstName(t, member, balance.userId)}
    </List.Item>
  );
}

/**
 * Posts the trip summary to the linked group chat, falling back to a DM —
 * plan T6. Always shown (works with or without a linked chat, the server
 * decides delivery), so it's a plain button rather than gated on `trip.data`.
 */
function ExportSection({ tripId }: { tripId: string }) {
  const t = useT();
  const exportTrip = useExportTrip(tripId);

  function handleExport() {
    exportTrip.mutate(undefined, {
      onSuccess: (response) => {
        Toast.show({ content: exportSuccessMessage(t, response), position: 'bottom' });
      },
      onError: () => {
        Toast.show({ content: t('balance.exportError'), position: 'bottom' });
      },
    });
  }

  return (
    <>
      <SectionTitle>{t('balance.export')}</SectionTitle>
      <div className="ts-inline-actions" style={{ paddingLeft: 16, paddingRight: 16 }}>
        <Button
          color="primary"
          fill="outline"
          size="small"
          loading={exportTrip.isPending}
          disabled={exportTrip.isPending}
          onClick={handleExport}
        >
          {t('balance.exportAction')}
        </Button>
      </div>
      <div className="ts-section-hint">{t('balance.exportFooter')}</div>
    </>
  );
}

export function BalanceScreen() {
  const navigate = useNavigate();
  const { me, tripId, trip } = useCurrentTrip();
  const balancesQuery = useBalances(tripId);
  const t = useT();
  const { money } = useFormatters();

  if (tripId === undefined) {
    return (
      <>
        <TripSwitcherBar />
        <EmptyState
          glyph="⚖️"
          title={t('balance.noTripHeader')}
          description={t('balance.noTripDescription')}
        />
      </>
    );
  }

  if (trip.isPending || balancesQuery.isPending || me.isPending) {
    return (
      <>
        <TripSwitcherBar />
        <SectionTitle>{t('balance.sectionHeader')}</SectionTitle>
        <ListSkeleton rows={4} />
      </>
    );
  }

  if (trip.isError || balancesQuery.isError || me.isError) {
    const message =
      (trip.isError && trip.error.message) ||
      (balancesQuery.isError && balancesQuery.error.message) ||
      (me.isError && me.error.message) ||
      t('common.somethingWrong');
    return (
      <>
        <TripSwitcherBar />
        <ErrorState
          title={t('balance.loadErrorHeader')}
          description={message}
          retryLabel={t('common.retry')}
          onRetry={() => {
            void trip.refetch();
            void balancesQuery.refetch();
          }}
        />
      </>
    );
  }

  if (!trip.data || !balancesQuery.data || !me.data) return null;

  const { balances, transfers, perCurrency, baseCurrency } = balancesQuery.data;
  const membersById = new Map(trip.data.members.map((m) => [m.id, m]));
  const allSettled = transfers.length === 0;
  const archived = trip.data.archivedAt != null;
  // Shared scale for every row's diverging net bar, so bar lengths are
  // comparable across people rather than each row maxing out on its own.
  const maxAbsNet = Math.max(...balances.map((b) => Math.abs(b.netBaseMinor)), 0);

  function handleSettle(transfer: TransferSuggestion) {
    navigate('/settle', {
      state: {
        fromUserId: transfer.fromUserId,
        toUserId: transfer.toUserId,
        amountBaseMinor: transfer.amountBaseMinor,
      },
    });
  }

  return (
    <>
      <TripSwitcherBar />
      {archived && <ArchivedTripBanner onOpen={() => navigate('/wrap')} />}
      <Hero
        myUserId={me.data.user.id}
        balances={balances}
        transfers={transfers}
        membersById={membersById}
        baseCurrency={baseCurrency}
      />

      {!allSettled && (
        <>
          <SectionTitle>{t('balance.suggestedTransfers')}</SectionTitle>
          <List mode="card">
            {transfers.map((transfer, i) => (
              <TransferRow
                key={`${transfer.fromUserId}-${transfer.toUserId}-${i}`}
                transfer={transfer}
                membersById={membersById}
                baseCurrency={baseCurrency}
                archived={archived}
                onSettle={handleSettle}
              />
            ))}
          </List>
          <div className="ts-section-hint">{t('balance.suggestedTransfersFooter')}</div>
        </>
      )}

      <SectionTitle>{t('balance.perPerson')}</SectionTitle>
      <List mode="card">
        {balances.map((b) => (
          <PersonTotalRow
            key={b.userId}
            balance={b}
            member={membersById.get(b.userId)}
            baseCurrency={baseCurrency}
            maxAbsNet={maxAbsNet}
          />
        ))}
      </List>
      <div className="ts-section-hint">
        {t('balance.perPersonFooter', { currency: baseCurrency })}
      </div>

      {perCurrency.length > 0 && (
        <>
          <SectionTitle>{t('balance.spendByCurrency')}</SectionTitle>
          <List mode="card">
            {perCurrency.map((c) => (
              <List.Item
                key={c.currency}
                extra={<span className="ts-nums">{money(c.totalMinor, c.currency)}</span>}
              >
                {c.currency}
              </List.Item>
            ))}
          </List>
          <div className="ts-section-hint">{t('balance.spendByCurrencyFooter')}</div>
        </>
      )}

      <ExportSection tripId={tripId} />
      <div style={{ height: 12 }} />
    </>
  );
}

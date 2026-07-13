/**
 * Trip Wrap — the celebratory "Trip Wrapped" report (`docs/TRIP_WRAP_PLAN.md`
 * task W3). Talks to `GET /api/trips/:id/wrap` (`useTripWrap`) and renders a
 * confetti burst (archived trips only — see `ConfettiBurst`), a hero card,
 * the earned awards, a static per-member paid/share table, the settle state,
 * and a "share to chat" action. Reachable on an active trip too as a live
 * preview — `getTripWrap` (server) computes the same payload either way.
 *
 * Standalone route (`/wrap`), same `Sheet`-as-route structure as
 * `SettlementSheet`/`TripSwitcherSheet`. Wiring the "Finish trip" button
 * that navigates here, plus archived-state banners elsewhere, is task W4 —
 * this screen only needs to be complete and routable on its own.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, List, Toast } from 'antd-mobile';
import type {
  TransferSuggestion,
  TripDetail,
  TripMemberView,
  TripWrapResponse,
  WrapAward,
  WrapMemberRow,
} from '@tripsplit/shared';
import { useNavigate } from 'react-router';

import { useShareWrap } from '../api/mutations';
import { useCurrentTrip, useTripWrap } from '../api/queries';
import { ConfettiBurst } from '../components/ConfettiBurst';
import { ListSkeleton } from '../components/ListSkeleton';
import { MemberAvatar } from '../components/MemberAvatar';
import { EmptyState, ErrorState, SectionTitle, Sheet } from '../components/ui';
import { useFormatters, useT } from '../i18n';
import type { Translator } from '../i18n';
import { wrapAwardEmoji, wrapAwardTitle, wrapAwardValueLine } from '../lib/wrapAwards';
import './screens.css';

function memberFirstName(
  t: Translator,
  member: TripMemberView | undefined,
  userId: number,
): string {
  return member?.firstName ?? t('common.userFallback', { id: userId });
}

function Hero({ wrap }: { wrap: TripWrapResponse }) {
  const t = useT();
  const { money, shortDate } = useFormatters();

  const dateRange =
    wrap.firstSpentOn === null || wrap.lastSpentOn === null
      ? undefined
      : wrap.firstSpentOn === wrap.lastSpentOn
        ? shortDate(wrap.firstSpentOn)
        : `${shortDate(wrap.firstSpentOn)} – ${shortDate(wrap.lastSpentOn)}`;

  return (
    <div className="ts-hero ts-hero--wrap">
      <div className="ts-hero-eyebrow">🏁 {wrap.title}</div>
      {dateRange && <div className="ts-hero-sub">{dateRange}</div>}
      <div className="ts-hero-amount ts-nums">
        {money(wrap.totalBaseMinor, wrap.baseCurrency)}
      </div>
      <div className="ts-hero-caption">
        {t('feed.expenseCount', { count: wrap.expenseCount })} ·{' '}
        {t('wrap.dayCount', { count: wrap.dayCount })} ·{' '}
        {t('wrap.currencyCount', { count: wrap.currenciesUsed })}
      </div>
    </div>
  );
}

function AwardRow({
  award,
  membersById,
  baseCurrency,
}: {
  award: WrapAward;
  membersById: Map<number, TripMemberView>;
  baseCurrency: string;
}) {
  const t = useT();
  const { money, dayHeader } = useFormatters();
  const member = award.userId !== undefined ? membersById.get(award.userId) : undefined;
  const name =
    award.userId !== undefined ? memberFirstName(t, member, award.userId) : undefined;

  return (
    <List.Item
      prefix={member ? <MemberAvatar person={member} size={36} /> : undefined}
      description={name}
      extra={
        <span className="ts-nums">
          {wrapAwardValueLine(t, award, { money, date: dayHeader, baseCurrency })}
        </span>
      }
    >
      {wrapAwardEmoji(award)} {wrapAwardTitle(t, award)}
    </List.Item>
  );
}

function MemberRow({
  row,
  member,
  baseCurrency,
}: {
  row: WrapMemberRow;
  member: TripMemberView | undefined;
  baseCurrency: string;
}) {
  const t = useT();
  const { money } = useFormatters();

  return (
    <List.Item
      prefix={member ? <MemberAvatar person={member} size={36} /> : undefined}
      description={t('balance.paidShare', {
        paid: money(row.paidBaseMinor, baseCurrency),
        share: money(row.shareBaseMinor, baseCurrency),
      })}
      extra={<span className="ts-nums">{money(row.paidBaseMinor, baseCurrency)}</span>}
    >
      {memberFirstName(t, member, row.userId)}
    </List.Item>
  );
}

function OutstandingRow({
  transfer,
  membersById,
  baseCurrency,
}: {
  transfer: TransferSuggestion;
  membersById: Map<number, TripMemberView>;
  baseCurrency: string;
}) {
  const t = useT();
  const { money } = useFormatters();
  const from = membersById.get(transfer.fromUserId);
  const to = membersById.get(transfer.toUserId);

  return (
    <List.Item
      prefix={from ? <MemberAvatar person={from} size={32} /> : undefined}
      extra={
        <span className="ts-nums">{money(transfer.amountBaseMinor, baseCurrency)}</span>
      }
    >
      {memberFirstName(t, from, transfer.fromUserId)} →{' '}
      {memberFirstName(t, to, transfer.toUserId)}
    </List.Item>
  );
}

/**
 * "Share to chat" action — reposts the farewell card, mirroring
 * `BalanceScreen`'s `ExportSection` (same success/error toast shape, its own
 * `wrap.*` copy since the card's content differs from the running summary).
 */
function ShareSection({ tripId, archived }: { tripId: string; archived: boolean }) {
  const t = useT();
  const shareWrap = useShareWrap(tripId);

  function handleShare() {
    shareWrap.mutate(undefined, {
      onSuccess: (response) => {
        Toast.show({
          content:
            response.delivered === 'group'
              ? t('wrap.shareSuccessGroup')
              : t('wrap.shareSuccessDm'),
          position: 'bottom',
        });
      },
      onError: () => {
        Toast.show({ content: t('wrap.shareError'), position: 'bottom' });
      },
    });
  }

  return (
    <>
      <SectionTitle>{t('wrap.share')}</SectionTitle>
      <div className="ts-inline-actions" style={{ paddingLeft: 16, paddingRight: 16 }}>
        <Button
          color="primary"
          fill="outline"
          size="small"
          loading={shareWrap.isPending}
          disabled={shareWrap.isPending}
          onClick={handleShare}
        >
          {t('wrap.shareAction')}
        </Button>
      </div>
      <div className="ts-section-hint">{t('wrap.shareFooter')}</div>
      {!archived && <div className="ts-section-hint">🔍 {t('wrap.previewNotice')}</div>}
    </>
  );
}

function WrapContent({
  tripId,
  trip,
  wrap,
}: {
  tripId: string;
  trip: TripDetail;
  wrap: TripWrapResponse;
}) {
  const t = useT();
  const membersById = new Map(trip.members.map((m) => [m.id, m]));
  const archived = wrap.archivedAt !== null;

  return (
    <>
      <Hero wrap={wrap} />

      {wrap.awards.length > 0 && (
        <>
          <SectionTitle>{t('wrap.awardsHeader')}</SectionTitle>
          <List mode="card">
            {wrap.awards.map((award, i) => (
              <AwardRow
                key={`${award.kind}-${i}`}
                award={award}
                membersById={membersById}
                baseCurrency={wrap.baseCurrency}
              />
            ))}
          </List>
        </>
      )}

      <SectionTitle>{t('stats.byMember')}</SectionTitle>
      <List mode="card">
        {wrap.members.map((row) => (
          <MemberRow
            key={row.userId}
            row={row}
            member={membersById.get(row.userId)}
            baseCurrency={wrap.baseCurrency}
          />
        ))}
      </List>

      {wrap.settled ? (
        <div
          className="ts-card ts-card--pad"
          style={{ margin: '20px 16px 4px', textAlign: 'center', fontWeight: 600 }}
        >
          ✅ {t('wrap.settled')}
        </div>
      ) : (
        <>
          <SectionTitle>{t('wrap.outstandingHeader')}</SectionTitle>
          <List mode="card">
            {wrap.outstandingTransfers.map((transfer, i) => (
              <OutstandingRow
                key={`${transfer.fromUserId}-${transfer.toUserId}-${i}`}
                transfer={transfer}
                membersById={membersById}
                baseCurrency={wrap.baseCurrency}
              />
            ))}
          </List>
        </>
      )}

      <ShareSection tripId={tripId} archived={archived} />
      <div style={{ height: 12 }} />
    </>
  );
}

export function WrapScreen() {
  const navigate = useNavigate();
  const { tripId, trip } = useCurrentTrip();
  const wrap = useTripWrap(tripId);
  const t = useT();

  // Fire the confetti burst once, only for an archived trip (arriving after
  // close, or revisiting a finished one) — never for the active-trip
  // preview. Guarded by a ref so a background refetch of `wrap` can't
  // re-trigger it.
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiFiredRef = useRef(false);
  useEffect(() => {
    if (confettiFiredRef.current || !wrap.data) return;
    confettiFiredRef.current = true;
    if (wrap.data.archivedAt) setShowConfetti(true);
  }, [wrap.data]);

  return (
    <Sheet title={t('wrap.title')} onClose={() => navigate(-1)}>
      {showConfetti && <ConfettiBurst onDone={() => setShowConfetti(false)} />}

      {tripId === undefined && (
        <EmptyState
          glyph="🏁"
          title={t('wrap.noTripHeader')}
          description={t('wrap.noTripDescription')}
        />
      )}

      {tripId !== undefined && (trip.isPending || wrap.isPending) && (
        <div style={{ paddingTop: 12 }}>
          <ListSkeleton rows={4} />
        </div>
      )}

      {tripId !== undefined && (trip.isError || wrap.isError) && (
        <ErrorState
          title={t('wrap.loadErrorHeader')}
          description={
            (trip.isError && trip.error.message) ||
            (wrap.isError && wrap.error.message) ||
            t('common.somethingWrong')
          }
          retryLabel={t('common.retry')}
          onRetry={() => {
            void trip.refetch();
            void wrap.refetch();
          }}
        />
      )}

      {tripId !== undefined && trip.data && wrap.data && (
        <WrapContent tripId={tripId} trip={trip.data} wrap={wrap.data} />
      )}
    </Sheet>
  );
}

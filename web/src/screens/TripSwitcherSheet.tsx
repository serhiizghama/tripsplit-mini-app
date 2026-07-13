/**
 * Trip switcher — route `/trips`, the visible UI for Phase A's active-trip
 * plumbing (`lib/activeTrip.ts`). Reached by tapping `TripSwitcherBar` (Feed/
 * Balance/Stats) or the Settings "switch or add trip" row. Lists every trip
 * from `/api/me`, lets the user tap one to make it active, and offers a
 * shortcut to create another.
 *
 * Mirrors `SettlementSheet`'s Sheet-as-route structure. Deliberately minimal
 * per this phase's scope: no join-by-code (invite links already cover that),
 * no per-trip balances or member avatars (deferred) — just title, member
 * count, and base currency, plus a checkmark on whichever row is active.
 */
import { Button, List } from 'antd-mobile';
import { CheckOutline } from 'antd-mobile-icons';
import { hapticFeedback } from '@tma.js/sdk-react';
import type { TripSummary } from '@tripsplit/shared';
import { useNavigate } from 'react-router';

import { useMe } from '../api/queries';
import { ListSkeleton } from '../components/ListSkeleton';
import { EmptyState, ErrorState, Sheet } from '../components/ui';
import { useT } from '../i18n';
import { resolveActiveTripId, useActiveTrip } from '../lib/activeTrip';
import { AVATAR_COLORS } from '../lib/avatarPerson';
import './screens.css';

/** Deterministic string hash (djb2-ish) so a trip id maps to a stable color/letter tile. */
function hashTripId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Rounded-square tile with the trip title's first letter — imitates
 * `MemberAvatar`'s initials-circle fallback (same palette) but square, so a
 * trip row never reads as a person row. */
function TripTile({ trip }: { trip: TripSummary }) {
  const color = AVATAR_COLORS[hashTripId(trip.id) % AVATAR_COLORS.length]!;
  const letter = trip.title.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="ts-trip-tile" style={{ background: color }} aria-hidden="true">
      {letter}
    </div>
  );
}

function TripRow({
  trip,
  isActive,
  onSelect,
}: {
  trip: TripSummary;
  isActive: boolean;
  onSelect: (trip: TripSummary) => void;
}) {
  const t = useT();
  const archived = trip.archivedAt != null;
  const description = `${t('settings.memberCount', { count: trip.memberCount })} · ${trip.baseCurrency}${
    archived ? ` · ${t('trips.finishedSuffix')}` : ''
  }`;

  return (
    <List.Item
      prefix={<TripTile trip={trip} />}
      description={description}
      extra={
        isActive ? (
          <CheckOutline className="ts-trip-check" aria-label={t('trips.activeAria')} />
        ) : undefined
      }
      clickable
      arrowIcon={false}
      onClick={() => onSelect(trip)}
    >
      <span className={archived ? 'ts-trip-title--archived' : undefined}>
        {archived && '🏁 '}
        {trip.title}
      </span>
    </List.Item>
  );
}

export function TripSwitcherSheet() {
  const navigate = useNavigate();
  const t = useT();
  const me = useMe();
  const { activeTripId, setActiveTripId } = useActiveTrip();

  const trips = me.data?.trips ?? [];
  const currentActiveId = resolveActiveTripId(trips, activeTripId);

  function handleSelect(trip: TripSummary) {
    if (trip.id !== currentActiveId) {
      setActiveTripId(trip.id);
      hapticFeedback.selectionChanged.ifAvailable();
    }
    navigate(-1);
  }

  return (
    <Sheet title={t('trips.title')} onClose={() => navigate(-1)}>
      {me.isPending && (
        <div style={{ paddingTop: 12 }}>
          <ListSkeleton rows={3} />
        </div>
      )}

      {me.isError && (
        <ErrorState
          title={t('common.somethingWrong')}
          description={me.error.message}
          retryLabel={t('common.retry')}
          onRetry={() => me.refetch()}
        />
      )}

      {me.data && trips.length === 0 && (
        <EmptyState glyph="🧳" description={t('feed.noTripDescription')} />
      )}

      {me.data && trips.length > 0 && (
        <List mode="card">
          {trips.map((trip) => (
            <TripRow
              key={trip.id}
              trip={trip}
              isActive={trip.id === currentActiveId}
              onSelect={handleSelect}
            />
          ))}
        </List>
      )}

      <div className="ts-sheet-actions">
        <Button
          color="primary"
          size="large"
          block
          onClick={() => navigate('/create-trip')}
        >
          {t('trips.newTrip')}
        </Button>
      </div>
    </Sheet>
  );
}

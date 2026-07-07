/**
 * Sticky trip-context bar — Phase B (visible UI) on top of the Phase A
 * active-trip plumbing (`lib/activeTrip.ts`). Sits at the very top of every
 * trip screen (Feed/Balance/Stats) in place of the old static `BrandBar`:
 * the brand mark, the active trip's title, and a chevron, tappable to open
 * the trip switcher sheet (`/trips`, `TripSwitcherSheet.tsx`).
 *
 * Resolves the active trip the same way `useCurrentTrip()` does
 * (`resolveActiveTripId`), but only needs `/api/me`'s cheap `TripSummary`
 * list — no need to wait on a full `useTrip()` fetch just to show a title.
 * Renders nothing when the user has no trips yet; trip screens already have
 * their own "no trip" empty states, so there's nothing to switch between.
 */
import { DownOutline } from 'antd-mobile-icons';
import { useNavigate } from 'react-router';

import { useMe } from '../api/queries';
import { resolveActiveTripId, useActiveTrip } from '../lib/activeTrip';
import { useT } from '../i18n';
import { LogoMark } from './LogoMark';
import '../screens/screens.css';

export function TripSwitcherBar() {
  const navigate = useNavigate();
  const t = useT();
  const me = useMe();
  const { activeTripId } = useActiveTrip();

  const trips = me.data?.trips ?? [];
  const activeId = resolveActiveTripId(trips, activeTripId);
  const active = trips.find((trip) => trip.id === activeId);

  if (!active) return null;

  return (
    <button
      type="button"
      className="ts-tripbar"
      aria-label={t('trips.switchAria')}
      onClick={() => navigate('/trips')}
    >
      <LogoMark size={24} />
      <span className="ts-tripbar-text">
        <span className="ts-tripbar-title">
          {active.title}
          <DownOutline className="ts-tripbar-chevron" />
        </span>
        <span className="ts-tripbar-sub">
          {t('settings.memberCount', { count: active.memberCount })} · {active.baseCurrency}
        </span>
      </span>
    </button>
  );
}

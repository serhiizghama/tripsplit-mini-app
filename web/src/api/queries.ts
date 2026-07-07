import { useQuery } from '@tanstack/react-query';
import type {
  BalancesResponse,
  InsightsResponse,
  MeResponse,
  TripDetail,
  TripJoinInfo,
} from '@tripsplit/shared';

import { resolveActiveTripId, useActiveTrip } from '../lib/activeTrip';
import { apiClient, type ApiError } from './client';

export const meQueryKey = ['me'] as const;

/**
 * `GET /api/me` — current Telegram user + their trips (Phase 1). This is the
 * proof that the end-to-end auth path works: whatever renders `data.user`
 * came back from the server after a real `Authorization: tma ...` round trip.
 */
export function useMe() {
  return useQuery<MeResponse, ApiError>({
    queryKey: meQueryKey,
    queryFn: () => apiClient.get<MeResponse>('/me'),
  });
}

export const tripQueryKey = (tripId: string) => ['trips', tripId] as const;

/**
 * `GET /api/trips/:id` — full trip detail (members, invite link; `expenses`
 * is always `[]` until Phase 4). Membership-checked server-side, so a 403
 * surfaces here as `ApiError` like any other failure.
 */
export function useTrip(tripId: string | undefined) {
  return useQuery<TripDetail, ApiError>({
    queryKey: tripQueryKey(tripId ?? 'none'),
    queryFn: () => apiClient.get<TripDetail>(`/trips/${tripId}`),
    enabled: tripId !== undefined,
  });
}

/**
 * There is no multi-trip switcher UI yet (plan §13: post-MVP), but the id it
 * will switch is already plumbed through `lib/activeTrip.ts`: every screen
 * that needs "the" trip resolves against the persisted active-trip id,
 * falling back to the first entry in `/api/me`'s `trips` list (same default
 * as before) when nothing's stored or the stored id no longer matches a
 * trip the user belongs to. Centralized here so Phase 4+ only has to wire up
 * the switcher UI itself once it exists.
 */
export function useCurrentTrip() {
  const me = useMe();
  const { activeTripId } = useActiveTrip();
  const tripId = resolveActiveTripId(me.data?.trips ?? [], activeTripId);
  const trip = useTrip(tripId);
  return { me, tripId, trip };
}

/**
 * `GET /api/trips/join-info?code=` — invite preview (Phase 3.3). Lets the
 * join screen show which trip + who created it before the user commits. A
 * 404 (unknown/expired code) surfaces as `ApiError` like any other failure.
 */
export function useTripJoinInfo(code: string | undefined) {
  return useQuery<TripJoinInfo, ApiError>({
    queryKey: ['trips', 'join-info', code] as const,
    queryFn: () => apiClient.get<TripJoinInfo>(`/trips/join-info?code=${encodeURIComponent(code!)}`),
    enabled: code !== undefined,
    retry: false,
  });
}

export const balancesQueryKey = (tripId: string) => ['trips', tripId, 'balances'] as const;

/**
 * `GET /api/trips/:id/balances` — Phase 6.1/§5. Its own query (rather than
 * embedded in `useTrip`) since `TripDetail` deliberately doesn't carry
 * balances (see that type's doc comment, `@tripsplit/shared`) — the feed
 * screen refetches the trip constantly (every expense add/edit/delete) and
 * never needs this, while the balance screen wants it fresh whenever a
 * settlement is created (`useCreateSettlement`, mutations.ts, invalidates
 * this exact key).
 */
export function useBalances(tripId: string | undefined) {
  return useQuery<BalancesResponse, ApiError>({
    queryKey: balancesQueryKey(tripId ?? 'none'),
    queryFn: () => apiClient.get<BalancesResponse>(`/trips/${tripId}/balances`),
    enabled: tripId !== undefined,
  });
}

export const insightsQueryKey = (tripId: string) => ['trips', tripId, 'insights'] as const;

/**
 * `GET /api/trips/:id/insights` — the Statistics tab's data source. Its own
 * query (rather than embedded in `useTrip`), same reasoning as `useBalances`:
 * the feed refetches `useTrip` constantly and never needs this aggregate.
 */
export function useInsights(tripId: string | undefined) {
  return useQuery<InsightsResponse, ApiError>({
    queryKey: insightsQueryKey(tripId ?? 'none'),
    queryFn: () => apiClient.get<InsightsResponse>(`/trips/${tripId}/insights`),
    enabled: tripId !== undefined,
  });
}

/** `GET /api/rates` response shape — Phase 5.4. */
export interface RateLookup {
  date: string;
  currency: string;
  base: string;
  rate: number;
  source: string;
}

/**
 * `GET /api/rates?date=&currency=&base=` — Phase 5.4/5.7. Backs the
 * add-expense sheet's rate-field prefill: the server only ever reads its
 * local SQLite cache for this route (`lib/rates.ts`'s `getCrossRateLocal`),
 * so this resolves near-instantly with no external call in the hot path.
 * Pass `undefined` to skip the lookup entirely (same-currency expenses never
 * need it — `AddExpenseSheet` only calls this when `currency !== baseCurrency`).
 */
export function useRate(
  params: { date: string; currency: string; base: string } | undefined,
) {
  return useQuery<RateLookup, ApiError>({
    queryKey: ['rates', params?.date, params?.currency, params?.base] as const,
    queryFn: () =>
      apiClient.get<RateLookup>(
        `/rates?date=${encodeURIComponent(params!.date)}&currency=${encodeURIComponent(
          params!.currency,
        )}&base=${encodeURIComponent(params!.base)}`,
      ),
    enabled: params !== undefined,
    // A given (date, currency, base) triple is effectively immutable for the
    // lifetime of one form-filling session (only a same-day cron refresh —
    // 01:00 UTC — could ever change it), so there's no reason to refetch on
    // every focus/mount once we have it.
    staleTime: 5 * 60 * 1000,
  });
}

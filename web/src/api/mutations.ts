/**
 * Trip/expense-mutating hooks — Phase 3.2/3.3 + Phase 4.2/4.3. Trip
 * mutations invalidate `meQueryKey`: `/api/me`'s trip list (and member
 * counts) changes the moment a trip is created or joined. Expense
 * mutations invalidate that trip's `tripQueryKey` instead — creating/
 * editing/deleting an expense never changes `/api/me`'s shape, only the
 * trip detail's `expenses` array. Either way, the plan's "server is the
 * single source of truth" rule (§3) means we refetch rather than
 * hand-patch the cache.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateExpenseRequest,
  CreateSettlementRequest,
  CreateTripRequest,
  CreateTripResponse,
  ExpenseWithShares,
  ExportTripResponse,
  JoinTripRequest,
  MeResponse,
  TripDetail,
  UpdateExpenseRequest,
  UpdateMeRequest,
} from '@tripsplit/shared';

import { apiClient } from './client';
import { balancesQueryKey, meQueryKey, tripQueryKey } from './queries';

/**
 * `PATCH /api/me` — Phase 7 §9's "user override stored in `users.lang`". The
 * Settings screen's language switcher calls this, then also calls the i18n
 * context's `setLocale()` directly (see `SettingsScreen.tsx`) for instant
 * UI feedback rather than waiting on this invalidation round-trip.
 */
export function useUpdateLang() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeRequest) => apiClient.patch<MeResponse>('/me', body),
    onSuccess: (data) => {
      queryClient.setQueryData(meQueryKey, data);
    },
  });
}

export function useCreateTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTripRequest) =>
      apiClient.post<CreateTripResponse>('/trips', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}

export function useJoinTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: JoinTripRequest) =>
      apiClient.post<TripDetail>('/trips/join', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}

/** `POST /api/trips/:id/expenses` — Phase 4.1. */
export function useCreateExpense(tripId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExpenseRequest) => {
      if (!tripId) return Promise.reject(new Error('No active trip'));
      return apiClient.post<ExpenseWithShares>(`/trips/${tripId}/expenses`, body);
    },
    onSuccess: () => {
      if (tripId) {
        void queryClient.invalidateQueries({ queryKey: tripQueryKey(tripId) });
        // Adding/editing/deleting an expense (incl. assigning a payer to a
        // planned one) changes balances — keep that query fresh too.
        void queryClient.invalidateQueries({ queryKey: balancesQueryKey(tripId) });
      }
    },
  });
}

/** `PATCH /api/expenses/:id` — Phase 4.1/4.4 (edit preserves stored split intent server-side). */
export function useUpdateExpense(tripId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      expenseId,
      body,
    }: {
      expenseId: string;
      body: UpdateExpenseRequest;
    }) => apiClient.patch<ExpenseWithShares>(`/expenses/${expenseId}`, body),
    onSuccess: () => {
      if (tripId) {
        void queryClient.invalidateQueries({ queryKey: tripQueryKey(tripId) });
        // Adding/editing/deleting an expense (incl. assigning a payer to a
        // planned one) changes balances — keep that query fresh too.
        void queryClient.invalidateQueries({ queryKey: balancesQueryKey(tripId) });
      }
    },
  });
}

/** `DELETE /api/expenses/:id` — Phase 4.1 soft delete. */
export function useDeleteExpense(tripId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => apiClient.delete<void>(`/expenses/${expenseId}`),
    onSuccess: () => {
      if (tripId) {
        void queryClient.invalidateQueries({ queryKey: tripQueryKey(tripId) });
        // Adding/editing/deleting an expense (incl. assigning a payer to a
        // planned one) changes balances — keep that query fresh too.
        void queryClient.invalidateQueries({ queryKey: balancesQueryKey(tripId) });
      }
    },
  });
}

/**
 * `POST /api/trips/:id/settlements` — Phase 6.3/6.4. Invalidates both the
 * trip detail (settlements show up in the feed, same as expenses) and the
 * balances query (this is the whole point — settling should move the
 * balance screen's numbers) rather than hand-patching either cache, per the
 * app's "server is the single source of truth" rule (plan §3).
 */
export function useCreateSettlement(tripId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSettlementRequest) => {
      if (!tripId) return Promise.reject(new Error('No active trip'));
      return apiClient.post<ExpenseWithShares>(`/trips/${tripId}/settlements`, body);
    },
    onSuccess: () => {
      if (tripId) {
        void queryClient.invalidateQueries({ queryKey: tripQueryKey(tripId) });
        void queryClient.invalidateQueries({ queryKey: balancesQueryKey(tripId) });
      }
    },
  });
}

/**
 * `POST /api/trips/:id/export` — Export & Group Nudges plan T6. No cache to
 * invalidate: posting/DM-ing a summary doesn't change any trip/balance state.
 * `meta: { silent: true }` — the caller shows its own localized error toast,
 * see `queryClient.ts`'s `mutationCache`.
 */
export function useExportTrip(tripId: string | undefined) {
  return useMutation({
    mutationFn: () => {
      if (!tripId) return Promise.reject(new Error('No active trip'));
      return apiClient.post<ExportTripResponse>(`/trips/${tripId}/export`);
    },
    meta: { silent: true },
  });
}

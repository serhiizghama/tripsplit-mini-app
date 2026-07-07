import { useEffect, useState } from 'react';
import { ConfigProvider } from 'antd-mobile';
import enUS from 'antd-mobile/es/locales/en-US';
import ruRU from 'antd-mobile/es/locales/ru-RU';
import { BrowserRouter, Route, Routes } from 'react-router';

import { AppShell } from './components/AppShell';
import { useLocale } from './i18n';
import { isAuthExpired, subscribeAuthExpired } from './lib/authExpiredBus';
import { AddExpenseSheet } from './screens/AddExpenseSheet';
import { BalanceScreen } from './screens/BalanceScreen';
import { CreateTripPlaceholder } from './screens/CreateTripPlaceholder';
import { FeedScreen } from './screens/FeedScreen';
import { InviteJoinScreen } from './screens/InviteJoinScreen';
import { SessionExpiredScreen } from './screens/SessionExpiredScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SettlementSheet } from './screens/SettlementSheet';
import { StatsScreen } from './screens/StatsScreen';
import { TripSwitcherSheet } from './screens/TripSwitcherSheet';

/**
 * App skeleton: Feed / Balance / Stats / Settings behind the bottom-nav shell, plus
 * the create-trip and invite/join stubs the Phase 2.4 launch router can
 * land on. `/add-expense` and `/expense/:expenseId` are standalone routes
 * (rendered as a `Modal`, not inside the tabbed shell) — both render the
 * same `AddExpenseSheet`, which tells create/edit apart via the
 * `expenseId` route param (Phase 4.2/4.4). `/settle` (Phase 6.3) is the same
 * kind of standalone modal route, reached only via the Balance screen's
 * "Settle" button (which passes the prefilled transfer through router
 * `state`) — see `SettlementSheet`. `/trips` (trip switcher) is the same
 * pattern again — reached from `TripSwitcherBar` or the Settings "switch or
 * add trip" row — see `TripSwitcherSheet`.
 */
function App() {
  // Phase 8.4: a 401 from any query/mutation (`api/queryClient.ts`'s
  // `handleQueryError`, via `authExpiredBus`) means Telegram's initData went
  // stale mid-session — swap the ENTIRE router tree for a friendly "reopen
  // the app" screen rather than let whatever partial data was on screen
  // look broken. Checked once here, above the router, so it wins regardless
  // of which screen the user was on when the 401 hit.
  const [sessionExpired, setSessionExpired] = useState(isAuthExpired);
  useEffect(() => subscribeAuthExpired(setSessionExpired), []);

  // Dismiss the instant boot splash (see index.html) once the app has
  // committed its first frame. The splash lives outside #root, so React never
  // touches it — we fade it out here and drop the node after the transition.
  useEffect(() => {
    const el = document.getElementById('ts-splash');
    if (!el) return;
    el.classList.add('is-hidden');
    const remove = () => el.remove();
    el.addEventListener('transitionend', remove, { once: true });
    const fallback = window.setTimeout(remove, 600); // reduced-motion: no transitionend
    return () => window.clearTimeout(fallback);
  }, []);

  // antd-mobile's built-in component text (Dialog cancel, SwipeAction, etc.)
  // follows the app locale. It ships en/ru but no Ukrainian bundle, so `uk`
  // falls back to English — every app-authored string is still translated by
  // our own i18n regardless.
  const [locale] = useLocale();
  const admLocale = locale === 'ru' ? ruRU : enUS;

  if (sessionExpired) {
    return (
      <ConfigProvider locale={admLocale}>
        <SessionExpiredScreen />
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider locale={admLocale}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<FeedScreen />} />
            <Route path="balance" element={<BalanceScreen />} />
            <Route path="stats" element={<StatsScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="create-trip" element={<CreateTripPlaceholder />} />
            <Route path="join" element={<InviteJoinScreen />} />
          </Route>
          <Route path="add-expense" element={<AddExpenseSheet />} />
          <Route path="expense/:expenseId" element={<AddExpenseSheet />} />
          <Route path="settle" element={<SettlementSheet />} />
          <Route path="trips" element={<TripSwitcherSheet />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;

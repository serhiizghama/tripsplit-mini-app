/**
 * App shell — bottom navigation (Feed / Balance / Stats / Settings) + the
 * Phase 2.4 launch-routing gate. Phase 3+ screens (trips, invites, avatars) mount
 * inside the same shell via the router's `<Outlet />`.
 *
 * Redesigned onto antd-mobile's `TabBar` (mobile.ant.design); all launch
 * routing, locale sync, and haptics are unchanged.
 */
import { useEffect, useRef } from 'react';
import { TabBar } from 'antd-mobile';
import { BillOutline, PayCircleOutline, PieOutline, SetOutline } from 'antd-mobile-icons';
import { hapticFeedback } from '@tma.js/sdk-react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { useMe } from '../api/queries';
import { isSupportedLocale, useLocale, useT } from '../i18n';
import { getStartParam, isLikelyInviteCode } from '../telegram/launchData';
import { ToastHost } from './ToastHost';
import './AppShell.css';

const TAB_PATHS = ['/', '/balance', '/stats', '/settings'] as const;
type TabPath = (typeof TAB_PATHS)[number];

const TAB_ICONS: Record<TabPath, JSX.Element> = {
  '/': <BillOutline />,
  '/balance': <PayCircleOutline />,
  '/stats': <PieOutline />,
  '/settings': <SetOutline />,
};
const TAB_LABEL_KEYS: Record<TabPath, string> = {
  '/': 'nav.feed',
  '/balance': 'nav.balance',
  '/stats': 'nav.stats',
  '/settings': 'nav.settings',
};

export function AppShell() {
  const { data: me, isPending, isError } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const ranLaunchRouting = useRef(false);
  const t = useT();
  const [, setLocale] = useLocale();

  // Phase 2.4 launch routing: decide the *initial* destination exactly once,
  // right after the first `/api/me` resolution. It never re-fires on a
  // deliberate tab tap (guarded by the ref) and only ever redirects away
  // from the default Feed landing (`location.pathname === '/'`).
  useEffect(() => {
    if (ranLaunchRouting.current || isPending) return;
    ranLaunchRouting.current = true;
    if (location.pathname !== '/') return;

    const startParam = getStartParam();
    if (isLikelyInviteCode(startParam)) {
      navigate(`/join?code=${encodeURIComponent(startParam)}`, { replace: true });
      return;
    }
    if (!isError && me && me.trips.length === 0) {
      navigate('/create-trip', { replace: true });
    }
  }, [isPending, isError, me, navigate, location.pathname]);

  // Phase 7 §9 detection: `me.user.lang` is the server-authoritative locale
  // (Telegram `language_code` resolved server-side, or the user's own
  // `PATCH /api/me` override — see `server/src/middleware/auth.ts`). This
  // corrects `LocaleProvider`'s client-only initial guess as soon as the
  // real value loads, and again whenever it changes (e.g. after the
  // Settings screen's language switcher invalidates `/api/me`).
  useEffect(() => {
    if (me && isSupportedLocale(me.user.lang)) {
      setLocale(me.user.lang);
    }
  }, [me, setLocale]);

  function handleTabChange(path: string) {
    if (location.pathname !== path) {
      hapticFeedback.selectionChanged.ifAvailable();
    }
    navigate(path);
  }

  const activeKey: TabPath | null = (TAB_PATHS as readonly string[]).includes(
    location.pathname,
  )
    ? (location.pathname as TabPath)
    : null;

  return (
    <div className="app-shell">
      <div className="app-shell-content">
        <Outlet />
      </div>
      <ToastHost />
      <div className="app-shell-tabbar">
        <TabBar safeArea activeKey={activeKey} onChange={handleTabChange}>
          {TAB_PATHS.map((path) => (
            <TabBar.Item key={path} icon={TAB_ICONS[path]} title={t(TAB_LABEL_KEYS[path])} />
          ))}
        </TabBar>
      </div>
    </div>
  );
}

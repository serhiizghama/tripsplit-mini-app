/**
 * Full-screen "session expired" state — Phase 8.4 (IMPLEMENTATION_PLAN.md
 * §12: "initData 1h expiry during long sessions -> surprise 401 -> graceful
 * re-open prompt; Telegram re-issues initData on every app open"). Rendered
 * by `App.tsx` in place of the ENTIRE router tree once `authExpiredBus`
 * reports a 401 from any query/mutation.
 *
 * There is no in-page fix to offer: Telegram only mints a fresh, validly
 * signed `initData` on a new Mini App launch, never via any action taken
 * inside the WebView. The "Reload" button is a reasonable first thing to
 * try (a same-tab reload can pick up a still-valid launch context in some
 * cases) — the copy is honest that closing and reopening from the chat is
 * the real fix if that doesn't help.
 *
 * Redesigned onto antd-mobile: the shared `EmptyState` primitive replaces
 * telegram-ui's `Placeholder`; the reload action is unchanged.
 */
import { Button } from 'antd-mobile';

import { EmptyState } from '../components/ui';
import { useT } from '../i18n';

export function SessionExpiredScreen() {
  const t = useT();

  return (
    <div
      style={{
        // `100dvh`/`viewportStableHeight` per plan §7's iOS rule — never a
        // bare `100vh`, which can clip under the Telegram WebView chrome.
        minHeight: 'var(--tg-viewport-stable-height, 100dvh)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <EmptyState
        glyph="🔒"
        title={t('session.expiredHeader')}
        description={t('session.expiredDescription')}
        action={
          <Button color="primary" size="large" onClick={() => window.location.reload()}>
            {t('session.reload')}
          </Button>
        }
      />
    </div>
  );
}

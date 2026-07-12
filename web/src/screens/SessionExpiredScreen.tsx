/**
 * Full-screen "session expired" state — Phase 8.4 (IMPLEMENTATION_PLAN.md
 * §12: "initData 1h expiry during long sessions -> surprise 401 -> graceful
 * re-open prompt; Telegram re-issues initData on every app open"). Rendered
 * by `App.tsx` in place of the ENTIRE router tree once `authExpiredBus`
 * reports a 401 from any query/mutation.
 *
 * There is no in-page fix to offer: Telegram only mints a fresh, validly
 * signed `initData` on a new Mini App launch, never via any action taken
 * inside the WebView — and a plain reload just re-sends the same expired
 * initData (the SDK serves it from cached launch params), so it can't
 * recover the session. The button therefore closes the Mini App via
 * `miniApp.close()`, sending the user back to the chat where reopening it
 * triggers a genuine relaunch with fresh initData. Outside Telegram
 * (plain-browser dev, where `close` isn't available) it falls back to a
 * reload, preserving the previous behavior there.
 *
 * Redesigned onto antd-mobile: the shared `EmptyState` primitive replaces
 * telegram-ui's `Placeholder`.
 */
import { miniApp } from '@tma.js/sdk-react';
import { Button } from 'antd-mobile';

import { EmptyState } from '../components/ui';
import { useT } from '../i18n';

/**
 * Closes the Mini App so reopening from the chat mints fresh initData; falls
 * back to a reload only where `close` isn't available (non-Telegram dev).
 */
function recoverSession(): void {
  if (miniApp.close.isAvailable()) {
    miniApp.close();
  } else {
    window.location.reload();
  }
}

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
          <Button color="primary" size="large" onClick={recoverSession}>
            {t('session.reload')}
          </Button>
        }
      />
    </div>
  );
}

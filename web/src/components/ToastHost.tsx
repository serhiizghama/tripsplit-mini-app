/**
 * Global toast host — Phase 7.3's "offline/error toast for failed requests".
 * Mounted once in `AppShell`. Two sources feed it:
 *  - `lib/toastBus.ts`, wired to `queryClient`'s global `onError` (every
 *    failed query/mutation, including background refetches a screen's own
 *    inline error state never renders for);
 *  - the browser's own `online`/`offline` events.
 *
 * Redesigned onto antd-mobile's imperative `Toast` — this component renders
 * nothing itself, it just drives `Toast.show` from those two sources.
 */
import { useEffect } from 'react';
import { Toast } from 'antd-mobile';

import { useT } from '../i18n';
import { subscribeToast } from '../lib/toastBus';

export function ToastHost() {
  const t = useT();

  useEffect(
    () =>
      subscribeToast((message) => {
        if (message) Toast.show({ content: message, position: 'bottom', duration: 3000 });
      }),
    [],
  );

  useEffect(() => {
    function handleOffline() {
      Toast.show({ content: t('toast.offline'), position: 'bottom', duration: 3000 });
    }
    function handleOnline() {
      Toast.show({ content: t('toast.backOnline'), position: 'bottom', duration: 2000 });
    }
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [t]);

  return null;
}

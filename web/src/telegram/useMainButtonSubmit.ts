/**
 * Wires the Telegram `MainButton` as a sheet's primary submit CTA — plan
 * §7/§8 ("bottom `MainButton` as the single primary action") and Phase 4.2's
 * "Submit via Telegram MainButton". Same `.ifAvailable()`-everywhere
 * discipline as `telegram/bootstrap.ts`: a client without MainButton support
 * (or plain-browser dev) just silently gets no button here — callers must
 * render an in-form fallback button for that case (see
 * `useMainButtonAvailable`).
 */
import { useEffect, useRef } from 'react';
import { mainButton, useSignal } from '@tma.js/sdk-react';

export interface MainButtonSubmitOptions {
  text: string;
  enabled: boolean;
  onClick: () => void;
}

/** True once MainButton itself is usable in this environment — drives the in-form fallback button's visibility. */
export function useMainButtonAvailable(): boolean {
  return useSignal(mainButton.mount.isAvailable);
}

/** Mounts MainButton for the lifetime of the calling component and keeps its text/enabled state in sync. */
export function useMainButtonSubmit({
  text,
  enabled,
  onClick,
}: MainButtonSubmitOptions): void {
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  // Mount + wire the click listener once; always unmount on cleanup so a
  // previous sheet's button never leaks into the next screen.
  useEffect(() => {
    try {
      mainButton.mount.ifAvailable();
      mainButton.setParams.ifAvailable({ isVisible: true });
    } catch (err) {
      console.warn('[telegram] MainButton mount failed', err);
    }

    const listenerResult = mainButton.onClick.ifAvailable(() => onClickRef.current());
    const unsubscribe = listenerResult.ok ? listenerResult.data : undefined;

    return () => {
      unsubscribe?.();
      try {
        mainButton.hide.ifAvailable();
        mainButton.unmount();
      } catch (err) {
        console.warn('[telegram] MainButton cleanup failed', err);
      }
    };
  }, []);

  useEffect(() => {
    try {
      mainButton.setParams.ifAvailable({ text, isEnabled: enabled });
    } catch (err) {
      console.warn('[telegram] MainButton setParams failed', err);
    }
  }, [text, enabled]);
}

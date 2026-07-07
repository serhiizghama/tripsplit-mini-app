/**
 * `enableClosingConfirmation()` while a form is dirty — plan §7's iOS/general
 * gotcha list and Phase 4.2's requirement for the add-expense sheet. Mirrors
 * `bootstrap.ts`'s `.ifAvailable()` discipline so a client without the
 * ClosingBehavior component just silently gets no confirmation prompt.
 */
import { useEffect } from 'react';
import { closingBehavior } from '@tma.js/sdk-react';

export function useClosingConfirmation(dirty: boolean): void {
  useEffect(() => {
    try {
      closingBehavior.mount.ifAvailable();
    } catch (err) {
      console.warn('[telegram] ClosingBehavior mount failed', err);
    }
    return () => {
      try {
        closingBehavior.disableConfirmation.ifAvailable();
      } catch {
        // Best-effort on unmount.
      }
    };
  }, []);

  useEffect(() => {
    try {
      if (dirty) {
        closingBehavior.enableConfirmation.ifAvailable();
      } else {
        closingBehavior.disableConfirmation.ifAvailable();
      }
    } catch (err) {
      console.warn('[telegram] ClosingBehavior toggle failed', err);
    }
  }, [dirty]);
}

/**
 * Copy for the Settings "Finish trip" confirm dialog (Trip Wrap plan task
 * W4) — split into a pure function so the outstanding-debts branch is
 * unit-testable without rendering anything (mirrors `exportSummary.ts`).
 */
import type { Translator } from '../i18n';

export function finishTripConfirmMessage(t: Translator, hasOutstanding: boolean): string {
  return hasOutstanding
    ? t('settings.finishTripConfirmOutstanding')
    : t('settings.finishTripConfirm');
}

/**
 * Toast copy for `BalanceScreen`'s Export button — Export & Group Nudges
 * plan T6. Split into a pure function so the group/dm branching is
 * unit-testable without rendering anything (`vitest.config.ts` is
 * pure-logic-only, no jsdom).
 */
import type { ExportTripResponse } from '@tripsplit/shared';

import type { Translator } from '../i18n';

export function exportSuccessMessage(
  t: Translator,
  response: ExportTripResponse,
): string {
  return response.delivered === 'group'
    ? t('balance.exportSuccessGroup')
    : t('balance.exportSuccessDm');
}

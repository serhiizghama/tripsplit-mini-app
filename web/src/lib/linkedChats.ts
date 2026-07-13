/**
 * Pure formatting for the Settings "Group notifications" section — Export &
 * Group Nudges plan T7. Split out so the title-vs-fallback branching is
 * unit-testable without rendering anything (mirrors `exportSummary.ts`).
 */
import type { LinkedChat } from '@tripsplit/shared';

import type { Translator } from '../i18n';

/** `title` when Telegram gave one; otherwise a generic label — never the raw chat id. */
export function linkedChatLabel(chat: LinkedChat, t: Translator): string {
  return chat.title ?? t('settings.groupNudgesChatFallback');
}

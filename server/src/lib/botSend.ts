/**
 * Resilient Telegram send path — Export & Group Nudges plan
 * (`docs/EXPORT_NUDGES_PLAN.md`) task T3. `callTelegram` is the raw Bot API
 * fetch wrapper (moved out of `bot.ts` so it has one home); `sendBotMessage`
 * is the single send path T3's commands, T4's nudges, and T5's export all
 * reuse — never throws, and auto-unlinks a chat's `trip_chats` bindings when
 * Telegram reports the bot can no longer reach it (kicked / chat gone /
 * blocked), so a dead binding doesn't keep silently failing forever.
 */
import { logger } from './logger.js';
import { unlinkChat } from './tripChats.js';

const TELEGRAM_API = 'https://api.telegram.org';

export async function callTelegram(
  botToken: string,
  method: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

interface TelegramErrorResult {
  ok: false;
  error_code?: number;
  description?: string;
}

/** True for errors meaning the bot can no longer post here (kicked, chat deleted, blocked, insufficient rights). */
function isUnrecoverableChatError(result: TelegramErrorResult): boolean {
  if (result.error_code === 403) return true;
  if (result.error_code === 400) {
    const desc = result.description?.toLowerCase() ?? '';
    return desc.includes('chat not found') || desc.includes('not enough rights');
  }
  return false;
}

/**
 * Sends an HTML message to `chatId` (`parse_mode: 'HTML'`, no link previews).
 * Never throws — logs and returns `false` on any failure. On an unrecoverable
 * chat error (see `isUnrecoverableChatError`) removes every `trip_chats`
 * binding for `chatId` (auto-unlink) before returning `false`.
 */
export async function sendBotMessage(
  botToken: string,
  chatId: number,
  html: string,
): Promise<boolean> {
  try {
    const result = (await callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })) as { ok: boolean } & TelegramErrorResult;

    if (result.ok) return true;

    if (isUnrecoverableChatError(result)) {
      const { tripTitles } = unlinkChat(chatId);
      logger.warn(
        { chatId, tripTitles, error: result },
        'botSend: chat unreachable, auto-unlinked',
      );
    } else {
      logger.error({ chatId, error: result }, 'botSend: sendMessage failed');
    }
    return false;
  } catch (err) {
    logger.error({ err, chatId }, 'botSend: sendMessage threw');
    return false;
  }
}

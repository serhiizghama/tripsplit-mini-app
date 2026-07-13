/**
 * Telegram bot loop — `/start` (private chat, Web App launch button) plus the
 * group commands from the Export & Group Nudges plan
 * (`docs/EXPORT_NUDGES_PLAN.md` task T3): `/link <code>`, `/unlink`,
 * `/summary`.
 *
 * Why `/start` exists: an inline `web_app` button can point at ANY https URL
 * and Telegram still opens it as a Mini App with signed `initData` — no
 * BotFather Mini App / menu-button setup required. So the launch URL lives
 * here (in code/env), not in BotFather, which is what the owner asked for.
 *
 * Deliberately dependency-free (raw Bot API over `fetch`, long polling) — no
 * telegraf/grammy.
 *
 * The Web App URL is resolved fresh on every `/start` (see resolveWebAppUrl)
 * so restarting the ngrok tunnel needs no bot restart — the next `/start`
 * button already points at the new tunnel URL.
 *
 * `handleUpdate` is exported standalone (pure-ish: only side effects are
 * Telegram sends + DB reads/writes) so it's unit-testable without the polling
 * loop — see `test/bot.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import { botMessages, resolveBotLocale, type BotLocale } from './lib/botMessages.js';
import { callTelegram, sendBotMessage } from './lib/botSend.js';
import { logger } from './lib/logger.js';
import { buildTripSummaryMessage } from './lib/summary.js';
import { getTripsForChat, linkTripChat, unlinkChat } from './lib/tripChats.js';

/** Local ngrok agent's inspection API — used to auto-discover the tunnel URL. */
const NGROK_TUNNELS_API = 'http://127.0.0.1:4040/api/tunnels';

/**
 * Tunnel-agnostic URL file: whatever tunnel is running (cloudflared, ngrok,
 * ...) writes its current public https URL here, one line. Resolved relative
 * to the server package cwd (see db/index.js's note on why cwd is stable).
 * cloudflared has no local API to query, so this file is how its URL reaches
 * the bot; `scripts/tunnel.sh` writes it.
 */
const TUNNEL_URL_FILE = join(process.cwd(), '.tunnel-url');

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string; title?: string };
    from?: { id: number; language_code?: string };
    text?: string;
  };
}

type IncomingMessage = NonNullable<TelegramUpdate['message']>;

/** `/command@BotName rest-of-args` — command name in group 1, trimmed args (if any) in group 2. */
const COMMAND_PATTERN = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/;

/** The sender's stored UI language (`users.lang`), or `'en'` for an unknown/anonymous sender. */
function localeForSender(userId: number | undefined): BotLocale {
  if (userId === undefined) return 'en';
  const row = db.select({ lang: schema.users.lang }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return resolveBotLocale(row?.lang);
}

/**
 * The public https URL the Web App button opens. Priority:
 *   1. WEBAPP_URL env (explicit override — e.g. the real prod domain)
 *   2. the current ngrok tunnel (auto-discovered from the local ngrok API)
 *   3. PUBLIC_URL env (fallback)
 * Returns undefined if none is a usable https URL (Telegram rejects non-https
 * web_app buttons) — the caller then sends a plain "not ready" message.
 */
async function resolveWebAppUrl(): Promise<string | undefined> {
  const fromEnv = process.env.WEBAPP_URL?.trim();
  if (fromEnv?.startsWith('https://')) return fromEnv;

  // Tunnel-agnostic: a file written by the running tunnel (e.g. cloudflared).
  try {
    const fromFile = readFileSync(TUNNEL_URL_FILE, 'utf8').trim();
    if (fromFile.startsWith('https://')) return fromFile;
  } catch {
    // No tunnel file — fall through to ngrok's API / PUBLIC_URL.
  }

  try {
    const res = await fetch(NGROK_TUNNELS_API, { signal: AbortSignal.timeout(2000) });
    const data = (await res.json()) as { tunnels?: Array<{ public_url?: string }> };
    const httpsTunnel = data.tunnels?.find((t) => t.public_url?.startsWith('https://'));
    if (httpsTunnel?.public_url) return httpsTunnel.public_url;
  } catch {
    // ngrok not running / API unreachable — fall through to PUBLIC_URL.
  }

  const publicUrl = process.env.PUBLIC_URL?.trim();
  if (publicUrl?.startsWith('https://')) return publicUrl;
  return undefined;
}

/**
 * Handles `/start` and `/start <inviteCode>` (bot deep link
 * `t.me/<bot>?start=<code>`). `inviteCode`, when present, is passed to the
 * Web App as a `?startapp=<code>` query param on the button URL — the web
 * app reads it (see getStartParam in web/src/telegram/launchData.ts) and
 * routes to the join screen. This is how invites work WITHOUT a BotFather
 * Mini App: the code rides in on the button URL, not Telegram's start_param.
 */
async function handleStart(
  botToken: string,
  chatId: number,
  inviteCode?: string,
): Promise<void> {
  const base = await resolveWebAppUrl();

  if (!base) {
    await callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text:
        '⚠️ Приложение сейчас недоступно — не удалось определить публичный адрес.\n' +
        'Запусти локальный сервер и туннель (./scripts/tunnel.sh), затем нажми /start ещё раз.',
    });
    return;
  }

  // Carry the invite code into the Web App via our own query param. Using the
  // URL API keeps it correct regardless of trailing slashes / existing query.
  const target = new URL(base);
  if (inviteCode) target.searchParams.set('startapp', inviteCode);
  const url = target.toString();

  const text = inviteCode
    ? '🧳 <b>TripSplit</b>\n\nТебя пригласили в поездку! Нажми кнопку ниже, ' +
      'чтобы присоединиться и вместе считать общие расходы.'
    : '🧳 <b>TripSplit</b> — считаем общие расходы в поездке.\n\n' +
      'Нажми кнопку ниже, чтобы открыть приложение. Добавляй траты, ' +
      'а мы посчитаем, кто кому сколько должен.';
  const buttonText = inviteCode ? '✅ Присоединиться к поездке' : '🚀 Открыть TripSplit';

  await callTelegram(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: buttonText, web_app: { url } }]],
    },
  });
  logger.info({ chatId, hasInvite: Boolean(inviteCode) }, 'bot: sent /start Web App button');
}

/**
 * `/link <code>`: resolves the invite code and binds this chat to that trip
 * (see `linkTripChat`). Meaningful in group/supergroup chats — linking never
 * gates on `chat.type` though, a private chat linking itself is harmless.
 * Missing sender (no `from`, e.g. an anonymous-admin post) can't be recorded
 * as `linkedBy` (FK to `users`), so it's a no-op, logged.
 */
async function handleLink(
  botToken: string,
  message: IncomingMessage,
  inviteCode: string | undefined,
): Promise<void> {
  const chatId = message.chat.id;
  const msgs = botMessages[localeForSender(message.from?.id)];

  if (!inviteCode) {
    await sendBotMessage(botToken, chatId, msgs.linkUsageHint());
    return;
  }
  if (!message.from) {
    logger.warn({ chatId }, 'bot: /link with no sender, ignoring');
    return;
  }

  const result = linkTripChat({
    inviteCode,
    chatId,
    chatTitle: message.chat.title ?? null,
    linkedBy: message.from.id,
  });

  if (!result) {
    await sendBotMessage(botToken, chatId, msgs.linkUnknownCode());
    return;
  }
  await sendBotMessage(botToken, chatId, msgs.linkSuccess(result.trip.title));
}

/** `/unlink`: removes every `trip_chats` binding for this chat (see `unlinkChat`'s doc comment for why "all"). */
async function handleUnlink(botToken: string, message: IncomingMessage): Promise<void> {
  const chatId = message.chat.id;
  const msgs = botMessages[localeForSender(message.from?.id)];

  const { tripTitles } = unlinkChat(chatId);
  if (tripTitles.length === 0) {
    await sendBotMessage(botToken, chatId, msgs.unlinkNothingLinked());
    return;
  }
  for (const title of tripTitles) {
    await sendBotMessage(botToken, chatId, msgs.unlinkSuccess(title));
  }
}

/** `/summary`: posts `buildTripSummaryMessage` for every trip linked to this chat. */
async function handleSummary(botToken: string, message: IncomingMessage): Promise<void> {
  const chatId = message.chat.id;
  const locale = localeForSender(message.from?.id);
  const msgs = botMessages[locale];

  const trips = getTripsForChat(chatId);
  if (trips.length === 0) {
    await sendBotMessage(botToken, chatId, msgs.unlinkNothingLinked());
    return;
  }
  for (const trip of trips) {
    await sendBotMessage(botToken, chatId, buildTripSummaryMessage(trip, locale));
  }
}

/**
 * Routes one update to its command handler. Any chat type, tolerates the
 * `@BotName` suffix Telegram appends in groups. Never throws — each handler
 * call is caught and logged so one bad update can't stall the polling loop.
 */
export async function handleUpdate(botToken: string, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  const chatId = message?.chat.id;
  const text = message?.text?.trim();
  if (!message || !chatId || !text) return;

  const match = text.match(COMMAND_PATTERN);
  if (!match) return;
  const command = match[1];
  const rest = match[2]?.trim();

  try {
    switch (command) {
      case 'start':
        // `/start` or `/start <inviteCode>` (t.me/<bot>?start=<code> deep
        // link) — only the first token is ever a real invite code.
        await handleStart(botToken, chatId, rest?.split(/\s+/)[0]);
        return;
      case 'link':
        await handleLink(botToken, message, rest);
        return;
      case 'unlink':
        await handleUnlink(botToken, message);
        return;
      case 'summary':
        await handleSummary(botToken, message);
        return;
      default:
        return;
    }
  } catch (err) {
    logger.error({ err, command }, 'bot: failed to handle command');
  }
}

/**
 * Starts the long-polling loop. Fire-and-forget from index.ts (never awaited)
 * — it runs for the lifetime of the process and swallows/logs its own errors
 * so a transient Telegram hiccup never takes the API down with it.
 */
export function startBot(botToken: string): void {
  void (async () => {
    // Drop any leftover webhook so getUpdates isn't rejected with 409.
    await callTelegram(botToken, 'deleteWebhook', { drop_pending_updates: false }).catch(() => {});
    logger.info('bot: /start listener started (long polling)');

    let offset = 0;
    for (;;) {
      try {
        const result = (await callTelegram(botToken, 'getUpdates', {
          offset,
          timeout: 30,
          allowed_updates: ['message'],
        })) as { ok: boolean; result?: TelegramUpdate[] };

        for (const update of result.result ?? []) {
          offset = update.update_id + 1;
          await handleUpdate(botToken, update);
        }
      } catch (err) {
        logger.error({ err }, 'bot: getUpdates loop error — retrying in 3s');
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();
}

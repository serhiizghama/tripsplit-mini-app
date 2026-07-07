/**
 * Minimal Telegram bot loop — replies to `/start` with a message + a Web App
 * button that launches the TripSplit Mini App.
 *
 * Why this exists: an inline `web_app` button can point at ANY https URL and
 * Telegram still opens it as a Mini App with signed `initData` — no BotFather
 * Mini App / menu-button setup required. So the launch URL lives here (in
 * code/env), not in BotFather, which is what the owner asked for.
 *
 * Deliberately dependency-free (raw Bot API over `fetch`, long polling) — no
 * telegraf/grammy. It only handles `/start`; the app itself is the product.
 *
 * The Web App URL is resolved fresh on every `/start` (see resolveWebAppUrl)
 * so restarting the ngrok tunnel needs no bot restart — the next `/start`
 * button already points at the new tunnel URL.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { logger } from './lib/logger.js';

const TELEGRAM_API = 'https://api.telegram.org';

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
    chat: { id: number };
    text?: string;
  };
}

async function callTelegram(botToken: string, method: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
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
          const text = update.message?.text?.trim();
          const chatId = update.message?.chat.id;
          // `/start` or `/start <inviteCode>` (from a t.me/<bot>?start=<code>
          // deep link — Telegram delivers the payload as the message text).
          const match = text?.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
          if (chatId && match) {
            const inviteCode = match[1];
            await handleStart(botToken, chatId, inviteCode).catch((err) =>
              logger.error({ err }, 'bot: failed to handle /start'),
            );
          }
        }
      } catch (err) {
        logger.error({ err }, 'bot: getUpdates loop error — retrying in 3s');
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();
}

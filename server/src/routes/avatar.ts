/**
 * Avatar proxy — IMPLEMENTATION_PLAN.md §7, Phase 3.4.
 *
 * `initData.user.photo_url` (used directly by the client when present) is
 * privacy-dependent and often absent. This route is the fallback: Telegram
 * Bot API `getUserProfilePhotos` → `getFile` → stream the bytes from
 * `api.telegram.org/file/bot<TOKEN>/...` ourselves. We MUST proxy rather than
 * hand the client that URL directly — it's CORS-blocked from a webview *and*
 * embeds the bot token (plan §7). The token never leaves this process.
 *
 * Disk-cached under `AVATAR_CACHE_DIR` (default `data/avatar-cache/`, already
 * covered by the repo-wide `data/` gitignore rule) with a ~24h TTL so a busy
 * trip doesn't hammer the Bot API on every Settings-screen render.
 *
 * On ANY failure — no bot token configured, Telegram privacy settings hiding
 * the photo, no photo set at all, a Telegram API error, or a network
 * timeout — this responds with a non-2xx (`404 avatar_not_found`) so the
 * client's fallback chain (`photoUrl` → this proxy → initials circle) can
 * proceed to the initials fallback. It never throws an unhandled 500 for
 * what is, from the client's point of view, a perfectly normal "no avatar"
 * case.
 *
 * Mounted at `/api/avatar` behind the same `/api/*` auth middleware as every
 * other route — this is Telegram Bot API traffic paid for by us, not a
 * public image host, so it stays behind `Authorization: tma ...` like
 * everything else. That in turn means the *client* can't just point a plain
 * `<img src>` at it (browsers never attach custom headers to image
 * requests) — see `web/src/api/avatar.ts`'s authenticated-fetch +
 * object-URL hook for the client side of this contract.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — plan §3.4/§7.
const TELEGRAM_API_TIMEOUT_MS = 5000;
/**
 * Telegram returns profile photos as an array of sizes, smallest first
 * (plan §7: "smallest acceptable size"). An avatar circle is never rendered
 * larger than ~96px in this app, so the smallest Telegram offers is plenty
 * and keeps the proxy fast + cheap to cache.
 */
const PHOTO_SIZE_INDEX = 0;

const userIdParamSchema = z
  .string()
  .regex(/^\d+$/, 'user id must be a positive integer')
  .transform(Number);

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
}

interface TelegramUserProfilePhotos {
  total_count: number;
  photos: TelegramPhotoSize[][];
}

interface TelegramFile {
  file_id: string;
  file_path?: string;
}

interface CachedAvatar {
  bytes: Buffer;
  contentType: string;
}

function avatarCacheDir(): string {
  return process.env.AVATAR_CACHE_DIR ?? join(process.cwd(), 'data', 'avatar-cache');
}

function cachePaths(userId: number): { bytesPath: string; metaPath: string } {
  const dir = avatarCacheDir();
  return { bytesPath: join(dir, `${userId}.bin`), metaPath: join(dir, `${userId}.json`) };
}

function readCachedAvatar(userId: number): CachedAvatar | undefined {
  const { bytesPath, metaPath } = cachePaths(userId);
  try {
    const stat = statSync(bytesPath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      return undefined; // stale — treat as a cache miss, refetch below.
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as { contentType: string };
    return { bytes: readFileSync(bytesPath), contentType: meta.contentType };
  } catch {
    return undefined; // no cache entry yet, or it's corrupt — refetch.
  }
}

function writeCachedAvatar(userId: number, avatar: CachedAvatar): void {
  const dir = avatarCacheDir();
  const { bytesPath, metaPath } = cachePaths(userId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(bytesPath, avatar.bytes);
  writeFileSync(metaPath, JSON.stringify({ contentType: avatar.contentType }));
}

function guessContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg'; // Telegram profile photos are jpg in practice.
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * `getUserProfilePhotos` → `getFile` → raw bytes. Returns `undefined` for
 * every "no avatar available" case (privacy, no photo, API error, timeout);
 * the caller turns that into a 404, never a 500.
 */
async function fetchAvatarFromTelegram(
  botToken: string,
  userId: number,
): Promise<CachedAvatar | undefined> {
  const apiBase = `https://api.telegram.org/bot${botToken}`;

  const photosRes = await fetchWithTimeout(
    `${apiBase}/getUserProfilePhotos?user_id=${userId}&limit=1`,
  );
  if (!photosRes.ok) return undefined;
  const photosBody =
    (await photosRes.json()) as TelegramApiResponse<TelegramUserProfilePhotos>;
  if (!photosBody.ok || !photosBody.result || photosBody.result.total_count === 0)
    return undefined;

  const mostRecentPhoto = photosBody.result.photos[0];
  const smallestSize = mostRecentPhoto?.[PHOTO_SIZE_INDEX];
  if (!smallestSize) return undefined;

  const fileRes = await fetchWithTimeout(
    `${apiBase}/getFile?file_id=${smallestSize.file_id}`,
  );
  if (!fileRes.ok) return undefined;
  const fileBody = (await fileRes.json()) as TelegramApiResponse<TelegramFile>;
  const filePath = fileBody.ok ? fileBody.result?.file_path : undefined;
  if (!filePath) return undefined;

  const downloadRes = await fetchWithTimeout(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
  );
  if (!downloadRes.ok) return undefined;

  const bytes = Buffer.from(await downloadRes.arrayBuffer());
  return { bytes, contentType: guessContentType(filePath) };
}

/** Builds the `/api/avatar` router. `botToken` is `undefined` in the (rare) case it's missing at boot. */
export function createAvatarRouter(botToken: string | undefined) {
  const router = new Hono();

  router.get('/:userId', async (c) => {
    const parsed = userIdParamSchema.safeParse(c.req.param('userId'));
    if (!parsed.success) {
      throw new AppError(404, 'avatar_not_found', 'Avatar not available');
    }
    const userId = parsed.data;

    const cached = readCachedAvatar(userId);
    if (cached) {
      // `new Uint8Array(buffer)` (not a raw `Buffer`) — Node's `Buffer` type
      // (`Uint8Array<ArrayBufferLike>`) doesn't structurally match Hono's
      // `Data` (`Uint8Array<ArrayBuffer>`); this copy satisfies it exactly,
      // and it's cheap for avatar-sized payloads.
      return c.body(new Uint8Array(cached.bytes), 200, {
        'Content-Type': cached.contentType,
        'Cache-Control': 'private, max-age=86400',
      });
    }

    try {
      if (!botToken) {
        throw new Error('BOT_TOKEN is not configured');
      }
      const avatar = await fetchAvatarFromTelegram(botToken, userId);
      if (!avatar) {
        throw new Error('no avatar available for this user');
      }
      writeCachedAvatar(userId, avatar);
      return c.body(new Uint8Array(avatar.bytes), 200, {
        'Content-Type': avatar.contentType,
        'Cache-Control': 'private, max-age=86400',
      });
    } catch (err) {
      logger.warn(
        { err, userId },
        'avatar proxy: falling back (client will show initials)',
      );
      throw new AppError(404, 'avatar_not_found', 'Avatar not available');
    }
  });

  return router;
}

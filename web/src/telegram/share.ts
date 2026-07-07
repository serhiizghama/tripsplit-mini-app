/**
 * Invite-link sharing — Phase 3.3.
 *
 * `shareMessage` (the SDK function the Phase 3 brief names) needs a
 * `messageId` from the Bot API's `savePreparedInlineMessage`, i.e. a whole
 * extra server round trip to Telegram just to prepare a shareable message —
 * disproportionate plumbing for "share an invite link". `openTelegramLink`
 * with a `t.me/share/url` deep link is the real fit here: it opens
 * Telegram's own chat-picker share sheet with the link prefilled, no
 * bot-side preparation step required. Per Telegram's docs this closes the
 * Mini App (control passes to the share sheet) — expected platform
 * behavior, not a bug.
 *
 * Falls back to clipboard (SDK `copyTextToClipboard`, then the standard
 * `navigator.clipboard`) when `openTelegramLink` isn't available — e.g.
 * running outside Telegram during dev.
 */
import { copyTextToClipboard, openTelegramLink } from '@tma.js/sdk-react';

/** Tries the SDK's clipboard helper, then the browser API. `false` if both fail. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await copyTextToClipboard(text);
    return true;
  } catch {
    // fall through to the browser API below.
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to `false` below.
  }
  return false;
}

export type ShareResult = 'opened-share-sheet' | 'copied' | 'failed';

/** Opens Telegram's native share sheet for the invite link, or copies it. */
export async function shareInviteLink(
  link: string,
  tripTitle: string,
): Promise<ShareResult> {
  try {
    if (openTelegramLink.isAvailable()) {
      const shareText = `Join "${tripTitle}" on TripSplit`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;
      openTelegramLink(shareUrl);
      return 'opened-share-sheet';
    }
  } catch {
    // fall through to clipboard below.
  }
  return (await copyToClipboard(link)) ? 'copied' : 'failed';
}

#!/usr/bin/env bash
#
# Dev HTTPS tunnel via cloudflared, with URL capture.
#
# Unlike ngrok's free tier, cloudflared quick tunnels show NO browser-warning
# interstitial — so the Mini App opens directly inside the Telegram mobile
# WebView (ngrok's interstitial is what caused the black screen on phones).
#
# This wrapper runs cloudflared AND writes the assigned https URL to
# `server/.tunnel-url`, which the bot reads to build the /start Web App button
# (see server/src/bot.ts's resolveWebAppUrl). So the launch URL is picked up
# automatically — no BotFather, no manual copy-paste.
#
# Usage (from repo root, in its own terminal, alongside `npm run dev`):
#   ./scripts/tunnel.sh
#   PORT=5173 ./scripts/tunnel.sh
#
# The URL changes every run (cloudflared quick tunnels are ephemeral); the bot
# always uses whatever is currently in server/.tunnel-url, so just re-run this
# and press /start again — nothing else to update.

set -euo pipefail

PORT="${PORT:-5173}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL_FILE="${REPO_ROOT}/server/.tunnel-url"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "error: cloudflared not found on PATH. Install with: brew install cloudflared" >&2
  exit 1
fi

: > "$URL_FILE" # clear any stale URL so a reader never sees the old tunnel
echo "==> cloudflared tunnel -> http://localhost:${PORT}"

# Stream cloudflared's output; capture the first trycloudflare URL it prints
# and persist it for the bot. `stdbuf` keeps the pipe unbuffered so the URL is
# saved the moment it appears, not after a buffer fills.
stdbuf -oL -eL cloudflared tunnel --url "http://localhost:${PORT}" 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ ! -s "$URL_FILE" ]]; then
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' <<<"$line" | head -1 || true)"
    if [[ -n "$url" ]]; then
      printf '%s\n' "$url" > "$URL_FILE"
      echo "==> saved tunnel URL -> server/.tunnel-url : $url"
    fi
  fi
done

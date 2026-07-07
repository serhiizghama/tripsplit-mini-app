#!/usr/bin/env bash
#
# Dev-loop HTTPS tunnel helper (IMPLEMENTATION_PLAN.md §7 "Dev loop" / Phase 0.5).
#
# Telegram Mini Apps require HTTPS (the official test environment is the
# only exception, and it allows plain HTTP). The fastest local dev loop is
# tunneling the Vite dev server (default http://localhost:5173) through
# cloudflared or ngrok, then pointing BotFather's Mini App URL (or the
# test environment) at the tunnel's HTTPS URL.
#
# Requires one of the two CLIs to already be installed:
#   cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
#   ngrok:       https://ngrok.com/download
#
# Usage:
#   npm run dev                     # in one terminal — starts web + server
#   ./scripts/dev-tunnel.sh         # in another terminal — defaults to cloudflared
#   TUNNEL=ngrok ./scripts/dev-tunnel.sh
#   PORT=5173 ./scripts/dev-tunnel.sh
#
# Then:
#   1. Copy the printed https://... URL.
#   2. Open it directly in a browser to sanity check (append ?eruda=1 to
#      get an in-page debug console on a real phone — see web/src/eruda.ts).
#   3. Paste it into @BotFather as the Mini App URL (or use Telegram's
#      test environment, which tolerates the tunnel restarting more often
#      during development). See docs/deploy/SETUP.md for the one-time
#      BotFather setup (owner action, not scripted here).
#
# Note: the tunnel URL changes every run unless you have a paid/named
# tunnel — expect to re-paste it into BotFather each dev session.

set -euo pipefail

TUNNEL="${TUNNEL:-cloudflared}"
PORT="${PORT:-5173}"

case "$TUNNEL" in
  cloudflared)
    if ! command -v cloudflared >/dev/null 2>&1; then
      echo "error: cloudflared not found on PATH. Install it, or run:" >&2
      echo "  TUNNEL=ngrok ./scripts/dev-tunnel.sh" >&2
      exit 1
    fi
    echo "==> Starting cloudflared tunnel -> http://localhost:${PORT}"
    exec cloudflared tunnel --url "http://localhost:${PORT}"
    ;;
  ngrok)
    if ! command -v ngrok >/dev/null 2>&1; then
      echo "error: ngrok not found on PATH. Install it, or run:" >&2
      echo "  TUNNEL=cloudflared ./scripts/dev-tunnel.sh" >&2
      exit 1
    fi
    echo "==> Starting ngrok tunnel -> http://localhost:${PORT}"
    exec ngrok http "${PORT}"
    ;;
  *)
    echo "error: unknown TUNNEL='${TUNNEL}' (expected 'cloudflared' or 'ngrok')" >&2
    exit 1
    ;;
esac

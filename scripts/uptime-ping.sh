#!/usr/bin/env bash
#
# TripSplit uptime monitor (IMPLEMENTATION_PLAN.md Phase 8.2).
#
# Curls HEALTH_URL (the public `GET /api/health` endpoint — see
# `server/src/lib/health.ts`). If the request itself fails (timeout,
# connection refused, non-2xx status) or the JSON body's `"ok"` field isn't
# `true`, sends a Telegram message to OWNER_CHAT_ID via the Bot API using
# BOT_TOKEN. Silent (exit 0, no output beyond a short log line) on a healthy
# check — a cron alert every few minutes would be spam; this is meant to be
# heard from only when something is actually wrong.
#
# Guard: if HEALTH_URL, BOT_TOKEN, or OWNER_CHAT_ID aren't all set, this
# exits 0 with an explanatory message instead of erroring — so an
# incomplete/not-yet-configured crontab entry never shows up as a cron
# failure email.
#
# Usage (cron — owner installs on the VPS, see docs/deploy/SETUP.md):
#   */5 * * * * HEALTH_URL=https://split.<yourdomain>/api/health \
#     BOT_TOKEN=<real-bot-token> OWNER_CHAT_ID=<your-telegram-user-id> \
#     /home/<deploy-user>/apps/tripsplit/scripts/uptime-ping.sh \
#     >> /home/<deploy-user>/apps/tripsplit/logs/uptime-ping.log 2>&1
#
# BOT_TOKEN/OWNER_CHAT_ID are read from the environment here rather than
# hardcoded — see .env.example for where the real values live on the VPS
# (never committed).

set -uo pipefail # NOT -e: a failed curl must fall through to the alert path, not abort the script.

HEALTH_URL="${HEALTH_URL:-}"
BOT_TOKEN="${BOT_TOKEN:-}"
OWNER_CHAT_ID="${OWNER_CHAT_ID:-}"
CURL_TIMEOUT_SECONDS="${UPTIME_PING_TIMEOUT_SECONDS:-10}"

if [[ -z "$HEALTH_URL" || -z "$BOT_TOKEN" || -z "$OWNER_CHAT_ID" ]]; then
  echo "uptime-ping.sh: HEALTH_URL/BOT_TOKEN/OWNER_CHAT_ID not fully configured — skipping (nothing to do)."
  exit 0
fi

send_alert() {
  local text="$1"
  if ! curl -fsS --max-time "$CURL_TIMEOUT_SECONDS" \
    -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${OWNER_CHAT_ID}" \
    --data-urlencode "text=${text}" \
    > /dev/null 2>&1; then
    echo "uptime-ping.sh: failed to send the Telegram alert itself — is BOT_TOKEN/OWNER_CHAT_ID correct?" >&2
  fi
}

RESPONSE="$(curl -fsS --max-time "$CURL_TIMEOUT_SECONDS" "$HEALTH_URL" 2>/dev/null)"
CURL_EXIT_CODE=$?

if [[ $CURL_EXIT_CODE -ne 0 ]]; then
  echo "uptime-ping.sh: health check FAILED (curl exit ${CURL_EXIT_CODE}) — alerting owner."
  send_alert "⚠️ TripSplit health check failed: could not reach ${HEALTH_URL} (curl exit ${CURL_EXIT_CODE})"
  exit 0
fi

# Dependency-light JSON scan (no jq assumed on the VPS): looks for the exact
# `"ok":true` token `lib/health.ts`'s JSON response always emits.
if [[ "$RESPONSE" != *'"ok":true'* ]]; then
  echo "uptime-ping.sh: health check reported UNHEALTHY — alerting owner. Response: ${RESPONSE}"
  send_alert "⚠️ TripSplit health check reported unhealthy: ${RESPONSE}"
  exit 0
fi

echo "uptime-ping.sh: healthy."
exit 0

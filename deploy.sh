#!/usr/bin/env bash
#
# TripSplit deploy script.
#
# Phase 0 status: this file is a scaffold only. It has NOT been run
# against any real server. No host/IP/domain is hardcoded — all
# connection details come from environment variables so this file is
# safe to commit.
#
# What it does:
#   1. npm install + build `web` (Vite SPA -> web/dist) and `server`
#      (Hono API -> server/dist), via the shared workspace.
#   2. rsync web/dist and the built server (+ package.json + ecosystem
#      config) to the VPS, under $DEPLOY_PATH.
#   3. Reload the pm2 process on the VPS (zero-downtime if pm2 supports
#      it for the process type; falls back to restart).
#
# nginx serves web/dist as static files at `/` and reverse-proxies
# `/api` to the Node process — this script does not touch nginx or
# certbot; see docs/deploy/SETUP.md for that one-time manual setup.
#
# Required environment variables (export them, or put them in a
# gitignored `.env.deploy` file next to this script and it will be
# sourced automatically):
#   DEPLOY_HOST      SSH host/alias for the VPS (e.g. an entry in
#                    ~/.ssh/config, or user@host)
#   DEPLOY_USER      SSH user on the VPS (only needed if DEPLOY_HOST is
#                    a bare hostname, not a user@host / ssh-config alias)
#   DEPLOY_PATH      Absolute path to the app directory on the VPS,
#                    e.g. /home/<deploy-user>/apps/tripsplit
# Optional:
#   DEPLOY_SSH_PORT  SSH port (default: 22)
#   DEPLOY_PM2_APP   pm2 app name from ecosystem.config.cjs
#                    (default: tripsplit-server)
#
# Usage:
#   cp .env.deploy.example .env.deploy   # if you keep one locally (gitignored)
#   ./deploy.sh
# or:
#   DEPLOY_HOST=split-vps DEPLOY_PATH=/home/deploy/apps/tripsplit ./deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load local deploy env overrides if present (gitignored — see .gitignore).
if [[ -f ".env.deploy" ]]; then
  # shellcheck disable=SC1091
  source ".env.deploy"
fi

: "${DEPLOY_HOST:?Set DEPLOY_HOST (VPS ssh host/alias). See deploy.sh header.}"
: "${DEPLOY_PATH:?Set DEPLOY_PATH (absolute app dir on the VPS). See deploy.sh header.}"

DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
DEPLOY_PM2_APP="${DEPLOY_PM2_APP:-tripsplit-server}"
DEPLOY_TARGET="$DEPLOY_HOST"
if [[ -n "${DEPLOY_USER:-}" ]]; then
  DEPLOY_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
fi

echo "==> Installing dependencies"
npm install

echo "==> Building shared, server, web"
npm run build

echo "==> Rsyncing web/dist -> ${DEPLOY_TARGET}:${DEPLOY_PATH}/web/dist"
rsync -az --delete \
  -e "ssh -p ${DEPLOY_SSH_PORT}" \
  web/dist/ "${DEPLOY_TARGET}:${DEPLOY_PATH}/web/dist/"

echo "==> Rsyncing server -> ${DEPLOY_TARGET}:${DEPLOY_PATH}/server"
# NB: `data` and `logs` are excluded so --delete can NEVER touch the live
# SQLite DB (default DB_PATH is ./data/tripsplit.db relative to server/) —
# excluded patterns are protected from deletion unless --delete-excluded.
rsync -az --delete \
  --exclude ".env" \
  --exclude "node_modules" \
  --exclude "src" \
  --exclude "data" \
  --exclude "logs" \
  -e "ssh -p ${DEPLOY_SSH_PORT}" \
  server/dist/ server/package.json \
  "${DEPLOY_TARGET}:${DEPLOY_PATH}/server/"

echo "==> Rsyncing ecosystem.config.cjs -> ${DEPLOY_TARGET}:${DEPLOY_PATH}/"
rsync -az \
  -e "ssh -p ${DEPLOY_SSH_PORT}" \
  ecosystem.config.cjs \
  "${DEPLOY_TARGET}:${DEPLOY_PATH}/"

echo "==> Installing production deps on the VPS and reloading pm2"
# shellcheck disable=SC2029
ssh -p "${DEPLOY_SSH_PORT}" "${DEPLOY_TARGET}" bash -s <<EOF
set -euo pipefail
cd "${DEPLOY_PATH}/server"
npm install --omit=dev
cd "${DEPLOY_PATH}"
pm2 startOrReload ecosystem.config.cjs --only "${DEPLOY_PM2_APP}"
pm2 save
EOF

echo "==> Done."

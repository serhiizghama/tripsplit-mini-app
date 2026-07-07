#!/usr/bin/env bash
#
# TripSplit nightly SQLite backup (IMPLEMENTATION_PLAN.md Phase 8.1).
#
# What it does:
#   1. Uses the SQLite online-backup API — `sqlite3 "$DB_PATH" ".backup ..."`
#      — to safely snapshot the LIVE database, even under WAL-mode
#      concurrent writes (`server/src/db/index.ts` runs in WAL mode). This
#      is NOT a plain `cp`: a raw file copy of a live WAL database can
#      capture a torn/inconsistent snapshot mid-write; `.backup` uses
#      SQLite's own backup API, which is safe to run at any time.
#   2. Names the backup file with a UTC date+time stamp, so multiple runs
#      per day never collide and files sort chronologically by name.
#   3. Verifies the fresh backup is itself a valid, uncorrupted SQLite file
#      (`PRAGMA integrity_check`) before declaring success.
#   4. Deletes backup files older than BACKUP_RETENTION_DAYS (default 14).
#   5. Optionally rsyncs the fresh backup offsite via BACKUP_OFFSITE_TARGET
#      (any rsync destination: `user@host:/path`, a mounted path, etc.) —
#      a no-op, not an error, when unset, so this script is safe to
#      schedule before offsite storage exists.
#
# Idempotent / safe to run repeatedly or concurrently for the same DB: each
# run creates its own uniquely-named dated file (down to the second) and
# never mutates an existing backup file.
#
# Usage:
#   DB_PATH=./data/tripsplit.db BACKUP_DIR=./backups ./scripts/backup.sh
#   BACKUP_RETENTION_DAYS=14 BACKUP_OFFSITE_TARGET=user@host:/path ./scripts/backup.sh
#
# Nightly cron line (owner installs on the VPS — see docs/deploy/SETUP.md):
#   0 3 * * * DB_PATH=/home/<deploy-user>/apps/tripsplit/data/tripsplit.db \
#     BACKUP_DIR=/home/<deploy-user>/apps/tripsplit/backups \
#     /home/<deploy-user>/apps/tripsplit/scripts/backup.sh \
#     >> /home/<deploy-user>/apps/tripsplit/logs/backup.log 2>&1

set -euo pipefail

DB_PATH="${DB_PATH:-./data/tripsplit.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "backup.sh: DB_PATH '${DB_PATH}' does not exist — nothing to back up." >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "backup.sh: the 'sqlite3' CLI is required but was not found on PATH." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/tripsplit-${TIMESTAMP}.db"

echo "==> Backing up '${DB_PATH}' -> '${BACKUP_FILE}'"
sqlite3 "$DB_PATH" ".backup '${BACKUP_FILE}'"

echo "==> Verifying backup integrity"
INTEGRITY_RESULT="$(sqlite3 "$BACKUP_FILE" 'PRAGMA integrity_check;')"
if [[ "$INTEGRITY_RESULT" != "ok" ]]; then
  echo "backup.sh: integrity check FAILED for '${BACKUP_FILE}': ${INTEGRITY_RESULT}" >&2
  exit 1
fi
echo "==> Integrity check: ${INTEGRITY_RESULT}"

echo "==> Pruning backups older than ${BACKUP_RETENTION_DAYS} days in '${BACKUP_DIR}'"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'tripsplit-*.db' -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete

if [[ -n "${BACKUP_OFFSITE_TARGET:-}" ]]; then
  if command -v rsync >/dev/null 2>&1; then
    echo "==> Copying offsite to '${BACKUP_OFFSITE_TARGET}'"
    rsync -az "$BACKUP_FILE" "${BACKUP_OFFSITE_TARGET}/"
  else
    echo "backup.sh: BACKUP_OFFSITE_TARGET is set but 'rsync' was not found on PATH — skipping offsite copy." >&2
  fi
else
  echo "==> BACKUP_OFFSITE_TARGET not set — skipping offsite copy (local backup only)."
fi

echo "==> Backup complete: ${BACKUP_FILE}"

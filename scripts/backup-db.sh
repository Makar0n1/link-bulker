#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Postgres backup script — pg_dump from the postgres container into a local
# directory, gzipped, with rotation.
#
# Designed for hourly/daily cron on the VPS:
#   crontab -e
#   0 */6 * * * /opt/link-checker/scripts/backup-db.sh >> /var/log/lc-backup.log 2>&1
#
# Optional offsite upload: set BACKUP_REMOTE (rsync target) and the script
# will rsync the new dump after creating it. Example:
#   BACKUP_REMOTE=user@backup.example.com:/srv/backups/link-checker
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR=${BACKUP_DIR:-/opt/link-checker/backups}
RETENTION_DAYS=${RETENTION_DAYS:-14}
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"

mkdir -p "$BACKUP_DIR"

TS=$(date -u +'%Y%m%d-%H%M%S')
OUT="$BACKUP_DIR/lc-${TS}.sql.gz"

echo "==> Dumping to $OUT"

# Read POSTGRES_USER + POSTGRES_DB from .env without sourcing the whole file
PGUSER=$(grep '^POSTGRES_USER=' .env | cut -d= -f2)
PGDB=$(grep '^POSTGRES_DB=' .env | cut -d= -f2)

$COMPOSE exec -T postgres \
  pg_dump -U "$PGUSER" -d "$PGDB" --clean --if-exists --no-owner --no-privileges \
  | gzip -9 > "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "==> Wrote $OUT ($SIZE)"

echo "==> Pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'lc-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete -print || true

if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "==> Uploading to $BACKUP_REMOTE"
  rsync -az "$OUT" "$BACKUP_REMOTE/"
fi

echo "==> Backup complete"

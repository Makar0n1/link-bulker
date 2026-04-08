#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Server-side deploy script. Invoked by CI over SSH from .github/workflows/deploy.yml.
# Can also be run by hand on the VPS:
#
#   cd /opt/link-checker
#   IMAGE_TAG=abc1234 ./scripts/deploy.sh
#
# Strategy:
#   1. docker compose pull        — fetch images for the pinned IMAGE_TAG
#   2. docker compose up -d migrate
#      (one-shot; waits for postgres health, runs prisma migrate deploy, exits)
#   3. docker compose up -d
#      Compose recreates only services whose image/config changed. The 3 worker
#      services come up first because of dependency graph; then api/web/caddy.
#   4. Wait until api healthcheck = healthy (max 90s)
#   5. Roll back to PREVIOUS_TAG if healthcheck fails
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
CURRENT_TAG=$(grep '^IMAGE_TAG=' .env | cut -d= -f2 || echo latest)
PREVIOUS_TAG_FILE=".previous_tag"
PREVIOUS_TAG=$(cat "$PREVIOUS_TAG_FILE" 2>/dev/null || echo "")

echo "==> Deploying tag: $CURRENT_TAG (previous: ${PREVIOUS_TAG:-none})"

echo "==> Pulling images..."
$COMPOSE pull api worker-1 worker-2 worker-3 web

echo "==> Running migrations..."
$COMPOSE up -d migrate
# Wait for migrate to finish
$COMPOSE wait migrate || {
  echo "ERROR: migrate container failed. Logs:"
  $COMPOSE logs migrate
  exit 1
}

echo "==> Recreating services..."
$COMPOSE up -d --remove-orphans

echo "==> Waiting for api to become healthy..."
DEADLINE=$((SECONDS + 90))
while true; do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' \
    "$($COMPOSE ps -q api)" 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then
    echo "==> api is healthy ✓"
    break
  fi
  if [ $SECONDS -ge $DEADLINE ]; then
    echo "ERROR: api did not become healthy in 90s. Last status: $STATUS"
    echo "==> Recent logs:"
    $COMPOSE logs --tail=80 api
    if [ -n "$PREVIOUS_TAG" ]; then
      echo "==> Rolling back to $PREVIOUS_TAG"
      sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${PREVIOUS_TAG}|" .env
      $COMPOSE pull api worker-1 worker-2 worker-3 web
      $COMPOSE up -d --remove-orphans
    fi
    exit 1
  fi
  sleep 3
done

echo "==> Pruning unused images..."
docker image prune -f --filter "until=168h" || true

# Save current tag as the new "previous" for next deploy's rollback
echo "$CURRENT_TAG" > "$PREVIOUS_TAG_FILE"

echo "==> Deploy complete: $CURRENT_TAG"

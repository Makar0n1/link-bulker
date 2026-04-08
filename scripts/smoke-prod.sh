#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Production smoke test — runs after a deploy.
#   - GET https://link-check-pro.top              → 200 (web)
#   - GET https://api.link-check-pro.top/api/v1/health → 200 (api flat)
#   - GET https://api.link-check-pro.top/api/v1/health/deep → 200 (api+pg+redis)
#
# Bails the deploy job (exit 1) on any failure so CI marks the run red.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

WEB_URL=${WEB_URL:-https://link-check-pro.top}
API_URL=${API_URL:-https://api.link-check-pro.top}

check() {
  local label=$1
  local url=$2
  local expect=${3:-200}
  echo -n "  [$label] $url → "
  CODE=$(curl -fsS -o /tmp/smoke-body.$$ -w "%{http_code}" --max-time 15 "$url" || echo "000")
  if [ "$CODE" = "$expect" ]; then
    echo "$CODE ✓"
    rm -f /tmp/smoke-body.$$
    return 0
  fi
  echo "$CODE ✗ (expected $expect)"
  echo "---"
  cat /tmp/smoke-body.$$ 2>/dev/null || true
  echo "---"
  rm -f /tmp/smoke-body.$$
  return 1
}

echo "==> Production smoke test"
check "web"        "$WEB_URL/"                      200
check "api flat"   "$API_URL/api/v1/health"         200
check "api deep"   "$API_URL/api/v1/health/deep"    200

echo "==> All smoke checks passed ✓"

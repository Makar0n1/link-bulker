#!/usr/bin/env bash
#
# Manual end-to-end smoke for the Phase 3a backend.
#
# What it does:
#   1. Logs in as the seeded super-admin (reads ADMIN_EMAIL/ADMIN_PASSWORD from env or prompts)
#   2. Creates a fresh project
#   3. Adds 5 manual link pairs (donor + acceptor)
#   4. Starts a manual check
#   5. Subscribes to the SSE stream and prints events as they arrive
#   6. After ~25 seconds, lists final results from the API and prints a summary
#
# Requirements:
#   - API running at http://localhost:3001 (pnpm --filter @link-checker/api dev)
#   - Worker running (pnpm --filter @link-checker/worker dev)
#   - Postgres + Redis up (pnpm infra:up)
#   - Admin seeded (pnpm db:seed)
#   - jq installed (brew install jq)
#   - FIRECRAWL_API_KEY set in .env so the worker can actually crawl
#
# Usage:
#   ./scripts/manual-test.sh
#   ADMIN_PASSWORD='mySecret' ./scripts/manual-test.sh
#

set -euo pipefail

# ─── config ─────────────────────────────────────────────────────────────────
API="${API:-http://localhost:3001/api/v1}"
COOKIE_JAR="$(mktemp -t lc-cookies.XXXXXX)"
trap 'rm -f "$COOKIE_JAR"' EXIT

# Read admin email from .env if not in environment
if [[ -z "${ADMIN_EMAIL:-}" ]]; then
  if [[ -f .env ]]; then
    ADMIN_EMAIL="$(grep -E '^ADMIN_EMAIL=' .env | cut -d '=' -f2- | tr -d '"' || true)"
  fi
fi
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@link-check-pro.top}"

# Prompt for password if not provided (we don't read it from env files because
# only the bcrypt hash lives there).
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  read -r -s -p "Admin password for ${ADMIN_EMAIL}: " ADMIN_PASSWORD
  echo
fi

# ─── colors ─────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_BLUE="$(printf '\033[1;34m')"
  C_GREEN="$(printf '\033[1;32m')"
  C_YELLOW="$(printf '\033[1;33m')"
  C_RED="$(printf '\033[1;31m')"
  C_DIM="$(printf '\033[2m')"
  C_RESET="$(printf '\033[0m')"
else
  C_BLUE='' C_GREEN='' C_YELLOW='' C_RED='' C_DIM='' C_RESET=''
fi

step()  { echo "${C_BLUE}▶ $*${C_RESET}"; }
ok()    { echo "${C_GREEN}✓ $*${C_RESET}"; }
warn()  { echo "${C_YELLOW}! $*${C_RESET}"; }
err()   { echo "${C_RED}✗ $*${C_RESET}"; }

# ─── prerequisites ──────────────────────────────────────────────────────────
command -v jq   >/dev/null || { err "jq is required (brew install jq)"; exit 1; }
command -v curl >/dev/null || { err "curl is required"; exit 1; }

step "API health check"
if ! curl -fsS "${API}/health" >/dev/null; then
  err "API not reachable at ${API}. Start it with: pnpm --filter @link-checker/api dev"
  exit 1
fi
ok "API is up"

# ─── 1. login ───────────────────────────────────────────────────────────────
step "Logging in as ${ADMIN_EMAIL}"
LOGIN_RESPONSE="$(
  curl -fsS -c "$COOKIE_JAR" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')" \
    "${API}/auth/login"
)"
USER_EMAIL="$(echo "$LOGIN_RESPONSE" | jq -r '.user.email')"
ok "Logged in as ${USER_EMAIL}"

# ─── 2. create project ──────────────────────────────────────────────────────
PROJECT_NAME="smoke-$(date +%s)"
step "Creating project '${PROJECT_NAME}'"
PROJECT="$(
  curl -fsS -b "$COOKIE_JAR" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg n "$PROJECT_NAME" '{name:$n,description:"manual smoke test"}')" \
    "${API}/projects"
)"
PROJECT_ID="$(echo "$PROJECT" | jq -r '.id')"
ok "Project created: ${PROJECT_ID}"

# ─── 3. add manual links ────────────────────────────────────────────────────
step "Adding 5 manual links"
LINKS_PAYLOAD='{
  "items": [
    { "donorUrl": "https://nextjs.org/blog",                  "acceptor": "vercel.com" },
    { "donorUrl": "https://nextjs.org/docs",                  "acceptor": "vercel.com" },
    { "donorUrl": "https://vercel.com/blog",                  "acceptor": "github.com" },
    { "donorUrl": "https://en.wikipedia.org/wiki/Berlin",     "acceptor": "en.wikipedia.org" },
    { "donorUrl": "https://news.ycombinator.com/",            "acceptor": "ycombinator.com" }
  ]
}'
CREATE_LINKS="$(
  curl -fsS -b "$COOKIE_JAR" \
    -H 'Content-Type: application/json' \
    -d "$LINKS_PAYLOAD" \
    "${API}/projects/${PROJECT_ID}/links/manual"
)"
CREATED_COUNT="$(echo "$CREATE_LINKS" | jq -r '.created')"
ok "Added ${CREATED_COUNT} links"

# ─── 4. start manual check ──────────────────────────────────────────────────
step "Starting manual check"
CHECK_RESPONSE="$(
  curl -fsS -X POST -b "$COOKIE_JAR" "${API}/projects/${PROJECT_ID}/check"
)"
JOB_ID="$(echo "$CHECK_RESPONSE" | jq -r '.jobId')"
QUEUED="$(echo "$CHECK_RESPONSE" | jq -r '.queued')"
ok "Job ${JOB_ID} enqueued (${QUEUED} links)"

# ─── 5. stream SSE events ───────────────────────────────────────────────────
SSE_TIMEOUT="${SSE_TIMEOUT:-60}"
step "Subscribing to SSE for ${C_DIM}~${SSE_TIMEOUT}s${C_RESET}${C_BLUE} (Ctrl-C to stop early)${C_RESET}"
echo "${C_DIM}─── live events ───${C_RESET}"

# We can't rely on `timeout` (GNU coreutils, missing on macOS by default).
# Instead: start curl in the background, schedule a kill after N seconds,
# pipe its output through awk for pretty-printing.
SSE_FIFO="$(mktemp -u -t lc-sse.XXXXXX)"
mkfifo "$SSE_FIFO"
trap 'rm -f "$SSE_FIFO" "$COOKIE_JAR"' EXIT

curl -sN -b "$COOKIE_JAR" \
  -H 'Accept: text/event-stream' \
  "${API}/projects/${PROJECT_ID}/stream" > "$SSE_FIFO" 2>/dev/null &
SSE_PID=$!

# Kill curl after the timeout window so the pipeline ends.
( sleep "$SSE_TIMEOUT" && kill "$SSE_PID" 2>/dev/null ) &
KILLER_PID=$!

awk -v G="$C_GREEN" -v Y="$C_YELLOW" -v D="$C_DIM" -v R="$C_RESET" '
  /^data: / {
    payload = substr($0, 7);
    if (payload ~ /"type":"done"/)             print G "✓ done       " R " " payload;
    else if (payload ~ /"type":"link_updated"/) print     "  link_upd    "    " " payload;
    else if (payload ~ /"type":"progress"/)     print Y "→ progress   " R " " payload;
    else if (payload ~ /"type":"lock_changed"/) print Y "🔒 lock        " R " " payload;
    else if (payload ~ /"type":"connected"/)    print D "  connected" R;
    else                                         print     "  " payload;
    fflush();
  }
' < "$SSE_FIFO" || true

wait "$SSE_PID" 2>/dev/null || true
kill "$KILLER_PID" 2>/dev/null || true
echo "${C_DIM}─── stream ended ───${C_RESET}"

# ─── 6. final summary ───────────────────────────────────────────────────────
step "Fetching final results"
RESULTS="$(
  curl -fsS -b "$COOKIE_JAR" \
    "${API}/projects/${PROJECT_ID}/links?source=manual&page=1&limit=100"
)"

TOTAL="$(echo "$RESULTS" | jq -r '.total')"
DONE_COUNT="$(echo "$RESULTS" | jq '[.items[] | select(.status=="DONE")] | length')"
ERROR_COUNT="$(echo "$RESULTS" | jq '[.items[] | select(.status=="ERROR")] | length')"
PENDING_COUNT="$(echo "$RESULTS" | jq '[.items[] | select(.status=="PENDING" or .status=="QUEUED" or .status=="CHECKING")] | length')"
FOUND_COUNT="$(echo "$RESULTS" | jq '[.items[] | select(.linkFound==true)] | length')"

echo
ok "Summary"
echo "  Total:    ${TOTAL}"
echo "  Done:     ${C_GREEN}${DONE_COUNT}${C_RESET}"
echo "  Errors:   ${C_RED}${ERROR_COUNT}${C_RESET}"
echo "  Pending:  ${C_YELLOW}${PENDING_COUNT}${C_RESET}"
echo "  Found:    ${FOUND_COUNT}/${TOTAL} links had matching occurrences"

echo
echo "${C_DIM}─── per-link details ───${C_RESET}"
echo "$RESULTS" | jq -r '
  .items[] |
  "  • [" + .status + "] " +
  (.donorUrl | .[0:70]) +
  "  →  " + .acceptorHost +
  "    " + (
    if .linkFound == true then "found=" + (.occurrencesCount|tostring)
    elif .linkFound == false then "no match"
    else "?"
    end
  ) +
  (if .donorStatusCode then "  http=" + (.donorStatusCode|tostring) else "" end) +
  (if .checkDurationMs then "  " + (.checkDurationMs|tostring) + "ms" else "" end) +
  (if .error then "  err=" + .error else "" end)
'

echo
if [[ "$PENDING_COUNT" -gt 0 ]]; then
  warn "${PENDING_COUNT} links still in progress — check is slower than the 25s window."
  echo "  Re-run this command to refetch:"
  echo "    curl -fsS -b $COOKIE_JAR '${API}/projects/${PROJECT_ID}/links?source=manual&limit=100' | jq"
fi
if [[ "$ERROR_COUNT" -gt 0 ]]; then
  warn "${ERROR_COUNT} links failed — check worker logs for details."
fi
if [[ "$ERROR_COUNT" -eq 0 && "$PENDING_COUNT" -eq 0 ]]; then
  ok "All ${TOTAL} links processed successfully 🎉"
fi

echo
echo "${C_DIM}Project ID: ${PROJECT_ID}${C_RESET}"
echo "${C_DIM}You can clean up via: curl -X DELETE -b ${COOKIE_JAR} ${API}/projects/${PROJECT_ID}${C_RESET}"

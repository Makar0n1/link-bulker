# Link Checker

High-load link analysis service. Manual lists and Google Sheets, real-time progress, per-project analytics.

## Stack

- **Web:** Next.js 15 + TanStack Query/Table
- **API:** NestJS (Fastify) — HTTP only, no heavy work
- **Worker:** BullMQ on Redis, Firecrawl for crawling, linkedom for parsing
- **DB:** PostgreSQL 16 + Prisma
- **Realtime:** SSE backed by Redis pub/sub
- **Deploy:** Docker Compose on a single VPS, GitHub Actions → Docker Hub → SSH

## Repo layout

```
apps/
  web/      Next.js frontend
  api/      NestJS HTTP API (placeholder in phase 0)
  worker/   BullMQ workers + scheduler (placeholder in phase 0)
packages/
  db/             Prisma schema + client + seed
  shared/         Zod schemas, constants, URL utils
  crawler-core/   CrawlerProvider, parser, matcher
```

## Getting started (local dev)

```bash
# 1. Boot postgres + redis
pnpm infra:up

# 2. Install deps
pnpm install

# 3. Copy env and fill secrets
cp .env.example .env
# generate AUTH_SECRET:        openssl rand -base64 32
# generate ADMIN_PASSWORD_HASH:
#   node -e "console.log(require('bcryptjs').hashSync('your_password', 12))"

# 4. Generate prisma client + run migrations + seed admin
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## Phases

- **Phase 0** — repo skeleton, db schema, shared types, crawler core (current)
- **Phase 1** — Auth, Projects CRUD, basic web UI
- **Phase 2** — Crawler integration end-to-end (parser tests with real fixtures)
- **Phase 3** — Manual mode end-to-end with SSE
- **Phase 4** — Google Sheets mode + scheduler
- **Phase 5** — Analytics dashboard
- **Phase 6** — Production deploy (compose + Caddy + GH Actions)

## Operational guarantees

- API never blocks: it only enqueues jobs
- Worker concurrency × replicas stays below Firecrawl's 50 concurrent cap
- Per-domain rate limit (2 RPS) prevents DoSing donor sites
- Project-level Redis lock prevents overlapping checks
- DB writes are batched (500 rows)
- SSE updates are throttled (500 ms)
- Each container has CPU/memory limits in `docker-compose.yml`

/**
 * Limits and tunables shared between API, worker and web.
 * Defaults are duplicated here so the build doesn't require env access;
 * runtime code should still read process.env where applicable.
 */

export const LIMITS = {
  MAX_MANUAL_URLS_PER_TASK: 1000,
  SINGLE_LINK_RECHECK_COOLDOWN_SEC: 60,
  PER_DOMAIN_RPS: 2,
  FIRECRAWL_CONCURRENCY: 45, // stay below the Standard plan's 50
  WORKER_CONCURRENCY: 5,
  DB_BATCH_SIZE: 500,
  SSE_THROTTLE_MS: 500,
} as const;

// BullMQ 5.x forbids ':' in queue names. Use hyphens.
export const QUEUE_NAMES = {
  MANUAL_CHECK: 'manual-check',
  SHEETS_RUN: 'sheets-run',
  SHEETS_CHECK: 'sheets-check',
  SINGLE_LINK: 'single-link',
  SHEETS_REPEATABLE: 'sheets-repeatable',
} as const;

export const REDIS_KEYS = {
  projectManualLock: (projectId: string) => `lock:project:${projectId}:manual`,
  projectSheetsLock: (projectId: string) => `lock:project:${projectId}:sheets`,
  domainRateLimit: (host: string) => `rl:host:${host}`,
  firecrawlSemaphore: 'sem:firecrawl',
  projectChannel: (projectId: string) => `channel:project:${projectId}`,
  sheetsTaskChannel: (taskId: string) => `channel:sheets-task:${taskId}`,
} as const;

export const PROJECT_LOCK_TTL_SEC = 1800; // 30 minutes; heartbeat extends it

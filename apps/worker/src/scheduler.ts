/**
 * Scheduler entry point — placeholder for Phase 0.
 *
 * Phase 4 will use BullMQ repeatable jobs to drive cron-scheduled
 * SheetsTask runs. On boot it reconciles repeatables with the DB
 * (creating new ones, removing stale ones).
 */
async function bootstrap() {
  // eslint-disable-next-line no-console
  console.log('[scheduler] phase-0 placeholder; BullMQ repeatables arrive in phase 4');
  setInterval(() => undefined, 1 << 30);
}

bootstrap();

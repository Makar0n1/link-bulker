import { defineConfig } from 'vitest/config';

/**
 * Web app unit tests run pure-Node logic only (api client, parse-csv).
 * Component / page tests would need jsdom + React 19 testing setup which
 * is out of scope for Phase 3b. Manual end-to-end click-testing covers the UI.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});

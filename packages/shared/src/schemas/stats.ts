import { z } from 'zod';

/**
 * Project-level analytics response. The same shape is returned for any
 * `source` filter (manual / sheets / all) — only the row set the
 * aggregates are computed over changes.
 */

export const StatsScope = z.enum(['manual', 'sheets', 'all']);
export type StatsScope = z.infer<typeof StatsScope>;

export const ProjectStatsQuery = z.object({
  source: StatsScope.default('all'),
});
export type ProjectStatsQuery = z.infer<typeof ProjectStatsQuery>;

export const ProjectStats = z.object({
  scope: StatsScope,
  totals: z.object({
    total: z.number().int(),
    done: z.number().int(),       // DONE rows that aren't a "problem"
    problem: z.number().int(),    // DONE rows missing 200/found/indexable
    error: z.number().int(),      // ERROR (anti-bot etc.)
    pending: z.number().int(),    // PENDING + QUEUED + CHECKING
  }),
  found: z.object({
    total: z.number().int(),
    dofollow: z.number().int(),
    nofollow: z.number().int(),
  }),
  http: z.object({
    ok: z.number().int(),
    redirect: z.number().int(),
    notFound: z.number().int(),
    serverError: z.number().int(),
    other: z.number().int(),
  }),
  indexable: z.object({
    yes: z.number().int(),
    no: z.number().int(),
    unknown: z.number().int(),
  }),
  canonical: z.object({
    match: z.number().int(),
    mismatch: z.number().int(),
    notFound: z.number().int(),
    unknown: z.number().int(),
  }),
  timing: z.object({
    avgMs: z.number().int().nullable(),
    p50Ms: z.number().int().nullable(),
    p95Ms: z.number().int().nullable(),
  }),
  topProblemDonors: z.array(
    z.object({
      donorHost: z.string(),
      problemCount: z.number().int(),
    }),
  ),
});
export type ProjectStats = z.infer<typeof ProjectStats>;

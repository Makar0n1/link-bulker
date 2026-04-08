import { Injectable, NotFoundException } from '@nestjs/common';
import type { Link } from '@link-checker/db';
import type { LinkOccurrence, ProjectStats, StatsScope } from '@link-checker/shared';
import { PrismaService } from '../prisma/prisma.service';

const NOFOLLOW_RELS = new Set(['nofollow', 'sponsored', 'ugc']);
const TOP_PROBLEM_LIMIT = 10;

/**
 * Project-level analytics aggregator.
 *
 * Strategy: load all link rows for the project (filtered by source) and
 * compute every aggregate in a single in-memory pass. We deliberately do
 * NOT push aggregation into SQL because:
 *   1. We need follow-kind classification, which depends on inspecting
 *      the per-row JSON `occurrences` array — not expressible in pure SQL.
 *   2. MVP project sizes are bounded by MAX_MANUAL_URLS_PER_TASK (1000)
 *      plus a handful of sheets; we're talking thousands of rows max.
 *      A single Prisma fetch + a sequential pass is faster than 8
 *      separate `groupBy` queries.
 *   3. Keeps the code straightforward — no risk of subtle SQL/Prisma
 *      semantics drift between aggregates.
 *
 * If we ever cross 100k+ rows per project we'll move to materialized
 * `project_stats_daily` rows updated by the worker.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async forProject(
    userId: string,
    projectId: string,
    scope: StatsScope,
  ): Promise<ProjectStats> {
    // Tenant guard — return 404 to avoid leaking project existence.
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const where: { projectId: string; source?: 'MANUAL' | 'SHEETS' } = { projectId };
    if (scope === 'manual') where.source = 'MANUAL';
    if (scope === 'sheets') where.source = 'SHEETS';

    const links = await this.prisma.link.findMany({
      where,
      // Only the columns we need; saves bandwidth and serialization on
      // big projects. `occurrences` is required for dofollow detection.
      select: {
        donorUrl: true,
        status: true,
        donorStatusCode: true,
        donorIndexable: true,
        donorCanonical: true,
        canonicalMatches: true,
        linkFound: true,
        occurrences: true,
        checkDurationMs: true,
      },
    });

    return aggregate(links as unknown as ReadonlyArray<LinkSlim>, scope);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Pure aggregator (exported for tests)
// ────────────────────────────────────────────────────────────────────────

interface LinkSlim {
  donorUrl: string;
  status: Link['status'];
  donorStatusCode: number | null;
  donorIndexable: boolean | null;
  donorCanonical: string | null;
  canonicalMatches: boolean | null;
  linkFound: boolean | null;
  occurrences: unknown;
  checkDurationMs: number | null;
}

export function aggregate(links: ReadonlyArray<LinkSlim>, scope: StatsScope): ProjectStats {
  const totals = { total: links.length, done: 0, problem: 0, error: 0, pending: 0 };
  const found = { total: 0, dofollow: 0, nofollow: 0 };
  const http = { ok: 0, redirect: 0, notFound: 0, serverError: 0, other: 0 };
  const indexable = { yes: 0, no: 0, unknown: 0 };
  const canonical = { match: 0, mismatch: 0, notFound: 0, unknown: 0 };

  const durations: number[] = [];
  const problemDonorCount = new Map<string, number>();

  for (const l of links) {
    // Lifecycle bucket
    if (l.status === 'PENDING' || l.status === 'QUEUED' || l.status === 'CHECKING') {
      totals.pending += 1;
    } else if (l.status === 'ERROR') {
      totals.error += 1;
    } else {
      // DONE: split into done vs problem using the same rule as the UI
      const isOk =
        l.donorStatusCode != null && l.donorStatusCode >= 200 && l.donorStatusCode < 300;
      const isFound = l.linkFound === true;
      const isIndexable = l.donorIndexable === true;
      if (!isOk || !isFound || !isIndexable) {
        totals.problem += 1;
      } else {
        totals.done += 1;
      }
    }

    // Found / follow
    if (l.linkFound === true) {
      found.total += 1;
      const occurrences = (l.occurrences ?? []) as LinkOccurrence[];
      const hasDofollow = occurrences.some(
        (o) => !o.rel.some((r) => NOFOLLOW_RELS.has(r.toLowerCase())),
      );
      if (hasDofollow) found.dofollow += 1;
      else found.nofollow += 1;
    }

    // HTTP buckets
    const code = l.donorStatusCode;
    if (code != null) {
      if (code >= 200 && code < 300) http.ok += 1;
      else if (code >= 300 && code < 400) http.redirect += 1;
      else if (code === 404) http.notFound += 1;
      else if (code >= 500 && code < 600) http.serverError += 1;
      else http.other += 1;
    }

    // Indexable
    if (l.donorIndexable === true) indexable.yes += 1;
    else if (l.donorIndexable === false) indexable.no += 1;
    else indexable.unknown += 1;

    // Canonical (parser sets canonicalMatches=true when canonical is null)
    if (l.donorCanonical === null) {
      // We only count "not found" for rows that finished checking — for
      // pending rows the canonical is genuinely unknown.
      if (l.status === 'DONE') canonical.notFound += 1;
      else canonical.unknown += 1;
    } else if (l.canonicalMatches === true) {
      canonical.match += 1;
    } else if (l.canonicalMatches === false) {
      canonical.mismatch += 1;
    } else {
      canonical.unknown += 1;
    }

    // Timing — only count rows that actually finished a check
    if (typeof l.checkDurationMs === 'number' && l.checkDurationMs > 0) {
      durations.push(l.checkDurationMs);
    }

    // Problem donor host count (for the top-N list)
    const isProblem = (() => {
      if (l.status === 'ERROR') return true;
      if (l.status !== 'DONE') return false;
      const isOk =
        l.donorStatusCode != null && l.donorStatusCode >= 200 && l.donorStatusCode < 300;
      return !isOk || l.linkFound !== true || l.donorIndexable !== true;
    })();
    if (isProblem) {
      const host = safeHostname(l.donorUrl);
      if (host) problemDonorCount.set(host, (problemDonorCount.get(host) ?? 0) + 1);
    }
  }

  const timing = computeTiming(durations);

  const topProblemDonors = Array.from(problemDonorCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_PROBLEM_LIMIT)
    .map(([donorHost, problemCount]) => ({ donorHost, problemCount }));

  return {
    scope,
    totals,
    found,
    http,
    indexable,
    canonical,
    timing,
    topProblemDonors,
  };
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function computeTiming(durations: number[]): {
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
} {
  if (durations.length === 0) {
    return { avgMs: null, p50Ms: null, p95Ms: null };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, n) => acc + n, 0);
  const avgMs = Math.round(sum / sorted.length);
  const p50Ms = percentile(sorted, 0.5);
  const p95Ms = percentile(sorted, 0.95);
  return { avgMs, p50Ms, p95Ms };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  // Nearest-rank, clamped to last index.
  const idx = Math.min(sortedAsc.length - 1, Math.ceil(p * sortedAsc.length) - 1);
  return Math.round(sortedAsc[Math.max(0, idx)]!);
}

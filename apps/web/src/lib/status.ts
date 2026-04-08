import type { LinkRow } from './api';

/**
 * Derived row status used in the table UI. The raw `LinkStatus` from the
 * database tells us only about the lifecycle (pending/checking/done/error);
 * the user wants a *quality* signal that reflects what the row actually means
 * for SEO purposes.
 *
 * Mapping rules (final, agreed with the user):
 *   PENDING / QUEUED → 'PENDING'
 *   CHECKING         → 'CHECKING'
 *   ERROR            → 'ERROR'   (e.g. anti-bot block — see firecrawl provider)
 *   DONE + 2xx + linkFound + indexable + canonical match-or-absent → 'GREEN'
 *   DONE + 2xx + linkFound + indexable + canonical mismatch        → 'YELLOW'
 *   DONE but missing any of (200, found, indexable)                → 'PROBLEM'
 *
 * Notes:
 * - Pages without a `<link rel="canonical">` are NOT considered a problem.
 *   The parser flips canonicalMatches to `true` in that case, so the GREEN
 *   branch fires here. The "no canonical" condition is only surfaced visually
 *   (LinksTable shows "—", sheets writeback shows "not found").
 * - dofollow/nofollow does NOT affect status — it's an independent column.
 */
export type RowStatus = 'PENDING' | 'CHECKING' | 'GREEN' | 'YELLOW' | 'PROBLEM' | 'ERROR';

export function computeRowStatus(link: LinkRow): RowStatus {
  if (link.status === 'PENDING' || link.status === 'QUEUED') return 'PENDING';
  if (link.status === 'CHECKING') return 'CHECKING';
  if (link.status === 'ERROR') return 'ERROR';

  // status === 'DONE'
  const code = link.donorStatusCode;
  const isOk = code != null && code >= 200 && code < 300;
  const isIndexable = link.donorIndexable === true;
  const isFound = link.linkFound === true;

  if (!isOk || !isFound || !isIndexable) return 'PROBLEM';
  if (link.canonicalMatches) return 'GREEN';
  return 'YELLOW';
}

/**
 * dofollow/nofollow detection from the occurrences array.
 *
 * Convention: a link is `nofollow` only if EVERY occurrence has at least one
 * of the nofollow-equivalent rel values. If any occurrence is dofollow, we
 * surface dofollow (it's the better signal — Google honors at least one).
 *
 * Returns null if there are no occurrences (e.g. link not found yet).
 */
export type FollowKind = 'dofollow' | 'nofollow';

const NOFOLLOW_RELS = new Set(['nofollow', 'sponsored', 'ugc']);

export function computeFollowKind(link: LinkRow): FollowKind | null {
  const occurrences = link.occurrences ?? [];
  if (occurrences.length === 0) return null;

  const hasDofollow = occurrences.some(
    (o) => !o.rel.some((r) => NOFOLLOW_RELS.has(r.toLowerCase())),
  );
  return hasDofollow ? 'dofollow' : 'nofollow';
}

/** Human-readable label for the row status pill. */
export function rowStatusLabel(s: RowStatus): string {
  switch (s) {
    case 'PENDING':
      return 'Pending';
    case 'CHECKING':
      return 'Checking';
    case 'GREEN':
      return 'Done';
    case 'YELLOW':
      return 'Done';
    case 'PROBLEM':
      return 'Problem';
    case 'ERROR':
      return 'Error';
  }
}

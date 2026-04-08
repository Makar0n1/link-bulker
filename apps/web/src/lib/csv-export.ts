import type { LinkRow } from './api';
import { computeFollowKind, computeRowStatus, rowStatusLabel } from './status';

/**
 * Convert link rows to a CSV blob and trigger a browser download.
 *
 * Columns are designed to round-trip into common SEO tooling:
 *   donor_url, acceptor, status, found, occurrences, follow_kind,
 *   http_status, indexable, canonical_match, last_checked, error
 *
 * RFC 4180 quoting: every field is quoted, internal " is escaped as "".
 */

const COLUMNS = [
  'donor_url',
  'acceptor',
  'status',
  'found',
  'occurrences',
  'follow',
  'http_status',
  'indexable',
  'canonical_match',
  'last_checked',
  'error',
] as const;

function escapeCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const s = String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export function linksToCsv(rows: LinkRow[]): string {
  const header = COLUMNS.join(',');
  const lines = rows.map((row) => {
    const status = computeRowStatus(row);
    const follow = computeFollowKind(row);
    return [
      row.donorUrl,
      row.acceptorRaw,
      rowStatusLabel(status),
      row.linkFound === null ? '' : row.linkFound ? 'yes' : 'no',
      row.occurrencesCount,
      follow ?? '',
      row.donorStatusCode ?? '',
      row.donorIndexable === null ? '' : row.donorIndexable ? 'yes' : 'no',
      row.canonicalMatches === null ? '' : row.canonicalMatches ? 'yes' : 'no',
      row.lastCheckedAt ?? '',
      row.error ?? '',
    ]
      .map(escapeCell)
      .join(',');
  });
  return [header, ...lines].join('\n');
}

export function downloadCsv(rows: LinkRow[], filename: string) {
  const csv = linksToCsv(rows);
  // Prepend BOM so Excel detects UTF-8 properly.
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

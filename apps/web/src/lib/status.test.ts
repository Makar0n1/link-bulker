import { describe, expect, it } from 'vitest';
import { computeFollowKind, computeRowStatus, type RowStatus } from './status';
import type { LinkRow } from './api';

function row(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: 'l1',
    projectId: 'p1',
    source: 'MANUAL',
    status: 'DONE',
    donorUrl: 'https://donor.example/x',
    acceptorRaw: 'studibucht.de',
    acceptorHost: 'studibucht.de',
    donorStatusCode: 200,
    donorFinalUrl: 'https://donor.example/x',
    donorIndexable: true,
    donorCanonical: 'https://donor.example/x',
    canonicalMatches: true,
    linkFound: true,
    occurrences: [
      { href: 'https://studibucht.de/y', anchor: 'a', rel: [], target: null, tag: 'a', position: 0 },
    ],
    occurrencesCount: 1,
    error: null,
    checkDurationMs: 100,
    lastCheckedAt: '2026-01-01T00:00:00Z',
    lastCooldownAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('computeRowStatus', () => {
  const cases: Array<[string, Partial<LinkRow>, RowStatus]> = [
    ['PENDING raw → PENDING', { status: 'PENDING' }, 'PENDING'],
    ['QUEUED raw → PENDING', { status: 'QUEUED' }, 'PENDING'],
    ['CHECKING raw → CHECKING', { status: 'CHECKING' }, 'CHECKING'],
    ['ERROR raw → ERROR', { status: 'ERROR' }, 'ERROR'],
    [
      'DONE 200 found indexable canonical match → GREEN',
      { status: 'DONE', donorStatusCode: 200, linkFound: true, donorIndexable: true, canonicalMatches: true },
      'GREEN',
    ],
    [
      'DONE 200 found indexable canonical mismatch → YELLOW',
      { status: 'DONE', donorStatusCode: 200, linkFound: true, donorIndexable: true, canonicalMatches: false },
      'YELLOW',
    ],
    [
      'DONE 200 NOT found indexable → PROBLEM',
      { status: 'DONE', donorStatusCode: 200, linkFound: false, donorIndexable: true },
      'PROBLEM',
    ],
    [
      'DONE 404 → PROBLEM',
      { status: 'DONE', donorStatusCode: 404, linkFound: true, donorIndexable: true, canonicalMatches: true },
      'PROBLEM',
    ],
    [
      'DONE 200 found NOT indexable → PROBLEM',
      { status: 'DONE', donorStatusCode: 200, linkFound: true, donorIndexable: false },
      'PROBLEM',
    ],
    [
      'DONE 500 → PROBLEM',
      { status: 'DONE', donorStatusCode: 500, linkFound: true, donorIndexable: true, canonicalMatches: true },
      'PROBLEM',
    ],
    [
      'DONE null status code → PROBLEM',
      { status: 'DONE', donorStatusCode: null, linkFound: true, donorIndexable: true, canonicalMatches: true },
      'PROBLEM',
    ],
    [
      // Pages without a canonical tag are NOT a problem; the parser flips
      // canonicalMatches to true so the GREEN branch fires.
      'DONE 200 found indexable, no canonical present → GREEN (parser sets matches=true)',
      {
        status: 'DONE',
        donorStatusCode: 200,
        linkFound: true,
        donorIndexable: true,
        canonicalMatches: true,
        donorCanonical: null,
      },
      'GREEN',
    ],
  ];

  for (const [name, partial, expected] of cases) {
    it(name, () => {
      expect(computeRowStatus(row(partial))).toBe(expected);
    });
  }
});

describe('computeFollowKind', () => {
  it('returns null when no occurrences', () => {
    expect(computeFollowKind(row({ occurrences: [], occurrencesCount: 0 }))).toBeNull();
  });

  it('returns dofollow when no nofollow rels', () => {
    expect(
      computeFollowKind(
        row({
          occurrences: [
            { href: 'x', anchor: 'a', rel: [], target: null, tag: 'a', position: 0 },
          ],
        }),
      ),
    ).toBe('dofollow');
  });

  it('returns nofollow when rel contains nofollow', () => {
    expect(
      computeFollowKind(
        row({
          occurrences: [
            { href: 'x', anchor: 'a', rel: ['nofollow'], target: null, tag: 'a', position: 0 },
          ],
        }),
      ),
    ).toBe('nofollow');
  });

  it('returns nofollow for sponsored', () => {
    expect(
      computeFollowKind(
        row({
          occurrences: [
            { href: 'x', anchor: 'a', rel: ['sponsored'], target: null, tag: 'a', position: 0 },
          ],
        }),
      ),
    ).toBe('nofollow');
  });

  it('returns nofollow for ugc', () => {
    expect(
      computeFollowKind(
        row({
          occurrences: [
            { href: 'x', anchor: 'a', rel: ['ugc', 'noopener'], target: null, tag: 'a', position: 0 },
          ],
        }),
      ),
    ).toBe('nofollow');
  });

  it('returns dofollow if ANY occurrence is dofollow', () => {
    expect(
      computeFollowKind(
        row({
          occurrences: [
            { href: 'x', anchor: 'a', rel: ['nofollow'], target: null, tag: 'a', position: 0 },
            { href: 'y', anchor: 'b', rel: [], target: null, tag: 'a', position: 1 },
          ],
        }),
      ),
    ).toBe('dofollow');
  });

  it('case-insensitive match on rel values', () => {
    expect(
      computeFollowKind(
        row({
          occurrences: [
            { href: 'x', anchor: 'a', rel: ['Nofollow', 'NOOPENER'], target: null, tag: 'a', position: 0 },
          ],
        }),
      ),
    ).toBe('nofollow');
  });
});

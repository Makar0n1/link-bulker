import { describe, expect, it } from 'vitest';
import { linksToCsv } from './csv-export';
import type { LinkRow } from './api';

function row(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: 'l1',
    projectId: 'p1',
    source: 'MANUAL',
    status: 'DONE',
    donorUrl: 'https://donor.example/page',
    acceptorRaw: 'studibucht.de',
    acceptorHost: 'studibucht.de',
    donorStatusCode: 200,
    donorFinalUrl: 'https://donor.example/page',
    donorIndexable: true,
    donorCanonical: null,
    canonicalMatches: true,
    linkFound: true,
    occurrences: [
      { href: 'https://studibucht.de/x', anchor: 'a', rel: [], target: null, tag: 'a', position: 0 },
    ],
    occurrencesCount: 1,
    error: null,
    checkDurationMs: 100,
    lastCheckedAt: '2026-01-01T00:00:00.000Z',
    lastCooldownAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('linksToCsv', () => {
  it('emits a header line and one row per link', () => {
    const csv = linksToCsv([row(), row({ donorUrl: 'https://other.example/y' })]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'donor_url,acceptor,status,found,occurrences,follow,http_status,indexable,canonical_match,last_checked,error',
    );
  });

  it('quotes every field with double quotes', () => {
    const csv = linksToCsv([row()]);
    const dataLine = csv.split('\n')[1]!;
    expect(dataLine.startsWith('"https://donor.example/page"')).toBe(true);
  });

  it('escapes double quotes in values as ""', () => {
    const csv = linksToCsv([row({ error: 'he said "hi"' })]);
    expect(csv).toContain('"he said ""hi"""');
  });

  it('renders DONE green status as "Done"', () => {
    const csv = linksToCsv([row()]);
    expect(csv).toContain('"Done"');
  });

  it('renders 404 as Problem', () => {
    const csv = linksToCsv([
      row({ donorStatusCode: 404, linkFound: false, status: 'DONE' }),
    ]);
    expect(csv).toContain('"Problem"');
  });

  it('renders found yes/no flags', () => {
    const csv = linksToCsv([row({ linkFound: true })]);
    expect(csv).toContain('"yes"');
  });

  it('writes empty quoted strings for nulls', () => {
    const csv = linksToCsv([
      row({
        donorStatusCode: null,
        donorIndexable: null,
        canonicalMatches: null,
        lastCheckedAt: null,
        error: null,
      }),
    ]);
    // Multiple "" tokens for null fields
    const dataLine = csv.split('\n')[1]!;
    expect((dataLine.match(/""/g) ?? []).length).toBeGreaterThan(0);
  });

  it('exports follow=dofollow / nofollow column', () => {
    const dofollow = linksToCsv([row()]);
    expect(dofollow).toContain('"dofollow"');

    const nofollow = linksToCsv([
      row({
        occurrences: [
          {
            href: 'x',
            anchor: 'a',
            rel: ['sponsored'],
            target: null,
            tag: 'a',
            position: 0,
          },
        ],
      }),
    ]);
    expect(nofollow).toContain('"nofollow"');
  });
});

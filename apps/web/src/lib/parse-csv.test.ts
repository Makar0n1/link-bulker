import { describe, expect, it } from 'vitest';
import { rowsToPayload, validateRow } from './parse-csv';

describe('validateRow', () => {
  it('accepts valid donor URL and acceptor', () => {
    const r = validateRow(1, 'https://example.com/page', 'studibucht.de');
    expect(r.errors).toEqual([]);
  });

  it('rejects empty donor URL', () => {
    const r = validateRow(1, '', 'studibucht.de');
    expect(r.errors).toContain('donorUrl is empty');
  });

  it('rejects non-http donor URL', () => {
    const r = validateRow(1, 'studibucht.de', 'studibucht.de');
    expect(r.errors[0]).toMatch(/valid http/);
  });

  it('rejects empty acceptor', () => {
    const r = validateRow(1, 'https://example.com', '');
    expect(r.errors).toContain('acceptor is empty');
  });

  it('accepts an acceptor as a bare host', () => {
    const r = validateRow(1, 'https://example.com', 'studibucht.de');
    expect(r.errors).toEqual([]);
  });

  it('accepts an acceptor as a full URL (normalized later)', () => {
    const r = validateRow(1, 'https://example.com', 'https://www.studibucht.de/x?utm=1');
    expect(r.errors).toEqual([]);
  });

  it('trims whitespace', () => {
    const r = validateRow(1, '  https://example.com  ', '  studibucht.de  ');
    expect(r.donorUrl).toBe('https://example.com');
    expect(r.acceptor).toBe('studibucht.de');
    expect(r.errors).toEqual([]);
  });
});

describe('rowsToPayload', () => {
  it('drops invalid rows', () => {
    const rows = [
      validateRow(1, 'https://a.com', 'b.com'),
      validateRow(2, 'not-a-url', 'b.com'),
      validateRow(3, 'https://c.com', ''),
      validateRow(4, 'https://d.com', 'e.com'),
    ];
    const payload = rowsToPayload(rows);
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ donorUrl: 'https://a.com', acceptor: 'b.com' });
    expect(payload[1]).toMatchObject({ donorUrl: 'https://d.com', acceptor: 'e.com' });
  });

  it('returns empty array if everything is invalid', () => {
    const rows = [validateRow(1, '', ''), validateRow(2, 'foo', 'bar')];
    expect(rowsToPayload(rows)).toEqual([]);
  });
});

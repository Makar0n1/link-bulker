import { describe, expect, it } from 'vitest';
import {
  extractAcceptorHost,
  isValidDonorUrl,
  normalizeHost,
  resolveHref,
  safeHost,
} from './url';

describe('normalizeHost', () => {
  it('lowercases', () => {
    expect(normalizeHost('Example.COM')).toBe('example.com');
  });
  it('strips www.', () => {
    expect(normalizeHost('www.example.com')).toBe('example.com');
  });
  it('strips port', () => {
    expect(normalizeHost('example.com:8080')).toBe('example.com');
  });
  it('keeps subdomains other than www', () => {
    expect(normalizeHost('blog.example.com')).toBe('blog.example.com');
  });
});

describe('extractAcceptorHost', () => {
  it('handles full URL', () => {
    expect(extractAcceptorHost('https://www.studibucht.de/page?utm=1')).toBe('studibucht.de');
  });
  it('handles bare host', () => {
    expect(extractAcceptorHost('studibucht.de')).toBe('studibucht.de');
  });
  it('handles subdomain bare host', () => {
    expect(extractAcceptorHost('blog.studibucht.de')).toBe('blog.studibucht.de');
  });
  it('throws on empty', () => {
    expect(() => extractAcceptorHost('')).toThrow();
  });
});

describe('resolveHref', () => {
  const base = 'https://example.com/foo/bar';
  it('resolves relative', () => {
    expect(resolveHref('/baz', base)).toBe('https://example.com/baz');
  });
  it('returns absolute as-is (normalized)', () => {
    expect(resolveHref('https://other.com/x', base)).toBe('https://other.com/x');
  });
  it('rejects mailto', () => {
    expect(resolveHref('mailto:a@b.c', base)).toBeNull();
  });
  it('rejects javascript:', () => {
    expect(resolveHref('javascript:void(0)', base)).toBeNull();
  });
  it('rejects empty', () => {
    expect(resolveHref('', base)).toBeNull();
  });
});

describe('safeHost', () => {
  it('extracts and normalizes', () => {
    expect(safeHost('https://WWW.Example.com:443/x')).toBe('example.com');
  });
  it('returns null on garbage', () => {
    expect(safeHost('not a url')).toBeNull();
  });
});

describe('isValidDonorUrl', () => {
  it('accepts https', () => {
    expect(isValidDonorUrl('https://example.com')).toBe(true);
  });
  it('rejects bare host', () => {
    expect(isValidDonorUrl('example.com')).toBe(false);
  });
  it('rejects ftp', () => {
    expect(isValidDonorUrl('ftp://example.com')).toBe(false);
  });
});

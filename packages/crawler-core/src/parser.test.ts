import { describe, expect, it } from 'vitest';
import { parseDonorHtml } from './parser';

const FINAL = 'https://donor.example/page';

function parse(html: string, acceptorHost = 'studibucht.de', headers: Record<string, string> = {}) {
  return parseDonorHtml({
    html,
    finalUrl: FINAL,
    responseHeaders: headers,
    acceptorHost,
  });
}

describe('parseDonorHtml', () => {
  it('finds <a href> matches with anchor and rel', () => {
    const r = parse(`
      <html><body>
        <a href="https://studibucht.de/x" rel="nofollow noopener" target="_blank">  Hello   World </a>
        <a href="https://other.com/x">no</a>
      </body></html>
    `);
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({
      href: 'https://studibucht.de/x',
      anchor: 'Hello World',
      rel: ['nofollow', 'noopener'],
      target: '_blank',
      tag: 'a',
      position: 0,
    });
  });

  it('does NOT match subdomains when acceptor is the apex', () => {
    const r = parse(`<a href="https://blog.studibucht.de/x">x</a>`);
    expect(r.occurrences).toHaveLength(0);
  });

  it('matches www-prefixed acceptor host (normalization)', () => {
    const r = parse(`<a href="https://www.studibucht.de/x">x</a>`);
    expect(r.occurrences).toHaveLength(1);
  });

  it('resolves relative hrefs against finalUrl', () => {
    const r = parse(`<a href="/foo">x</a>`, 'donor.example');
    expect(r.occurrences[0]?.href).toBe('https://donor.example/foo');
  });

  it('honors <base href>', () => {
    const r = parse(
      `<head><base href="https://studibucht.de/"></head><body><a href="x">y</a></body>`,
      'studibucht.de',
    );
    expect(r.occurrences[0]?.href).toBe('https://studibucht.de/x');
  });

  it('extracts data-href and data-link', () => {
    const r = parse(`
      <div data-href="https://studibucht.de/a">a</div>
      <div data-link="https://studibucht.de/b">b</div>
    `);
    expect(r.occurrences.map((o) => o.tag).sort()).toEqual(['data-href', 'data-link']);
  });

  it('detects noindex via meta robots', () => {
    const r = parse(`<head><meta name="robots" content="NOINDEX, follow"></head>`);
    expect(r.indexable).toBe(false);
    expect(r.metaRobots).toBe('noindex, follow');
  });

  it('detects noindex via X-Robots-Tag header', () => {
    const r = parse(`<html></html>`, 'studibucht.de', { 'x-robots-tag': 'noindex' });
    expect(r.indexable).toBe(false);
  });

  it('detects canonical and matching status', () => {
    const r = parse(
      `<head><link rel="canonical" href="https://donor.example/page/"></head>`,
      'studibucht.de',
    );
    expect(r.canonical).toBe('https://donor.example/page/');
    expect(r.canonicalMatches).toBe(true);
  });

  it('flags canonical mismatch', () => {
    const r = parse(
      `<head><link rel="canonical" href="https://donor.example/other"></head>`,
      'studibucht.de',
    );
    expect(r.canonicalMatches).toBe(false);
  });

  it('treats missing canonical as match (canonical=null, canonicalMatches=true)', () => {
    const r = parse(`<head><title>No canonical here</title></head>`, 'studibucht.de');
    expect(r.canonical).toBeNull();
    // Product rule: pages without a canonical tag are NOT a problem.
    expect(r.canonicalMatches).toBe(true);
  });

  it('ignores meta robots from a nested widget HTML in body (AddToAny etc.)', () => {
    // Regression: osthessen-zeitung.de embeds an AddToAny share widget
    // which injects its own <html><head><meta name="robots" content="noindex">
    // into the page body. linkedom sees BOTH metas via a permissive
    // querySelector; the parser must scope to the real document head only.
    const r = parse(
      `<html>
        <head><title>Real page</title></head>
        <body>
          <article>real content</article>
          <div class="a2a_modal">
            <html><head><title>A2A</title><meta name="robots" content="noindex"></head></html>
          </div>
        </body>
      </html>`,
      'studibucht.de',
    );
    expect(r.metaRobots).toBeNull();
    expect(r.indexable).toBe(true);
  });

  it('ignores canonical from a nested widget HTML in body', () => {
    const r = parse(
      `<html>
        <head><link rel="canonical" href="https://donor.example/real"></head>
        <body>
          <div>
            <html><head><link rel="canonical" href="https://other.com/widget"></head></html>
          </div>
        </body>
      </html>`,
      'studibucht.de',
    );
    expect(r.canonical).toBe('https://donor.example/real');
  });

  it('skips mailto/javascript hrefs', () => {
    const r = parse(`<a href="mailto:a@b.c">x</a><a href="javascript:void(0)">y</a>`);
    expect(r.occurrences).toHaveLength(0);
  });
});

import { parseHTML } from 'linkedom';
import { resolveHref, safeHost, type LinkOccurrence } from '@link-checker/shared';

export interface ParsedDonor {
  /** Effective base URL for resolving relative hrefs (`<base>` or finalUrl). */
  baseUrl: string;
  /** content of `<meta name="robots">` if present, lowercased. */
  metaRobots: string | null;
  /** Lowercased value of the `X-Robots-Tag` header, if any. */
  xRobotsTag: string | null;
  /** True if the donor is indexable (no noindex in meta or X-Robots-Tag). */
  indexable: boolean;
  /** `<link rel="canonical">` resolved to absolute URL, or null. */
  canonical: string | null;
  /** True iff canonical equals finalUrl after normalization. */
  canonicalMatches: boolean;
  /** All occurrences of links pointing to the acceptor host. */
  occurrences: LinkOccurrence[];
}

interface ParseInput {
  html: string;
  finalUrl: string;
  responseHeaders: Record<string, string>;
  acceptorHost: string;
}

const LINK_TAG_SELECTORS: Array<{ selector: string; tag: string; attr: string }> = [
  { selector: 'a[href]', tag: 'a', attr: 'href' },
  { selector: 'link[href]', tag: 'link', attr: 'href' },
  { selector: 'area[href]', tag: 'area', attr: 'href' },
  { selector: '[data-href]', tag: 'data-href', attr: 'data-href' },
  { selector: '[data-link]', tag: 'data-link', attr: 'data-link' },
  { selector: '[data-url]', tag: 'data-url', attr: 'data-url' },
];

function isNoindex(value: string | null): boolean {
  if (!value) return false;
  return /\bnoindex\b/i.test(value);
}

function urlsEqualForCanonical(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    // Compare host (normalized) + pathname; ignore trailing slash and query/hash
    const hostA = ua.hostname.replace(/^www\./i, '').toLowerCase();
    const hostB = ub.hostname.replace(/^www\./i, '').toLowerCase();
    const pathA = ua.pathname.replace(/\/+$/, '');
    const pathB = ub.pathname.replace(/\/+$/, '');
    return hostA === hostB && pathA === pathB;
  } catch {
    return a === b;
  }
}

export function parseDonorHtml(input: ParseInput): ParsedDonor {
  const { html, finalUrl, responseHeaders, acceptorHost } = input;
  const { document } = parseHTML(html || '<html></html>');

  // Resolve <base href> if present, otherwise use finalUrl.
  // We use the FIRST <head> element in the document, not a permissive
  // tree-wide query. Reason: third-party share-button widgets (AddToAny
  // and similar) embed their own `<html><head><meta name="robots" content
  // ="noindex">` inside the page body. Browsers ignore those nested heads,
  // but a tree-wide querySelector would happily return them and we'd
  // mis-flag the donor as non-indexable. Picking the first <head> in
  // document order matches what a real browser does.
  const headEl = document.querySelector('head');
  const baseEl = headEl?.querySelector('base[href]') ?? null;
  const rawBase = baseEl?.getAttribute('href') ?? finalUrl;
  const baseUrl = resolveHref(rawBase, finalUrl) ?? finalUrl;

  const metaRobotsEl = headEl?.querySelector('meta[name="robots" i]') ?? null;
  const metaRobots = metaRobotsEl?.getAttribute('content')?.toLowerCase().trim() ?? null;

  const xRobotsHeader =
    responseHeaders['x-robots-tag'] ?? responseHeaders['X-Robots-Tag'] ?? null;
  const xRobotsTag = xRobotsHeader ? xRobotsHeader.toLowerCase() : null;

  const indexable = !isNoindex(metaRobots) && !isNoindex(xRobotsTag);

  // Same scoping rule as metaRobots: only the first <head> in document
  // order, never a nested widget head.
  const canonicalEl = headEl?.querySelector('link[rel="canonical" i][href]') ?? null;
  const canonicalRaw = canonicalEl?.getAttribute('href') ?? null;
  const canonical = canonicalRaw ? resolveHref(canonicalRaw, baseUrl) : null;
  // Product rule: a missing canonical tag is NOT a problem. Many news/CMS
  // pages simply don't set one. We treat absence as "matches by default"
  // so the page status stays green; UI/sheets render "not found" instead
  // of a mismatch indicator.
  const canonicalMatches = canonical ? urlsEqualForCanonical(canonical, finalUrl) : true;

  const occurrences: LinkOccurrence[] = [];
  let position = 0;

  for (const { selector, tag, attr } of LINK_TAG_SELECTORS) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const rawHref = node.getAttribute(attr);
      if (!rawHref) continue;
      const abs = resolveHref(rawHref, baseUrl);
      if (!abs) continue;
      const host = safeHost(abs);
      if (!host) continue;
      if (host !== acceptorHost) continue;

      const relAttr = node.getAttribute('rel');
      const rel: string[] = relAttr
        ? relAttr
            .split(/\s+/)
            .map((s: string) => s.trim().toLowerCase())
            .filter((s: string) => s.length > 0)
        : [];
      const target = node.getAttribute('target');
      const anchor = (node.textContent ?? '').replace(/\s+/g, ' ').trim();

      occurrences.push({
        href: abs,
        anchor,
        rel,
        target: target ?? null,
        tag,
        position: position++,
      });
    }
  }

  return {
    baseUrl,
    metaRobots,
    xRobotsTag,
    indexable,
    canonical,
    canonicalMatches,
    occurrences,
  };
}

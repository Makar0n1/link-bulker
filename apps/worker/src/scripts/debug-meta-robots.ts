/**
 * One-shot debug helper: fetches a page via Firecrawl, then prints every
 * <meta> tag whose name attribute is 'robots' (case-insensitive) along with
 * the surrounding HTML so we can see where exactly it lives.
 *
 * Usage:
 *   pnpm --filter @link-checker/worker exec dotenv -e ../../.env -- \
 *     node -r @swc-node/register src/scripts/debug-meta-robots.ts <url>
 */
import { FirecrawlProvider } from '@link-checker/crawler-core';
import { parseHTML } from 'linkedom';
import { loadEnv } from '../config/env';

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: debug-meta-robots.ts <url>');
    process.exit(1);
  }

  const env = loadEnv();
  if (!env.FIRECRAWL_API_KEY) {
    console.error('FIRECRAWL_API_KEY missing');
    process.exit(1);
  }

  const provider = new FirecrawlProvider(env.FIRECRAWL_API_KEY);
  console.log(`[debug] fetching ${url}`);
  const res = await provider.scrape({ url });
  console.log(`[debug] html length: ${res.html.length} bytes`);

  // Raw regex search for any meta tag mentioning "robots"
  const rawMetas = res.html.match(/<meta[^>]*robots[^>]*>/gi) ?? [];
  console.log(`\n[debug] Raw regex matches for <meta...robots...>: ${rawMetas.length}`);
  for (const m of rawMetas.slice(0, 10)) {
    const idx = res.html.indexOf(m);
    console.log(`  @offset ${idx}: ${m}`);
  }

  // Raw regex search for any literal "noindex" in the HTML
  const rawNoindex: number[] = [];
  let idx = 0;
  while (true) {
    const found = res.html.toLowerCase().indexOf('noindex', idx);
    if (found === -1) break;
    rawNoindex.push(found);
    idx = found + 7;
  }
  console.log(`\n[debug] Raw 'noindex' literal occurrences: ${rawNoindex.length}`);
  for (const offset of rawNoindex.slice(0, 10)) {
    const start = Math.max(0, offset - 60);
    const end = Math.min(res.html.length, offset + 80);
    console.log(`  @offset ${offset}: …${res.html.slice(start, end).replace(/\s+/g, ' ')}…`);
  }

  // Now what linkedom sees
  const { document } = parseHTML(res.html || '<html></html>');
  const robotsEls = document.querySelectorAll('meta[name="robots" i]');
  console.log(`\n[debug] linkedom querySelectorAll('meta[name="robots" i]'): ${robotsEls.length}`);
  robotsEls.forEach((el, i) => {
    console.log(`  #${i}: ${el.outerHTML}`);
    console.log(`       name="${el.getAttribute('name')}" content="${el.getAttribute('content')}"`);
  });

  // Where in the document tree is it? <head>, <body>, <noscript>?
  robotsEls.forEach((el, i) => {
    const parents: string[] = [];
    let p: any = el.parentElement;
    while (p && p.tagName) {
      parents.unshift(p.tagName.toLowerCase());
      p = p.parentElement;
    }
    console.log(`  #${i} parent chain: ${parents.join(' > ')}`);
  });
}

main().catch((err) => {
  console.error('crashed:', err);
  process.exit(1);
});

/**
 * Smoke test against the real Firecrawl API.
 *
 * Usage:
 *   pnpm --filter @link-checker/worker smoke:firecrawl <donorUrl> <acceptor>
 *
 * What it does:
 *   1. calls FirecrawlProvider.scrape directly (raw response inspection)
 *   2. then calls the full CrawlerService.crawlAndAnalyze pipeline
 *   3. prints HTML length, headers, raw response keys, and the parsed result
 *
 * This is the only place we burn Firecrawl credits in Phase 2. Tests use a mock.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FirecrawlProvider } from '@link-checker/crawler-core';
import { AppModule } from '../app.module';
import { CrawlerService } from '../modules/crawler/crawler.service';
import { loadEnv } from '../config/env';

async function main() {
  const [donorUrl, acceptor] = process.argv.slice(2);
  if (!donorUrl || !acceptor) {
    // eslint-disable-next-line no-console
    console.error('Usage: smoke-firecrawl.ts <donorUrl> <acceptor>');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`[smoke] donor:    ${donorUrl}`);
  // eslint-disable-next-line no-console
  console.log(`[smoke] acceptor: ${acceptor}\n`);

  // ---- Step 1: raw provider call (for inspection) ----
  const env = loadEnv();
  if (!env.FIRECRAWL_API_KEY) {
    console.error('[smoke] FIRECRAWL_API_KEY missing in env');
    process.exit(1);
  }
  const provider = new FirecrawlProvider(env.FIRECRAWL_API_KEY);

  console.log('[smoke] === RAW PROVIDER RESPONSE ===');
  const rawStart = Date.now();
  const raw = await provider.scrape({ url: donorUrl });
  const rawElapsed = Date.now() - rawStart;
  console.log(`[smoke] provider.scrape took: ${rawElapsed}ms`);
  console.log(`[smoke] statusCode:    ${raw.statusCode}`);
  console.log(`[smoke] finalUrl:      ${raw.finalUrl}`);
  console.log(`[smoke] redirectChain: ${JSON.stringify(raw.redirectChain)}`);
  console.log(`[smoke] headers keys:  ${Object.keys(raw.headers).join(', ') || '(none)'}`);
  console.log(`[smoke] html length:   ${raw.html.length} bytes`);
  if (raw.html.length > 0) {
    console.log(`[smoke] html first 2500 chars:`);
    console.log(raw.html.slice(0, 2500).replace(/\n/g, ' '));
    console.log('...\n');
  }

  // Quick grep: how many <a href> tags? how many mention the acceptor?
  const aHrefCount = (raw.html.match(/<a\s+[^>]*href/gi) || []).length;
  const acceptorMentions = (raw.html.match(new RegExp(acceptor.replace(/\./g, '\\.'), 'gi')) || []).length;
  console.log(`[smoke] <a href> tag count:        ${aHrefCount}`);
  console.log(`[smoke] acceptor mentions in html: ${acceptorMentions}`);

  // Look for canonical in any order: rel="canonical" or rel='canonical' or
  // even rel after href.
  const canonicalRegex = /<link\b[^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/gi;
  const canonicalMatches = raw.html.match(canonicalRegex) || [];
  console.log(`[smoke] canonical <link> tags found in raw html: ${canonicalMatches.length}`);
  for (const m of canonicalMatches.slice(0, 3)) {
    console.log(`        ${m}`);
  }
  // Also check the "canonical" word frequency to see if it's anywhere at all
  const canonicalWord = (raw.html.match(/canonical/gi) || []).length;
  console.log(`[smoke] word "canonical" appears: ${canonicalWord} times in html`);

  // Show all <link rel=...> tags in head (first ~50KB) for inspection
  const headSlice = raw.html.slice(0, 50_000);
  const linkRels = headSlice.match(/<link\b[^>]*\brel\s*=[^>]*>/gi) || [];
  console.log(`\n[smoke] <link rel="..."> tags in first 50KB: ${linkRels.length}`);
  for (const tag of linkRels.slice(0, 15)) {
    console.log(`        ${tag.slice(0, 200)}`);
  }

  // ---- Step 2: full pipeline ----
  console.log('\n[smoke] === FULL PIPELINE (CrawlerService) ===');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const service = app.get(CrawlerService);

  const startedAt = Date.now();
  const result = await service.crawlAndAnalyze(donorUrl, acceptor);
  const elapsed = Date.now() - startedAt;

  console.log(`[smoke] pipeline elapsed: ${elapsed}ms (crawler-reported: ${result.durationMs}ms)`);
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));

  await app.close();
  process.exit(result.ok ? 0 : 2);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[smoke] crashed:', err);
  process.exit(1);
});

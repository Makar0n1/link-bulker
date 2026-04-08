import { Test } from '@nestjs/testing';
import type { CrawlerProvider } from '@link-checker/crawler-core';
import { CrawlerModule } from '../../src/modules/crawler/crawler.module';
import { CrawlerService } from '../../src/modules/crawler/crawler.service';
import { createRedisClient } from '@link-checker/worker-core';

export interface CrawlerTestRig {
  service: CrawlerService;
  close: () => Promise<void>;
}

/**
 * Build a NestJS standalone container with CrawlerModule.forRoot({ provider }).
 * The worker is HTTP-less, so we use the testing module ref directly without
 * createNestApplication() (which would require @nestjs/platform-express).
 */
export async function buildCrawler(provider: CrawlerProvider): Promise<CrawlerTestRig> {
  const moduleRef = await Test.createTestingModule({
    imports: [CrawlerModule.forRoot({ provider })],
  }).compile();

  // Manually trigger lifecycle hooks (OnModuleInit) without HTTP adapter
  await moduleRef.init();

  const service = moduleRef.get(CrawlerService);

  return {
    service,
    close: async () => {
      await moduleRef.close();
    },
  };
}

/**
 * Standalone Redis helper for cleaning Phase-2 keys before/after tests.
 */
export function makeRedis() {
  return createRedisClient(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: false,
  });
}

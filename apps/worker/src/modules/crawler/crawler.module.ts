import { Module, type DynamicModule } from '@nestjs/common';
import {
  CrawlError,
  FirecrawlProvider,
  type CrawlRequest,
  type CrawlResponse,
  type CrawlerProvider,
} from '@link-checker/crawler-core';
import {
  CircuitBreaker,
  DomainRateLimiter,
  RedisSemaphore,
  createRedisClient,
} from '@link-checker/worker-core';
import {
  CRAWLER_PROVIDER,
  CrawlerService,
  CIRCUIT_BREAKER,
  DOMAIN_RATE_LIMITER,
  FIRECRAWL_SEMAPHORE,
} from './crawler.service';
import { loadEnv } from '../../config/env';

interface CrawlerModuleOptions {
  /** Override the provider — tests inject a MockCrawlerProvider here. */
  provider?: CrawlerProvider;
}

/**
 * Fallback provider used when FIRECRAWL_API_KEY is not set. Tests override
 * CRAWLER_PROVIDER, so they never see this. Production / smoke without an
 * API key fails at first scrape, not at module construction — that lets
 * test rigs override the provider safely.
 */
class UnconfiguredProvider implements CrawlerProvider {
  readonly name = 'unconfigured';
  async scrape(_req: CrawlRequest): Promise<CrawlResponse> {
    throw new CrawlError(
      'CrawlerProvider is not configured: set FIRECRAWL_API_KEY or override CRAWLER_PROVIDER',
    );
  }
}

/**
 * Crawler module wires up Redis, semaphore, rate limiter, circuit breaker
 * and the FirecrawlProvider into the CrawlerService.
 *
 * Use forRoot({ provider }) in tests to swap the real provider for a mock.
 */
@Module({})
export class CrawlerModule {
  static forRoot(options: CrawlerModuleOptions = {}): DynamicModule {
    const env = loadEnv();

    const redisProvider = {
      provide: 'WORKER_REDIS',
      useFactory: () => createRedisClient(env.REDIS_URL),
    };

    const semaphoreProvider = {
      provide: FIRECRAWL_SEMAPHORE,
      inject: ['WORKER_REDIS'],
      useFactory: (redis: ReturnType<typeof createRedisClient>) =>
        new RedisSemaphore(redis, {
          key: 'sem:firecrawl',
          limit: env.FIRECRAWL_CONCURRENCY,
          ttlMs: 90_000,
        }),
    };

    const rateLimiterProvider = {
      provide: DOMAIN_RATE_LIMITER,
      inject: ['WORKER_REDIS'],
      useFactory: (redis: ReturnType<typeof createRedisClient>) =>
        new DomainRateLimiter(redis, {
          ratePerSec: env.PER_DOMAIN_RPS,
          capacity: env.PER_DOMAIN_RPS,
        }),
    };

    const breakerProvider = {
      provide: CIRCUIT_BREAKER,
      useValue: new CircuitBreaker({ failureThreshold: 5, cooldownMs: 30_000 }),
    };

    const providerProvider = {
      provide: CRAWLER_PROVIDER,
      useValue:
        options.provider ??
        (env.FIRECRAWL_API_KEY
          ? new FirecrawlProvider(env.FIRECRAWL_API_KEY)
          : new UnconfiguredProvider()),
    };

    return {
      module: CrawlerModule,
      providers: [
        redisProvider,
        semaphoreProvider,
        rateLimiterProvider,
        breakerProvider,
        providerProvider,
        CrawlerService,
      ],
      exports: [CrawlerService, FIRECRAWL_SEMAPHORE, DOMAIN_RATE_LIMITER, CIRCUIT_BREAKER, 'WORKER_REDIS'],
    };
  }
}

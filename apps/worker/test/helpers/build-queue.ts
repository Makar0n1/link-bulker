import { Test } from '@nestjs/testing';
import { PrismaClient } from '@link-checker/db';
import type { CrawlerProvider } from '@link-checker/crawler-core';
import { AppModule } from '../../src/app.module';
import { LinkRepository } from '../../src/modules/queue/link.repository';
import { ProgressPublisher } from '../../src/modules/queue/progress.publisher';
import { SingleLinkProcessor } from '../../src/modules/queue/single-link.processor';
import { ManualCheckProcessor } from '../../src/modules/queue/manual-check.processor';
import { SheetsTaskService } from '../../src/modules/sheets/sheets-task.service';
import { SheetsClientService } from '../../src/modules/sheets/sheets-client.service';
import { CRAWLER_PROVIDER } from '../../src/modules/crawler/crawler.service';
import { MockCrawlerProvider } from '../mocks/mock-crawler.provider';
import { MockSheetsClient } from '../mocks/mock-sheets-client';

/**
 * Standalone Prisma client used by tests to seed data and reset tables.
 * Independent of Nest DI; the worker's LinkRepository has its own client.
 */
export const testPrisma = new PrismaClient();

export interface QueueRig {
  singleLink: SingleLinkProcessor;
  manualCheck: ManualCheckProcessor;
  sheetsTask: SheetsTaskService;
  links: LinkRepository;
  publisher: ProgressPublisher;
  provider: MockCrawlerProvider;
  sheetsClient: MockSheetsClient;
  close: () => Promise<void>;
}

/**
 * Boot a test rig with the full worker AppModule, with two providers
 * overridden:
 *   - CRAWLER_PROVIDER → MockCrawlerProvider (no real Firecrawl calls)
 *   - SheetsClientService → MockSheetsClient (no real Google Sheets calls)
 *
 * BullMQ workers are disabled via WORKER_DISABLE_BULLMQ=1; tests invoke
 * processor methods directly with synthesized jobs.
 *
 * Backwards-compatible signature: pre-Phase-4 tests pass a CrawlerProvider
 * directly as the first argument; Phase 4 sheets tests pass an options
 * object {provider?, sheetsClient?}.
 */
export async function buildQueueRig(
  arg?: CrawlerProvider | { provider?: CrawlerProvider; sheetsClient?: MockSheetsClient },
): Promise<QueueRig> {
  process.env.WORKER_DISABLE_BULLMQ = '1';

  // Distinguish "options object" from "provider instance" by checking for
  // CrawlerProvider's `scrape` method.
  const isProviderInstance =
    arg !== undefined && typeof (arg as CrawlerProvider).scrape === 'function';
  const options = isProviderInstance
    ? { provider: arg as CrawlerProvider }
    : ((arg as { provider?: CrawlerProvider; sheetsClient?: MockSheetsClient } | undefined) ?? {});

  const mockCrawler =
    (options.provider as MockCrawlerProvider | undefined) ?? new MockCrawlerProvider();
  const mockSheets = options.sheetsClient ?? new MockSheetsClient();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(CRAWLER_PROVIDER)
    .useValue(mockCrawler)
    .overrideProvider(SheetsClientService)
    .useValue(mockSheets)
    .compile();

  await moduleRef.init();

  return {
    singleLink: moduleRef.get(SingleLinkProcessor),
    manualCheck: moduleRef.get(ManualCheckProcessor),
    sheetsTask: moduleRef.get(SheetsTaskService),
    links: moduleRef.get(LinkRepository),
    publisher: moduleRef.get(ProgressPublisher),
    provider: mockCrawler,
    sheetsClient: mockSheets,
    close: async () => {
      await moduleRef.close();
    },
  };
}

export async function resetDb() {
  await testPrisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "Link", "SheetsTask", "Project", "User" RESTART IDENTITY CASCADE',
  );
}

export async function seedUserAndProject(name = 'Test Project') {
  const user = await testPrisma.user.create({
    data: {
      email: `worker-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: 'irrelevant',
      role: 'ADMIN',
    },
  });
  const project = await testPrisma.project.create({
    data: { userId: user.id, name },
  });
  return { user, project };
}

export async function seedManualLink(
  projectId: string,
  donorUrl = 'https://donor.example/page',
  acceptor = 'studibucht.de',
) {
  return testPrisma.link.create({
    data: {
      projectId,
      source: 'MANUAL',
      donorUrl,
      acceptorRaw: acceptor,
      acceptorHost: acceptor,
    },
  });
}

export async function seedSheetsTask(
  projectId: string,
  overrides: Partial<{
    name: string;
    spreadsheetId: string;
    sheetGid: number;
    donorColumn: string;
    acceptorColumn: string;
    resultStartCol: string;
    headerRow: number;
    dataStartRow: number;
  }> = {},
) {
  return testPrisma.sheetsTask.create({
    data: {
      projectId,
      name: overrides.name ?? 'Test sheet',
      spreadsheetId: overrides.spreadsheetId ?? 'test-spreadsheet-id',
      sheetGid: overrides.sheetGid ?? 0,
      donorColumn: overrides.donorColumn ?? 'A',
      acceptorColumn: overrides.acceptorColumn ?? 'B',
      resultStartCol: overrides.resultStartCol ?? 'C',
      headerRow: overrides.headerRow ?? 1,
      dataStartRow: overrides.dataStartRow ?? 2,
    },
  });
}

export async function disposeTestPrisma() {
  await testPrisma.$disconnect();
}

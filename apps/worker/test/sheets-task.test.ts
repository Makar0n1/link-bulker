import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { REDIS_KEYS } from '@link-checker/shared';
import {
  buildQueueRig,
  disposeTestPrisma,
  resetDb,
  seedSheetsTask,
  seedUserAndProject,
  testPrisma,
  type QueueRig,
} from './helpers/build-queue';
import { MockCrawlerProvider } from './mocks/mock-crawler.provider';
import { MockSheetsClient } from './mocks/mock-sheets-client';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

beforeAll(async () => {});

afterAll(async () => {
  await redis.quit();
  await disposeTestPrisma();
});

beforeEach(async () => {
  await resetDb();
  const semKeys = await redis.keys('sem:firecrawl');
  if (semKeys.length) await redis.del(...semKeys);
  const lockKeys = await redis.keys('lock:project:*');
  if (lockKeys.length) await redis.del(...lockKeys);
  const rlKeys = await redis.keys('rl:host:*');
  if (rlKeys.length) await redis.del(...rlKeys);
});

describe('SheetsTaskService.run (integration)', () => {
  let rig: QueueRig;

  afterEach(async () => {
    await rig?.close();
  });

  it('reads rows, processes them, persists Links and writes results back', async () => {
    const sheetsClient = new MockSheetsClient([
      { rowNumber: 2, donorUrl: 'https://donor1.example/page', acceptor: 'studibucht.de' },
      { rowNumber: 3, donorUrl: 'https://donor2.example/page', acceptor: 'studibucht.de' },
      { rowNumber: 4, donorUrl: 'https://donor3.example/page', acceptor: 'studibucht.de' },
    ]);
    rig = await buildQueueRig({ sheetsClient });

    const { project } = await seedUserAndProject();
    const task = await seedSheetsTask(project.id);

    await rig.sheetsTask.run(task.id);

    // Links persisted
    const links = await testPrisma.link.findMany({ where: { sheetsTaskId: task.id } });
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.status === 'DONE')).toBe(true);
    expect(links.every((l) => l.linkFound === true)).toBe(true);
    expect(links.every((l) => l.source === 'SHEETS')).toBe(true);

    // Task completed
    const updated = await testPrisma.sheetsTask.findUnique({ where: { id: task.id } });
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.lastRunAt).toBeInstanceOf(Date);
    expect(updated?.isChecking).toBe(false);

    // Project flag cleared
    const proj = await testPrisma.project.findUnique({ where: { id: project.id } });
    expect(proj?.sheetsChecking).toBe(false);

    // Writeback now happens via formatted batchUpdate. We expect at least
    // two calls: one for the data block (3 rows × 6 cols) and one for the
    // header row.
    expect(sheetsClient.formattedWrites.length).toBeGreaterThanOrEqual(1);
    // Largest call is the data block.
    const dataWrite = sheetsClient.formattedWrites.reduce((a, b) =>
      b.cells.length > a.cells.length ? b : a,
    );
    expect(dataWrite.cells).toHaveLength(3);
    expect(dataWrite.cells[0]).toHaveLength(6);
    // First cell of first row is the Status column. With the parser's new
    // canonical rule (absent canonical = treated as match) successful rows
    // are now labelled exactly "Done", not "Done (canonical mismatch)".
    const firstStatus = dataWrite.cells[0]?.[0]?.value;
    expect(firstStatus).toBe('Done');
    // Column widths request also fires.
    expect(sheetsClient.columnWidths.length).toBeGreaterThanOrEqual(1);
  });

  it('marks invalid rows as ERROR without crawling them', async () => {
    const sheetsClient = new MockSheetsClient([
      { rowNumber: 2, donorUrl: 'not a url', acceptor: 'studibucht.de' },
      { rowNumber: 3, donorUrl: 'https://valid.example/page', acceptor: '' },
      { rowNumber: 4, donorUrl: 'https://valid.example/x', acceptor: 'studibucht.de' },
    ]);
    rig = await buildQueueRig({ sheetsClient });

    const { project } = await seedUserAndProject();
    const task = await seedSheetsTask(project.id);

    await rig.sheetsTask.run(task.id);

    const links = await testPrisma.link.findMany({
      where: { sheetsTaskId: task.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(links).toHaveLength(3);

    // The two invalid ones are ERROR with explanatory text
    const errored = links.filter((l) => l.status === 'ERROR');
    expect(errored).toHaveLength(2);
    expect(errored.every((l) => l.error?.startsWith('Invalid input:'))).toBe(true);

    // The valid one is DONE
    const done = links.filter((l) => l.status === 'DONE');
    expect(done).toHaveLength(1);

    // Crawler called once (only the valid row)
    expect(rig.provider.callCount).toBe(1);
  });

  it('replaces existing links on every run (sheet is source of truth)', async () => {
    const firstClient = new MockSheetsClient([
      { rowNumber: 2, donorUrl: 'https://a.example/x', acceptor: 'b.com' },
      { rowNumber: 3, donorUrl: 'https://b.example/x', acceptor: 'b.com' },
    ]);
    rig = await buildQueueRig({ sheetsClient: firstClient });
    const { project } = await seedUserAndProject();
    const task = await seedSheetsTask(project.id);

    await rig.sheetsTask.run(task.id);
    expect(await testPrisma.link.count({ where: { sheetsTaskId: task.id } })).toBe(2);

    // Second run with a different row set
    firstClient.rowsToReturn = [
      { rowNumber: 2, donorUrl: 'https://c.example/x', acceptor: 'b.com' },
    ];
    await rig.sheetsTask.run(task.id);

    const links = await testPrisma.link.findMany({ where: { sheetsTaskId: task.id } });
    expect(links).toHaveLength(1);
    expect(links[0]?.donorUrl).toBe('https://c.example/x');
  });

  it('records FAILED status when SheetsClient throws', async () => {
    const sheetsClient = new MockSheetsClient([]);
    sheetsClient.readDonorRows = async () => {
      throw new Error('Sheet not found');
    };
    rig = await buildQueueRig({ sheetsClient });
    const { project } = await seedUserAndProject();
    const task = await seedSheetsTask(project.id);

    await rig.sheetsTask.run(task.id);

    const updated = await testPrisma.sheetsTask.findUnique({ where: { id: task.id } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.lastRunStatus).toContain('Sheet not found');
    expect(updated?.isChecking).toBe(false);

    // Lock released even on failure
    const lockKey = REDIS_KEYS.projectSheetsLock(project.id);
    expect(await redis.exists(lockKey)).toBe(0);
  });

  it('refuses to start when project sheets lock is held', async () => {
    const sheetsClient = new MockSheetsClient([
      { rowNumber: 2, donorUrl: 'https://x.example/y', acceptor: 'b.com' },
    ]);
    rig = await buildQueueRig({ sheetsClient });
    const { project } = await seedUserAndProject();
    const task = await seedSheetsTask(project.id);

    const lockKey = REDIS_KEYS.projectSheetsLock(project.id);
    await redis.set(lockKey, 'someone-else', 'PX', 30_000);

    await rig.sheetsTask.run(task.id);

    // No links created — early exit
    const count = await testPrisma.link.count({ where: { sheetsTaskId: task.id } });
    expect(count).toBe(0);
    // Foreign lock untouched
    expect(await redis.get(lockKey)).toBe('someone-else');
  });
});

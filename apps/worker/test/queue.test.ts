import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { REDIS_KEYS } from '@link-checker/shared';
import {
  buildQueueRig,
  disposeTestPrisma,
  resetDb,
  seedManualLink,
  seedUserAndProject,
  testPrisma,
  type QueueRig,
} from './helpers/build-queue';
import { MockCrawlerProvider } from './mocks/mock-crawler.provider';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
let subscriber: Redis;

beforeAll(async () => {
  subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
});

afterAll(async () => {
  await redis.quit();
  await subscriber.quit();
  await disposeTestPrisma();
});

beforeEach(async () => {
  await resetDb();
  // Phase-2 keys we share with worker
  const semKeys = await redis.keys('sem:firecrawl');
  if (semKeys.length) await redis.del(...semKeys);
  const rlKeys = await redis.keys('rl:host:*');
  if (rlKeys.length) await redis.del(...rlKeys);
  const lockKeys = await redis.keys('lock:project:*');
  if (lockKeys.length) await redis.del(...lockKeys);
});

describe('SingleLinkProcessor (integration)', () => {
  let rig: QueueRig;

  afterEach(async () => {
    await rig?.close();
  });

  it('processes a link end-to-end and persists results', async () => {
    rig = await buildQueueRig();
    const { project } = await seedUserAndProject();
    const link = await seedManualLink(project.id, 'https://donor.example/page', 'studibucht.de');

    await rig.singleLink.processOne(link.id);

    const updated = await testPrisma.link.findUnique({ where: { id: link.id } });
    expect(updated?.status).toBe('DONE');
    expect(updated?.linkFound).toBe(true);
    expect(updated?.occurrencesCount).toBe(1);
    expect(updated?.donorStatusCode).toBe(200);
    expect(updated?.lastCheckedAt).toBeInstanceOf(Date);
  });

  it('marks link as ERROR on provider failure', async () => {
    rig = await buildQueueRig(new MockCrawlerProvider({ failEveryN: 1 }));
    const { project } = await seedUserAndProject();
    const link = await seedManualLink(project.id);

    await rig.singleLink.processOne(link.id);

    const updated = await testPrisma.link.findUnique({ where: { id: link.id } });
    expect(updated?.status).toBe('ERROR');
    expect(updated?.error).toMatch(/scheduled failure/);
  });

  it('publishes link_updated events on Redis pub/sub', async () => {
    rig = await buildQueueRig();
    const { project } = await seedUserAndProject();
    const link = await seedManualLink(project.id);

    const channel = REDIS_KEYS.projectChannel(project.id);
    const messages: string[] = [];
    await subscriber.subscribe(channel);
    subscriber.on('message', (_chan, msg) => {
      messages.push(msg);
    });

    await rig.singleLink.processOne(link.id);
    // give pub/sub a tick
    await new Promise((r) => setTimeout(r, 50));
    await subscriber.unsubscribe(channel);
    subscriber.removeAllListeners('message');

    // Should receive at least: CHECKING then DONE
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const parsed = messages.map((m) => JSON.parse(m));
    expect(parsed.some((e) => e.type === 'link_updated' && e.status === 'CHECKING')).toBe(true);
    expect(parsed.some((e) => e.type === 'link_updated' && e.status === 'DONE')).toBe(true);
  });

  it('skips silently when link does not exist', async () => {
    rig = await buildQueueRig();
    await expect(rig.singleLink.processOne('missing-id')).resolves.toBeUndefined();
  });
});

describe('ManualCheckProcessor (integration)', () => {
  let rig: QueueRig;

  afterEach(async () => {
    await rig?.close();
  });

  function fakeJob(projectId: string, linkIds: string[]): any {
    return {
      id: 'test-job',
      data: { projectId, linkIds },
      updateProgress: async (_n: number) => undefined,
    };
  }

  it('processes 20 links and marks them DONE', async () => {
    rig = await buildQueueRig();
    const { project } = await seedUserAndProject();
    const links = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        seedManualLink(project.id, `https://donor${i}.example/page`, 'studibucht.de'),
      ),
    );

    await rig.manualCheck.handle(fakeJob(project.id, links.map((l) => l.id)));

    const updated = await testPrisma.link.findMany({
      where: { projectId: project.id },
    });
    expect(updated).toHaveLength(20);
    expect(updated.every((l) => l.status === 'DONE')).toBe(true);
    expect(updated.every((l) => l.linkFound === true)).toBe(true);
  });

  it('acquires and releases the project lock', async () => {
    rig = await buildQueueRig();
    const { project } = await seedUserAndProject();
    const link = await seedManualLink(project.id);

    const lockKey = REDIS_KEYS.projectManualLock(project.id);
    expect(await redis.exists(lockKey)).toBe(0);

    const promise = rig.manualCheck.handle(fakeJob(project.id, [link.id]));
    // We can't easily catch the lock mid-flight in this short job, but we
    // can verify it's released after.
    await promise;

    expect(await redis.exists(lockKey)).toBe(0);

    const proj = await testPrisma.project.findUnique({ where: { id: project.id } });
    expect(proj?.manualChecking).toBe(false);
  });

  it('refuses to start when lock is already held', async () => {
    rig = await buildQueueRig();
    const { project } = await seedUserAndProject();
    const link = await seedManualLink(project.id);

    const lockKey = REDIS_KEYS.projectManualLock(project.id);
    await redis.set(lockKey, 'someone-else', 'PX', 30_000);

    await rig.manualCheck.handle(fakeJob(project.id, [link.id]));

    // Link should remain PENDING because the processor exited early
    const stillPending = await testPrisma.link.findUnique({ where: { id: link.id } });
    expect(stillPending?.status).toBe('PENDING');

    // The pre-existing foreign lock should not have been touched
    const owner = await redis.get(lockKey);
    expect(owner).toBe('someone-else');
  });

  it('publishes lock_changed and done events', async () => {
    rig = await buildQueueRig();
    const { project } = await seedUserAndProject();
    const link = await seedManualLink(project.id);

    const channel = REDIS_KEYS.projectChannel(project.id);
    const messages: any[] = [];
    await subscriber.subscribe(channel);
    subscriber.on('message', (_chan, msg) => messages.push(JSON.parse(msg)));

    await rig.manualCheck.handle(fakeJob(project.id, [link.id]));
    await new Promise((r) => setTimeout(r, 100));
    await subscriber.unsubscribe(channel);
    subscriber.removeAllListeners('message');

    expect(messages.some((m) => m.type === 'lock_changed' && m.manualChecking === true)).toBe(true);
    expect(messages.some((m) => m.type === 'lock_changed' && m.manualChecking === false)).toBe(true);
    expect(messages.some((m) => m.type === 'done')).toBe(true);
  });

  it('mini-load: 5 projects × 30 links concurrent, no slot leaks, no errors', async () => {
    rig = await buildQueueRig();

    const projects = await Promise.all(
      Array.from({ length: 5 }, (_, i) => seedUserAndProject(`P${i}`)),
    );

    const allLinks = await Promise.all(
      projects.map(async ({ project }) => {
        const links = await Promise.all(
          Array.from({ length: 30 }, (_, i) =>
            seedManualLink(
              project.id,
              `https://donor-${project.id}-${i}.example/page`,
              'studibucht.de',
            ),
          ),
        );
        return { projectId: project.id, linkIds: links.map((l) => l.id) };
      }),
    );

    await Promise.all(
      allLinks.map(({ projectId, linkIds }) =>
        rig.manualCheck.handle(fakeJob(projectId, linkIds)),
      ),
    );

    // All 150 links should be DONE
    const totalDone = await testPrisma.link.count({ where: { status: 'DONE' } });
    expect(totalDone).toBe(150);

    // No leaked Firecrawl semaphore slots
    const semSize = await redis.zcard('sem:firecrawl');
    expect(semSize).toBe(0);

    // All locks released
    const locks = await redis.keys('lock:project:*');
    expect(locks).toHaveLength(0);

    // All project flags cleared
    const projs = await testPrisma.project.findMany();
    expect(projs.every((p) => p.manualChecking === false)).toBe(true);
  });
});

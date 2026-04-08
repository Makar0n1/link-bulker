import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { loadEnv } from '../../config/env';

@Injectable()
export class HealthService {
  private redis: Redis | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private getRedis(): Redis {
    if (!this.redis) {
      this.redis = new Redis(loadEnv().REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
    }
    return this.redis;
  }

  async deep(): Promise<{ status: 'ok' | 'degraded'; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    let ok = true;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = 'ok';
    } catch (err) {
      ok = false;
      checks.postgres = `error: ${(err as Error).message}`;
    }

    try {
      const redis = this.getRedis();
      if (redis.status === 'end' || redis.status === 'wait') {
        await redis.connect();
      }
      const pong = await redis.ping();
      checks.redis = pong === 'PONG' ? 'ok' : `unexpected: ${pong}`;
      if (pong !== 'PONG') ok = false;
    } catch (err) {
      ok = false;
      checks.redis = `error: ${(err as Error).message}`;
    }

    return { status: ok ? 'ok' : 'degraded', checks };
  }
}

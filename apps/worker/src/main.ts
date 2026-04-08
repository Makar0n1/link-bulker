import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Worker entry point.
 *
 * Boots a standalone NestJS context that owns the QueueModule. BullMQ
 * Workers are created in QueueModule.onModuleInit and live for the lifetime
 * of this process. enableShutdownHooks() wires SIGTERM/SIGINT to app.close()
 * which in turn drains workers and disconnects Prisma/Redis cleanly.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error', 'log'],
  });
  app.enableShutdownHooks();

  // eslint-disable-next-line no-console
  console.log('[worker] running. Ctrl+C to stop.');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] bootstrap failed:', err);
  process.exit(1);
});

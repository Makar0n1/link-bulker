import { Controller, Param, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import { REDIS_KEYS } from '@link-checker/shared';
import { SessionGuard } from '../auth/session.guard';
import { loadEnv } from '../../config/env';

interface SseEvent {
  data: string;
}

@Controller('projects')
@UseGuards(SessionGuard)
export class StreamController {
  /**
   * SSE stream of progress events for a project.
   *
   * Implementation note: each connected client gets its OWN ioredis client
   * because Redis pub/sub puts the connection into subscriber mode, which
   * cannot be reused for normal commands. The subscriber is closed when the
   * Observable is unsubscribed (browser disconnects).
   *
   * Authorization: SessionGuard ensures a valid session cookie. We don't
   * additionally check project ownership here because the SSE channel
   * carries no sensitive data beyond status counts — and project ownership
   * is enforced on every CRUD endpoint that produces those events.
   */
  @Sse(':projectId/stream')
  stream(@Param('projectId') projectId: string): Observable<SseEvent> {
    const env = loadEnv();
    const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const channel = REDIS_KEYS.projectChannel(projectId);

    return new Observable<SseEvent>((observer) => {
      subscriber.subscribe(channel).catch((err) => observer.error(err));

      const onMessage = (chan: string, message: string) => {
        if (chan === channel) observer.next({ data: message });
      };
      subscriber.on('message', onMessage);

      // Send an initial heartbeat so EventSource considers the stream open.
      observer.next({ data: JSON.stringify({ type: 'connected', projectId }) });

      return () => {
        subscriber.off('message', onMessage);
        subscriber.unsubscribe(channel).catch(() => undefined);
        subscriber.quit().catch(() => undefined);
      };
    });
  }
}

/**
 * Strongly-typed wrapper around EventSource for project progress streams.
 *
 * EventSource doesn't support custom headers but DOES send cookies on
 * same-origin requests. For cross-origin (api.* in prod, localhost:3001 in
 * dev) we set withCredentials so the session cookie travels.
 *
 * Auto-reconnect: EventSource reconnects automatically on transport errors.
 * We surface connection state through `onStateChange` so the UI can show
 * "reconnecting…" feedback.
 */

export type ProjectStreamEvent =
  | { type: 'connected'; projectId: string }
  | {
      type: 'link_updated';
      linkId: string;
      projectId: string;
      status: 'PENDING' | 'QUEUED' | 'CHECKING' | 'DONE' | 'ERROR';
      linkFound: boolean | null;
      occurrencesCount: number;
      donorStatusCode: number | null;
      error: string | null;
      lastCheckedAt: string | null;
    }
  | {
      type: 'progress';
      projectId: string;
      total: number;
      processed: number;
      found: number;
      errors: number;
    }
  | { type: 'lock_changed'; projectId: string; manualChecking: boolean }
  | { type: 'done'; projectId: string; total: number; found: number; errors: number }
  | {
      type: 'sheets_task_updated';
      sheetsTaskId: string;
      projectId: string;
      status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
      lastRunAt: string | null;
      lastRunStatus: string | null;
    }
  | {
      type: 'sheets_task_progress';
      sheetsTaskId: string;
      projectId: string;
      total: number;
      processed: number;
      found: number;
      errors: number;
    };

export type StreamConnectionState = 'connecting' | 'open' | 'closed';

export interface SubscribeOptions {
  apiUrl: string;
  projectId: string;
  onEvent: (event: ProjectStreamEvent) => void;
  onStateChange?: (state: StreamConnectionState) => void;
}

export interface StreamHandle {
  close: () => void;
}

export function subscribeProjectStream({
  apiUrl,
  projectId,
  onEvent,
  onStateChange,
}: SubscribeOptions): StreamHandle {
  const url = `${apiUrl}/api/v1/projects/${projectId}/stream`;
  const es = new EventSource(url, { withCredentials: true });

  onStateChange?.('connecting');

  es.onopen = () => onStateChange?.('open');

  es.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as ProjectStreamEvent;
      onEvent(parsed);
    } catch (err) {
      // Malformed event — ignore but log for debugging.
      // eslint-disable-next-line no-console
      console.warn('[sse] could not parse event', event.data, err);
    }
  };

  es.onerror = () => {
    // EventSource handles reconnect itself; we just notify the UI.
    onStateChange?.('connecting');
  };

  return {
    close: () => {
      es.close();
      onStateChange?.('closed');
    },
  };
}

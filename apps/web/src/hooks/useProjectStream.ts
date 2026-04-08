'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  API_URL,
  type LinkRow,
  type LinksListResponse,
  type ProjectDetail,
  type SheetsTaskRow,
} from '../lib/api';
import {
  subscribeProjectStream,
  type ProjectStreamEvent,
  type StreamConnectionState,
} from '../lib/sse';

export interface ProjectProgress {
  total: number;
  processed: number;
  found: number;
  errors: number;
}

/**
 * Subscribes to a project's SSE stream and:
 *   - patches the cached InfiniteData<LinksListResponse> with each
 *     `link_updated` event (no full refetch — feels instant for 1000+ rows)
 *   - patches the cached ProjectDetail's `manualChecking` on `lock_changed`
 *   - exposes the latest `progress` snapshot for manual mode
 *   - exposes a per-task `sheetsProgress` map for sheets mode (so each
 *     sheets-task card can render its own progress bar independently)
 *   - returns connection state for UI feedback
 */
export function useProjectStream(projectId: string | null) {
  const qc = useQueryClient();
  const [state, setState] = useState<StreamConnectionState>('closed');
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [sheetsProgress, setSheetsProgress] = useState<Record<string, ProjectProgress>>({});

  // We use a ref to give the event handler stable access to the latest
  // setters without re-subscribing on every render.
  const settersRef = useRef({ setProgress, setSheetsProgress });
  settersRef.current = { setProgress, setSheetsProgress };

  useEffect(() => {
    if (!projectId) return;

    const handle = subscribeProjectStream({
      apiUrl: API_URL,
      projectId,
      onStateChange: setState,
      onEvent: (event) => {
        applyEvent(qc, projectId, event, settersRef.current);
      },
    });

    return () => handle.close();
  }, [projectId, qc]);

  return { state, progress, sheetsProgress };
}

interface Setters {
  setProgress: (p: ProjectProgress | null) => void;
  setSheetsProgress: (
    update: (prev: Record<string, ProjectProgress>) => Record<string, ProjectProgress>,
  ) => void;
}

function applyEvent(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
  event: ProjectStreamEvent,
  setters: Setters,
) {
  switch (event.type) {
    case 'link_updated': {
      qc.setQueryData<InfiniteData<LinksListResponse> | undefined>(
        ['links', projectId],
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            pages: prev.pages.map((page) => ({
              ...page,
              items: page.items.map((l): LinkRow => {
                if (l.id !== event.linkId) return l;
                return {
                  ...l,
                  status: event.status,
                  linkFound: event.linkFound,
                  occurrencesCount: event.occurrencesCount,
                  donorStatusCode: event.donorStatusCode,
                  error: event.error,
                  lastCheckedAt: event.lastCheckedAt,
                };
              }),
            })),
          };
        },
      );
      break;
    }
    case 'progress': {
      setters.setProgress({
        total: event.total,
        processed: event.processed,
        found: event.found,
        errors: event.errors,
      });
      break;
    }
    case 'lock_changed': {
      qc.setQueryData<ProjectDetail | undefined>(['project', projectId], (prev) =>
        prev ? { ...prev, manualChecking: event.manualChecking } : prev,
      );
      if (event.manualChecking === false) {
        qc.invalidateQueries({ queryKey: ['links', projectId] });
        qc.invalidateQueries({ queryKey: ['project', projectId] });
        qc.invalidateQueries({ queryKey: ['stats', projectId] });
      }
      break;
    }
    case 'done': {
      setters.setProgress({
        total: event.total,
        processed: event.total,
        found: event.found,
        errors: event.errors,
      });
      break;
    }
    case 'sheets_task_updated': {
      qc.setQueryData<SheetsTaskRow[] | undefined>(['sheets-tasks', projectId], (prev) => {
        if (!prev) return prev;
        return prev.map((t) =>
          t.id === event.sheetsTaskId
            ? {
                ...t,
                status: event.status,
                isChecking: event.status === 'RUNNING',
                lastRunAt: event.lastRunAt ?? t.lastRunAt,
                lastRunStatus: event.lastRunStatus ?? t.lastRunStatus,
              }
            : t,
        );
      });
      // Clear per-task progress when the run terminates so the card stops
      // showing a stale bar.
      if (event.status === 'COMPLETED' || event.status === 'FAILED') {
        setters.setSheetsProgress((prev) => {
          if (!(event.sheetsTaskId in prev)) return prev;
          const next = { ...prev };
          delete next[event.sheetsTaskId];
          return next;
        });
        qc.invalidateQueries({ queryKey: ['links', projectId] });
        qc.invalidateQueries({ queryKey: ['sheets-tasks', projectId] });
        qc.invalidateQueries({ queryKey: ['stats', projectId] });
      }
      break;
    }
    case 'sheets_task_progress': {
      setters.setSheetsProgress((prev) => ({
        ...prev,
        [event.sheetsTaskId]: {
          total: event.total,
          processed: event.processed,
          found: event.found,
          errors: event.errors,
        },
      }));
      break;
    }
    case 'connected':
      break;
  }
}

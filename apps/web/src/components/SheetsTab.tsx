'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiClient, type SheetsTaskRow } from '../lib/api';
import type { ProjectProgress } from '../hooks/useProjectStream';
import { ExternalLink, Plus, Refresh, Trash } from './icons';
import { ProgressCard } from './ProgressCard';
import { SheetsTaskDialog } from './SheetsTaskDialog';

interface Props {
  projectId: string;
  /** Per-task progress map keyed by sheets-task id, fed by useProjectStream. */
  progressByTaskId?: Record<string, ProjectProgress>;
}

const STATUS_PILL: Record<SheetsTaskRow['status'], string> = {
  IDLE: 'pill-gray',
  RUNNING: 'pill-blue animate-pulse',
  COMPLETED: 'pill-green',
  FAILED: 'pill-red',
};

const STATUS_LABEL: Record<SheetsTaskRow['status'], string> = {
  IDLE: 'Idle',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

export function SheetsTab({ projectId, progressByTaskId = {} }: Props) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SheetsTaskRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tasks = useQuery({
    queryKey: ['sheets-tasks', projectId],
    queryFn: () => apiClient.listSheetsTasks(projectId),
    retry: false,
  });

  const run = useMutation({
    mutationFn: (taskId: string) => apiClient.runSheetsTask(taskId),
    onError: (err) => {
      if (err instanceof ApiError) {
        setActionError(err.status === 409 ? 'A sheets task is already running' : err.message);
        setTimeout(() => setActionError(null), 4000);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheets-tasks', projectId] });
    },
  });

  const remove = useMutation({
    mutationFn: (taskId: string) => apiClient.deleteSheetsTask(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheets-tasks', projectId] });
      qc.invalidateQueries({ queryKey: ['links', projectId] });
    },
  });

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(task: SheetsTaskRow) {
    setEditing(task);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={openCreate} className="btn-primary !px-2.5 sm:!px-4">
          <Plus size={14} />
          <span className="hidden sm:inline">Connect sheet</span>
        </button>
        {tasks.data && tasks.data.length > 0 && (
          <div className="text-xs muted">
            {tasks.data.length} task{tasks.data.length === 1 ? '' : 's'}
          </div>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/60 animate-fade-in">
          {actionError}
        </div>
      )}

      {tasks.isLoading && (
        <div className="card p-12 text-center text-sm muted">Loading sheets tasks…</div>
      )}

      {tasks.data && tasks.data.length === 0 && (
        <div className="card flex flex-col items-center gap-2 p-12 text-center">
          <div className="text-sm muted">No sheets tasks yet.</div>
          <div className="text-xs muted">
            Click <span className="font-medium heading">+ Connect sheet</span> to import donor
            URLs from Google Sheets.
          </div>
        </div>
      )}

      {tasks.data && tasks.data.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tasks.data.map((task) => {
            const sheetUrl = `https://docs.google.com/spreadsheets/d/${task.spreadsheetId}/edit`;
            const taskProgress = progressByTaskId[task.id];
            return (
              <li
                key={task.id}
                className="card group relative p-5 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => openEdit(task)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <h3 className="truncate font-semibold heading">{task.name}</h3>
                    <p className="mt-0.5 truncate font-mono text-[11px] muted">
                      gid={task.sheetGid} · {task.spreadsheetId.slice(0, 12)}…
                    </p>
                  </button>
                  <span className={STATUS_PILL[task.status]}>{STATUS_LABEL[task.status]}</span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] muted">
                  <span>
                    <span className="font-mono">{task.donorColumn}</span> →{' '}
                    <span className="font-mono">{task.acceptorColumn}</span> · results from{' '}
                    <span className="font-mono">{task.resultStartCol}</span>
                  </span>
                  <span className="opacity-30">·</span>
                  <span>{task.linksCount} links</span>
                </div>

                {/* Live progress while the task is running */}
                {task.isChecking && taskProgress && (
                  <div className="mt-3">
                    <ProgressCard
                      compact
                      total={taskProgress.total}
                      processed={taskProgress.processed}
                      found={taskProgress.found}
                      errors={taskProgress.errors}
                    />
                  </div>
                )}

                {/* Indeterminate state: task is running but no progress event yet */}
                {task.isChecking && !taskProgress && (
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div className="h-full w-1/3 animate-pulse bg-blue-500" />
                  </div>
                )}

                {!task.isChecking && task.lastRunAt && (
                  <p className="mt-2 truncate text-[11px] muted">
                    Last run:{' '}
                    <span className="heading">{formatDateTime(task.lastRunAt)}</span>
                  </p>
                )}

                <div className="mt-4 flex items-center gap-1">
                  <button
                    onClick={() => run.mutate(task.id)}
                    disabled={task.isChecking || run.isPending}
                    className="btn-secondary !px-2.5 !py-1 !text-xs"
                  >
                    <Refresh size={12} />
                    {task.isChecking ? 'Running…' : 'Run now'}
                  </button>
                  <a
                    href={sheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost !px-2 !py-1 !text-xs"
                    title="Open in Google Sheets"
                  >
                    <ExternalLink size={12} />
                  </a>
                  <button
                    onClick={() => {
                      if (confirm(`Delete sheets task "${task.name}"?`)) {
                        remove.mutate(task.id);
                      }
                    }}
                    disabled={task.isChecking}
                    className="btn-icon ml-auto hover:!text-red-600 hover:!bg-red-50 dark:hover:!bg-red-950/30 dark:hover:!text-red-400"
                    title="Delete"
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <SheetsTaskDialog
        projectId={projectId}
        editing={editing}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

/** Local-time formatter for `lastRunAt`. Example: "2026-04-07 22:45". */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

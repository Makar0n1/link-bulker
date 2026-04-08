import { z } from 'zod';

/**
 * BullMQ job payloads. API is the producer, worker is the consumer.
 * Both sides validate against these schemas at the boundary.
 */

export const SingleLinkJobData = z.object({
  linkId: z.string(),
  projectId: z.string(),
  // Hint for the worker which channel to publish progress on. Manual jobs
  // publish per-project, sheets jobs would publish per-task.
  source: z.enum(['MANUAL', 'SHEETS']),
});
export type SingleLinkJobData = z.infer<typeof SingleLinkJobData>;

export const ManualCheckJobData = z.object({
  projectId: z.string(),
  // The set of link IDs to process. Snapshotted by API at enqueue time so
  // links added later won't sneak into a running batch.
  linkIds: z.array(z.string()).min(1),
});
export type ManualCheckJobData = z.infer<typeof ManualCheckJobData>;

export const SheetsTaskRunJobData = z.object({
  sheetsTaskId: z.string(),
  // True when fired by the cron scheduler — used only for telemetry.
  scheduled: z.boolean().optional(),
});
export type SheetsTaskRunJobData = z.infer<typeof SheetsTaskRunJobData>;

/**
 * Real-time progress events published over Redis pub/sub and forwarded
 * to clients via SSE. All events are scoped per-project so the same
 * `channel:project:{id}` carries both manual and sheets activity.
 */
export const ProgressEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('link_updated'),
    linkId: z.string(),
    projectId: z.string(),
    status: z.enum(['PENDING', 'QUEUED', 'CHECKING', 'DONE', 'ERROR']),
    linkFound: z.boolean().nullable(),
    occurrencesCount: z.number().int(),
    donorStatusCode: z.number().int().nullable(),
    error: z.string().nullable(),
    lastCheckedAt: z.string().nullable(),
  }),
  z.object({
    type: z.literal('progress'),
    projectId: z.string(),
    total: z.number().int(),
    processed: z.number().int(),
    found: z.number().int(),
    errors: z.number().int(),
  }),
  z.object({
    type: z.literal('lock_changed'),
    projectId: z.string(),
    manualChecking: z.boolean(),
  }),
  z.object({
    type: z.literal('done'),
    projectId: z.string(),
    total: z.number().int(),
    found: z.number().int(),
    errors: z.number().int(),
  }),
  // ── Sheets-task lifecycle ─────────────────────────────────────────────
  z.object({
    type: z.literal('sheets_task_updated'),
    sheetsTaskId: z.string(),
    projectId: z.string(),
    status: z.enum(['IDLE', 'RUNNING', 'COMPLETED', 'FAILED']),
    lastRunAt: z.string().nullable(),
    lastRunStatus: z.string().nullable(),
  }),
  z.object({
    type: z.literal('sheets_task_progress'),
    sheetsTaskId: z.string(),
    projectId: z.string(),
    total: z.number().int(),
    processed: z.number().int(),
    found: z.number().int(),
    errors: z.number().int(),
  }),
]);
export type ProgressEvent = z.infer<typeof ProgressEvent>;

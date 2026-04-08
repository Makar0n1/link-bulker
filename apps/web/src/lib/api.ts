/**
 * Thin fetch wrapper for the backend API.
 *
 * - Always sends cookies (credentials: 'include') so the session round-trips.
 * - Reads the API origin from NEXT_PUBLIC_API_URL.
 * - Throws ApiError on non-2xx with the parsed error body.
 *
 * Body content-type rules:
 *   - We only set Content-Type: application/json when there is actually a body.
 *     Fastify rejects empty-body POSTs that declare JSON content type. POST
 *     with no body (e.g. /links/:id/check) goes out without the header.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body !== undefined && init.body !== null && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  const text = await res.text();
  const body = text ? safeJson(text) : null;

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? String((body as any).message)
        : null) ?? `Request failed with ${res.status}`;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Domain types (mirror Prisma where it matters; defined here so the web app
// doesn't pull @link-checker/db into the browser bundle).
// ────────────────────────────────────────────────────────────────────────────

export type LinkStatus = 'PENDING' | 'QUEUED' | 'CHECKING' | 'DONE' | 'ERROR';
export type LinkSource = 'MANUAL' | 'SHEETS';

export interface LinkOccurrence {
  href: string;
  anchor: string;
  rel: string[];
  target: string | null;
  tag: string;
  position: number;
}

export interface LinkRow {
  id: string;
  projectId: string;
  source: LinkSource;
  status: LinkStatus;
  donorUrl: string;
  acceptorRaw: string;
  acceptorHost: string;
  donorStatusCode: number | null;
  donorFinalUrl: string | null;
  donorIndexable: boolean | null;
  donorCanonical: string | null;
  canonicalMatches: boolean | null;
  linkFound: boolean | null;
  occurrences: LinkOccurrence[] | null;
  occurrencesCount: number;
  error: string | null;
  checkDurationMs: number | null;
  lastCheckedAt: string | null;
  lastCooldownAt: string | null;
  createdAt: string;
}

export interface LinksListResponse {
  items: LinkRow[];
  total: number;
  page: number;
  limit: number;
}

export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  manualChecking: boolean;
  sheetsChecking: boolean;
  createdAt: string;
  _count: { links: number; sheetsTasks: number };
}

export interface ManualLinkInput {
  donorUrl: string;
  acceptor: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint helpers
// ────────────────────────────────────────────────────────────────────────────

export const apiClient = {
  // Auth
  me: () => api<{ user: { id: string; email: string; role: string } }>('/auth/me'),
  logout: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),

  // Projects
  listProjects: () =>
    api<
      Array<{
        id: string;
        name: string;
        description: string | null;
        manualChecking: boolean;
        sheetsChecking: boolean;
        linksCount: number;
        sheetsTasksCount: number;
        createdAt: string;
      }>
    >('/projects'),
  getProject: (id: string) => api<ProjectDetail>(`/projects/${id}`),
  createProject: (data: { name: string; description?: string }) =>
    api<ProjectDetail>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  deleteProject: (id: string) =>
    api<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),

  // Links
  listLinks: (projectId: string, params: { source?: 'manual' | 'sheets'; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.source) q.set('source', params.source);
    q.set('page', String(params.page ?? 1));
    q.set('limit', String(params.limit ?? 500));
    return api<LinksListResponse>(`/projects/${projectId}/links?${q.toString()}`);
  },

  createManualLinks: (projectId: string, items: ManualLinkInput[]) =>
    api<{ created: number }>(`/projects/${projectId}/links/manual`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  deleteLink: (linkId: string) =>
    api<{ ok: true }>(`/links/${linkId}`, { method: 'DELETE' }),

  deleteAllManualLinks: (projectId: string) =>
    api<{ deleted: number }>(`/projects/${projectId}/links`, { method: 'DELETE' }),

  startManualCheck: (projectId: string) =>
    api<{ jobId: string; queued: number }>(`/projects/${projectId}/check`, { method: 'POST' }),

  recheckLink: (linkId: string) =>
    api<{ jobId: string }>(`/links/${linkId}/check`, { method: 'POST' }),

  // ─── Sheets tasks ────────────────────────────────────────────────────
  listSheetsTasks: (projectId: string) =>
    api<SheetsTaskRow[]>(`/projects/${projectId}/sheets-tasks`),
  createSheetsTask: (projectId: string, dto: SheetsTaskInput) =>
    api<SheetsTaskRow>(`/projects/${projectId}/sheets-tasks`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  updateSheetsTask: (taskId: string, dto: Partial<SheetsTaskInput>) =>
    api<SheetsTaskRow>(`/sheets-tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  deleteSheetsTask: (taskId: string) =>
    api<{ ok: true }>(`/sheets-tasks/${taskId}`, { method: 'DELETE' }),
  runSheetsTask: (taskId: string) =>
    api<{ jobId: string }>(`/sheets-tasks/${taskId}/run`, { method: 'POST' }),
  getServiceAccountEmail: () =>
    api<{ email: string | null }>('/sheets/service-account-email'),

  // ─── Stats ───────────────────────────────────────────────────────────
  getProjectStats: (projectId: string, scope: 'manual' | 'sheets' | 'all' = 'all') =>
    api<ProjectStats>(`/projects/${projectId}/stats?source=${scope}`),
};

// ────────────────────────────────────────────────────────────────────────────
// Stats types (mirror packages/shared/src/schemas/stats.ts)
// ────────────────────────────────────────────────────────────────────────────

export type StatsScope = 'manual' | 'sheets' | 'all';

export interface ProjectStats {
  scope: StatsScope;
  totals: {
    total: number;
    done: number;
    problem: number;
    error: number;
    pending: number;
  };
  found: { total: number; dofollow: number; nofollow: number };
  http: {
    ok: number;
    redirect: number;
    notFound: number;
    serverError: number;
    other: number;
  };
  indexable: { yes: number; no: number; unknown: number };
  canonical: { match: number; mismatch: number; notFound: number; unknown: number };
  timing: { avgMs: number | null; p50Ms: number | null; p95Ms: number | null };
  topProblemDonors: Array<{ donorHost: string; problemCount: number }>;
}

// ────────────────────────────────────────────────────────────────────────────
// Sheets task types
// ────────────────────────────────────────────────────────────────────────────

export interface SheetsTaskInput {
  name: string;
  spreadsheetId: string;
  sheetGid: number;
  donorColumn: string;
  acceptorColumn: string;
  resultStartCol: string;
  headerRow?: number;
  dataStartRow?: number;
  scheduleCron?: string;
}

export interface SheetsTaskRow {
  id: string;
  projectId: string;
  name: string;
  spreadsheetId: string;
  sheetGid: number;
  donorColumn: string;
  acceptorColumn: string;
  resultStartCol: string;
  headerRow: number;
  dataStartRow: number;
  scheduleCron: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  isChecking: boolean;
  linksCount: number;
  createdAt: string;
  updatedAt: string;
}

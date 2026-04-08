'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ApiError, apiClient, type LinksListResponse } from '../../../lib/api';
import { useProjectStream } from '../../../hooks/useProjectStream';
import { AddLinksDialog } from '../../../components/AddLinksDialog';
import { LinksTable } from '../../../components/LinksTable';
import { ProgressCard } from '../../../components/ProgressCard';
import { SheetsTab } from '../../../components/SheetsTab';
import { StatsTab } from '../../../components/StatsTab';
import { Download, Plus, Refresh, Trash } from '../../../components/icons';
import { downloadCsv } from '../../../lib/csv-export';

const PAGE_SIZE = 100;

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const qc = useQueryClient();

  const [tab, setTab] = useState<'manual' | 'sheets' | 'stats'>('manual');
  const [addOpen, setAddOpen] = useState(false);

  const project = useQuery({
    queryKey: ['project', id],
    queryFn: () => apiClient.getProject(id),
    retry: false,
  });

  const linksQuery = useInfiniteQuery({
    queryKey: ['links', id],
    queryFn: ({ pageParam }) =>
      apiClient.listLinks(id, { source: 'manual', page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage: LinksListResponse, allPages) => {
      const loaded = allPages.reduce((acc, p) => acc + p.items.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
    enabled: !!id,
    retry: false,
  });

  const linkRows = useMemo(
    () => linksQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [linksQuery.data],
  );
  const totalLinks = linksQuery.data?.pages[0]?.total ?? 0;

  const { state: streamState, progress, sheetsProgress } = useProjectStream(id);

  const startCheck = useMutation({
    mutationFn: () => apiClient.startManualCheck(id),
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 409) alert('A check is already running for this project');
        else if (err.status === 400) alert(err.message);
        else alert(`Error: ${err.message}`);
      }
    },
  });

  const deleteAll = useMutation({
    mutationFn: () => apiClient.deleteAllManualLinks(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['links', id] });
      qc.invalidateQueries({ queryKey: ['project', id] });
    },
  });

  const deleteProject = useMutation({
    mutationFn: () => apiClient.deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      router.replace('/projects');
    },
    onError: (err) => {
      if (err instanceof ApiError) alert(`Delete failed: ${err.message}`);
    },
  });

  if (project.isError && project.error instanceof ApiError) {
    if (project.error.status === 401) {
      router.replace('/login');
      return null;
    }
  }

  const isChecking = project.data?.manualChecking === true;

  function handleExport() {
    if (linkRows.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `${project.data?.name ?? 'project'}-links-${stamp}.csv`.replace(
      /[^a-zA-Z0-9._-]/g,
      '_',
    );
    downloadCsv(linkRows, filename);
  }

  return (
    /*
     * Mobile (< sm): the page becomes a fullscreen flex column. We negate the
     *   layout's pt-16 with -mt-12 so the inline header sits next to the
     *   floating hamburger (left-4 top-4). Page itself never scrolls; only
     *   the table body inside LinksTable does.
     *
     * Desktop (>= sm): everything reverts to the natural document flow that
     *   the user explicitly asked us not to touch.
     */
    <div className="-mt-12 flex h-[calc(100dvh-4rem)] flex-col overflow-hidden sm:mt-0 sm:h-auto sm:space-y-6 sm:overflow-visible">
      {project.isLoading && (
        <div className="card p-12 text-center text-sm muted">Loading project…</div>
      )}

      {project.data && (
        <>
          {/* Header — inline on mobile, multi-row on desktop */}
          <header className="flex-shrink-0 sm:flex-shrink">
            <div className="flex items-center gap-2 pl-12 sm:flex-col sm:items-start sm:gap-4 sm:pl-0 sm:flex-row sm:justify-between">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-semibold heading sm:text-2xl">
                  {project.data.name}
                </h1>
                {project.data.description && (
                  <p className="mt-1 hidden truncate text-sm muted sm:block">
                    {project.data.description}
                  </p>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <div
                  className="flex items-center gap-1.5 rounded-full border divider px-2 py-1 text-[11px] muted sm:px-3"
                  title={`Live: ${streamState}`}
                >
                  <span
                    className={[
                      'inline-block h-1.5 w-1.5 rounded-full',
                      streamState === 'open'
                        ? 'bg-emerald-500'
                        : streamState === 'connecting'
                          ? 'bg-amber-400 animate-pulse'
                          : 'bg-neutral-300 dark:bg-neutral-700',
                    ].join(' ')}
                  />
                  <span className="hidden sm:inline">live: {streamState}</span>
                </div>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        `Delete project "${project.data!.name}"?\n\nThis will permanently remove all its links.`,
                      )
                    ) {
                      deleteProject.mutate();
                    }
                  }}
                  disabled={isChecking || deleteProject.isPending}
                  className="btn-danger !px-2.5 sm:!px-4"
                  title={isChecking ? 'Cannot delete while checking' : 'Delete project'}
                >
                  <Trash size={14} />
                  <span className="hidden sm:inline">Delete project</span>
                </button>
              </div>
            </div>
          </header>

          {/* Tabs */}
          <div className="mt-3 flex flex-shrink-0 gap-1 border-b divider sm:mt-0">
            {(['manual', 'sheets', 'stats'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`tab capitalize ${tab === t ? 'tab-active' : ''}`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'manual' && (
            <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 sm:mt-0 sm:flex-initial sm:space-y-4 sm:gap-0">
              {/* Action bar — icon-only buttons on mobile */}
              <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 sm:gap-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setAddOpen(true)}
                    disabled={isChecking}
                    className="btn-primary !px-2.5 sm:!px-4"
                    title="Add links"
                  >
                    <Plus size={14} />
                    <span className="hidden sm:inline">Add links</span>
                  </button>
                  <button
                    onClick={() => startCheck.mutate()}
                    disabled={isChecking || linkRows.length === 0 || startCheck.isPending}
                    className="btn-secondary !px-2.5 sm:!px-4"
                    title={isChecking ? 'Checking…' : 'Check all'}
                  >
                    <Refresh size={14} />
                    <span className="hidden sm:inline">
                      {isChecking ? 'Checking…' : 'Check all'}
                    </span>
                  </button>
                  <button
                    onClick={handleExport}
                    disabled={linkRows.length === 0}
                    className="btn-secondary !px-2.5 sm:!px-4"
                    title="Export CSV"
                  >
                    <Download size={14} />
                    <span className="hidden sm:inline">Export CSV</span>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete all ${totalLinks} manual links?`)) {
                        deleteAll.mutate();
                      }
                    }}
                    disabled={isChecking || linkRows.length === 0}
                    className="btn-danger !px-2.5 sm:!px-4"
                    title="Delete all"
                  >
                    <Trash size={14} />
                    <span className="hidden sm:inline">Delete all</span>
                  </button>
                </div>

                <div className="hidden text-xs muted sm:block">
                  Showing <span className="font-medium heading">{linkRows.length}</span> of{' '}
                  <span className="font-medium heading">{totalLinks}</span> link
                  {totalLinks === 1 ? '' : 's'}
                </div>
              </div>

              {/* Progress bar */}
              {isChecking && progress && (
                <ProgressCard
                  total={progress.total}
                  processed={progress.processed}
                  found={progress.found}
                  errors={progress.errors}
                />
              )}

              {/* Table — fills remaining space on mobile, natural height on desktop */}
              {linksQuery.isLoading ? (
                <div className="card p-12 text-center text-sm muted">Loading links…</div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col sm:block sm:flex-initial">
                  <LinksTable
                    projectId={id}
                    links={linkRows}
                    bulkChecking={isChecking}
                    hasNextPage={linksQuery.hasNextPage}
                    isFetchingNextPage={linksQuery.isFetchingNextPage}
                    onEndReached={() => linksQuery.fetchNextPage()}
                  />
                </div>
              )}
            </div>
          )}

          {tab === 'sheets' && (
            <div className="mt-4 sm:mt-0">
              <SheetsTab projectId={id} progressByTaskId={sheetsProgress} />
            </div>
          )}

          {tab === 'stats' && (
            <div className="mt-4 sm:mt-0">
              <StatsTab projectId={id} />
            </div>
          )}
        </>
      )}

      <AddLinksDialog projectId={id} open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

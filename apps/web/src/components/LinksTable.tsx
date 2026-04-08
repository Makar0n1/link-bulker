'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ApiError, apiClient, type LinkRow, type LinksListResponse } from '../lib/api';
import { computeFollowKind, computeRowStatus, type RowStatus } from '../lib/status';
import { FollowBadge, StatusBadge } from './StatusBadge';
import { OccurrencesDialog } from './OccurrencesDialog';
import { Loader, Refresh, Search, Trash, X } from './icons';

interface Props {
  projectId: string;
  links: LinkRow[];
  /** True when a project-wide manual check is in progress (disables row actions). */
  bulkChecking: boolean;
  /** Whether more pages are available to fetch. */
  hasNextPage?: boolean;
  /** True if useInfiniteQuery is currently fetching the next page. */
  isFetchingNextPage?: boolean;
  /** Called when the virtualizer reaches near the bottom. */
  onEndReached?: () => void;
}

const ROW_HEIGHT = 52;

/**
 * Layout strategy:
 *
 * Two-tier responsive layout.
 *
 *   Desktop (>= sm): the table is fully fluid. Donor column flexes (1fr),
 *     other columns have small fixed widths, and the total min-width is
 *     small enough to fit inside the projects layout (max-w-7xl minus the
 *     sidebar). No horizontal scroll appears.
 *
 *   Mobile (< sm): MIN_TABLE_WIDTH kicks in via CSS, the table scrolls
 *     horizontally, and the sticky actions column stays pinned to the
 *     right edge of the viewport with a gradient fade.
 *
 * The actions column is `position: sticky; right: 0` in CSS Grid, so it
 * always sits flush against the visible right edge regardless of horizontal
 * scroll position.
 */

type ColAlign = 'left' | 'center' | 'right';
type ColDef = { key: string; label: string; width: string; align: ColAlign };

const COLS: ReadonlyArray<ColDef> = [
  { key: 'donor', label: 'Donor URL', width: 'minmax(180px, 1fr)', align: 'left' },
  { key: 'acceptor', label: 'Acceptor', width: 'minmax(120px, 0.6fr)', align: 'left' },
  { key: 'status', label: 'Status', width: '88px', align: 'left' },
  { key: 'follow', label: 'Follow', width: '92px', align: 'left' },
  { key: 'count', label: 'Count', width: '60px', align: 'center' },
  { key: 'http', label: 'HTTP', width: '60px', align: 'center' },
  { key: 'idx', label: 'Idx', width: '50px', align: 'center' },
  { key: 'canon', label: 'Canon', width: '60px', align: 'center' },
  { key: 'last', label: 'Last check', width: '90px', align: 'left' },
  { key: 'actions', label: '', width: '88px', align: 'right' },
] as const;

const GRID_TEMPLATE = COLS.map((c) => c.width).join(' ');

// Tailwind classes for the sticky actions cell. Background must match the
// row background to mask data columns scrolling underneath. The row hover
// background is also handled here so the actions cell highlights together
// with the rest of the row.
const STICKY_ACTIONS_CELL =
  'sticky right-0 z-[5] flex h-full items-center justify-end gap-1 ' +
  'pl-3 pr-4 bg-white group-hover:bg-neutral-50 ' +
  'dark:bg-neutral-900/60 dark:group-hover:bg-neutral-800/30 ' +
  // Left fade so users can see content scrolls under the actions
  'before:pointer-events-none before:absolute before:inset-y-0 before:-left-6 before:w-6 ' +
  'before:bg-gradient-to-r before:from-transparent before:to-white ' +
  'dark:before:to-neutral-900/60';

const STICKY_ACTIONS_HEADER =
  'sticky right-0 z-[6] bg-neutral-50/95 backdrop-blur ' +
  'dark:bg-neutral-900/95 ' +
  'before:pointer-events-none before:absolute before:inset-y-0 before:-left-6 before:w-6 ' +
  'before:bg-gradient-to-r before:from-transparent before:to-neutral-50/95 ' +
  'dark:before:to-neutral-900/95';

type StatusFilter = 'all' | 'done' | 'problem' | 'error' | 'pending';
type FollowFilter = 'all' | 'dofollow' | 'nofollow' | 'not-found';

export function LinksTable({
  projectId,
  links,
  bulkChecking,
  hasNextPage,
  isFetchingNextPage,
  onEndReached,
}: Props) {
  const qc = useQueryClient();
  const parentRef = useRef<HTMLDivElement>(null);
  const [openLink, setOpenLink] = useState<LinkRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Client-side filters. We do them here (not in the API) because:
  //   - the project page already loads up to 1000 rows via infinite query
  //   - filtering is instant; round-tripping to the server would feel laggy
  //   - search & filter chained together is trivial in JS, complex in SQL
  // If a project ever exceeds the page size we'll add server-side params.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [followFilter, setFollowFilter] = useState<FollowFilter>('all');

  const filteredLinks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return links.filter((l) => {
      // Search across donor URL, acceptor host and acceptor raw input.
      if (q) {
        const hay = `${l.donorUrl} ${l.acceptorHost} ${l.acceptorRaw}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== 'all') {
        const rs = computeRowStatus(l);
        if (!matchesStatus(rs, statusFilter)) return false;
      }
      if (followFilter !== 'all') {
        const fk = computeFollowKind(l);
        if (followFilter === 'not-found' && fk !== null) return false;
        if (followFilter === 'dofollow' && fk !== 'dofollow') return false;
        if (followFilter === 'nofollow' && fk !== 'nofollow') return false;
      }
      return true;
    });
  }, [links, search, statusFilter, followFilter]);

  const filtersActive = search !== '' || statusFilter !== 'all' || followFilter !== 'all';

  const virtualizer = useVirtualizer({
    count: filteredLinks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Trigger onEndReached when within ~5 rows of the bottom — only when no
  // filters are active, otherwise endless rows from a server fetch would
  // confuse the user (more rows arrive but they don't match the filter).
  const items = virtualizer.getVirtualItems();
  const lastItem = items[items.length - 1];
  useEffect(() => {
    if (filtersActive) return;
    if (!onEndReached || !hasNextPage || isFetchingNextPage) return;
    if (lastItem && lastItem.index >= filteredLinks.length - 5) {
      onEndReached();
    }
  }, [
    lastItem,
    filteredLinks.length,
    hasNextPage,
    isFetchingNextPage,
    onEndReached,
    filtersActive,
  ]);

  const recheck = useMutation({
    mutationFn: (linkId: string) => apiClient.recheckLink(linkId),
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const retryAfter = (err.details as any)?.retryAfterSec ?? 60;
          setActionError(`Recheck cooldown: try again in ${retryAfter}s`);
        } else if (err.status === 409) {
          setActionError('A bulk check is currently running');
        } else {
          setActionError(err.message);
        }
      } else {
        setActionError('Network error');
      }
      setTimeout(() => setActionError(null), 4000);
    },
  });

  const remove = useMutation({
    mutationFn: (linkId: string) => apiClient.deleteLink(linkId),
    onSuccess: (_data, linkId) => {
      // Remove from infinite cache without refetching
      qc.setQueryData<InfiniteData<LinksListResponse>>(['links', projectId], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map((p) => ({
            ...p,
            items: p.items.filter((l) => l.id !== linkId),
            total: Math.max(0, p.total - 1),
          })),
        };
      });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  if (links.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center gap-2 p-12 text-center">
        <div className="text-sm muted">No links yet.</div>
        <div className="text-xs muted">
          Click <span className="font-medium heading">+ Add links</span> above to get started.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by donor URL or acceptor…"
            className="input !pl-9 !pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon !h-6 !w-6"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="input !w-auto"
        >
          <option value="all">All statuses</option>
          <option value="done">Done</option>
          <option value="problem">Problem</option>
          <option value="error">Error</option>
          <option value="pending">Pending</option>
        </select>
        <select
          value={followFilter}
          onChange={(e) => setFollowFilter(e.target.value as FollowFilter)}
          className="input !w-auto"
        >
          <option value="all">All follow types</option>
          <option value="dofollow">Dofollow</option>
          <option value="nofollow">Nofollow</option>
          <option value="not-found">Not found</option>
        </select>
        {filtersActive && (
          <div className="text-xs muted">
            {filteredLinks.length} of {links.length}
          </div>
        )}
      </div>

      {actionError && (
        <div className="mb-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/60 animate-fade-in">
          {actionError}
        </div>
      )}

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden sm:block sm:flex-initial">
        {/*
          ONE scroll container for both axes. Header is position: sticky inside
          the same min-width wrapper as the body, so it stays pinned to the top
          and scrolls horizontally in lock-step with rows.

          Mobile: card fills its flex parent (flex-1 min-h-0), inner scroller
          takes whatever remains after the action bar / progress sections.
          Page itself is overflow-hidden, so only this inner div scrolls.

          Desktop (sm+): unchanged — max-h/min-h define a comfortable height
          in the natural document flow.
        */}
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto sm:max-h-[calc(100vh-22rem)] sm:min-h-[400px] sm:flex-initial"
        >
          {/*
            Inner wrapper enforces a min-width on mobile so the columns don't
            collapse into unreadable strips. On md+ it becomes fluid (100%),
            so the table fits whatever container width is available — no
            horizontal scroll on desktop.
          */}
          <div className="w-full min-w-[920px] md:min-w-0">
            {/* Sticky header — scrolls horizontally with body, sticks vertically */}
            <div
              className="sticky top-0 z-20 grid gap-3 border-b divider bg-neutral-50/95 py-3 pl-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 backdrop-blur dark:bg-neutral-900/95 dark:text-neutral-400"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
            >
              {COLS.map((c) => {
                const isActions = c.key === 'actions';
                return (
                  <div
                    key={c.key}
                    className={[
                      isActions
                        ? `${STICKY_ACTIONS_HEADER} flex items-center justify-end pr-4`
                        : c.align === 'center'
                          ? 'text-center'
                          : c.align === 'right'
                            ? 'text-right'
                            : 'text-left',
                    ].join(' ')}
                  >
                    {c.label}
                  </div>
                );
              })}
            </div>

            {/* Virtualized body */}
            <div>
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: 'relative',
                  width: '100%',
                }}
              >
                {items.map((virtualRow) => {
                  const link = filteredLinks[virtualRow.index]!;
                  const status = computeRowStatus(link);
                  const follow = computeFollowKind(link);
                  const cooldownActive = isCooldownActive(link.lastCooldownAt);

                  return (
                    <div
                      key={link.id}
                      className="group grid items-center gap-3 border-b border-neutral-100 pl-4 text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-800/30"
                      style={{
                        gridTemplateColumns: GRID_TEMPLATE,
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                        height: ROW_HEIGHT,
                      }}
                    >
                      <button
                        onClick={() => setOpenLink(link)}
                        className="truncate text-left font-mono text-xs text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                        title={link.donorUrl}
                      >
                        {link.donorUrl}
                      </button>
                      <div
                        className="truncate font-mono text-xs muted"
                        title={link.acceptorRaw}
                      >
                        {link.acceptorHost}
                      </div>
                      <div>
                        <StatusBadge status={status} />
                      </div>
                      <div>
                        <FollowBadge kind={follow} />
                      </div>
                      <div className="text-center text-xs font-medium">
                        {link.occurrencesCount || <span className="muted">—</span>}
                      </div>
                      <div className="text-center font-mono text-xs">
                        {link.donorStatusCode ?? <span className="muted">—</span>}
                      </div>
                      <div className="text-center text-sm">
                        {link.donorIndexable === true ? (
                          <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                        ) : link.donorIndexable === false ? (
                          <span className="text-red-600 dark:text-red-400">✗</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </div>
                      <div className="text-center text-sm">
                        {/*
                          Display rules (matches the new product spec):
                          - canonical not present  → "—" (no problem,
                            page status stays green)
                          - canonical present + match → ✓ (green)
                          - canonical present + mismatch → ≠ (amber)
                        */}
                        {link.donorCanonical === null ? (
                          <span className="muted" title="No canonical tag">—</span>
                        ) : link.canonicalMatches === true ? (
                          <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                        ) : link.canonicalMatches === false ? (
                          <span className="text-amber-600 dark:text-amber-400">≠</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] muted">
                        {formatDate(link.lastCheckedAt)}
                      </div>
                      <div className={STICKY_ACTIONS_CELL}>
                        <button
                          onClick={() => recheck.mutate(link.id)}
                          disabled={bulkChecking || cooldownActive || recheck.isPending}
                          className="btn-icon"
                          title={
                            bulkChecking
                              ? 'Bulk check running'
                              : cooldownActive
                                ? 'Cooldown active'
                                : 'Recheck this link'
                          }
                        >
                          <Refresh size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Delete this link?')) remove.mutate(link.id);
                          }}
                          disabled={bulkChecking}
                          className="btn-icon hover:!text-red-600 hover:!bg-red-50 dark:hover:!bg-red-950/30 dark:hover:!text-red-400"
                          title="Delete"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>

            {/* Loading spinner for the next page */}
            {isFetchingNextPage && (
              <div className="flex items-center justify-center gap-2 p-3 text-xs muted">
                <Loader size={14} />
                Loading more…
              </div>
            )}
            {filteredLinks.length === 0 && filtersActive && (
              <div className="p-12 text-center text-xs muted">No links match your filters.</div>
            )}
            {!hasNextPage && filteredLinks.length > 50 && !filtersActive && (
              <div className="p-3 text-center text-xs muted">— end of list —</div>
            )}
          </div>
        </div>
      </div>

      <OccurrencesDialog link={openLink} onClose={() => setOpenLink(null)} />
    </>
  );
}

function isCooldownActive(lastCooldownAt: string | null): boolean {
  if (!lastCooldownAt) return false;
  const elapsed = Date.now() - new Date(lastCooldownAt).getTime();
  return elapsed < 60_000;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

/**
 * Map a derived RowStatus into one of our 4 user-facing filter buckets.
 * Note: GREEN and YELLOW both render as "Done" in the UI, so the "done"
 * filter accepts both. ERROR is its own bucket; PROBLEM is its own bucket.
 */
function matchesStatus(rs: RowStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case 'done':
      return rs === 'GREEN' || rs === 'YELLOW';
    case 'problem':
      return rs === 'PROBLEM';
    case 'error':
      return rs === 'ERROR';
    case 'pending':
      return rs === 'PENDING' || rs === 'CHECKING';
    default:
      return true;
  }
}

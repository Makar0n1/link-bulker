'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ApiError, apiClient, type ProjectStats, type StatsScope } from '../lib/api';

interface Props {
  projectId: string;
}

const SCOPES: ReadonlyArray<{ id: StatsScope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'manual', label: 'Manual' },
  { id: 'sheets', label: 'Sheets' },
];

// Tailwind-aligned palette. Recharts wants raw hex strings.
const COLORS = {
  green: '#10b981',
  yellow: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
  grey: '#9ca3af',
  greenSoft: '#34d39933',
  redSoft: '#f8717133',
};

export function StatsTab({ projectId }: Props) {
  const [scope, setScope] = useState<StatsScope>('all');

  const stats = useQuery({
    queryKey: ['stats', projectId, scope],
    queryFn: () => apiClient.getProjectStats(projectId, scope),
    retry: false,
    // 5s stale: re-fetches on tab focus and after invalidations from
    // useProjectStream when bulk checks complete.
    staleTime: 5_000,
  });

  if (stats.isError && stats.error instanceof ApiError) {
    return (
      <div className="card p-12 text-center text-sm muted">
        Failed to load stats: {stats.error.message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Scope switcher */}
      <div className="inline-flex gap-1 rounded-xl border divider bg-neutral-50 p-1 dark:bg-neutral-900/40">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            onClick={() => setScope(s.id)}
            className={[
              'rounded-lg px-3 py-1.5 text-xs sm:text-sm transition-all duration-150',
              scope === s.id
                ? 'bg-white shadow-sm font-medium heading dark:bg-neutral-800'
                : 'muted hover:text-neutral-900 dark:hover:text-neutral-100',
            ].join(' ')}
          >
            {s.label}
          </button>
        ))}
      </div>

      {stats.isLoading && (
        <div className="card p-12 text-center text-sm muted">Loading stats…</div>
      )}

      {stats.data && stats.data.totals.total === 0 && (
        <div className="card flex flex-col items-center gap-2 p-12 text-center">
          <div className="text-sm muted">No data yet for this scope.</div>
          <div className="text-xs muted">
            Add and check some links to see analytics.
          </div>
        </div>
      )}

      {stats.data && stats.data.totals.total > 0 && <StatsContent data={stats.data} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────

function StatsContent({ data }: { data: ProjectStats }) {
  const statusPie = useMemo(
    () => [
      { name: 'Done', value: data.totals.done, color: COLORS.green },
      { name: 'Problem', value: data.totals.problem, color: COLORS.red },
      { name: 'Error', value: data.totals.error, color: COLORS.red },
      { name: 'Pending', value: data.totals.pending, color: COLORS.grey },
    ].filter((d) => d.value > 0),
    [data.totals],
  );

  const followPie = useMemo(
    () => [
      { name: 'Dofollow', value: data.found.dofollow, color: COLORS.green },
      { name: 'Nofollow', value: data.found.nofollow, color: COLORS.yellow },
    ].filter((d) => d.value > 0),
    [data.found],
  );

  const httpBars = useMemo(
    () => [
      { name: '2xx', value: data.http.ok, color: COLORS.green },
      { name: '3xx', value: data.http.redirect, color: COLORS.blue },
      { name: '404', value: data.http.notFound, color: COLORS.red },
      { name: '5xx', value: data.http.serverError, color: COLORS.red },
      { name: 'other', value: data.http.other, color: COLORS.grey },
    ],
    [data.http],
  );

  const total = data.totals.total;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <>
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total" value={total} />
        <KpiCard
          label="Done"
          value={data.totals.done}
          subtitle={`${pct(data.totals.done)}%`}
          tone="green"
        />
        <KpiCard
          label="Problem"
          value={data.totals.problem}
          subtitle={`${pct(data.totals.problem)}%`}
          tone="yellow"
        />
        <KpiCard
          label="Error"
          value={data.totals.error}
          subtitle={`${pct(data.totals.error)}%`}
          tone="red"
        />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Status distribution">
          {statusPie.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={statusPie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {statusPie.map((d, i) => (
                    <Cell key={i} fill={d.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--rc-tooltip-bg, #fff)',
                    border: 'none',
                    borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,.1)',
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
          <Legend items={statusPie} />
        </ChartCard>

        <ChartCard title="Found links — follow type">
          {followPie.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={followPie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {followPie.map((d, i) => (
                    <Cell key={i} fill={d.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,.1)',
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <Empty hint="No links found yet" />
          )}
          <div className="mt-2 text-center text-xs muted">
            <span className="font-medium heading">{data.found.total}</span> of {total} links found
          </div>
        </ChartCard>

        <ChartCard title="HTTP status codes">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={httpBars} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} tickLine={false} />
              <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                contentStyle={{
                  background: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,.1)',
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {httpBars.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Quick facts">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Indexable yes" value={data.indexable.yes} tone="green" />
            <Fact label="Indexable no" value={data.indexable.no} tone="red" />
            <Fact label="Canonical match" value={data.canonical.match} tone="green" />
            <Fact label="Canonical differs" value={data.canonical.mismatch} tone="yellow" />
            <Fact label="Canonical not found" value={data.canonical.notFound} tone="blue" />
            <Fact label="Found total" value={data.found.total} tone="green" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t divider pt-3 text-center">
            <Timing label="Avg" ms={data.timing.avgMs} />
            <Timing label="p50" ms={data.timing.p50Ms} />
            <Timing label="p95" ms={data.timing.p95Ms} />
          </div>
        </ChartCard>
      </div>

      {/* Top problem donors */}
      {data.topProblemDonors.length > 0 && (
        <ChartCard title="Top problem donors">
          <ul className="divide-y divider text-sm">
            {data.topProblemDonors.map((d) => (
              <li
                key={d.donorHost}
                className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
              >
                <span className="truncate font-mono text-xs heading">{d.donorHost}</span>
                <span className="pill-red">{d.problemCount}</span>
              </li>
            ))}
          </ul>
        </ChartCard>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Small presentational helpers
// ────────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: number;
  subtitle?: string;
  tone?: 'green' | 'yellow' | 'red';
}) {
  const toneClass =
    tone === 'green'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'yellow'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'red'
          ? 'text-red-600 dark:text-red-400'
          : 'heading';
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wider muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {subtitle && <div className="text-[11px] muted">{subtitle}</div>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider muted">{title}</div>
      {children}
    </div>
  );
}

function Empty({ hint = 'No data' }: { hint?: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-xs muted">{hint}</div>
  );
}

function Legend({ items }: { items: Array<{ name: string; value: number; color: string }> }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] muted">
      {items.map((it) => (
        <span key={it.name} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: it.color }}
          />
          {it.name} <span className="heading">{it.value}</span>
        </span>
      ))}
    </div>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'green' | 'yellow' | 'red' | 'blue';
}) {
  const toneClass =
    tone === 'green'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'yellow'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'red'
          ? 'text-red-600 dark:text-red-400'
          : 'text-blue-600 dark:text-blue-400';
  return (
    <div className="rounded-lg border divider px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider muted">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function Timing({ label, ms }: { label: string; ms: number | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider muted">{label}</div>
      <div className="font-mono text-sm heading">{ms != null ? `${ms}ms` : '—'}</div>
    </div>
  );
}

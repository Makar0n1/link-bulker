'use client';

import type { LinkRow } from '../lib/api';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { X } from './icons';

interface Props {
  link: LinkRow | null;
  onClose: () => void;
}

/**
 * Modal that displays all occurrences (anchor / rel / target / tag) for a
 * single link. Opened by clicking a row in LinksTable.
 */
export function OccurrencesDialog({ link, onClose }: Props) {
  useBodyScrollLock(link !== null);
  if (!link) return null;

  const occurrences = link.occurrences ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8 backdrop-blur-sm animate-overlay-in">
      <div className="card relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b divider px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold heading">Link details</h2>
            <p className="mt-0.5 truncate font-mono text-xs muted" title={link.donorUrl}>
              {link.donorUrl}
            </p>
            <p className="text-xs muted">
              Acceptor: <span className="font-mono heading">{link.acceptorHost}</span>
              <span className="opacity-30 mx-1.5">·</span>
              {occurrences.length} occurrence{occurrences.length === 1 ? '' : 's'}
            </p>
          </div>
          <button onClick={onClose} className="btn-icon" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {link.error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200/60 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/60">
              {link.error}
            </div>
          )}

          {/* Donor metadata grid */}
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Field label="HTTP" value={link.donorStatusCode?.toString() ?? '—'} />
            <Field
              label="Indexable"
              value={link.donorIndexable === null ? '—' : link.donorIndexable ? 'yes' : 'no'}
            />
            <Field
              label="Canonical"
              value={
                link.canonicalMatches === null ? '—' : link.canonicalMatches ? 'match' : 'differs'
              }
            />
            <Field
              label="Duration"
              value={link.checkDurationMs ? `${link.checkDurationMs}ms` : '—'}
            />
          </div>

          {link.donorCanonical && (
            <div className="break-all rounded-lg bg-neutral-50 px-3 py-2 font-mono text-xs muted dark:bg-neutral-900/40">
              <span className="muted">canonical → </span>
              <span className="heading">{link.donorCanonical}</span>
            </div>
          )}

          {/* Occurrences table */}
          {occurrences.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border divider">
              <table className="w-full text-xs" style={{ minWidth: 700 }}>
                <thead className="sticky top-0 bg-neutral-50 text-[10px] uppercase tracking-wider muted dark:bg-neutral-900/40">
                  <tr>
                    <th className="w-10 px-2 py-2 text-left">#</th>
                    <th className="w-20 px-2 py-2 text-left">Tag</th>
                    <th className="px-2 py-2 text-left">Anchor</th>
                    <th className="w-32 px-2 py-2 text-left">Rel</th>
                    <th className="w-20 px-2 py-2 text-left">Target</th>
                    <th className="px-2 py-2 text-left">Href</th>
                  </tr>
                </thead>
                <tbody>
                  {occurrences.map((o, i) => (
                    <tr
                      key={i}
                      className="border-t divider hover:bg-neutral-50 dark:hover:bg-neutral-900/40"
                    >
                      <td className="px-2 py-1.5 muted">{o.position}</td>
                      <td className="px-2 py-1.5 font-mono">{o.tag}</td>
                      <td className="max-w-xs truncate px-2 py-1.5" title={o.anchor}>
                        {o.anchor || <span className="muted">—</span>}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{o.rel.join(' ') || '—'}</td>
                      <td className="px-2 py-1.5 font-mono">{o.target ?? '—'}</td>
                      <td className="max-w-xs truncate px-2 py-1.5 font-mono" title={o.href}>
                        {o.href}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-sm muted py-4">No occurrences recorded.</p>
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end border-t divider px-6 py-4">
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border divider px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider muted">{label}</div>
      <div className="font-mono text-sm heading">{value}</div>
    </div>
  );
}

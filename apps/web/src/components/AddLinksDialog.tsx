'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError, type ManualLinkInput } from '../lib/api';
import {
  parseLinksCsv,
  rowsToPayload,
  validateRow,
  type ParsedRow,
} from '../lib/parse-csv';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { Plus, Trash, X } from './icons';

const MAX_ITEMS = 1000;
const CSV_PREVIEW_ROWS = 10;

type Tab = 'one-many' | 'pairs' | 'csv';

interface Props {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

interface PairRow {
  donorUrl: string;
  acceptor: string;
}

export function AddLinksDialog({ projectId, open, onClose }: Props) {
  useBodyScrollLock(open);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('one-many');

  // Tab 1
  const [acceptor, setAcceptor] = useState('');
  const [urlsText, setUrlsText] = useState('');

  // Tab 2
  const [pairs, setPairs] = useState<PairRow[]>([{ donorUrl: '', acceptor: '' }]);

  // Tab 3
  const [csvHasHeader, setCsvHasHeader] = useState(true);
  const [csvRows, setCsvRows] = useState<ParsedRow[] | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const built = useMemo(
    () => buildPayload(tab, acceptor, urlsText, pairs, csvRows),
    [tab, acceptor, urlsText, pairs, csvRows],
  );

  const submit = useMutation({
    mutationFn: (items: ManualLinkInput[]) => apiClient.createManualLinks(projectId, items),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['links', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      reset();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setSubmitError(err.message);
      else setSubmitError('Network error');
    },
  });

  function reset() {
    setAcceptor('');
    setUrlsText('');
    setPairs([{ donorUrl: '', acceptor: '' }]);
    setCsvRows(null);
    setCsvFileName(null);
    setCsvError(null);
    setSubmitError(null);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (built.validRows.length === 0) {
      setSubmitError('Nothing to submit — fix the errors above');
      return;
    }
    if (built.validRows.length > MAX_ITEMS) {
      setSubmitError(`Cannot submit more than ${MAX_ITEMS} items at once`);
      return;
    }
    submit.mutate(built.validRows);
  }

  async function onCsvFile(file: File) {
    setCsvError(null);
    setCsvFileName(file.name);
    try {
      const result = await parseLinksCsv(file, csvHasHeader);
      setCsvRows(result.rows);
    } catch (err) {
      setCsvError(`Could not parse CSV: ${(err as Error).message}`);
      setCsvRows(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8 backdrop-blur-sm animate-overlay-in">
      <form
        onSubmit={onSubmit}
        className="card relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden animate-fade-in"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b divider px-6 py-4">
          <div>
            <h2 className="text-base font-semibold heading">Add manual links</h2>
            <p className="text-xs muted mt-0.5">Up to {MAX_ITEMS} pairs at once.</p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex-shrink-0 px-6 pt-4">
          <div className="flex gap-1 rounded-xl border divider bg-neutral-50 p-1 dark:bg-neutral-900/40">
            {[
              { id: 'one-many' as const, label: 'One acceptor + URLs' },
              { id: 'pairs' as const, label: 'Pairs' },
              { id: 'csv' as const, label: 'CSV import' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={[
                  'flex-1 rounded-lg px-3 py-1.5 text-xs sm:text-sm transition-all duration-150',
                  tab === t.id
                    ? 'bg-white shadow-sm font-medium heading dark:bg-neutral-800'
                    : 'muted hover:text-neutral-900 dark:hover:text-neutral-100',
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content (scrollable) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {tab === 'one-many' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="label">Acceptor</label>
                <input
                  value={acceptor}
                  onChange={(e) => setAcceptor(e.target.value)}
                  placeholder="e.g. studibucht.de"
                  className="input"
                />
              </div>
              <div className="space-y-1.5">
                <label className="label">Donor URLs (one per line)</label>
                <textarea
                  value={urlsText}
                  onChange={(e) => setUrlsText(e.target.value)}
                  rows={10}
                  placeholder={'https://donor1.com/page\nhttps://donor2.com/another'}
                  className="input font-mono text-xs resize-y"
                />
              </div>
            </div>
          )}

          {tab === 'pairs' && (
            <div className="space-y-2">
              <div className="space-y-2">
                {pairs.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={p.donorUrl}
                      onChange={(e) => {
                        const next = [...pairs];
                        next[i] = { ...next[i]!, donorUrl: e.target.value };
                        setPairs(next);
                      }}
                      placeholder="https://donor.com/page"
                      className="input flex-1 font-mono text-xs"
                    />
                    <input
                      value={p.acceptor}
                      onChange={(e) => {
                        const next = [...pairs];
                        next[i] = { ...next[i]!, acceptor: e.target.value };
                        setPairs(next);
                      }}
                      placeholder="acceptor.com"
                      className="input w-44 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setPairs(pairs.filter((_, j) => j !== i))}
                      className="btn-icon hover:!text-red-600 hover:!bg-red-50 dark:hover:!bg-red-950/30 dark:hover:!text-red-400"
                      aria-label="Remove row"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPairs([...pairs, { donorUrl: '', acceptor: '' }])}
                className="btn-ghost text-xs"
              >
                <Plus size={14} />
                Add row
              </button>
            </div>
          )}

          {tab === 'csv' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm muted">
                <input
                  type="checkbox"
                  checked={csvHasHeader}
                  onChange={(e) => setCsvHasHeader(e.target.checked)}
                  className="rounded"
                />
                First row is a header
              </label>
              <div className="rounded-xl border-2 border-dashed divider p-6 text-center">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onCsvFile(f);
                  }}
                  className="block w-full text-sm muted file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-4 file:py-1.5 file:text-xs file:font-medium file:text-white file:cursor-pointer hover:file:bg-neutral-800 dark:file:bg-white dark:file:text-neutral-900 dark:hover:file:bg-neutral-100"
                />
                <p className="mt-2 text-xs muted">
                  Column A → donor URL · Column B → acceptor
                </p>
              </div>
              {csvFileName && (
                <p className="text-xs muted">
                  Loaded: <span className="font-mono heading">{csvFileName}</span>
                </p>
              )}
              {csvError && (
                <p className="text-sm text-red-600 dark:text-red-400">{csvError}</p>
              )}
              {csvRows && csvRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs muted">
                    Preview ({Math.min(CSV_PREVIEW_ROWS, csvRows.length)} of {csvRows.length}{' '}
                    rows):
                  </p>
                  <div className="overflow-x-auto rounded-lg border divider">
                    <table
                      className="w-full text-xs"
                      style={{ tableLayout: 'fixed', minWidth: 600 }}
                    >
                      <colgroup>
                        <col style={{ width: 40 }} />
                        <col style={{ width: '45%' }} />
                        <col style={{ width: '25%' }} />
                        <col style={{ width: '30%' }} />
                      </colgroup>
                      <thead>
                        <tr className="bg-neutral-50 text-[10px] uppercase tracking-wider muted dark:bg-neutral-900/40">
                          <th className="px-2 py-1.5 text-left">#</th>
                          <th className="px-2 py-1.5 text-left">donorUrl</th>
                          <th className="px-2 py-1.5 text-left">acceptor</th>
                          <th className="px-2 py-1.5 text-left">errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.slice(0, CSV_PREVIEW_ROWS).map((r) => (
                          <tr
                            key={r.rowIndex}
                            className={`border-t divider ${
                              r.errors.length > 0
                                ? 'bg-red-50/40 text-red-700 dark:bg-red-950/20 dark:text-red-300'
                                : ''
                            }`}
                          >
                            <td className="px-2 py-1.5 muted">{r.rowIndex}</td>
                            <td
                              className="truncate px-2 py-1.5 font-mono"
                              title={r.donorUrl || '<empty>'}
                            >
                              {r.donorUrl || <span className="muted">&lt;empty&gt;</span>}
                            </td>
                            <td
                              className="truncate px-2 py-1.5 font-mono"
                              title={r.acceptor || '<empty>'}
                            >
                              {r.acceptor || <span className="muted">&lt;empty&gt;</span>}
                            </td>
                            <td
                              className="truncate px-2 py-1.5"
                              title={r.errors.join(', ')}
                            >
                              {r.errors.join(', ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Validation summary + invalid details */}
          <div className="mt-4 space-y-2">
            <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-900/40">
              <span className="font-medium heading">{built.validRows.length}</span> valid
              {built.invalidCount > 0 && (
                <span className="ml-2 text-red-600 dark:text-red-400">
                  · {built.invalidCount} invalid
                </span>
              )}
              {built.validRows.length > MAX_ITEMS && (
                <span className="ml-2 text-red-600 dark:text-red-400">
                  · exceeds {MAX_ITEMS} max
                </span>
              )}
            </div>

            {built.invalidCount > 0 && tab !== 'csv' && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-600 dark:text-red-400 hover:underline">
                  Show {built.invalidCount} invalid rows
                </summary>
                <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto rounded-lg bg-neutral-50 p-2 dark:bg-neutral-900/40">
                  {built.invalidRows.slice(0, 20).map((r) => (
                    <li
                      key={r.rowIndex}
                      className="truncate text-red-700 dark:text-red-300"
                      title={r.errors.join(', ')}
                    >
                      Row {r.rowIndex}: {r.errors.join(', ')}
                    </li>
                  ))}
                  {built.invalidRows.length > 20 && (
                    <li className="muted">… and {built.invalidRows.length - 20} more</li>
                  )}
                </ul>
              </details>
            )}

            {submitError && (
              <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 justify-end gap-2 border-t divider px-6 py-4">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              submit.isPending ||
              built.validRows.length === 0 ||
              built.validRows.length > MAX_ITEMS
            }
            className="btn-primary"
          >
            {submit.isPending
              ? 'Adding…'
              : `Add ${built.validRows.length} link${built.validRows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </form>
    </div>
  );
}

interface BuildResult {
  validRows: ManualLinkInput[];
  invalidRows: ParsedRow[];
  invalidCount: number;
}

function buildPayload(
  tab: Tab,
  acceptor: string,
  urlsText: string,
  pairs: PairRow[],
  csvRows: ParsedRow[] | null,
): BuildResult {
  let parsed: ParsedRow[] = [];

  if (tab === 'one-many') {
    const urls = urlsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    parsed = urls.map((url, i) => validateRow(i + 1, url, acceptor));
  } else if (tab === 'pairs') {
    parsed = pairs
      .filter((p) => p.donorUrl.trim() || p.acceptor.trim())
      .map((p, i) => validateRow(i + 1, p.donorUrl, p.acceptor));
  } else if (tab === 'csv' && csvRows) {
    parsed = csvRows;
  }

  const invalidRows = parsed.filter((r) => r.errors.length > 0);
  const validRows = rowsToPayload(parsed);
  return { validRows, invalidRows, invalidCount: invalidRows.length };
}

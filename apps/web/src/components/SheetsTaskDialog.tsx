'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseSheetUrl } from '@link-checker/shared';
import {
  apiClient,
  ApiError,
  type SheetsTaskInput,
  type SheetsTaskRow,
} from '../lib/api';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { Check, X } from './icons';

interface Props {
  projectId: string;
  /** When set, the dialog is in "edit" mode for that task. */
  editing: SheetsTaskRow | null;
  open: boolean;
  onClose: () => void;
}

const COLUMN_REGEX = /^[A-Z]{1,3}$/;

/**
 * Cron presets shown in the dialog. Users pick a label, we send the matching
 * cron string to the server. Empty string = no schedule (manual run only).
 */
const CRON_PRESETS: ReadonlyArray<{ label: string; cron: string }> = [
  { label: 'Off (manual only)', cron: '' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 3 hours', cron: '0 */3 * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Every 9 hours', cron: '0 */9 * * *' },
  { label: 'Every 12 hours', cron: '0 */12 * * *' },
  { label: 'Daily', cron: '0 0 * * *' },
  { label: 'Every 3 days', cron: '0 0 */3 * *' },
  { label: 'Weekly', cron: '0 0 * * 0' },
  { label: 'Monthly', cron: '0 0 1 * *' },
];

interface FormState {
  name: string;
  sheetUrl: string;
  donorColumn: string;
  acceptorColumn: string;
  resultStartCol: string;
  headerRow: number;
  dataStartRow: number;
  scheduleCron: string;
}

const empty: FormState = {
  name: '',
  sheetUrl: '',
  donorColumn: 'A',
  acceptorColumn: 'B',
  resultStartCol: 'C',
  headerRow: 1,
  dataStartRow: 2,
  scheduleCron: '',
};

export function SheetsTaskDialog({ projectId, editing, open, onClose }: Props) {
  useBodyScrollLock(open);
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(empty);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);

  // Pre-populate when entering edit mode. We synthesise a sheetUrl back from
  // spreadsheetId + sheetGid so the user sees the current selection and can
  // paste a new URL to change it.
  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${editing.spreadsheetId}/edit#gid=${editing.sheetGid}`,
        donorColumn: editing.donorColumn,
        acceptorColumn: editing.acceptorColumn,
        resultStartCol: editing.resultStartCol,
        headerRow: editing.headerRow,
        dataStartRow: editing.dataStartRow,
        scheduleCron: editing.scheduleCron ?? '',
      });
    } else {
      setForm(empty);
    }
    setSubmitError(null);
  }, [editing, open]);

  const serviceAccount = useQuery({
    queryKey: ['service-account-email'],
    queryFn: () => apiClient.getServiceAccountEmail(),
    enabled: open,
    staleTime: 60 * 60 * 1000,
  });

  // Live-parse the URL so the user gets feedback as they paste it
  const parsed = useMemo(() => parseSheetUrl(form.sheetUrl), [form.sheetUrl]);

  const submit = useMutation({
    mutationFn: () => {
      if (!parsed) throw new Error('Invalid Google Sheets URL');
      const dto: SheetsTaskInput = {
        name: form.name.trim(),
        spreadsheetId: parsed.spreadsheetId,
        sheetGid: parsed.sheetGid,
        donorColumn: form.donorColumn,
        acceptorColumn: form.acceptorColumn,
        resultStartCol: form.resultStartCol,
        headerRow: form.headerRow,
        dataStartRow: form.dataStartRow,
        scheduleCron: form.scheduleCron || undefined,
      };
      return editing
        ? apiClient.updateSheetsTask(editing.id, dto)
        : apiClient.createSheetsTask(projectId, dto);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheets-tasks', projectId] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setSubmitError(err.message);
      else setSubmitError((err as Error).message ?? 'Network error');
    },
  });

  function copyEmail() {
    const email = serviceAccount.data?.email;
    if (!email) return;
    navigator.clipboard.writeText(email).then(() => {
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 1500);
    });
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const errors = validate(form, parsed !== null);
    if (errors.length > 0) {
      setSubmitError(errors[0]!);
      return;
    }
    submit.mutate();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8 backdrop-blur-sm animate-overlay-in">
      <form
        onSubmit={onSubmit}
        className="card relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden animate-fade-in"
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b divider px-6 py-4">
          <div>
            <h2 className="text-base font-semibold heading">
              {editing ? 'Edit sheets task' : 'Connect a Google Sheet'}
            </h2>
            <p className="mt-0.5 text-xs muted">
              The service account needs read/write access to your spreadsheet.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* Service account hint */}
          {serviceAccount.data?.email && (
            <div className="rounded-xl border divider bg-neutral-50 p-3 text-xs dark:bg-neutral-900/40">
              <div className="muted mb-1">
                Share your spreadsheet (Editor access) with this service account:
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate font-mono heading">
                  {serviceAccount.data.email}
                </code>
                <button
                  type="button"
                  onClick={copyEmail}
                  className="btn-secondary !px-2 !py-1 !text-xs"
                >
                  {emailCopied ? <Check size={12} /> : null}
                  {emailCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="label">Task name</label>
              <input
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="e.g. Q1 backlinks"
                className="input"
                required
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="label">Google Sheets URL</label>
              <input
                value={form.sheetUrl}
                onChange={(e) => update('sheetUrl', e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0"
                className="input font-mono text-xs"
                required
              />
              {form.sheetUrl && parsed && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                  ✓ Spreadsheet:{' '}
                  <span className="font-mono">{parsed.spreadsheetId.slice(0, 16)}…</span>
                  <span className="opacity-50 mx-1.5">·</span>
                  Sheet gid: <span className="font-mono">{parsed.sheetGid}</span>
                </p>
              )}
              {form.sheetUrl && !parsed && (
                <p className="text-[11px] text-red-600 dark:text-red-400">
                  Could not parse — paste the full Google Sheets URL.
                </p>
              )}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="label">Schedule</label>
              <select
                value={form.scheduleCron}
                onChange={(e) => update('scheduleCron', e.target.value)}
                className="input"
              >
                {CRON_PRESETS.map((p) => (
                  <option key={p.label} value={p.cron}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="label">Donor URL column</label>
              <input
                value={form.donorColumn}
                onChange={(e) => update('donorColumn', e.target.value.toUpperCase())}
                placeholder="A"
                className="input font-mono uppercase"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="label">Acceptor column</label>
              <input
                value={form.acceptorColumn}
                onChange={(e) => update('acceptorColumn', e.target.value.toUpperCase())}
                placeholder="B"
                className="input font-mono uppercase"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="label">Result start column</label>
              <input
                value={form.resultStartCol}
                onChange={(e) => update('resultStartCol', e.target.value.toUpperCase())}
                placeholder="C"
                className="input font-mono uppercase"
                required
              />
              <p className="text-[11px] muted">6 columns will be written from here.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="label">Header row</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={form.headerRow}
                  onChange={(e) => update('headerRow', Number(e.target.value))}
                  className="input"
                />
              </div>
              <div className="space-y-1.5">
                <label className="label">Data start row</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={form.dataStartRow}
                  onChange={(e) => update('dataStartRow', Number(e.target.value))}
                  className="input"
                />
              </div>
            </div>
          </div>

          {submitError && (
            <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t divider px-6 py-4">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submit.isPending || !parsed}
            className="btn-primary"
          >
            {submit.isPending ? 'Saving…' : editing ? 'Save changes' : 'Connect sheet'}
          </button>
        </div>
      </form>
    </div>
  );
}

function validate(form: FormState, parsedOk: boolean): string[] {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push('Name is required');
  if (!parsedOk) errors.push('Paste a valid Google Sheets URL');
  if (!COLUMN_REGEX.test(form.donorColumn)) errors.push('Donor column must be letters (A-Z)');
  if (!COLUMN_REGEX.test(form.acceptorColumn))
    errors.push('Acceptor column must be letters (A-Z)');
  if (!COLUMN_REGEX.test(form.resultStartCol))
    errors.push('Result column must be letters (A-Z)');
  if (form.dataStartRow <= form.headerRow)
    errors.push('Data start row must be after header row');
  return errors;
}

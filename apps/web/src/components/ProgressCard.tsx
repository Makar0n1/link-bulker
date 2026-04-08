'use client';

/**
 * Reusable progress card used by both Manual mode (project-wide check) and
 * Sheets mode (per-task run). Shows: processed/total counter, found and
 * error pills, remaining count and a percentage, plus a gradient bar.
 *
 * Two visual sizes:
 *   default — used as a full-width card on the project page during manual checks
 *   compact — used inline inside a sheets-task card (smaller text, no card frame)
 */
interface Props {
  total: number;
  processed: number;
  found: number;
  errors: number;
  /** Optional title shown above the bar — e.g. task name in Sheets mode. */
  title?: string;
  /** Render without the card chrome (for embedding inside another card). */
  compact?: boolean;
}

export function ProgressCard({ total, processed, found, errors, title, compact }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const remaining = Math.max(0, total - processed);

  const body = (
    <>
      {title && (
        <div className="mb-2 truncate text-xs font-medium heading">{title}</div>
      )}
      <div className={`mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 ${compact ? 'text-xs' : 'text-sm'}`}>
        <div className="flex items-baseline gap-1">
          <span className="heading font-medium">{processed}</span>
          <span className="muted">/</span>
          <span className="muted">{total}</span>
          <span className="muted">·</span>
          <span className="muted">{remaining} remaining</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-emerald-600 dark:text-emerald-400">✓ {found}</span>
          <span className="opacity-30">·</span>
          <span className="text-red-600 dark:text-red-400">✗ {errors}</span>
          <span className="opacity-30">·</span>
          <span className="muted">{pct}%</span>
        </div>
      </div>
      <div
        className={`overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800 ${
          compact ? 'h-1' : 'h-1.5'
        }`}
      >
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </>
  );

  if (compact) {
    return <div className="animate-fade-in">{body}</div>;
  }
  return <div className="card flex-shrink-0 p-4 animate-fade-in">{body}</div>;
}

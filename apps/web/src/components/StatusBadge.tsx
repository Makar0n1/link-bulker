import type { RowStatus } from '../lib/status';
import { rowStatusLabel } from '../lib/status';

const STYLES: Record<RowStatus, string> = {
  PENDING: 'pill-gray',
  CHECKING: 'pill-blue animate-pulse',
  GREEN: 'pill-green',
  YELLOW: 'pill-yellow',
  PROBLEM: 'pill-red',
  ERROR: 'pill-red',
};

export function StatusBadge({ status }: { status: RowStatus }) {
  return <span className={STYLES[status]}>{rowStatusLabel(status)}</span>;
}

export function FollowBadge({ kind }: { kind: 'dofollow' | 'nofollow' | null }) {
  if (kind === null) return <span className="muted text-xs">—</span>;
  if (kind === 'dofollow') return <span className="pill-green">dofollow</span>;
  return <span className="pill-yellow">nofollow</span>;
}

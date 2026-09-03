import type { HTMLAttributes } from 'react';

import { cn } from './utils';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cn('rb-badge', `rb-badge--${tone}`, className)} {...props} />;
}

const statusTone: Record<string, BadgeTone> = {
  active: 'success',
  approved: 'success',
  balanced: 'success',
  complete: 'success',
  completed: 'success',
  done: 'success',
  open: 'success',
  posted: 'success',
  archived: 'neutral',
  draft: 'neutral',
  in_progress: 'info',
  invoiced: 'info',
  submitted: 'info',
  on_hold: 'warning',
  pending: 'warning',
  review: 'warning',
  closed: 'warning',
  cancelled: 'danger',
  failed: 'danger',
  locked: 'danger',
  rejected: 'danger',
  reversed: 'danger',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const normalized = status.toLowerCase();
  return (
    <Badge tone={statusTone[normalized] ?? 'neutral'} className={className}>
      <span className="rb-badge__dot" aria-hidden="true" />
      {status}
    </Badge>
  );
}

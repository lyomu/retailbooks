import type { LucideIcon } from 'lucide-react';
import type { HTMLAttributes } from 'react';

import { Card } from './card';
import { cn } from './utils';

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = 'primary',
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  tone?: 'primary' | 'info' | 'success' | 'warning' | 'danger';
}) {
  return (
    <Card className={cn('rb-stat-card', className)} {...props}>
      <div className="rb-stat-card__copy">
        <span className="rb-stat-card__label">{label}</span>
        <strong className="rb-stat-card__value">{value}</strong>
        {hint ? <span className="rb-stat-card__hint">{hint}</span> : null}
      </div>
      <span className={cn('rb-stat-card__icon', `rb-stat-card__icon--${tone}`)}>
        <Icon aria-hidden="true" />
      </span>
    </Card>
  );
}

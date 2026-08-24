import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from './utils';

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rb-empty-state', className)}>
      <span className="rb-empty-state__icon">
        <Icon aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="rb-empty-state__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'We couldn’t load this information',
  description = 'Try again. If the problem continues, check your connection.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState icon={AlertTriangle} title={title} description={description} action={action} />
  );
}

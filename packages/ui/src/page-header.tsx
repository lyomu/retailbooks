import type { ReactNode } from 'react';

import { cn } from './utils';

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('rb-page-header', className)}>
      <div className="rb-page-header__copy">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="rb-page-header__actions">{actions}</div> : null}
    </header>
  );
}

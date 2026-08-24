import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

import { EmptyState } from './empty-state';

export function ForbiddenState({
  title = 'You don’t have access to this page',
  description = 'Ask an organization owner or administrator for access.',
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <EmptyState
      icon={Lock}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}

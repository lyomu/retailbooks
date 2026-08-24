import type { HTMLAttributes } from 'react';

import { cn } from './utils';

export function Spinner({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('rb-spinner', className)} role="status" aria-label="Loading" {...props} />
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rb-skeleton', className)} aria-hidden="true" {...props} />;
}

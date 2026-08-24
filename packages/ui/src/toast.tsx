'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from './utils';

export const ToastProvider = ToastPrimitive.Provider;

export function ToastViewport({
  className,
  ...props
}: ComponentProps<typeof ToastPrimitive.Viewport>) {
  return <ToastPrimitive.Viewport className={cn('rb-toast__viewport', className)} {...props} />;
}

export function Toast({
  title,
  description,
  className,
  ...props
}: ComponentProps<typeof ToastPrimitive.Root> & {
  title: string;
  description?: ReactNode;
}) {
  return (
    <ToastPrimitive.Root className={cn('rb-toast', className)} {...props}>
      <CheckCircle2 className="rb-toast__icon" aria-hidden="true" />
      <div className="rb-toast__copy">
        <ToastPrimitive.Title className="rb-toast__title">{title}</ToastPrimitive.Title>
        {description ? (
          <ToastPrimitive.Description className="rb-toast__description">
            {description}
          </ToastPrimitive.Description>
        ) : null}
      </div>
      <ToastPrimitive.Close className="rb-icon-button" aria-label="Dismiss notification">
        <X aria-hidden="true" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

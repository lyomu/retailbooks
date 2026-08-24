'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from './utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  className,
  title,
  description,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="rb-dialog__overlay" />
      <DialogPrimitive.Content className={cn('rb-dialog__content', className)} {...props}>
        <div className="rb-dialog__header">
          <div>
            <DialogPrimitive.Title className="rb-dialog__title">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="rb-dialog__description">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close className="rb-icon-button" aria-label="Close dialog">
            <X aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DrawerContent({
  children,
  className,
  title,
  description,
  side = 'left',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  children: ReactNode;
  side?: 'left' | 'right';
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="rb-dialog__overlay" />
      <DialogPrimitive.Content
        className={cn('rb-drawer', `rb-drawer--${side}`, className)}
        {...props}
      >
        <DialogPrimitive.Title className="rb-visually-hidden">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="rb-visually-hidden">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

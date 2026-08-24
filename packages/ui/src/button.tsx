'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from './utils';

const buttonVariants = cva('rb-button', {
  variants: {
    variant: {
      primary: 'rb-button--primary',
      secondary: 'rb-button--secondary',
      outline: 'rb-button--outline',
      ghost: 'rb-button--ghost',
      danger: 'rb-button--danger',
    },
    size: {
      sm: 'rb-button--sm',
      md: 'rb-button--md',
      lg: 'rb-button--lg',
      icon: 'rb-button--icon',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { asChild = false, children, className, disabled, loading = false, size, variant, ...props },
  ref,
) {
  if (asChild) {
    return (
      <Slot className={cn(buttonVariants({ size, variant }), className)} ref={ref} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      className={cn(buttonVariants({ size, variant }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      ref={ref}
      {...props}
    >
      {loading ? <LoaderCircle className="rb-button__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});

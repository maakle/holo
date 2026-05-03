import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-4 tracking-wide whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral:
          'border-border bg-surface-2 text-text-muted',
        success:
          'border-transparent bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success',
        warning:
          'border-transparent bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-warning',
        error:
          'border-transparent bg-[color-mix(in_srgb,var(--error)_12%,transparent)] text-error',
        accent:
          'border-transparent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

import { cn } from '@/lib/utils';
import { SelectHTMLAttributes, forwardRef } from 'react';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-10 w-full rounded-xl border border-white/[0.08] bg-[var(--input-bg)] px-3.5 text-sm text-foreground',
        'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40',
        'hover:border-white/[0.12] transition-all duration-200',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className
      )}
      {...props}
    />
  )
);
Select.displayName = 'Select';

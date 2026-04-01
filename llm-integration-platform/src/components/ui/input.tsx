import { cn } from '@/lib/utils';
import { InputHTMLAttributes, forwardRef } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-xl border border-white/[0.08] bg-[var(--input-bg)] px-3.5 text-sm text-foreground',
        'placeholder:text-muted-foreground/60',
        'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40',
        'hover:border-white/[0.12] transition-all duration-200',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

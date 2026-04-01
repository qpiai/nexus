import { cn } from '@/lib/utils';
import { TextareaHTMLAttributes, forwardRef } from 'react';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-xl border border-white/[0.08] bg-[var(--input-bg)] px-3.5 py-2.5 text-sm text-foreground',
        'placeholder:text-muted-foreground/60',
        'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40',
        'hover:border-white/[0.12] transition-all duration-200',
        'disabled:cursor-not-allowed disabled:opacity-40',
        'min-h-[80px] resize-y',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

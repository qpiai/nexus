import { cn } from '@/lib/utils';
import { HTMLAttributes } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'outline' | 'secondary';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-primary/15 text-primary border-primary/25 dark:bg-primary/20 dark:border-primary/30',
    secondary: 'bg-secondary/15 text-secondary border-secondary/25 dark:bg-secondary/20 dark:border-secondary/30',
    success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 dark:bg-emerald-500/20 border-emerald-500/25 dark:border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 dark:bg-amber-500/20 border-amber-500/25 dark:border-amber-500/30',
    destructive: 'bg-red-500/15 text-red-600 dark:text-red-400 dark:bg-red-500/20 border-red-500/25 dark:border-red-500/30',
    outline: 'bg-transparent text-muted-foreground border-border/80',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

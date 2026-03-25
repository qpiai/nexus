import { cn } from '@/lib/utils';
import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    const variants = {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30',
      secondary: 'bg-secondary/20 text-secondary border border-secondary/30 hover:bg-secondary/30',
      outline: 'border border-border bg-transparent hover:bg-accent hover:border-primary/30 text-foreground',
      ghost: 'bg-transparent hover:bg-accent/80 text-foreground',
      destructive: 'bg-destructive/90 text-white hover:bg-destructive shadow-md shadow-destructive/20',
      success: 'bg-success/90 text-white hover:bg-success shadow-md shadow-success/20',
    };
    const sizes = {
      sm: 'h-8 px-3 text-xs rounded-lg',
      md: 'h-9 px-4 text-sm rounded-lg',
      lg: 'h-11 px-6 text-sm rounded-xl',
      icon: 'h-9 w-9 rounded-lg',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:pointer-events-none disabled:opacity-40',
          'active:scale-[0.98]',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

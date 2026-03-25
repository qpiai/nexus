'use client';

import { cn } from '@/lib/utils';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
  label?: string;
}

export function Slider({ value, min, max, step = 1, onChange, className, label }: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <span>{value}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--primary) ${percent}%, var(--border) ${percent}%)`,
        }}
      />
    </div>
  );
}

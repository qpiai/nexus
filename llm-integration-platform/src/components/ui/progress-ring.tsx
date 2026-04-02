'use client';

import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';

interface ProgressRingProps {
  value: number;        // 0-100
  size?: number;        // px, default 80
  strokeWidth?: number; // default 10
  status?: 'running' | 'complete' | 'error' | 'idle';
  showText?: boolean;   // default true
  label?: string;       // optional label below percentage
}

export function ProgressRing({
  value,
  size = 80,
  strokeWidth = 10,
  status = 'running',
  showText = true,
  label,
}: ProgressRingProps) {
  const colors = {
    running: { path: 'hsl(var(--primary))', trail: 'hsl(var(--muted))' },
    complete: { path: '#34d399', trail: 'hsl(var(--muted))' },
    error: { path: '#f87171', trail: 'hsl(var(--muted))' },
    idle: { path: 'hsl(var(--muted-foreground))', trail: 'hsl(var(--muted))' },
  };

  const { path, trail } = colors[status];

  return (
    <div style={{ width: size, height: size }} className="relative shrink-0">
      <CircularProgressbar
        value={value}
        text={showText ? `${Math.round(value)}%` : ''}
        styles={buildStyles({
          pathColor: path,
          textColor: 'hsl(var(--foreground))',
          trailColor: trail,
          pathTransitionDuration: 0.5,
          textSize: '24px',
        })}
        strokeWidth={strokeWidth}
      />
      {label && (
        <div className="text-[10px] text-muted-foreground text-center mt-1 truncate" style={{ maxWidth: size }}>
          {label}
        </div>
      )}
    </div>
  );
}

'use client';

import { useMemo, useState, useEffect } from 'react';

interface Particle {
  id: number;
  size: number;
  x: number;
  y: number;
  duration: number;
  delay: number;
  color: string;
  opacity: number;
  drift: number;
}

const COLORS = [
  'var(--qpi-blue)',
  'var(--qpi-magenta)',
  'var(--success)',
  'var(--qpi-blue)',
  'var(--qpi-magenta)',
  'var(--primary)',
];

export function FloatingParticles({ count = 18 }: { count?: number }) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const particles = useMemo<Particle[]>(() => {
    // Seeded pseudo-random for consistent SSR/CSR
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    return Array.from({ length: count }, (_, i) => ({
      id: i,
      size: 4 + rand() * 200,
      x: rand() * 100,
      y: rand() * 100,
      duration: 25 + rand() * 40,
      delay: -(rand() * 30),
      color: COLORS[Math.floor(rand() * COLORS.length)],
      opacity: 0.03 + rand() * 0.06,
      drift: 15 + rand() * 40,
    }));
  }, [count]);

  if (reducedMotion) return null;

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full particle-float"
          style={{
            width: `${p.size}px`,
            height: `${p.size}px`,
            left: `${p.x}%`,
            top: `${p.y}%`,
            background: `radial-gradient(circle, ${p.color} 0%, transparent 70%)`,
            opacity: p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            '--drift-x': `${p.drift}px`,
            '--drift-y': `${p.drift * 0.7}px`,
            filter: `blur(${p.size > 80 ? p.size * 0.3 : 1}px)`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

interface AnimatedCheckProps {
  size?: number;
  color?: string;
  delay?: number;
}

export function AnimatedCheck({ size = 48, color = '#34d399', delay = 0 }: AnimatedCheckProps) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setAnimate(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <svg width={size} height={size} viewBox="0 0 52 52" className={animate ? 'animated-check' : ''}>
      <circle
        cx="26" cy="26" r="25"
        fill="none"
        stroke={color}
        strokeWidth="2"
        className={animate ? 'animated-check-circle' : ''}
        style={{ opacity: animate ? 1 : 0 }}
      />
      <path
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.1 27.2l7.1 7.2 16.7-16.8"
        className={animate ? 'animated-check-path' : ''}
        style={{ opacity: animate ? 1 : 0 }}
      />
    </svg>
  );
}

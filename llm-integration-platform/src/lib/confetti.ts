'use client';

import confetti from 'canvas-confetti';

/** Check if user prefers reduced motion */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Small celebration — task completed, model downloaded */
export function confettiSmall() {
  if (prefersReducedMotion()) return;
  confetti({
    particleCount: 50,
    spread: 60,
    origin: { y: 0.7 },
    colors: ['#7b9fc7', '#34d399', '#d63384'],
    disableForReducedMotion: true,
  });
}

/** Medium celebration — quantization complete, training done */
export function confettiMedium() {
  if (prefersReducedMotion()) return;
  const duration = 2000;
  const end = Date.now() + duration;

  (function frame() {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: ['#7b9fc7', '#34d399', '#fbbf24'],
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ['#d63384', '#34d399', '#7b9fc7'],
      disableForReducedMotion: true,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

/** Big celebration — full pipeline complete, level-up achievements */
export function confettiBig() {
  if (prefersReducedMotion()) return;
  const duration = 3000;
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999, disableForReducedMotion: true };

  function randomInRange(min: number, max: number) {
    return Math.random() * (max - min) + min;
  }

  const interval = setInterval(() => {
    confetti({
      ...defaults,
      particleCount: 40,
      origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
      colors: ['#7b9fc7', '#34d399', '#d63384', '#fbbf24'],
    });
    confetti({
      ...defaults,
      particleCount: 40,
      origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
      colors: ['#7b9fc7', '#34d399', '#d63384', '#fbbf24'],
    });
  }, 250);

  setTimeout(() => clearInterval(interval), duration);
}

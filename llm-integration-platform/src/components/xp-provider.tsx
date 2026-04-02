'use client';

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { XPAction, XP_VALUES, XPState, computeXPState, getLevel } from '@/lib/xp';
import { confettiBig } from '@/lib/confetti';
import { toastSuccess } from '@/lib/toast';

interface XPContextValue {
  state: XPState;
  addXP: (action: XPAction) => void;
}

const XPContext = createContext<XPContextValue | null>(null);

export function useXP() {
  const ctx = useContext(XPContext);
  if (!ctx) throw new Error('useXP must be inside XPProvider');
  return ctx;
}

export function XPProvider({ children }: { children: ReactNode }) {
  const [totalXP, setTotalXP] = useState(0);
  const [actions, setActions] = useState<{ action: XPAction; timestamp: number }[]>([]);
  const prevLevelRef = useRef(1);

  const addXP = useCallback((action: XPAction) => {
    const points = XP_VALUES[action];
    setTotalXP(prev => {
      const newXP = prev + points;
      const newLevel = getLevel(newXP);

      if (newLevel.level > prevLevelRef.current) {
        prevLevelRef.current = newLevel.level;
        setTimeout(() => {
          confettiBig();
          toastSuccess(
            `Level Up! Level ${newLevel.level}`,
            `You are now "${newLevel.title}" — keep going!`
          );
        }, 300);
      }

      return newXP;
    });
    setActions(prev => [...prev, { action, timestamp: Date.now() }]);
  }, []);

  const state = computeXPState(totalXP, actions);

  return (
    <XPContext.Provider value={{ state, addXP }}>
      {children}
    </XPContext.Provider>
  );
}

'use client';

import { useXP } from '@/components/xp-provider';
import { Zap } from 'lucide-react';

export function XPBar() {
  const { state } = useXP();

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border/50">
      <Zap className="h-3.5 w-3.5 text-amber-400" />
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">Lv.{state.level}</span>
        <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${state.progress}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground">{state.totalXP} XP</span>
      </div>
    </div>
  );
}

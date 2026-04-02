'use client';

export const XP_VALUES = {
  agentRun: 25,
  quantizeComplete: 50,
  finetuneComplete: 75,
  visionTrainComplete: 75,
  visionExportComplete: 30,
  modelDownload: 15,
  chatMessage: 5,
  datasetUpload: 20,
} as const;

export type XPAction = keyof typeof XP_VALUES;

const LEVELS = [
  { level: 1, xp: 0, title: 'Newcomer' },
  { level: 2, xp: 50, title: 'Explorer' },
  { level: 3, xp: 150, title: 'Practitioner' },
  { level: 4, xp: 300, title: 'Engineer' },
  { level: 5, xp: 500, title: 'Expert' },
  { level: 6, xp: 800, title: 'Master' },
  { level: 7, xp: 1200, title: 'Architect' },
  { level: 8, xp: 2000, title: 'Nexus Legend' },
];

export interface XPState {
  totalXP: number;
  level: number;
  title: string;
  xpInLevel: number;
  xpForNextLevel: number;
  progress: number;
  actions: { action: XPAction; timestamp: number }[];
}

export function getLevel(xp: number) {
  let current = LEVELS[0];
  for (const l of LEVELS) {
    if (xp >= l.xp) current = l;
    else break;
  }
  return current;
}

export function getNextLevel(xp: number) {
  for (const l of LEVELS) {
    if (xp < l.xp) return l;
  }
  return null;
}

export function computeXPState(totalXP: number, actions: { action: XPAction; timestamp: number }[]): XPState {
  const current = getLevel(totalXP);
  const next = getNextLevel(totalXP);
  const xpInLevel = totalXP - current.xp;
  const xpForNextLevel = next ? next.xp - current.xp : 0;
  const progress = next ? Math.min(100, (xpInLevel / xpForNextLevel) * 100) : 100;

  return {
    totalXP,
    level: current.level,
    title: current.title,
    xpInLevel,
    xpForNextLevel,
    progress,
    actions,
  };
}

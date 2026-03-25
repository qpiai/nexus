import type { ChildProcess } from 'child_process';

export interface FinetuneLogEntry {
  type: string;
  message: string;
  progress?: number;
}

export interface FinetuneLossPoint {
  step: number;
  loss: number;
  learning_rate?: number;
  epoch?: number;
}

const MAX_LOGS = 200;

interface FinetuneState {
  running: boolean;
  model: string;
  dataset: string;
  finetuningType: string;
  trainingMode: string;
  progress: number;
  logs: FinetuneLogEntry[];
  lossData: FinetuneLossPoint[];
  error: string | null;
  done: boolean;
  outputDir: string | null;
  finalResult: Record<string, unknown> | null;
  startTime: number;
  process: ChildProcess | null;
}

function createInitialState(): FinetuneState {
  return {
    running: false,
    model: '',
    dataset: '',
    finetuningType: '',
    trainingMode: '',
    progress: 0,
    logs: [],
    lossData: [],
    error: null,
    done: false,
    outputDir: null,
    finalResult: null,
    startTime: 0,
    process: null,
  };
}

// Per-user finetune state
const finetuneStates = new Map<string, FinetuneState>();

export function getFinetuneState(userId: string): FinetuneState {
  if (!finetuneStates.has(userId)) {
    finetuneStates.set(userId, createInitialState());
  }
  return finetuneStates.get(userId)!;
}

// Backward-compatible global alias (used only if no userId is available)
export const finetuneState = createInitialState();

export function resetState(userId?: string) {
  const state = userId ? getFinetuneState(userId) : finetuneState;
  Object.assign(state, createInitialState());
}

export function pushLog(entryOrUserId: FinetuneLogEntry | string, entry?: FinetuneLogEntry) {
  let state: FinetuneState;
  let logEntry: FinetuneLogEntry;

  if (typeof entryOrUserId === 'string' && entry) {
    state = getFinetuneState(entryOrUserId);
    logEntry = entry;
  } else {
    state = finetuneState;
    logEntry = entryOrUserId as FinetuneLogEntry;
  }

  state.logs.push(logEntry);
  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS);
  }
}

export function pushLoss(pointOrUserId: FinetuneLossPoint | string, point?: FinetuneLossPoint) {
  let state: FinetuneState;
  let lossPoint: FinetuneLossPoint;

  if (typeof pointOrUserId === 'string' && point) {
    state = getFinetuneState(pointOrUserId);
    lossPoint = point;
  } else {
    state = finetuneState;
    lossPoint = pointOrUserId as FinetuneLossPoint;
  }

  state.lossData.push(lossPoint);
}

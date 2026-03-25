import type { ChildProcess } from 'child_process';

export interface VisionTrainLogEntry {
  type: string;
  message: string;
  progress?: number;
}

export interface VisionEpochMetrics {
  epoch: number;
  totalEpochs: number;
  boxLoss: number;
  clsLoss: number;
  dflLoss: number;
  mAP50: number;
  mAP5095: number;
  precision: number;
  recall: number;
  learningRate: number;
}

const MAX_LOGS = 200;
const MAX_EPOCH_METRICS = 1000;

interface VisionTrainState {
  running: boolean;
  model: string;
  dataset: string;
  progress: number;
  logs: VisionTrainLogEntry[];
  epochMetrics: VisionEpochMetrics[];
  error: string | null;
  done: boolean;
  runDir: string | null;
  finalResult: Record<string, unknown> | null;
  startTime: number;
  process: ChildProcess | null;
}

function createInitialState(): VisionTrainState {
  return {
    running: false,
    model: '',
    dataset: '',
    progress: 0,
    logs: [],
    epochMetrics: [],
    error: null,
    done: false,
    runDir: null,
    finalResult: null,
    startTime: 0,
    process: null,
  };
}

// Per-user vision train state
const visionTrainStates = new Map<string, VisionTrainState>();

export function getVisionTrainState(userId: string): VisionTrainState {
  if (!visionTrainStates.has(userId)) {
    visionTrainStates.set(userId, createInitialState());
  }
  return visionTrainStates.get(userId)!;
}

// Backward-compatible global alias
export const visionTrainState = createInitialState();

export function resetVisionTrainState(userId?: string) {
  const state = userId ? getVisionTrainState(userId) : visionTrainState;

  // Kill any running process before clearing state to prevent orphans
  if (state.process && !state.process.killed) {
    try {
      state.process.kill('SIGTERM');
    } catch { /* process may have already exited */ }
  }

  Object.assign(state, createInitialState());
}

export function pushVisionTrainLog(entryOrUserId: VisionTrainLogEntry | string, entry?: VisionTrainLogEntry) {
  let state: VisionTrainState;
  let logEntry: VisionTrainLogEntry;

  if (typeof entryOrUserId === 'string' && entry) {
    state = getVisionTrainState(entryOrUserId);
    logEntry = entry;
  } else {
    state = visionTrainState;
    logEntry = entryOrUserId as VisionTrainLogEntry;
  }

  state.logs.push(logEntry);
  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS);
  }
}

export function pushEpochMetrics(metricsOrUserId: VisionEpochMetrics | string, metrics?: VisionEpochMetrics) {
  let state: VisionTrainState;
  let metricsEntry: VisionEpochMetrics;

  if (typeof metricsOrUserId === 'string' && metrics) {
    state = getVisionTrainState(metricsOrUserId);
    metricsEntry = metrics;
  } else {
    state = visionTrainState;
    metricsEntry = metricsOrUserId as VisionEpochMetrics;
  }

  // Merge train and val metrics for the same epoch
  const existing = state.epochMetrics.find(m => m.epoch === metricsEntry.epoch);
  if (existing) {
    Object.assign(existing, metricsEntry);
  } else {
    if (state.epochMetrics.length >= MAX_EPOCH_METRICS) {
      state.epochMetrics = state.epochMetrics.slice(-MAX_EPOCH_METRICS + 1);
    }
    state.epochMetrics.push(metricsEntry);
  }
}

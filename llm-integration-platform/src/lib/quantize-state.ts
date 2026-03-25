import type { ChildProcess } from 'child_process';

export interface QuantizeLogEntry {
  type: string;
  message: string;
  progress?: number;
}

const MAX_LOGS = 200;

interface QuantizeState {
  running: boolean;
  model: string;
  method: string;
  bits: number;
  progress: number;
  logs: QuantizeLogEntry[];
  error: string | null;
  done: boolean;
  outputFile: string | null;
  outputDir: string | null;
  startTime: number;
  process: ChildProcess | null;
}

function createInitialState(): QuantizeState {
  return {
    running: false,
    model: '',
    method: '',
    bits: 0,
    progress: 0,
    logs: [],
    error: null,
    done: false,
    outputFile: null,
    outputDir: null,
    startTime: 0,
    process: null,
  };
}

// Per-user quantize state
const quantizeStates = new Map<string, QuantizeState>();

export function getQuantizeState(userId: string): QuantizeState {
  if (!quantizeStates.has(userId)) {
    quantizeStates.set(userId, createInitialState());
  }
  return quantizeStates.get(userId)!;
}

export function resetQuantizeState(userId: string) {
  const state = getQuantizeState(userId);

  // Kill any running process before clearing state
  if (state.process && !state.process.killed) {
    try {
      state.process.kill('SIGTERM');
    } catch { /* process may have already exited */ }
  }

  Object.assign(state, createInitialState());
}

export function pushQuantizeLog(userId: string, entry: QuantizeLogEntry) {
  const state = getQuantizeState(userId);
  state.logs.push(entry);
  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS);
  }
}

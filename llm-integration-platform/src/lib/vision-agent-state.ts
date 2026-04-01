export interface VisionAgentEventEntry {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

const MAX_EVENTS = 100;

interface VisionAgentRunState {
  running: boolean;
  events: VisionAgentEventEntry[];
  error: string | null;
  done: boolean;
  startTime: number;
}

function createInitialState(): VisionAgentRunState {
  return {
    running: false,
    events: [],
    error: null,
    done: false,
    startTime: 0,
  };
}

const visionAgentStates = new Map<string, VisionAgentRunState>();

export function getVisionAgentState(userId: string): VisionAgentRunState {
  if (!visionAgentStates.has(userId)) {
    visionAgentStates.set(userId, createInitialState());
  }
  return visionAgentStates.get(userId)!;
}

export function resetVisionAgentState(userId: string) {
  const state = getVisionAgentState(userId);
  Object.assign(state, createInitialState());
}

export function pushVisionAgentEvent(userId: string, type: string, data: Record<string, unknown>) {
  const state = getVisionAgentState(userId);
  state.events.push({ type, data, timestamp: Date.now() });
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
}

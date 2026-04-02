export interface AgentEventEntry {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

const MAX_EVENTS = 100;

interface AgentRunState {
  running: boolean;
  events: AgentEventEntry[];
  error: string | null;
  done: boolean;
  startTime: number;
  runId: string;
  abortController: AbortController | null;
}

function createInitialState(): AgentRunState {
  return {
    running: false,
    events: [],
    error: null,
    done: false,
    startTime: 0,
    runId: '',
    abortController: null,
  };
}

// Per-user agent state
const agentStates = new Map<string, AgentRunState>();

export function getAgentState(userId: string): AgentRunState {
  if (!agentStates.has(userId)) {
    agentStates.set(userId, createInitialState());
  }
  return agentStates.get(userId)!;
}

export function resetAgentState(userId: string) {
  const state = getAgentState(userId);
  Object.assign(state, createInitialState());
}

export function pushAgentEvent(userId: string, type: string, data: Record<string, unknown>) {
  const state = getAgentState(userId);
  state.events.push({ type, data, timestamp: Date.now() });
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
}

import { AgentWorkflow } from './types';

class Store {
  private workflows: Map<string, AgentWorkflow> = new Map();

  getWorkflows(userId?: string): AgentWorkflow[] {
    const all = Array.from(this.workflows.values());
    if (!userId) return all;
    return all.filter(wf => wf.userId === userId);
  }
  getWorkflow(id: string): AgentWorkflow | undefined { return this.workflows.get(id); }
  addWorkflow(wf: AgentWorkflow): void { this.workflows.set(wf.id, wf); }
  updateWorkflow(id: string, updates: Partial<AgentWorkflow>): void {
    const wf = this.workflows.get(id);
    if (wf) this.workflows.set(id, { ...wf, ...updates });
  }
}

const globalStore = globalThis as unknown as { __store?: Store };
if (!globalStore.__store) {
  globalStore.__store = new Store();
}
export const store: Store = globalStore.__store;

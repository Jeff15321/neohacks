import { FLOW_LIMITS, FlowRun } from '@app/contracts';
import { isFlowTerminal } from '@app/core';
import { storage } from '../../platform/index.js';

/** Storage keys owned by modules/flow. FlowRuns live in storage.session (survive SW suspension, not browser restart). */
const KEY = 'wwa_flow_runs';

export class FlowStore {
  private map = new Map<string, FlowRun>();
  readonly ready: Promise<void>;
  constructor() {
    this.ready = storage.session.get<unknown[]>(KEY).then(list => {
      for (const raw of list ?? []) { const r = FlowRun.safeParse(raw); if (r.success) this.map.set(r.data.runId, r.data); }
    });
  }
  get(id: string) { return this.map.get(id); }
  list() { return [...this.map.values()].sort((a, b) => b.createdAt - a.createdAt); }
  active() { return this.list().filter(r => !isFlowTerminal(r.status)); }
  async put(r: FlowRun) {
    this.map.set(r.runId, r);
    // keep every active run + the newest finished ones (panel trace)
    const done = this.list().filter(x => isFlowTerminal(x.status));
    for (const old of done.slice(FLOW_LIMITS.HISTORY)) this.map.delete(old.runId);
    await storage.session.set(KEY, [...this.map.values()]);
  }
}

import type { Bus } from '../../bus.js';
import { StepStore } from './steps.js';

/**
 * Phase B: Step ingest (global seq, storage.session ring, late-effect merge) — see README.md.
 * Phase D adds the ObserveClient (activity model) on top via `bus.use('steps.subscribe')`.
 */
export function registerObserve(bus: Bus) {
  const store = new StepStore();
  bus.provide('steps.ingest', (draft, tabId, windowId) => store.ingest(draft, tabId, windowId));
  bus.provide('steps.subscribe', (fn) => store.subscribe(fn));
  bus.provide('steps.recent', (limit) => store.recent(limit));

  bus.onPage('WWA_STEP', async (m, ctx) => {
    const step = await store.ingest(m.step, ctx.tabId ?? -1, ctx.sender.tab?.windowId);
    return { seq: step.seq };
  });
  bus.onPage('WWA_STEP_LATE', (m) => {
    const s = store.mergeLate(m.stepId, m.late);
    if (s) bus.broadcast({ type: 'STEP_UPDATED', step: s });
  });
  bus.on('GET_STEPS', async (m) => { await store.ready; return { steps: store.recent(m.limit ?? 100) }; });
}

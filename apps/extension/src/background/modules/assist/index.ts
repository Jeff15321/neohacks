import type { Bus } from '../../bus.js';
import { AssistService } from './service.js';

/** Self-healing runtime (decision B). See README.md. */
export function registerAssist(bus: Bus) {
  const svc = new AssistService(bus);
  const ready = svc.store.ready;

  // generated widget → SW (widget existence / approval / origin checked by the bus; no extra grant needed)
  bus.onUserScript('WIDGET_ASSIST', async (m, ctx) => { await ready; return svc.assist(m.widgetId, m.report, ctx.tabId, ctx.traceId); });
  bus.onUserScript('WIDGET_RUN_EVENT', async (m, ctx) => { await ready; return svc.onEvent(m.widgetId, m.runId, m.event, ctx.traceId); });

  // panel → SW
  bus.on('GET_RUNS', async (m) => { await ready; return { runs: svc.store.list(m.widgetId, m.limit ?? 10) }; });
  bus.on('LEARNED_BRANCH_DECISION', async (m, ctx) => { await ready; return svc.learnedDecision(m.runId, m.step, m.accept, ctx.traceId); });
  return svc;
}

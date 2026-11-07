import type { Bus } from '../../bus.js';
import { alarms, runtime, tabs } from '../../platform/index.js';
import { FlowService } from './service.js';

/** Doc §5 FlowCoordinator: WidgetAI.flow (grant "flow"), durable FlowRuns, alarms, cancellation. See README.md. */
export function registerFlow(bus: Bus) {
  const svc = new FlowService(bus);
  (globalThis as { __wwaFlow?: FlowService }).__wwaFlow = svc; // debugging from the SW console / tests (E7 timings)
  void svc.recover();
  runtime.onStartup(() => void svc.recover());
  alarms.onAlarm(name => void svc.onAlarm(name));
  tabs.onRemoved(tabId => void svc.onTabRemoved(tabId));
  tabs.onUpdatedComplete(tabId => void svc.onTabComplete(tabId));

  // panel → SW
  bus.on('GET_FLOW_RUNS', async () => { await svc.store.ready; return { runs: svc.store.list() }; });
  bus.on('CANCEL_FLOW_RUN', (m) => svc.cancel(m.runId, null, 'cancelled from the panel'));

  // home part → SW (bus checks widget existence/approval/origin/grant first)
  bus.onUserScript('FLOW_CALL', (m, ctx) => svc.call(m.widgetId, m.role, m.handler, m.input, m.opts ?? {}, ctx.tabId, ctx.traceId), 'flow');
  bus.onUserScript('FLOW_WAIT', (m) => svc.wait(m.runId, m.widgetId), 'flow');
  bus.onUserScript('FLOW_CANCEL', (m) => svc.cancel(m.runId, m.widgetId, 'cancelled by the widget'), 'flow');
  // sink part ("<widgetId>#<role>", confined to the part's own match patterns by widgets.authorize) → SW
  bus.onUserScript('FLOW_RESULT', (m, ctx) => svc.result(m.runId, m.widgetId, ctx.tabId, m.ok, m.result, m.error), 'flow');
  bus.onUserScript('FLOW_CHECKPOINT', (m) => svc.checkpoint(m.runId, m.widgetId, m.state), 'flow');
  bus.onUserScript('FLOW_STATUS', (m) => svc.status(m.runId, m.widgetId), 'flow');
  return svc;
}

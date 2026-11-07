import type { InferenceResponse } from '@app/contracts';
import type { Bus } from '../../bus.js';
import { backend, runtime, storage } from '../../platform/index.js';
import { WidgetService } from './service.js';
import { widgetStorageKey } from './store.js';

export function registerWidgets(bus: Bus) {
  const svc = new WidgetService(bus);
  const ready = svc.store.ready;
  void ready.then(() => svc.syncRegistrations());
  runtime.onStartup(() => void ready.then(() => svc.syncRegistrations()));

  bus.provide('widgets.list', () => svc.store.list());
  bus.provide('widgets.get', (id) => svc.store.get(id));
  bus.provide('widgets.authorize', (id, url, grant) => svc.authorize(id, url, grant));
  bus.provide('widgets.generate', async (request, traceId, opts) => { await ready; return svc.generate(request, traceId, opts); });

  // panel → SW
  bus.on('GENERATE_WIDGET', async (m, ctx) => { await ready; return { widget: await svc.generate(m.request, ctx.traceId) }; });
  bus.on('APPROVE_WIDGET', async (m, ctx) => { await ready; return svc.approve(m.widgetId, ctx.traceId); });
  bus.on('RUN_WIDGET', async (m, ctx) => { await ready; return svc.run(m.widgetId, ctx.traceId); });
  bus.on('REPAIR_WIDGET', async (m, ctx) => { await ready; return { widget: await svc.repair(m.widgetId, m.instruction, ctx.traceId) }; });
  bus.on('REMOVE_WIDGET', async (m) => { await ready; await svc.remove(m.widgetId); });
  bus.on('LIST_WIDGETS', async () => { await ready; return { widgets: svc.store.list() }; });

  // generated widget → SW (existence, approval, origin and grant are checked by the bus before these run)
  bus.onUserScript('WIDGET_INFERENCE', async (m, ctx) => {
    const res = await backend.post<InferenceResponse>('/api/inference', { prompt: m.prompt, context: m.context, instruction: m.instruction, widgetId: m.widgetId }, ctx.traceId);
    if (!res.ok) throw new Error(res.error ?? 'inference failed');
    return { text: res.text };
  }, 'inference');
  bus.onUserScript('WIDGET_STORAGE', async (m) => {
    const key = widgetStorageKey(m.widgetId, m.key);
    if (m.op === 'get') return { value: await storage.local.get(key) };
    if (m.op === 'set') await storage.local.set(key, m.value);
    else await storage.local.remove(key);
  }, 'storage');
  bus.onUserScript('WIDGET_LOG', (m, ctx) => {
    const w = svc.mustGet(m.widgetId);
    bus.broadcast({ type: 'WIDGET_STATUS', widgetId: w.id, status: w.status, log: `[${m.level}] ${m.message}`, traceId: ctx.traceId });
  });
  bus.onUserScript('WIDGET_STATUS', (m, ctx) => { svc.setStatus(svc.mustGet(m.widgetId), m.status, m.detail, ctx.traceId); });
  return svc;
}

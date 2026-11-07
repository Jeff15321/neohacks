import type { Bus } from '../../bus.js';
import { backend } from '../../platform/index.js';
import { DataService, collectionDenied, type DataBackend } from './service.js';

/** User data store (WidgetAI.db): user-script WIDGET_DATA + panel DATA_* → backend /api/data. See README.md. */
export function registerData(bus: Bus, api: DataBackend = backend) {
  const svc = new DataService(api);

  /** Existing collection names, sent with GENERATE_WIDGET so the generator reuses them. */
  bus.provide('data.collections', async () => (await svc.collections()).map(c => c.name));

  // panel → SW
  bus.on('DATA_LIST_COLLECTIONS', async (_m, ctx) => ({ collections: await svc.collections(ctx.traceId) }));
  bus.on('DATA_LIST', async (m, ctx) => svc.list(m.collection, { limit: m.limit, after: m.after }, ctx.traceId));
  bus.on('DATA_DELETE', async (m, ctx) => ({ removed: await svc.remove(m.collection, m.id, ctx.traceId) }));
  bus.on('DATA_CLEAR', async (m, ctx) => ({ removed: await svc.clear(m.collection, ctx.traceId) }));

  // generated widget → SW. The bus already checked existence/approval/origin/grant "data"; here: declared collection.
  bus.onUserScript('WIDGET_DATA', async (m, ctx) => {
    const denied = collectionDenied(bus.use('widgets.get')(m.widgetId), m.collection);
    if (denied) throw new Error(denied);
    return svc.widgetOp(m, ctx.traceId);
  }, 'data');

  return svc;
}

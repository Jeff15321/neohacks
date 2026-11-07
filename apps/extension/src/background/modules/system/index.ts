import { DEFAULT_SETTINGS, PageContext, type Settings } from '@app/contracts';
import type { Bus } from '../../bus.js';
import { backend, storage, tabs, userScripts } from '../../platform/index.js';

const SETTINGS_KEY = 'wwa_settings';

async function pageContext(tab: chrome.tabs.Tab): Promise<PageContext> {
  try {
    const ctx = await tabs.send(tab.id!, { type: 'WWA_GET_CONTEXT' }, 0);
    const parsed = PageContext.safeParse(ctx);
    if (parsed.success) return parsed.data;
  } catch { /* content script absent (chrome://, pdf, not yet loaded) */ }
  const url = new URL(tab.url ?? 'http://unknown/');
  return { url: tab.url ?? '', origin: url.origin, title: tab.title ?? '', landmarks: [], insertionCandidates: [], textSample: '', interactive: [] };
}

/** Health, page context, settings flags, bus log and LLM-call log (Inspector). */
export function registerSystem(bus: Bus) {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const ready = storage.local.get<Partial<Settings>>(SETTINGS_KEY).then(s => { settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) }; });

  bus.provide('settings.get', () => settings);
  bus.provide('page.context', pageContext);

  bus.on('PANEL_READY', async () => ({ widgets: bus.use('widgets.list')() }));
  bus.on('GET_HEALTH', async () => {
    const h = await backend.health();
    return { health: { userScripts: userScripts.available(), backend: h.status, provider: h.provider, backendUrl: backend.url, widgets: bus.use('widgets.list')().length } };
  });
  bus.on('GET_PAGE_CONTEXT', async () => {
    const tab = await tabs.findTarget();
    if (!tab?.id) throw new Error('no eligible tab');
    return { context: await pageContext(tab) };
  });
  bus.on('GET_SETTINGS', async () => { await ready; return { settings }; });
  bus.on('SET_SETTINGS', async (m) => {
    await ready;
    settings = { ...settings, ...m.patch };
    await storage.local.set(SETTINGS_KEY, settings);
    bus.broadcast({ type: 'SETTINGS_CHANGED', settings });
    return { settings };
  });
  bus.on('GET_BUS_LOG', (m) => ({ entries: bus.log.list(m.limit ?? 200) }));
  bus.on('GET_LLM_CALLS', async (m, ctx) => {
    const q = new URLSearchParams();
    if (m.filterTraceId) q.set('traceId', m.filterTraceId);
    q.set('limit', String(m.limit ?? 50));
    const r = await backend.get<{ ok: boolean; calls: unknown[] }>(`/api/debug/llm-calls?${q}`, ctx.traceId);
    return { calls: r.calls ?? [] };
  });
}
